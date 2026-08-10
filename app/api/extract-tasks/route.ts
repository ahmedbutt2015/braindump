import { createClient } from '@/lib/supabase/server'
import { getHuggingFaceToken, maskSecret, serializeError } from '@/lib/huggingface'
import { checkDumpRateLimit } from '@/lib/rate-limit'
import { embedQuery, embedTaskBatch, toVectorLiteral } from '@/lib/embeddings'
import { z } from 'zod'

const HF_MODEL = 'deepseek-ai/DeepSeek-V3-0324:novita'
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions'

export const preferredRegion = 'iad1'

const nullableString = z.string().nullable().optional().transform(v =>
  (v === 'null' || v === 'undefined' || v === '' || v == null) ? null : v
)

const TaskSchema = z.object({
  title: z.string(),
  description: nullableString,
  priority: z.enum(['low', 'medium', 'high']).catch('medium'),
  due_date: nullableString,
})

const EnrichmentSchema = z.object({
  task_id: z.string().nullable().optional(),
  additional_context: z.string().nullable().optional(),
})

const SubtaskAdditionSchema = z.object({
  task_id: z.string().nullable().optional(),
  subtask_title: z.string().nullable().optional(),
})

const ExtractedTasksSchema = z.object({
  tasks: z.array(TaskSchema),
  enrichments: z.array(EnrichmentSchema).optional().default([]),
  subtask_additions: z.array(SubtaskAdditionSchema).optional().default([]),
  summary: z.string(),
})

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0]
  return `You are an AI second-brain assistant. Extract actionable tasks from brain dumps and connect them to existing open tasks intelligently.

Today's date: ${today}. Use this when inferring due dates — never produce a date in the past unless the user explicitly stated a past date. Always use the correct year.

Respond ONLY with a valid JSON object — no explanation, no markdown, no code blocks.

Required JSON format:
{
  "tasks": [
    {
      "title": "specific, action-oriented task title (verb + object)",
      "description": "extra context that helps execute the task, or null",
      "priority": "low" | "medium" | "high",
      "due_date": "YYYY-MM-DD or null"
    }
  ],
  "enrichments": [
    {
      "task_id": "exact UUID of the existing task",
      "additional_context": "new information to append to that task's description"
    }
  ],
  "subtask_additions": [
    {
      "task_id": "exact UUID of the existing task",
      "subtask_title": "specific action step that belongs under this task"
    }
  ],
  "summary": "one sentence describing what was processed"
}

STEP 1 — INVENTORY: Read the entire dump and list every distinct actionable item before deciding what to do with any of them. Do not skip items.

STEP 2 — CLASSIFY each item using these rules in order:

A. ENRICHMENT: The item is new information, an update, or context about an existing task (a date change, a new contact detail, a status update). Use "enrichments". Do not also create a new task for the same content.

B. SUBTASK: The item is a direct action step required to complete an existing task — meaning it only makes sense as part of that parent task and has no independent value. Use "subtask_additions".
   → "Ask Sarah to review the resume before sending" IS a subtask of "Update resume" — it only matters in that context.
   → "Prepare for CyberX interview" is NOT a subtask of "Follow up with Jake" — it is substantial independent work.
   → "Write a cover letter for CyberX" is NOT a subtask of any follow-up task — it stands alone.
   → When in doubt: if the item could appear on its own on a to-do list and make sense without the parent, make it a new task.

C. NEW TASK: Everything else. Create a new task if:
   - The item has no existing task to attach to, OR
   - The item is substantial standalone work, even if loosely related to an existing task.
   → Title must be a specific action: verb + object. Bad: "CyberX stuff". Good: "Prepare for CyberX technical interview".
   → Put useful context in the description. Never leave it empty if the dump contains relevant detail.

D. NOT A TASK: Negative statements ("I don't want X"), preferences, or pure observations with nothing to do.
   → Attach as an enrichment constraint if related to an existing task, otherwise discard.

STEP 3 — OUTPUT: Every item from Step 1 must appear in exactly one of: tasks, enrichments, subtask_additions, or be explicitly discarded as non-actionable. Nothing may be silently dropped.

CRITICAL: One action per item — never both a new task AND an enrichment/subtask for the same content.
Use the exact task_id UUID from the provided list. Never fabricate or guess a UUID.`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  const startTime = Date.now()

  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { allowed, resetInSeconds } = await checkDumpRateLimit(supabase, user.id)
    if (!allowed) {
      return Response.json(
        { error: `Rate limit reached. You can submit up to 20 dumps per hour. Try again in ${Math.ceil(resetInSeconds / 60)} minutes.` },
        { status: 429 }
      )
    }

    const { token: hfToken, source: hfTokenSource } = getHuggingFaceToken()

    console.info('[extract-tasks] Hugging Face env check', {
      requestId,
      hasServerToken: Boolean(process.env.HUGGINGFACE_API_TOKEN),
      hasPublicToken: Boolean(process.env.NEXT_PUBLIC_HUGGINGFACE_API_TOKEN),
      resolvedSource: hfTokenSource,
      tokenPreview: maskSecret(hfToken),
    })

    if (!hfToken) {
      return Response.json({ error: 'AI service not configured. Set HUGGINGFACE_API_TOKEN.' }, { status: 503 })
    }

    const { content } = await request.json()
    if (!content || typeof content !== 'string') {
      return Response.json({ error: 'Content is required' }, { status: 400 })
    }

    // Fetch recent dumps and attempt to embed the dump in parallel.
    // Embedding requires api-inference.huggingface.co (reachable on Vercel, may fail locally).
    const [{ data: recentDumps }, dumpEmbedding] = await Promise.all([
      supabase
        .from('brain_dumps')
        .select('content, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5),
      embedQuery(content).catch(() => null),
    ])

    // Three-tier retrieval — fills up to 15 tasks in priority order:
    //   Tier 1 · Vector search   — cosine similarity (production: Vercel can reach HF embed API)
    //   Tier 2 · Keyword FTS     — PostgreSQL tsvector/tsquery (works everywhere, no external API)
    //   Tier 3 · Recency         — newest tasks (baseline, always works, original behaviour)
    // Each tier supplements the previous; seen-set deduplicates across tiers.
    type TaskContext = { id: string; title: string; description: string | null; subtasks: unknown }
    const existingTasks: TaskContext[] = []
    const seen = new Set<string>()
    const fill = (rows: TaskContext[]) => {
      for (const t of rows) {
        if (existingTasks.length >= 15) break
        if (!seen.has(t.id)) { existingTasks.push(t); seen.add(t.id) }
      }
    }

    // Tier 1 — vector cosine search
    if (dumpEmbedding) {
      const { data: semantic, error: semanticErr } = await supabase.rpc('match_tasks', {
        query_embedding: toVectorLiteral(dumpEmbedding),
        user_id_param: user.id,
        match_count: 15,
      })
      if (!semanticErr) fill((semantic ?? []) as TaskContext[])
    }

    // Tier 2 — keyword FTS (fills remaining slots after vector search, or all slots if no embedding)
    if (existingTasks.length < 15) {
      const { data: fts } = await supabase.rpc('match_tasks_fts', {
        query_text: content.substring(0, 1000),
        user_id_param: user.id,
        match_count: 15,
      })
      fill((fts ?? []) as TaskContext[])
    }

    // Tier 3 — recency (catches tasks with no keyword overlap, always-on safety net)
    if (existingTasks.length < 15) {
      const { data: recent } = await supabase
        .from('tasks')
        .select('id, title, description, subtasks')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(15)
      fill((recent ?? []) as TaskContext[])
    }

    console.info('[extract-tasks] Task retrieval', {
      requestId,
      tier1Vector: dumpEmbedding ? 'yes' : 'no',
      totalRetrieved: existingTasks.length,
    })

    const previousContext = recentDumps?.length
      ? `Recent brain dumps for context:\n${recentDumps.map(d => `- ${d.content.substring(0, 200)}`).join('\n')}`
      : ''

    const existingTasksContext = existingTasks?.length
      ? `Existing pending tasks (use their IDs in enrichments/subtask_additions instead of creating duplicates):\n${existingTasks.map(t => {
          const desc = t.description ? ` | Context: ${t.description.substring(0, 120)}` : ''
          return `- ID: ${t.id} | Title: ${t.title}${desc}`
        }).join('\n')}`
      : ''

    const userMessage = [
      previousContext,
      existingTasksContext,
      `Brain dump to process:\n"""\n${content}\n"""`,
      'Extract new tasks and identify enrichments/subtask additions for existing tasks. Return as JSON.',
    ].filter(Boolean).join('\n\n')

    console.info('[extract-tasks] Sending Hugging Face request', {
      requestId,
      userId: user.id,
      hfUrl: HF_API_URL,
      hfHostname: new URL(HF_API_URL).hostname,
      model: HF_MODEL,
      contentLength: content.length,
      recentDumpCount: recentDumps?.length ?? 0,
      existingTaskCount: existingTasks?.length ?? 0,
      tokenSource: hfTokenSource,
    })

    const hfResponse = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HF_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(err => {
      if (err.name === 'AbortError') {
        throw new Error('HuggingFace API request timed out after 30 seconds')
      }
      throw err
    })

    if (!hfResponse.ok) {
      const errorData = await hfResponse.json().catch(() => ({}))

      if (hfResponse.status === 503 && errorData.error?.includes('loading')) {
        return Response.json({
          error: 'AI model is warming up, please try again shortly',
          retryAfter: errorData.estimated_time ?? 20,
          modelLoading: true,
        }, { status: 503 })
      }

      console.error('[extract-tasks] Hugging Face API error', {
        requestId,
        status: hfResponse.status,
        statusText: hfResponse.statusText,
        errorData,
      })
      return Response.json({ error: 'AI service error' }, { status: 500 })
    }

    const hfData = await hfResponse.json()
    const rawContent: string = hfData.choices?.[0]?.message?.content ?? ''

    const jsonStr = rawContent
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    let output: z.infer<typeof ExtractedTasksSchema>
    try {
      output = ExtractedTasksSchema.parse(JSON.parse(jsonStr))
    } catch {
      console.error('[extract-tasks] Failed to parse AI output', {
        requestId,
        rawContent,
      })
      return Response.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 500 })
    }

    // Build a set of valid task IDs belonging to this user
    const validTaskIds = new Set((existingTasks ?? []).map(t => t.id))

    // UUID pattern — filter out placeholder strings the model sometimes returns
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    // Drop enrichments/subtask_additions that have null/empty/placeholder values
    output.enrichments = (output.enrichments ?? []).filter(
      e => e.task_id && UUID_RE.test(e.task_id) && e.additional_context?.trim()
    )
    output.subtask_additions = (output.subtask_additions ?? []).filter(
      s => s.task_id && UUID_RE.test(s.task_id) && s.subtask_title?.trim()
    )

    // Code-level dedup: if the model added a subtask or enrichment for existing task content,
    // drop any new task whose title shares 2+ meaningful words with that subtask/enrichment.
    // This catches the "double-dip" where the model enriches AND creates a duplicate new task.
    if (output.subtask_additions.length > 0 || output.enrichments.length > 0) {
      const coveredWords = new Set<string>()
      const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'also', 'just', 'then'])
      const tokenize = (text: string) =>
        text.toLowerCase().split(/[\s\-\/]+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(w => w.length > 3 && !STOP_WORDS.has(w))

      for (const s of output.subtask_additions) {
        tokenize(s.subtask_title!).forEach(w => coveredWords.add(w))
      }
      for (const e of output.enrichments) {
        tokenize(e.additional_context!).forEach(w => coveredWords.add(w))
      }

      output.tasks = output.tasks.filter(task => {
        const titleWords = tokenize(task.title)
        const overlap = titleWords.filter(w => coveredWords.has(w)).length
        return overlap < 2
      })
    }

    // Embed new tasks and save brain dump in parallel (both are independent at this point)
    const [taskEmbeddings, { data: brainDump, error: dumpError }] = await Promise.all([
      output.tasks.length > 0
        ? embedTaskBatch(output.tasks.map(t => ({ title: t.title, description: t.description ?? null })))
        : Promise.resolve([] as Array<number[] | null>),
      supabase
        .from('brain_dumps')
        .insert({ user_id: user.id, content })
        .select()
        .single(),
    ])

    if (dumpError) {
      console.error('[extract-tasks] Error saving brain dump', { requestId, dumpError })
      return Response.json({ error: 'Failed to save brain dump' }, { status: 500 })
    }

    // Save new tasks — include embeddings so they are immediately searchable
    if (output.tasks.length > 0) {
      const { error: tasksError } = await supabase
        .from('tasks')
        .insert(
          output.tasks.map((task, i) => ({
            user_id: user.id,
            brain_dump_id: brainDump.id,
            title: task.title,
            description: task.description ?? null,
            priority: task.priority,
            due_date: task.due_date ?? null,
            status: 'pending' as const,
            embedding: taskEmbeddings[i] ? toVectorLiteral(taskEmbeddings[i]!) : null,
          }))
        )

      if (tasksError) {
        console.error('[extract-tasks] Error saving tasks', { requestId, tasksError })
        return Response.json({ error: 'Failed to save tasks' }, { status: 500 })
      }
    }

    // Apply enrichments — append new context to existing task descriptions
    const validEnrichments = (output.enrichments ?? []).filter(e => validTaskIds.has(e.task_id!))
    let enrichmentsApplied = 0

    for (const enrichment of validEnrichments) {
      const existing = existingTasks?.find(t => t.id === enrichment.task_id)
      if (!existing) continue

      const newDescription = existing.description
        ? `${existing.description}\n\nUpdate: ${enrichment.additional_context}`
        : enrichment.additional_context!

      const { error: enrichError } = await supabase
        .from('tasks')
        .update({ description: newDescription, updated_at: new Date().toISOString() })
        .eq('id', enrichment.task_id!)
        .eq('user_id', user.id)

      if (!enrichError) enrichmentsApplied++
      else console.warn('[extract-tasks] Failed to apply enrichment', { requestId, taskId: enrichment.task_id, enrichError })
    }

    // Apply subtask additions — append new subtasks to existing tasks
    const validSubtaskAdditions = (output.subtask_additions ?? []).filter(s => validTaskIds.has(s.task_id!))
    let subtaskAdditions = 0

    for (const addition of validSubtaskAdditions) {
      const existing = existingTasks?.find(t => t.id === addition.task_id)
      if (!existing) continue

      const currentSubtasks = Array.isArray(existing.subtasks) ? existing.subtasks : []
      const newSubtask = {
        id: crypto.randomUUID(),
        title: addition.subtask_title!,
        completed: false,
        created_at: new Date().toISOString(),
      }

      const { error: subtaskError } = await supabase
        .from('tasks')
        .update({
          subtasks: [...currentSubtasks, newSubtask],
          updated_at: new Date().toISOString(),
        })
        .eq('id', addition.task_id!)
        .eq('user_id', user.id)

      if (!subtaskError) subtaskAdditions++
      else console.warn('[extract-tasks] Failed to add subtask', { requestId, taskId: addition.task_id, subtaskError })
    }

    // Log the API call — awaited so Vercel doesn't drop it before the function terminates
    const { error: logError } = await supabase.from('api_logs').insert({
      user_id: user.id,
      brain_dump_id: brainDump.id,
      endpoint: 'extract-tasks',
      model: HF_MODEL,
      content_length: content.length,
      tasks_extracted: output.tasks.length,
      enrichments_applied: enrichmentsApplied + subtaskAdditions,
      duration_ms: Date.now() - startTime,
      success: true,
    })
    if (logError) console.warn('[extract-tasks] Failed to write api_log', { requestId, logError })

    return Response.json({
      success: true,
      tasksExtracted: output.tasks.length,
      enrichmentsApplied,
      subtaskAdditions,
      summary: output.summary,
      extractedTasks: output.tasks,
      transcript: content,
    })

  } catch (error) {
    const serializedError = serializeError(error)

    console.error('[extract-tasks] Unhandled error', {
      requestId,
      error: serializedError,
    })

    if (serializedError.cause?.code === 'ENOTFOUND') {
      return Response.json(
        {
          error: 'Could not reach Hugging Face from the server. This is likely a DNS or outbound network issue.',
          code: serializedError.cause.code,
          hostname: serializedError.cause.hostname,
        },
        { status: 502 }
      )
    }

    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
