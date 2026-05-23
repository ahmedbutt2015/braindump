import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = UpdateTaskSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: 'Invalid fields', details: parsed.error.flatten() }, { status: 400 })
    }

    if (Object.keys(parsed.data).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { error } = await supabase
      .from('tasks')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error updating task:', error)
      return Response.json({ error: 'Failed to update task' }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/tasks/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting task:', error)
      return Response.json({ error: 'Failed to delete task' }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/tasks/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
