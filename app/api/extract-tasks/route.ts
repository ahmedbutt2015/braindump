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
  task_id: z.string(), // validated against real task IDs at line 206, not here
  additional_context: z.string(),
})

const ExtractedTasksSchema = z.object({
  tasks: z.array(TaskSchema),
  enrichments: z.array(EnrichmentSchema).optional().default([]),
  summary: z.string(),
})

const SYSTEM_PROMPT = `You are an AI assistant that extracts actionable tasks from brain dumps and enriches existing tasks with new context.
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
      "task_id": "the exact UUID of the existing task to enrich",
      "additional_context": "what new information from this dump should be appended to that task"
    }
  ],
  "summary": "one sentence describing what was processed"
}

Rules:
- Only create a NEW task for a genuinely new action item not covered by existing tasks
- If the dump mentions something related to an existing task, add an enrichment entry for that task instead of (or alongside) creating a new one
- Use the exact task_id UUID from the provided list — do not guess or modify it
- If nothing is actionable, return empty tasks and enrichments arrays`

export async function POST(request: Request) {
  const requestId = crypto.randomUUID()

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

    // Fetch recent dumps + existing pending tasks (with IDs for enrichment)
    const [{ data: recentDumps }, { data: existingTasks }] = await Promise.all([
      supabase
        .from('brain_dumps')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('tasks')
        .select('id, title, description, status')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(15),
    ])

    const previousContext = recentDumps?.length
      ? `Recent brain dumps for context:\n${recentDumps.map(d => `- ${d.content.substring(0, 200)}`).join('\n')}`
      : ''

    // Pass tasks with IDs so the AI can reference them in enrichments
    const existingTasksContext = existingTasks?.length
      ? `Existing pending tasks (with IDs for enrichment — reference these instead of creating duplicates):\n${existingTasks.map(t => {
          const desc = t.description ? ` | Description: ${t.description.substring(0, 100)}` : ''
          return `- ID: ${t.id} | Title: ${t.title}${desc}`
        }).join('\n')}`
      : ''

    const userMessage = [
      previousContext,
      existingTasksContext,
      `Brain dump to process:\n"""\n${content}\n"""`,
      'Extract new tasks and identify enrichments for existing tasks. Return as JSON.',
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
      signal: AbortSignal.timeout(30000), // 30 second timeout
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

    // Strip markdown code fences if the model wraps the JSON
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

    // Build a set of valid task IDs belonging to this user for safe enrichment
    const validTaskIds = new Set((existingTasks ?? []).map(t => t.id))

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
    const validEnrichments = (output.enrichments ?? []).filter(e => validTaskIds.has(e.task_id))
    let enrichmentsApplied = 0

    for (const enrichment of validEnrichments) {
      const existing = existingTasks?.find(t => t.id === enrichment.task_id)
      if (!existing) continue

      const newDescription = existing.description
        ? `${existing.description}\n\nUpdate: ${enrichment.additional_context}`
        : enrichment.additional_context

      const { error: enrichError } = await supabase
        .from('tasks')
        .update({ description: newDescription, updated_at: new Date().toISOString() })
        .eq('id', enrichment.task_id)
        .eq('user_id', user.id)

      if (!enrichError) enrichmentsApplied++
    }

    return Response.json({
      success: true,
      tasksExtracted: output.tasks.length,
      enrichmentsApplied,
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
