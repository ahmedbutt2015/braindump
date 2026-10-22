import { formatEnrichedDescription, type ActionKind, type AllowedTask, type GuardDecision, type GuardReason } from '@/lib/ai-guard'

// Applies the decisions made by guardActions().
//
// The guard decides what MAY be written; this module is the only place the
// model's proposals reach existing tasks, and it does so only through the
// apply_ai_action RPC (migration 004). That function is a compare-and-swap on
// one field plus its audit row in a single transaction, so a task that changed
// since the route read it is never overwritten.
//
// Fails closed: a verdict of "apply" is counted as applied only when the RPC
// answers exactly "applied". Every other result leaves the task untouched and
// is stored as a proposal for a human.

// Reasons added here, after the guard has run. Kept out of GuardReason, which
// describes the guard's own checks.
export type ApplyReason =
  // The task no longer holds the value the route read: edited, enriched by
  // another request, or deleted. Nothing was written.
  | 'stale_target'
  // The RPC failed or answered with something unrecognised. Nothing is assumed
  // to have been written.
  | 'apply_error'

export type ActionReason = GuardReason | ApplyReason

export type ApplyOutcome = 'applied' | 'proposed' | 'rejected'

// The slice of the Supabase client this module uses. Declared structurally so
// the real client satisfies it and tests can pass a plain fake.
export interface ApplyClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
  from(table: string): {
    insert(rows: Array<Record<string, unknown>>): PromiseLike<{ error: unknown }>
  }
}

export interface ApplyInput {
  client: ApplyClient
  decisions: readonly GuardDecision[]
  // The tasks the model was shown, keyed by lowercase id. Same map given to guardActions().
  allowedTasks: ReadonlyMap<string, AllowedTask>
  userId: string
  brainDumpId: string
  requestId: string
  // Injected so subtask ids and timestamps are deterministic in tests.
  newId?: () => string
  now?: () => string
}

export interface AppliedDecision {
  kind: ActionKind
  index: number
  outcome: ApplyOutcome
  reasons: ActionReason[]
}

export interface ApplyResult {
  enrichmentsApplied: number
  subtaskAdditions: number
  // Guard proposals + stale targets + apply errors. Rejected items are not proposals.
  proposedCount: number
  rejectedCount: number
  outcomes: AppliedDecision[]
}

type Field = 'description' | 'subtasks'

const FIELD_BY_KIND: Record<ActionKind, Field> = {
  enrichment: 'description',
  subtask_addition: 'subtasks',
}

type RpcOutcome = 'applied' | 'conflict' | 'task_not_found'

// apply_ai_action RETURNS TABLE (outcome, action_id), which PostgREST sends as
// an array of rows. Anything else, including the revert-only outcomes, is not
// an answer this module can act on.
function parseRpcOutcome(data: unknown): RpcOutcome | null {
  if (!Array.isArray(data)) return null
  const outcome = (data[0] as { outcome?: unknown } | null | undefined)?.outcome
  return outcome === 'applied' || outcome === 'conflict' || outcome === 'task_not_found' ? outcome : null
}

// linkTask is false when the task is known not to exist (or was never verified):
// the task_id FK and the insert policy would reject the row, and since all rows
// go out in one insert, that would lose every other audit row with it.
function auditRow(
  input: ApplyInput,
  decision: GuardDecision,
  status: 'proposed' | 'rejected',
  reasons: ActionReason[],
  linkTask: boolean
): Record<string, unknown> {
  return {
    user_id: input.userId,
    request_id: input.requestId,
    brain_dump_id: input.brainDumpId,
    // The id the model named stays in payload for the record either way.
    task_id: status === 'rejected' || !linkTask ? null : decision.payload.taskId,
    kind: decision.kind,
    status,
    field: FIELD_BY_KIND[decision.kind],
    before_value: null,
    after_value: null,
    payload: decision.payload,
    evidence: decision.payload.evidence,
    reasons,
  }
}

export async function applyGuardDecisions(input: ApplyInput): Promise<ApplyResult> {
  const newId = input.newId ?? (() => crypto.randomUUID())
  const now = input.now ?? (() => new Date().toISOString())

  // Latest known value per task field. Seeded from the snapshot, then advanced
  // after every RPC that returns "applied", so a second action on the same
  // field is built on (and compared against) what the first one wrote, not on
  // the stale snapshot.
  const known = new Map<string, unknown>()
  const queued: Array<Record<string, unknown>> = []
  const outcomes: AppliedDecision[] = []
  let enrichmentsApplied = 0
  let subtaskAdditions = 0
  let proposedCount = 0
  let rejectedCount = 0

  const propose = (decision: GuardDecision, reasons: ActionReason[], linkTask = true) => {
    queued.push(auditRow(input, decision, 'proposed', reasons, linkTask))
    outcomes.push({ kind: decision.kind, index: decision.index, outcome: 'proposed', reasons })
    proposedCount++
  }

  // Strictly sequential: same-field actions depend on the previous result, and
  // the RPC row-locks the task anyway.
  for (const decision of input.decisions) {
    if (decision.verdict === 'reject') {
      queued.push(auditRow(input, decision, 'rejected', decision.reasons, false))
      outcomes.push({ kind: decision.kind, index: decision.index, outcome: 'rejected', reasons: decision.reasons })
      rejectedCount++
      continue
    }

    if (decision.verdict === 'propose') {
      propose(decision, decision.reasons)
      continue
    }

    const { taskId, text } = decision.payload
    const task = taskId ? input.allowedTasks.get(taskId) : undefined
    if (!taskId || !text || !task) {
      // guardActions() cannot produce this; an "apply" without a known task or text is a caller bug.
      console.warn('[ai-apply] apply decision has no usable target', { requestId: input.requestId, taskId })
      propose(decision, [...decision.reasons, 'apply_error'], false)
      continue
    }

    const field = FIELD_BY_KIND[decision.kind]
    const key = `${taskId}|${field}`
    if (!known.has(key)) known.set(key, field === 'description' ? task.description : task.subtasks)
    const current = known.get(key)

    let next: unknown
    if (decision.kind === 'enrichment') {
      next = formatEnrichedDescription(typeof current === 'string' ? current : null, text)
    } else {
      const added = { id: newId(), title: text, completed: false, created_at: now() }
      next = Array.isArray(current) ? [...current, added] : [added]
    }

    let rpcOutcome: RpcOutcome | null = null
    try {
      const { data, error } = await input.client.rpc('apply_ai_action', {
        p_task_id: taskId,
        p_field: field,
        p_expected: current ?? null,
        p_new: next,
        p_kind: decision.kind,
        p_request_id: input.requestId,
        p_brain_dump_id: input.brainDumpId,
        p_payload: decision.payload,
        p_evidence: decision.payload.evidence,
        p_reasons: decision.reasons,
      })
      if (error) {
        console.warn('[ai-apply] apply_ai_action failed', { requestId: input.requestId, taskId, error })
      } else {
        rpcOutcome = parseRpcOutcome(data)
        if (!rpcOutcome) {
          console.warn('[ai-apply] apply_ai_action returned an unrecognised result', { requestId: input.requestId, taskId, data })
        }
      }
    } catch (error) {
      console.warn('[ai-apply] apply_ai_action threw', { requestId: input.requestId, taskId, error })
    }

    if (rpcOutcome === 'applied') {
      known.set(key, next)
      if (decision.kind === 'enrichment') enrichmentsApplied++
      else subtaskAdditions++
      outcomes.push({ kind: decision.kind, index: decision.index, outcome: 'applied', reasons: decision.reasons })
    } else if (rpcOutcome === 'conflict' || rpcOutcome === 'task_not_found') {
      // task_not_found: the task is gone, so it cannot be linked.
      propose(decision, [...decision.reasons, 'stale_target'], rpcOutcome === 'conflict')
    } else {
      propose(decision, [...decision.reasons, 'apply_error'])
    }
  }

  // One awaited write for everything the RPC did not already record. A failure
  // here costs audit rows only; the tasks are already in their final state.
  if (queued.length > 0) {
    try {
      const { error } = await input.client.from('ai_actions').insert(queued)
      if (error) {
        console.warn('[ai-apply] Failed to write ai_actions rows', { requestId: input.requestId, count: queued.length, error })
      }
    } catch (error) {
      console.warn('[ai-apply] Failed to write ai_actions rows', { requestId: input.requestId, count: queued.length, error })
    }
  }

  return { enrichmentsApplied, subtaskAdditions, proposedCount, rejectedCount, outcomes }
}
