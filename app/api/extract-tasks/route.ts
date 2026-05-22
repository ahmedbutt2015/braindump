import { generateText, Output } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const TaskSchema = z.object({
  title: z.string().describe('A clear, actionable task title'),
  description: z.string().nullable().describe('Additional context or details about the task'),
  priority: z.enum(['low', 'medium', 'high']).describe('Task priority based on urgency and importance'),
  due_date: z.string().nullable().describe('Suggested due date in ISO format if mentioned or implied'),
})

const ExtractedTasksSchema = z.object({
  tasks: z.array(TaskSchema).describe('List of extracted tasks from the brain dump'),
  summary: z.string().describe('Brief summary of what was processed'),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { content } = await request.json()

    if (!content || typeof content !== 'string') {
      return Response.json({ error: 'Content is required' }, { status: 400 })
    }

    // Fetch recent brain dumps for context
    const { data: recentDumps } = await supabase
      .from('brain_dumps')
      .select('content, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    // Fetch existing tasks for context
    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('title, description, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10)

    // Build context from previous dumps and tasks
    const previousContext = recentDumps?.length 
      ? `Recent brain dumps for context:\n${recentDumps.map(d => `- ${d.content.substring(0, 200)}...`).join('\n')}`
      : ''
    
    const existingTasksContext = existingTasks?.length
      ? `Existing pending tasks (avoid duplicates):\n${existingTasks.map(t => `- ${t.title}`).join('\n')}`
      : ''

    // Use AI to extract tasks
    const { output } = await generateText({
      model: 'openai/gpt-4o-mini',
      output: Output.object({
        schema: ExtractedTasksSchema,
      }),
      prompt: `You are an AI assistant that extracts actionable tasks from brain dumps.

Analyze the following brain dump and extract clear, actionable tasks. Consider:
1. What specific actions need to be taken?
2. What is the priority based on urgency/importance mentioned?
3. Are there any deadlines or time-sensitive items?
4. Avoid creating duplicate tasks that already exist.

${previousContext}

${existingTasksContext}

Current brain dump to process:
"""
${content}
"""

Extract all actionable tasks. For each task:
- Create a clear, specific title (action-oriented)
- Add description only if there's relevant context
- Set priority (high for urgent/important, medium for normal, low for someday/maybe)
- Include due_date only if explicitly mentioned or strongly implied

If no actionable tasks are found, return an empty tasks array with a summary explaining why.`,
    })

    if (!output) {
      return Response.json({ error: 'Failed to extract tasks' }, { status: 500 })
    }

    // Save the brain dump first
    const { data: brainDump, error: dumpError } = await supabase
      .from('brain_dumps')
      .insert({
        user_id: user.id,
        content: content,
      })
      .select()
      .single()

    if (dumpError) {
      console.error('Error saving brain dump:', dumpError)
      return Response.json({ error: 'Failed to save brain dump' }, { status: 500 })
    }

    // Save extracted tasks
    if (output.tasks.length > 0) {
      const tasksToInsert = output.tasks.map(task => ({
        user_id: user.id,
        brain_dump_id: brainDump.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        due_date: task.due_date,
        status: 'pending' as const,
      }))

      const { error: tasksError } = await supabase
        .from('tasks')
        .insert(tasksToInsert)

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
