import { createClient } from '@/lib/supabase/server'
import { isUuid, mapRevertResult } from '@/lib/ai-revert'

// Undo one applied AI action. The request body is deliberately never read: the
// only input is the id in the path, so a client cannot choose the task, field
// or value that gets written. apply_ai_action does the work and enforces
// ownership, status and compare-and-swap.
export async function POST(
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
    if (!isUuid(id)) {
      return Response.json({ error: 'Invalid action id' }, { status: 400 })
    }

    const result = await supabase.rpc('apply_ai_action', { p_revert_of: id })
    const { status, body } = mapRevertResult(result, id)
    return Response.json(body, { status })
  } catch (error) {
    console.error('Error in POST /api/ai-actions/[id]/revert:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
