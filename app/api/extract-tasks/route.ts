import { createClient } from '@/lib/supabase/server'
import { getHuggingFaceToken, maskSecret, serializeError } from '@/lib/huggingface'
import { checkDumpRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct:novita'
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions'

export const preferredRegion = 'iad1'

const TaskSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']),
  due_date: z.string().nullable().optional(),
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

const SYSTEM_PROMPT = `You are an AI second-brain assistant. Your job is to extract tasks from brain dumps and connect them intelligently to what the user already has open.

Respond ONLY with a valid JSON object — no explanation, no markdown, no code blocks.

Required JSON format:
{
  "tasks": [
    {
      "title": "clear, action-oriented task title",
      "description": "extra context or null",
      "priority": "low" | "medium" | "high",
      "due_date": "ISO date string or null"
    }
  ],
  "enrichments": [
    {
      "task_id": "the exact UUID of the existing task",
      "additional_context": "new information to append to that task's description"
    }
  ],
  "subtask_additions": [
    {
      "task_id": "the exact UUID of the existing task",
      "subtask_title": "a specific action item that belongs under this task"
    }
  ],
  "summary": "one sentence describing what was processed"
}

Decision rules — apply in order:
1. DUPLICATE CHECK: Does the dump mention something already covered by an existing task?
   → Do NOT create a new task for it.
   → If the dump adds new CONTEXT, INFORMATION, or UPDATES about that task → add to "enrichments"
   → If the dump adds a NEW SPECIFIC ACTION ITEM that belongs under that task → add to "subtask_additions"
   → You may do both enrichment AND subtask addition for the same task if appropriate.

2. GENUINELY NEW: Is this a completely new action item not covered by any existing task?
   → Create a new entry in "tasks".

3. MULTI-TASK: Can the dump relate to multiple existing tasks?
   → Add enrichments/subtask_additions for each relevant task.

4. NOTHING ACTIONABLE: Return empty arrays for all three fields.

Key distinctions:
- "enrichments" = new knowledge/context about the task (what you learned, who you met, updates)
- "subtask_additions" = a new specific step to complete under an existing task
- "tasks" = brand new work that has no existing home

Use the exact task_id UUID from the provided list — never guess or modify it.`

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

    // Fetch recent dumps + existing pending tasks (with subtasks so we can append to them)
    const [{ data: recentDumps }, { data: existingTasks }] = await Promise.all([
      supabase
        .from('brain_dumps')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('tasks')
        .select('id, title, description, status, subtasks')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(15),
    ])

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
          { role: 'system', content: SYSTEM_PROMPT },
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

    // Save the brain dump
    const { data: brainDump, error: dumpError } = await supabase
      .from('brain_dumps')
      .insert({ user_id: user.id, content })
      .select()
      .single()

    if (dumpError) {
      console.error('[extract-tasks] Error saving brain dump', { requestId, dumpError })
      return Response.json({ error: 'Failed to save brain dump' }, { status: 500 })
    }

    // Save new tasks
    if (output.tasks.length > 0) {
      const { error: tasksError } = await supabase
        .from('tasks')
        .insert(
          output.tasks.map(task => ({
            user_id: user.id,
            brain_dump_id: brainDump.id,
            title: task.title,
            description: task.description ?? null,
            priority: task.priority,
            due_date: task.due_date ?? null,
            status: 'pending' as const,
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
    }

    // Log the API call — non-blocking but with visible error if it fails
    supabase.from('api_logs').insert({
      user_id: user.id,
      brain_dump_id: brainDump.id,
      endpoint: 'extract-tasks',
      model: HF_MODEL,
      content_length: content.length,
      tasks_extracted: output.tasks.length,
      enrichments_applied: enrichmentsApplied + subtaskAdditions,
      duration_ms: Date.now() - startTime,
      success: true,
    }).then(({ error }) => {
      if (error) console.warn('[extract-tasks] Failed to write api_log', { requestId, error })
    })

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
