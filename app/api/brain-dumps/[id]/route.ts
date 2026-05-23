import { createClient } from '@/lib/supabase/server'

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

    // Delete linked tasks first (in case CASCADE DELETE isn't configured in Supabase)
    await supabase
      .from('tasks')
      .delete()
      .eq('brain_dump_id', id)
      .eq('user_id', user.id)

    const { error } = await supabase
      .from('brain_dumps')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting brain dump:', error)
      return Response.json({ error: 'Failed to delete brain dump' }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/brain-dumps/[id]:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
