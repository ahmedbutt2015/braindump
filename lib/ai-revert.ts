// Pure helpers for POST /api/ai-actions/[id]/revert.
//
// The undo itself is done by apply_ai_action(p_revert_of => id) (migration 004):
// a strict compare-and-swap that restores before_value only if the task field
// still equals the action's after_value. This module only validates the id and
// turns the RPC result into an HTTP response. It does nothing clever on a
// conflict: a later edit blocks the revert.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export type RevertOutcome = 'reverted' | 'conflict' | 'not_revertable' | 'task_not_found'

export interface RevertResponse {
  status: 200 | 404 | 409 | 500
  body: Record<string, unknown>
}

const REVERT_OUTCOMES: ReadonlySet<string> = new Set<RevertOutcome>([
  'reverted',
  'conflict',
  'not_revertable',
  'task_not_found',
])

// The RPC RETURNS TABLE (outcome, action_id), which PostgREST sends as an array
// of rows. Anything else is not an answer: "applied" is an apply-only outcome
// and is treated like any other unknown string.
function parseOutcome(data: unknown): RevertOutcome | null {
  if (!Array.isArray(data)) return null
  const outcome = (data[0] as { outcome?: unknown } | null | undefined)?.outcome
  return typeof outcome === 'string' && REVERT_OUTCOMES.has(outcome) ? (outcome as RevertOutcome) : null
}

export function mapRevertResult(result: { data: unknown; error: unknown }, actionId: string): RevertResponse {
  if (result.error) {
    console.error('[ai-revert] apply_ai_action failed', { actionId, error: result.error })
    return { status: 500, body: { error: 'Failed to revert action' } }
  }

  const outcome = parseOutcome(result.data)
  switch (outcome) {
    case 'reverted':
      return { status: 200, body: { success: true, outcome, actionId } }
    case 'conflict':
      return {
        status: 409,
        body: { error: 'This task was changed after the AI update, so it can no longer be reverted.', outcome },
      }
    case 'not_revertable':
    case 'task_not_found':
      return { status: 404, body: { error: 'This action cannot be reverted.', outcome } }
    default:
      console.error('[ai-revert] apply_ai_action returned an unrecognised result', { actionId, data: result.data })
      return { status: 500, body: { error: 'Failed to revert action' } }
  }
}
