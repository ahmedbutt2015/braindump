import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const HF_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3'
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}/v1/chat/completions`

const TaskSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']),
  due_date: z.string().nullable().optional(),
})

const ExtractedTasksSchema = z.object({
  tasks: z.array(TaskSchema),
  summary: z.string(),
})

const SYSTEM_PROMPT = `You are an AI assistant that extracts actionable tasks from brain dumps.
Respond ONLY with a valid JSON object — no explanation, no markdown, no code blocks.

Required JSON format:
{
  "tasks": [
    {
      "title": "clear, action-oriented task title",
      "description": "extra context or null",
      "priority": "low" or "medium" or "high",
      "due_date": "ISO date string or null"
    }
  ],
  "summary": "one sentence describing what was processed"
}`

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const hfToken = process.env.HUGGINGFACE_API_TOKEN
    if (!hfToken) {
      return Response.json({ error: 'AI service not configured. Set HUGGINGFACE_API_TOKEN.' }, { status: 503 })
    }

    const { content } = await request.json()
    if (!content || typeof content !== 'string') {
      return Response.json({ error: 'Content is required' }, { status: 400 })
    }

    // Fetch recent dumps and existing tasks for context
    const [{ data: recentDumps }, { data: existingTasks }] = await Promise.all([
      supabase
        .from('brain_dumps')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('tasks')
        .select('title, status')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const previousContext = recentDumps?.length
      ? `Recent brain dumps for context:\n${recentDumps.map(d => `- ${d.content.substring(0, 200)}`).join('\n')}`
      : ''

    const existingTasksContext = existingTasks?.length
      ? `Existing pending tasks (avoid duplicates):\n${existingTasks.map(t => `- ${t.title}`).join('\n')}`
      : ''

    const userMessage = [
      previousContext,
      existingTasksContext,
      `Brain dump to process:\n"""\n${content}\n"""`,
      'Extract all actionable tasks as JSON. If nothing actionable, return empty tasks array.',
    ].filter(Boolean).join('\n\n')

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

      console.error('HuggingFace API error:', errorData)
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
      console.error('Failed to parse AI output:', rawContent)
      return Response.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 500 })
    }

    // Save the brain dump
    const { data: brainDump, error: dumpError } = await supabase
      .from('brain_dumps')
      .insert({ user_id: user.id, content })
      .select()
      .single()

    if (dumpError) {
      console.error('Error saving brain dump:', dumpError)
      return Response.json({ error: 'Failed to save brain dump' }, { status: 500 })
    }

    // Save extracted tasks
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
        console.error('Error saving tasks:', tasksError)
        return Response.json({ error: 'Failed to save tasks' }, { status: 500 })
      }
    }

    return Response.json({
      success: true,
      tasksExtracted: output.tasks.length,
      summary: output.summary,
    })

  } catch (error) {
    console.error('Error in extract-tasks:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
