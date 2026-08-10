/**
 * BrainDump AI Story Integration Test
 *
 * Feeds a progressive job-search story to the real AI pipeline, chapter by
 * chapter, and evaluates whether the AI correctly:
 *   · Extracts new tasks (Ch 1-2, 5-8)
 *   · Enriches existing tasks instead of duplicating (Ch 3)
 *   · Adds subtasks to existing tasks (Ch 4)
 *   · Handles extreme multi-item dumps without losing threads (Ch 7)
 *   · Demonstrates cross-dump memory (Ch 3, 5, 7, 8)
 *   · Avoids hallucinated / placeholder UUIDs
 *
 * Run:  npm run test:story
 *
 * Requires in .env.local:
 *   TEST_USER_EMAIL=your@email.com
 *   TEST_USER_PASSWORD=yourpassword
 *
 * NOTE: This test writes real data to your Supabase account. The afterAll
 * block prints DELETE statements you can run to clean up.
 */

import { beforeAll, afterAll, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

// ─── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN ?? ''
const HF_MODEL = 'deepseek-ai/DeepSeek-V3-0324:novita'
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions'
const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

// ─── Shared state ──────────────────────────────────────────────────────────

let supabase: SupabaseClient
let userId: string
const testDumpIds: string[] = []
const testTaskIds: string[] = []

// ─── Zod schemas (mirror of extract-tasks/route.ts) ───────────────────────

const nullStr = z.string().nullable().optional().transform(v =>
  (v === 'null' || v === 'undefined' || v === '' || v == null) ? null : v
)

const AiResponse = z.object({
  tasks: z.array(z.object({
    title: z.string(),
    description: nullStr,
    priority: z.enum(['low', 'medium', 'high']).catch('medium'),
    due_date: nullStr,
  })),
  enrichments: z.array(z.object({
    task_id: z.string().nullable().optional(),
    additional_context: z.string().nullable().optional(),
  })).optional().default([]),
  subtask_additions: z.array(z.object({
    task_id: z.string().nullable().optional(),
    subtask_title: z.string().nullable().optional(),
  })).optional().default([]),
  summary: z.string(),
})

type AiOutput = z.infer<typeof AiResponse>

type DbTask = {
  id: string
  title: string
  description: string | null
  status: string
  subtasks: Array<{ id: string; title: string; completed: boolean }> | null
}

type DbDump = {
  content: string
  created_at: string
}

// ─── System prompt (mirror of route.ts) ───────────────────────────────────

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0]
  return `You are an AI second-brain assistant. Extract actionable tasks from brain dumps and connect them to existing open tasks intelligently.

Today's date: ${today}. Use this when inferring due dates — never produce a date in the past. Always use the correct year.

Respond ONLY with a valid JSON object — no explanation, no markdown, no code blocks.

Required JSON format:
{
  "tasks": [{ "title": "...", "description": "...", "priority": "low|medium|high", "due_date": "YYYY-MM-DD or null" }],
  "enrichments": [{ "task_id": "exact UUID of existing task", "additional_context": "..." }],
  "subtask_additions": [{ "task_id": "exact UUID of existing task", "subtask_title": "..." }],
  "summary": "one sentence describing what was processed"
}

STEP 1 — INVENTORY: Read the entire dump and list every distinct actionable item before deciding what to do with any of them. Do not skip items.

STEP 2 — CLASSIFY each item using these rules in order:

A. ENRICHMENT: New info, update, or context about an existing task. Use "enrichments". Do not also create a new task for the same content.

B. SUBTASK: A direct action step required to complete an existing task — only makes sense as part of that parent, no independent value.
   → "Ask Sarah to review the resume" IS a subtask of "Update resume".
   → "Prepare for CyberX interview" is NOT a subtask of "Follow up with Jake" — it is substantial independent work.
   → "Write a cover letter for CyberX" is NOT a subtask of any follow-up task — it stands alone.
   → When in doubt: if the item could appear on its own to-do list and make sense without the parent, make it a new task.

C. NEW TASK: Everything else — no existing home, OR substantial standalone work even if loosely related to an existing task.
   → Title: specific verb + object. Description: carry useful context from the dump.

D. NOT A TASK: Negative statements, preferences, pure observations. Attach as enrichment if relevant, otherwise discard.

STEP 3 — OUTPUT: Every item from Step 1 must appear in exactly one of: tasks, enrichments, subtask_additions, or be explicitly discarded. Nothing may be silently dropped.

CRITICAL: One action per item — never both a new task AND an enrichment/subtask for the same content.
Use the exact task_id UUID from the provided list. Never fabricate or guess a UUID.`
}

// ─── AI pipeline (mirrors route.ts logic, no Next.js deps) ────────────────

async function fetchExistingContext(): Promise<{ dumps: DbDump[]; tasks: DbTask[] }> {
  const [{ data: recentDumps }, { data: existingTasks }] = await Promise.all([
    supabase
      .from('brain_dumps')
      .select('content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('tasks')
      .select('id, title, description, status, subtasks')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(15),
  ])
  return { dumps: (recentDumps ?? []) as DbDump[], tasks: (existingTasks ?? []) as DbTask[] }
}

function buildUserMessage(content: string, dumps: DbDump[], tasks: DbTask[]): string {
  const dumpContext = dumps.length
    ? `Recent brain dumps for context:\n${dumps.map(d => `- ${d.content.substring(0, 200)}`).join('\n')}`
    : ''

  const taskContext = tasks.length
    ? `Existing pending tasks (use their IDs in enrichments/subtask_additions instead of creating duplicates):\n${tasks.map(t => {
        const desc = t.description ? ` | Context: ${t.description.substring(0, 120)}` : ''
        return `- ID: ${t.id} | Title: ${t.title}${desc}`
      }).join('\n')}`
    : ''

  return [dumpContext, taskContext, `Brain dump to process:\n"""\n${content}\n"""`, 'Extract new tasks and identify enrichments/subtask additions for existing tasks. Return as JSON.']
    .filter(Boolean).join('\n\n')
}

async function callHuggingFace(userMessage: string): Promise<AiOutput> {
  const res = await fetch(HF_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(90_000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`HF API ${res.status}: ${JSON.stringify(err)}`)
  }

  const hfData = await res.json()
  const raw: string = hfData.choices?.[0]?.message?.content ?? ''
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return AiResponse.parse(JSON.parse(json))
}

function dedup(output: AiOutput): AiOutput {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'also', 'just', 'then'])
  const tokens = (t: string) => t.toLowerCase().split(/[\s\-\/]+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(w => w.length > 3 && !STOP.has(w))

  output.enrichments = output.enrichments.filter(e => e.task_id && UUID_RE.test(e.task_id) && e.additional_context?.trim())
  output.subtask_additions = output.subtask_additions.filter(s => s.task_id && UUID_RE.test(s.task_id) && s.subtask_title?.trim())

  if (output.enrichments.length + output.subtask_additions.length > 0) {
    const covered = new Set<string>()
    output.subtask_additions.forEach(s => tokens(s.subtask_title!).forEach(w => covered.add(w)))
    output.enrichments.forEach(e => tokens(e.additional_context!).forEach(w => covered.add(w)))
    output.tasks = output.tasks.filter(t => tokens(t.title).filter(w => covered.has(w)).length < 2)
  }

  return output
}

// ─── Chapter runner ────────────────────────────────────────────────────────

type Check = {
  label: string
  evaluate(args: {
    newTasks: string[]
    enrichedIds: string[]
    subtaskIds: string[]
    tasksAfter: DbTask[]
  }): { pass: boolean; detail: string }
}

type ChapterResult = {
  name: string
  summary: string
  newTasks: string[]
  enrichedIds: string[]
  subtaskIds: string[]
  enrichedTitles: string[]
  subtaskParentTitles: string[]
  checks: Array<{ label: string; pass: boolean; detail: string }>
}

async function runChapter(name: string, dump: string, checks: Check[]): Promise<ChapterResult> {
  console.log(`\n${'━'.repeat(70)}`)
  console.log(`  ${name}`)
  console.log(`${'━'.repeat(70)}`)
  console.log(`  DUMP: "${dump.substring(0, 130)}${dump.length > 130 ? '…' : ''}"`)

  // Snapshot before
  const { dumps, tasks: existingTasks } = await fetchExistingContext()
  const validIds = new Set(existingTasks.map(t => t.id))
  const taskMapBefore = new Map(existingTasks.map(t => [t.id, { ...t }]))

  // Run AI
  const userMessage = buildUserMessage(dump, dumps, existingTasks)
  const raw = await callHuggingFace(userMessage)
  const output = dedup(raw)

  // Save brain dump
  const { data: brainDump } = await supabase
    .from('brain_dumps')
    .insert({ user_id: userId, content: dump })
    .select()
    .single()
  if (brainDump) testDumpIds.push(brainDump.id)

  // Save new tasks
  const newTaskTitles: string[] = []
  if (output.tasks.length > 0) {
    const { data: inserted } = await supabase
      .from('tasks')
      .insert(output.tasks.map(t => ({
        user_id: userId,
        brain_dump_id: brainDump?.id,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority,
        due_date: t.due_date ?? null,
        status: 'pending' as const,
      })))
      .select('id, title')
    if (inserted) {
      inserted.forEach(t => { testTaskIds.push(t.id); newTaskTitles.push(t.title) })
    }
  }

  // Apply enrichments
  const enrichedIds: string[] = []
  for (const e of output.enrichments) {
    if (!e.task_id || !validIds.has(e.task_id)) continue
    const prev = taskMapBefore.get(e.task_id)
    if (!prev) continue
    const newDesc = prev.description ? `${prev.description}\n\nUpdate: ${e.additional_context}` : e.additional_context!
    const { error } = await supabase
      .from('tasks')
      .update({ description: newDesc, updated_at: new Date().toISOString() })
      .eq('id', e.task_id).eq('user_id', userId)
    if (!error) enrichedIds.push(e.task_id)
  }

  // Apply subtask additions
  const subtaskIds: string[] = []
  for (const s of output.subtask_additions) {
    if (!s.task_id || !validIds.has(s.task_id)) continue
    const prev = taskMapBefore.get(s.task_id)
    if (!prev) continue
    const current = Array.isArray(prev.subtasks) ? prev.subtasks : []
    const { error } = await supabase
      .from('tasks')
      .update({
        subtasks: [...current, { id: crypto.randomUUID(), title: s.subtask_title!, completed: false, created_at: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      })
      .eq('id', s.task_id).eq('user_id', userId)
    if (!error) subtaskIds.push(s.task_id)
  }

  // Snapshot after
  const { data: tasksAfterRaw } = await supabase
    .from('tasks')
    .select('id, title, description, status, subtasks')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)
  const tasksAfter = (tasksAfterRaw ?? []) as DbTask[]

  const enrichedTitles = tasksAfter.filter(t => enrichedIds.includes(t.id)).map(t => t.title)
  const subtaskParentTitles = tasksAfter.filter(t => subtaskIds.includes(t.id)).map(t => t.title)

  // Evaluate
  const evaluated = checks.map(c => ({
    label: c.label,
    ...c.evaluate({ newTasks: newTaskTitles, enrichedIds, subtaskIds, tasksAfter }),
  }))

  // Console report
  console.log(`\n  AI SUMMARY: "${output.summary}"`)
  console.log(`  CONTEXT FED TO AI: ${dumps.length}/5 recent dumps · ${existingTasks.length}/15 pending tasks`)
  console.log(`\n  NEW TASKS (${newTaskTitles.length}):`)
  newTaskTitles.forEach(t => console.log(`    + "${t}"`))
  if (!newTaskTitles.length) console.log('    (none)')
  console.log(`\n  ENRICHMENTS (${enrichedIds.length}): ${enrichedTitles.map(t => `"${t}"`).join(', ') || '(none)'}`)
  console.log(`  SUBTASKS ADDED (${subtaskIds.length}): ${subtaskParentTitles.map(t => `"${t}"`).join(', ') || '(none)'}`)
  console.log(`\n  CHECKS:`)
  evaluated.forEach(c => {
    console.log(`    ${c.pass ? '✓' : '✗'} ${c.label}`)
    if (c.detail) console.log(`        ${c.detail}`)
  })

  return { name, summary: output.summary, newTasks: newTaskTitles, enrichedIds, subtaskIds, enrichedTitles, subtaskParentTitles, checks: evaluated }
}

// ─── Check factories ───────────────────────────────────────────────────────

function hasNewTask(titleContains: string): Check {
  return {
    label: `Creates new task matching "${titleContains}"`,
    evaluate: ({ newTasks }) => {
      const found = newTasks.find(t => t.toLowerCase().includes(titleContains.toLowerCase()))
      return found
        ? { pass: true, detail: `→ "${found}"` }
        : { pass: false, detail: `Not found. Got: [${newTasks.join(' | ')}]` }
    },
  }
}

function noNewTask(titleContains: string): Check {
  return {
    label: `No duplicate task for "${titleContains}"`,
    evaluate: ({ newTasks }) => {
      const dup = newTasks.find(t => t.toLowerCase().includes(titleContains.toLowerCase()))
      return dup
        ? { pass: false, detail: `Duplicate created: "${dup}"` }
        : { pass: true, detail: 'Not duplicated ✓' }
    },
  }
}

function enriches(parentContains: string): Check {
  return {
    label: `Enriches existing "${parentContains}" task (not creates duplicate)`,
    evaluate: ({ enrichedIds, tasksAfter }) => {
      const hit = tasksAfter.find(t => enrichedIds.includes(t.id) && t.title.toLowerCase().includes(parentContains.toLowerCase()))
      if (hit) return { pass: true, detail: `→ enriched "${hit.title}"` }
      if (enrichedIds.length) {
        const enrichedNames = tasksAfter.filter(t => enrichedIds.includes(t.id)).map(t => t.title)
        return { pass: false, detail: `Enriched wrong tasks: [${enrichedNames.join(' | ')}]` }
      }
      return { pass: false, detail: 'No enrichments applied' }
    },
  }
}

function addsSubtask(parentContains: string): Check {
  return {
    label: `Adds subtask to "${parentContains}" task`,
    evaluate: ({ subtaskIds, tasksAfter }) => {
      const hit = tasksAfter.find(t => subtaskIds.includes(t.id) && t.title.toLowerCase().includes(parentContains.toLowerCase()))
      if (hit) {
        const subs = Array.isArray(hit.subtasks) ? hit.subtasks : []
        const newest = subs[subs.length - 1]
        return { pass: true, detail: `→ added "${newest?.title}" to "${hit.title}"` }
      }
      return { pass: false, detail: `No subtask added to task matching "${parentContains}"` }
    },
  }
}

function newTaskCount(min: number, max: number): Check {
  return {
    label: `Creates ${min === max ? min : `${min}–${max}`} new task(s)`,
    evaluate: ({ newTasks }) => {
      const n = newTasks.length
      return {
        pass: n >= min && n <= max,
        detail: `Got ${n} new tasks`,
      }
    },
  }
}

function demonstratesMemory(): Check {
  return {
    label: 'Demonstrates cross-dump memory (at least 1 enrichment or subtask)',
    evaluate: ({ enrichedIds, subtaskIds }) => {
      const total = enrichedIds.length + subtaskIds.length
      return total > 0
        ? { pass: true, detail: `${enrichedIds.length} enrichments + ${subtaskIds.length} subtask additions` }
        : { pass: false, detail: 'No cross-dump linking — AI treated this as isolated input' }
    },
  }
}

// ─── The story (8 chapters, escalating complexity) ─────────────────────────

const STORY: Array<{ name: string; dump: string; checks: Check[] }> = [
  {
    name: 'Ch.1 — First Contact (baseline: new task creation)',
    dump: 'Went to a networking event tonight. Met Jake Chen, hiring manager at CyberX Security. They are hiring for a Senior Security Engineer, $160-200k range. He gave me his card and seemed very interested in my zero-trust architecture background.',
    checks: [
      hasNewTask('Jake'),
      hasNewTask('CyberX'),
      newTaskCount(1, 2),
    ],
  },
  {
    name: 'Ch.2 — Separate Tracks (multiple unrelated tasks)',
    dump: 'I really need to update my resume — it was last touched in 2022, two years out of date. Also should research what skills cybersecurity companies are demanding right now: AWS, zero-trust, and SOC2 compliance seem to keep coming up. And I need to practice system design interviews since I am very rusty.',
    checks: [
      hasNewTask('resume'),
      hasNewTask('research'),
      noNewTask('Jake'),
      noNewTask('CyberX'),
      newTaskCount(2, 3),
    ],
  },
  {
    name: 'Ch.3 — First Linking Moment ⭐ KEY TEST (enrich, not duplicate)',
    dump: 'Jake from the networking event messaged me on LinkedIn. He wants me to send my resume by this Friday. CyberX specifically needs someone with deep AWS security experience and zero-trust — which matches exactly what I was already researching.',
    checks: [
      demonstratesMemory(),
      enriches('resume'),
      noNewTask('resume'),
      noNewTask('Jake'),
      newTaskCount(0, 1),
    ],
  },
  {
    name: 'Ch.4 — Subtask Addition ⭐ KEY TEST (action steps, not new tasks)',
    dump: 'For the resume update I need to: combine my 2022 LinkedIn export, 2021 job application version, and an old portfolio doc into one clean document. Also need my colleague Sarah to review it before I send it to Jake. And I should write a custom cover letter specifically targeting CyberX.',
    checks: [
      addsSubtask('resume'),
      noNewTask('Sarah'),
      hasNewTask('cover letter'),
      newTaskCount(0, 2),
    ],
  },
  {
    name: 'Ch.5 — Interview Scheduled (new task + memory of existing)',
    dump: 'Sent my resume to Jake this morning — he responded within the hour! CyberX wants to schedule a technical interview next Tuesday at 2pm. Need to prep for deep questions on AWS security architecture, zero-trust implementation patterns, and incident response procedures.',
    checks: [
      hasNewTask('interview'),
      demonstratesMemory(),
      noNewTask('resume'),
      newTaskCount(1, 3),
    ],
  },
  {
    name: 'Ch.6 — Parallel Tracks + Personal Noise (isolation test)',
    dump: 'Also applied to TechCorp last month and never heard back — should follow up with them. Have a coffee chat scheduled with Maria from CloudShield next week, she was referred by Tom my old colleague. Personal stuff: need to fix the leak under the bathroom sink, pick up groceries this weekend, and call my mom for her birthday on Thursday.',
    checks: [
      hasNewTask('TechCorp'),
      hasNewTask('CloudShield'),
      hasNewTask('birthday'),
      noNewTask('CyberX'),
      noNewTask('Jake'),
      noNewTask('interview'),
      newTaskCount(3, 6),
    ],
  },
  {
    name: 'Ch.7 — EXTREME DUMP 🔥 (10 items, cross-thread linking, stress test)',
    dump: `The CyberX technical interview was incredible — Jake was there with three senior engineers. Two hours of AWS architecture deep dive. They loved my zero-trust implementation story from Acme Corp. Lead engineer asked detailed SOC2 compliance automation questions. Jake said they will decide by end of this week.

Ten more things I need to handle:
1) TechCorp finally emailed back — they want a phone screen tomorrow at 10am, need to prep now
2) Maria from CloudShield wants lunch instead of coffee — mentioned a potential opportunity to discuss
3) My manager asked me to present the Q3 security roadmap next Monday, need to finish that deck
4) Call mom on Thursday for her birthday — already noted but just a reminder
5) Renew car insurance — expires end of month, need to call broker
6) Start gym routine, three times per week starting this week
7) Read the new NIST CSF 2.0 framework — directly relevant for the job interviews
8) Create a job tracking spreadsheet to organize all my applications and statuses
9) Buy a proper laptop stand for the home office setup
10) Reach out to old colleague David who now works at SecureNet — might know of openings there`,
    checks: [
      demonstratesMemory(),
      noNewTask('call mom'),  // already exists from Ch.6 — should enrich or ignore, not duplicate
      hasNewTask('roadmap'),
      hasNewTask('NIST'),
      hasNewTask('tracking'),
      newTaskCount(4, 10),  // should create new items but not blindly duplicate existing
    ],
  },
  {
    name: 'Ch.8 — Resolution ⭐ INTELLIGENCE TEST (closure, counter-offer, dead threads)',
    dump: 'CyberX made me an offer: Senior Security Engineer, $180k base plus equity. Jake called me personally — they want an answer by next Friday. I want to negotiate, I think $195k is achievable based on my Levels.fyi research. Notice period at my current job is 2 weeks so timing works. TechCorp lowballed me at $150k so I am passing on them entirely. CloudShield lunch with Maria was great but they are not hiring until Q2 next year — she said to stay in touch.',
    checks: [
      hasNewTask('negoti'),
      demonstratesMemory(),
      noNewTask('CyberX interview prep'),
      newTaskCount(1, 4),
    ],
  },
]

// ─── Test suite ────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error('Add TEST_USER_EMAIL and TEST_USER_PASSWORD to .env.local')
  }
  if (!HF_TOKEN) throw new Error('Missing HUGGINGFACE_API_TOKEN in .env.local')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing Supabase env vars')

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const { data: { session }, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error || !session) throw new Error(`Sign-in failed: ${error?.message}`)

  userId = session.user.id

  console.log(`\n${'═'.repeat(70)}`)
  console.log('  BRAINDUMP AI STORY INTEGRATION TEST')
  console.log(`${'═'.repeat(70)}`)
  console.log(`  User : ${TEST_EMAIL}`)
  console.log(`  UID  : ${userId.substring(0, 8)}…`)
  console.log(`  Model: ${HF_MODEL}`)
  console.log(`  Story: ${STORY.length} chapters, escalating complexity`)
  console.log(`\n  ARCHITECTURE NOTE:`)
  console.log(`    The AI receives the last 5 dumps (200 chars each, truncated) and`)
  console.log(`    the last 15 pending tasks (120 chars each). No embeddings, no`)
  console.log(`    vector search. After Ch.6 dump #1 falls off the context window.`)
  console.log(`${'═'.repeat(70)}`)
}, 30_000)

afterAll(async () => {
  const results = (global as unknown as { __storyResults?: ChapterResult[] }).__storyResults ?? []

  let totalChecks = 0
  let passedChecks = 0

  console.log(`\n${'═'.repeat(70)}`)
  console.log('  FINAL REPORT')
  console.log(`${'═'.repeat(70)}`)

  for (const r of results) {
    const p = r.checks.filter(c => c.pass).length
    const t = r.checks.length
    totalChecks += t
    passedChecks += p
    const grade = p === t ? '✓' : p >= t * 0.5 ? '~' : '✗'
    console.log(`  ${grade} ${r.name}: ${p}/${t} checks passed`)
  }

  const pct = totalChecks ? Math.round(passedChecks / totalChecks * 100) : 0
  console.log(`\n  OVERALL SCORE: ${passedChecks}/${totalChecks} checks passed (${pct}%)`)

  if (pct >= 80) console.log('  RATING: Excellent — AI memory and linking are working well')
  else if (pct >= 60) console.log('  RATING: Good — some edge cases missed, enrichment could improve')
  else if (pct >= 40) console.log('  RATING: Needs work — frequent duplication or missing memory')
  else console.log('  RATING: Poor — context window stuffing is not sufficient for this workload')

  console.log(`\n  ARCHITECTURE ASSESSMENT:`)
  console.log(`  · Embedding search : NO — pure context-window stuffing`)
  console.log(`  · Memory window    : last 5 dumps × 200 chars + last 15 pending tasks × 120 chars`)
  console.log(`  · Memory cliff     : dump #1 falls off after 5 more dumps are added`)
  console.log(`  · Blind spots      : completed tasks are invisible to AI (status filter)`)
  console.log(`  · Scale risk       : >15 pending tasks → oldest tasks invisible to AI`)
  console.log(`  · Dedup mechanism  : word-overlap (≥2 shared tokens) — works but rough`)
  console.log(`  · Improvement path : add pgvector + semantic search to surface older context`)

  console.log(`\n  CLEANUP (${testDumpIds.length} dumps, ${testTaskIds.length} tasks created):`)
  if (testDumpIds.length) {
    const dumpList = testDumpIds.map(id => `'${id}'`).join(', ')
    console.log(`  DELETE FROM brain_dumps WHERE id IN (${dumpList});`)
  }
  if (testTaskIds.length) {
    const taskList = testTaskIds.map(id => `'${id}'`).join(', ')
    console.log(`  DELETE FROM tasks WHERE id IN (${taskList});`)
  }
  console.log(`${'═'.repeat(70)}\n`)
})

// Single sequential test that runs all chapters in order
it('AI processes a 8-chapter job-search story intelligently', async () => {
  const results: ChapterResult[] = []

  for (const chapter of STORY) {
    const result = await runChapter(chapter.name, chapter.dump, chapter.checks)
    results.push(result)

    // Hard-fail only if the API pipeline itself broke
    expect(result.summary, `Chapter "${chapter.name}" — AI returned no summary`).toBeTruthy()

    const passed = result.checks.filter(c => c.pass).length
    const total = result.checks.length

    if (passed < Math.ceil(total / 2)) {
      console.warn(`\n  ⚠  BELOW 50% — ${passed}/${total} checks passed for "${result.name}"`)
    }

    // Small delay between chapters to avoid HF rate limits on free tier
    await new Promise(r => setTimeout(r, 2000))
  }

  // Store for afterAll report
  ;(global as unknown as { __storyResults: ChapterResult[] }).__storyResults = results

  // Aggregate assertion: at least 60% of all checks should pass
  const totalChecks = results.flatMap(r => r.checks).length
  const passedChecks = results.flatMap(r => r.checks).filter(c => c.pass).length
  const pct = Math.round(passedChecks / totalChecks * 100)

  console.log(`\n  Story complete: ${passedChecks}/${totalChecks} checks (${pct}%)`)

  expect(pct, `Overall score ${pct}% — expected at least 50%. See check details above.`).toBeGreaterThanOrEqual(50)
}, 120_000 * STORY.length)
