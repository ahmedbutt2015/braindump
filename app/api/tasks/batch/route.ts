import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const BatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['complete', 'delete']),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = BatchSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { ids, action } = parsed.data

    if (action === 'delete') {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id)
      if (error) return Response.json({ error: 'Failed to delete tasks' }, { status: 500 })
    } else {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', user.id)
      if (error) return Response.json({ error: 'Failed to update tasks' }, { status: 500 })
    }

    return Response.json({ success: true, count: ids.length })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
