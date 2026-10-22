import { describe, it, expect, vi, afterEach } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { guardActions, formatEnrichedDescription, type AllowedTask, type GuardDecision } from '@/lib/ai-guard'
import { applyGuardDecisions, type ApplyClient, type ApplyResult } from '@/lib/ai-apply'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DUMP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const REQUEST_ID = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr'
const TASK_A = '11111111-1111-4111-8111-111111111111'
const TASK_B = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-10-22T12:00:00.000Z'

const DUMP = [
  "Met Jake at the networking event, he's a hiring manager at CyberX.",
  'Need to send him my updated resume by Friday.',
  'Also ask Sarah to review the resume before sending.',
].join('\n')

const EVIDENCE_JAKE = "he's a hiring manager at CyberX"
const EVIDENCE_SARAH = 'ask Sarah to review the resume'

interface FakeTask {
  description: string | null
  subtasks: unknown[]
}

function initialTasks(): Record<string, FakeTask> {
  return {
    [TASK_A]: { description: 'Check the cybersecurity openings on LinkedIn weekly', subtasks: [] },
    [TASK_B]: {
      description: null,
      subtasks: [{ id: 's1', title: 'Update LinkedIn profile', completed: false, created_at: '2026-01-01T00:00:00Z' }],
    },
  }
}

// The snapshot the route would hand over: what the model was shown.
function snapshot(tasks: Record<string, FakeTask> = initialTasks()): Map<string, AllowedTask> {
  return new Map(
    Object.entries(tasks).map(([id, t]) => [id, { title: id, description: t.description, subtasks: t.subtasks }])
  )
}

// ─── Fake Supabase client ────────────────────────────────────────────────────
// Implements the real compare-and-swap contract of apply_ai_action over an
// in-memory task store, so a stale snapshot surfaces as a genuine "conflict"
// instead of being assumed. Tests can override any single RPC call.

type RpcResult = { data: unknown; error: unknown }

interface FakeOptions {
  tasks?: Record<string, FakeTask>
  rpcOverride?: (callIndex: number, args: Record<string, unknown>) => RpcResult | Promise<RpcResult> | undefined
  insertError?: unknown
  // Mimics the ai_actions FK + insert policy: a row whose task_id is not an
  // existing task fails, and because the batch is one statement, takes every
  // other row in it down too (nothing is written).
  rejectRowsForMissingTasks?: boolean
  delayMs?: number
}

function makeFake(options: FakeOptions = {}) {
  const tasks = options.tasks ?? initialTasks()
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = []
  let inFlight = 0
  let maxInFlight = 0
  let started = 0
  let settled = 0
  let actionSeq = 0

  const wait = () => new Promise<void>(resolve => setTimeout(resolve, options.delayMs ?? 0))

  async function tracked<T>(work: () => Promise<T>): Promise<T> {
    started++
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      await wait()
      return await work()
    } finally {
      inFlight--
      settled++
    }
  }

  const client: ApplyClient = {
    rpc(fn, args) {
      return tracked(async (): Promise<RpcResult> => {
        const callIndex = rpcCalls.length
        rpcCalls.push({ fn, args })

        const override = options.rpcOverride?.(callIndex, args)
        if (override) return override

        const task = tasks[args.p_task_id as string]
        if (!task) return { data: [{ outcome: 'task_not_found', action_id: null }], error: null }

        const field = args.p_field as 'description' | 'subtasks'
        const current = task[field]
        const expected = args.p_expected ?? null
        if (!isDeepStrictEqual(current ?? null, expected)) {
          return { data: [{ outcome: 'conflict', action_id: null }], error: null }
        }
        if (field === 'description') task.description = args.p_new as string | null
        else task.subtasks = args.p_new as unknown[]
        return { data: [{ outcome: 'applied', action_id: `act-${++actionSeq}` }], error: null }
      })
    },
    from(table) {
      return {
        insert(rows) {
          return tracked(async () => {
            if (options.rejectRowsForMissingTasks && rows.some(r => r.task_id != null && !tasks[r.task_id as string])) {
              return { error: { message: 'violates foreign key constraint "ai_actions_task_id_fkey"', code: '23503' } }
            }
            inserts.push({ table, rows })
            return { error: options.insertError ?? null }
          })
        },
      }
    },
  }

  return {
    client,
    tasks,
    rpcCalls,
    inserts,
    insertedRows: () => inserts.flatMap(i => i.rows),
    stats: () => ({ inFlight, maxInFlight, started, settled }),
  }
}

// ─── Decision builders ───────────────────────────────────────────────────────

function enrichDecision(over: Partial<GuardDecision> & { text?: string; taskId?: string } = {}): GuardDecision {
  const { text, taskId, ...rest } = over
  return {
    kind: 'enrichment',
    index: 0,
    verdict: 'apply',
    reasons: [],
    payload: { taskId: taskId ?? TASK_A, text: text ?? 'Contact Jake from CyberX', evidence: EVIDENCE_JAKE },
    ...rest,
  }
}

function subtaskDecision(over: Partial<GuardDecision> & { text?: string; taskId?: string } = {}): GuardDecision {
  const { text, taskId, ...rest } = over
  return {
    kind: 'subtask_addition',
    index: 0,
    verdict: 'apply',
    reasons: [],
    payload: { taskId: taskId ?? TASK_B, text: text ?? 'Ask Sarah to review it', evidence: EVIDENCE_SARAH },
    ...rest,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

let idCounter = 0
const deps = { newId: () => `sub-${++idCounter}`, now: () => NOW }

function run(
  fake: ReturnType<typeof makeFake>,
  decisions: GuardDecision[],
  allowed: ReadonlyMap<string, AllowedTask> = snapshot()
): Promise<ApplyResult> {
  return applyGuardDecisions({
    client: fake.client,
    decisions,
    allowedTasks: allowed,
    userId: USER,
    brainDumpId: DUMP_ID,
    requestId: REQUEST_ID,
    ...deps,
  })
}

afterEach(() => {
  idCounter = 0
  vi.restoreAllMocks()
})

// ─── 'apply' decisions ───────────────────────────────────────────────────────

describe("applyGuardDecisions — 'apply' decisions", () => {
  it('calls apply_ai_action once with the CAS arguments for an enrichment', async () => {
    const fake = makeFake()
    await run(fake, [enrichDecision()])

    expect(fake.rpcCalls).toHaveLength(1)
    const { fn, args } = fake.rpcCalls[0]
    expect(fn).toBe('apply_ai_action')
    expect(args).toMatchObject({
      p_task_id: TASK_A,
      p_field: 'description',
      p_expected: 'Check the cybersecurity openings on LinkedIn weekly',
      p_new: formatEnrichedDescription('Check the cybersecurity openings on LinkedIn weekly', 'Contact Jake from CyberX'),
      p_kind: 'enrichment',
      p_request_id: REQUEST_ID,
      p_brain_dump_id: DUMP_ID,
      p_evidence: EVIDENCE_JAKE,
    })
    expect(args.p_revert_of ?? null).toBeNull()
  })

  it('calls apply_ai_action with the appended array for a subtask addition', async () => {
    const fake = makeFake()
    const before = fake.tasks[TASK_B].subtasks
    await run(fake, [subtaskDecision()])

    const { args } = fake.rpcCalls[0]
    expect(args).toMatchObject({ p_task_id: TASK_B, p_field: 'subtasks', p_kind: 'subtask_addition', p_expected: before })
    expect(args.p_new).toEqual([
      ...before,
      { id: 'sub-1', title: 'Ask Sarah to review it', completed: false, created_at: NOW },
    ])
  })

  it('writes the first description as just the context when the task had none', async () => {
    const fake = makeFake()
    await run(fake, [enrichDecision({ taskId: TASK_B, text: 'Jake is the hiring manager' })])
    expect(fake.rpcCalls[0].args.p_expected ?? null).toBeNull()
    expect(fake.rpcCalls[0].args.p_new).toBe('Jake is the hiring manager')
  })

  it('counts an action as applied only when the RPC returns "applied"', async () => {
    const fake = makeFake()
    const result = await run(fake, [enrichDecision(), subtaskDecision()])

    expect(result.enrichmentsApplied).toBe(1)
    expect(result.subtaskAdditions).toBe(1)
    expect(result.proposedCount).toBe(0)
    expect(result.outcomes.map(o => o.outcome)).toEqual(['applied', 'applied'])
    expect(fake.inserts).toHaveLength(0) // applied rows are written by the RPC itself
  })

  it('does not mutate the snapshot it was given', async () => {
    const fake = makeFake()
    const frozen = deepFreeze(snapshot())
    await expect(run(fake, [enrichDecision(), subtaskDecision()], frozen)).resolves.toBeDefined()
  })
})

// ─── Stale targets ───────────────────────────────────────────────────────────

describe('applyGuardDecisions — stale targets', () => {
  it.each(['conflict', 'task_not_found'])(
    'records a proposed row with stale_target and leaves the task untouched on "%s"',
    async outcome => {
      const fake = makeFake({
        rpcOverride: () => ({ data: [{ outcome, action_id: null }], error: null }),
      })
      const before = JSON.stringify(fake.tasks)
      const result = await run(fake, [enrichDecision()])

      expect(JSON.stringify(fake.tasks)).toBe(before)
      expect(result.enrichmentsApplied).toBe(0)
      expect(result.proposedCount).toBe(1)
      expect(result.outcomes[0]).toMatchObject({ outcome: 'proposed', reasons: ['stale_target'] })

      expect(fake.inserts).toHaveLength(1)
      expect(fake.inserts[0].table).toBe('ai_actions')
      expect(fake.insertedRows()[0]).toMatchObject({
        user_id: USER,
        request_id: REQUEST_ID,
        brain_dump_id: DUMP_ID,
        // a deleted task cannot be referenced by the FK, so its id lives only in payload
        task_id: outcome === 'task_not_found' ? null : TASK_A,
        kind: 'enrichment',
        status: 'proposed',
        field: 'description',
        before_value: null,
        after_value: null,
        evidence: EVIDENCE_JAKE,
        reasons: ['stale_target'],
        payload: { taskId: TASK_A, text: 'Contact Jake from CyberX', evidence: EVIDENCE_JAKE },
      })
    }
  )

  it('keeps the guard reasons and appends stale_target', async () => {
    const fake = makeFake({ rpcOverride: () => ({ data: [{ outcome: 'conflict', action_id: null }], error: null }) })
    await run(fake, [enrichDecision({ reasons: [] })])
    // an "apply" verdict has no guard reasons, so stale_target is the only one
    expect(fake.insertedRows()[0].reasons).toEqual(['stale_target'])
  })

  it('detects a real concurrent edit through the CAS (task changed after the snapshot)', async () => {
    const fake = makeFake()
    const stale = snapshot()
    fake.tasks[TASK_A].description = 'User edited this while the model was thinking'

    const result = await run(fake, [enrichDecision()], stale)

    expect(fake.tasks[TASK_A].description).toBe('User edited this while the model was thinking')
    expect(result.enrichmentsApplied).toBe(0)
    expect(result.proposedCount).toBe(1)
  })

  it('keeps the other audit rows when one action targets a deleted task (task_id null, id kept in payload)', async () => {
    const fake = makeFake({ rejectRowsForMissingTasks: true })
    delete fake.tasks[TASK_A] // deleted after the route read it: the RPC will answer task_not_found

    const result = await run(fake, [
      enrichDecision({ index: 0 }), // TASK_A -> task_not_found
      subtaskDecision({ index: 0, verdict: 'propose', reasons: ['evidence_not_in_dump'] }), // ordinary guard proposal on TASK_B
    ])

    expect(result.proposedCount).toBe(2)
    expect(fake.inserts).toHaveLength(1) // the batch was accepted, not rejected wholesale
    const rows = fake.insertedRows()
    expect(rows).toHaveLength(2)

    const gone = rows.find(r => r.kind === 'enrichment')!
    expect(gone).toMatchObject({ status: 'proposed', task_id: null, reasons: ['stale_target'] })
    expect(gone.payload).toMatchObject({ taskId: TASK_A, text: 'Contact Jake from CyberX' })

    const ordinary = rows.find(r => r.kind === 'subtask_addition')!
    expect(ordinary).toMatchObject({ status: 'proposed', task_id: TASK_B, reasons: ['evidence_not_in_dump'] })
  })

  it('keeps task_id on a plain conflict, where the task still exists', async () => {
    const fake = makeFake({ rejectRowsForMissingTasks: true })
    const stale = snapshot()
    fake.tasks[TASK_A].description = 'edited elsewhere'
    await run(fake, [enrichDecision()], stale)
    expect(fake.insertedRows()[0]).toMatchObject({ status: 'proposed', task_id: TASK_A, reasons: ['stale_target'] })
  })

  it('does not link a task_id it never verified when the apply decision has no usable target', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = makeFake({ rejectRowsForMissingTasks: true })
    const foreign = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    await run(fake, [
      enrichDecision({ taskId: foreign }),
      subtaskDecision({ verdict: 'propose', reasons: ['text_too_long'] }),
    ])
    expect(fake.inserts).toHaveLength(1)
    const rows = fake.insertedRows()
    expect(rows.find(r => r.kind === 'enrichment')).toMatchObject({ task_id: null, reasons: ['apply_error'] })
    expect(rows.find(r => r.kind === 'subtask_addition')).toMatchObject({ task_id: TASK_B })
  })

  it('treats a deleted task as stale', async () => {
    const fake = makeFake()
    delete fake.tasks[TASK_A]
    const result = await run(fake, [enrichDecision()])
    expect(result.proposedCount).toBe(1)
    expect(fake.insertedRows()[0].reasons).toEqual(['stale_target'])
  })
})

// ─── Fail closed ─────────────────────────────────────────────────────────────

describe('applyGuardDecisions — fail closed', () => {
  const failures: Array<[string, () => RpcResult | Promise<RpcResult>]> = [
    ['an RPC error', () => ({ data: null, error: { message: 'boom', code: '28000' } })],
    ['a rejected promise', () => Promise.reject(new Error('network down'))],
    ['null data', () => ({ data: null, error: null })],
    ['an empty result set', () => ({ data: [], error: null })],
    ['an unknown outcome string', () => ({ data: [{ outcome: 'applied-ish', action_id: null }], error: null })],
    ['a revert-only outcome', () => ({ data: [{ outcome: 'not_revertable', action_id: null }], error: null })],
    ['a non-array payload', () => ({ data: { outcome: 'applied' }, error: null })],
  ]

  it.each(failures)('applies nothing and records apply_error on %s', async (_label, make) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = makeFake({ rpcOverride: () => make() })

    const result = await run(fake, [enrichDecision(), subtaskDecision()])

    expect(result.enrichmentsApplied).toBe(0)
    expect(result.subtaskAdditions).toBe(0)
    expect(result.proposedCount).toBe(2)
    expect(result.outcomes.every(o => o.outcome === 'proposed' && o.reasons.includes('apply_error'))).toBe(true)
    expect(fake.insertedRows().map(r => r.status)).toEqual(['proposed', 'proposed'])
    expect(fake.insertedRows().every(r => (r.reasons as string[]).includes('apply_error'))).toBe(true)
  })

  it('does not throw when the audit insert itself fails, and still reports the counts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = makeFake({
      insertError: { message: 'insert failed' },
      rpcOverride: () => ({ data: null, error: { message: 'boom' } }),
    })
    const result = await run(fake, [enrichDecision()])
    expect(result.enrichmentsApplied).toBe(0)
    expect(result.proposedCount).toBe(1)
  })

  it('does not call the RPC for an apply decision whose task is not in the snapshot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = makeFake()
    const result = await run(fake, [enrichDecision({ taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })])
    expect(fake.rpcCalls).toHaveLength(0)
    expect(result.enrichmentsApplied).toBe(0)
    expect(fake.insertedRows()[0]).toMatchObject({ status: 'proposed' })
    expect(fake.insertedRows()[0].reasons).toEqual(['apply_error'])
  })

  it('keeps going after a failure: later actions on other tasks still apply', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = makeFake({
      rpcOverride: i => (i === 0 ? { data: null, error: { message: 'boom' } } : undefined),
    })
    const result = await run(fake, [enrichDecision(), subtaskDecision()])
    expect(result.enrichmentsApplied).toBe(0)
    expect(result.subtaskAdditions).toBe(1)
    expect(result.proposedCount).toBe(1)
  })
})

// ─── 'propose' and 'reject' decisions ────────────────────────────────────────

describe("applyGuardDecisions — 'propose' and 'reject' decisions", () => {
  it("inserts a proposed row for a 'propose' decision and never calls the RPC", async () => {
    const fake = makeFake()
    const before = JSON.stringify(fake.tasks)
    const result = await run(fake, [
      enrichDecision({ verdict: 'propose', reasons: ['evidence_not_in_dump'] }),
      subtaskDecision({ verdict: 'propose', reasons: ['evidence_missing'] }),
    ])

    expect(fake.rpcCalls).toHaveLength(0)
    expect(JSON.stringify(fake.tasks)).toBe(before)
    expect(result.proposedCount).toBe(2)
    expect(result.enrichmentsApplied).toBe(0)

    const rows = fake.insertedRows()
    expect(rows[0]).toMatchObject({
      user_id: USER,
      request_id: REQUEST_ID,
      brain_dump_id: DUMP_ID,
      task_id: TASK_A,
      kind: 'enrichment',
      status: 'proposed',
      field: 'description',
      reasons: ['evidence_not_in_dump'],
      evidence: EVIDENCE_JAKE,
    })
    expect(rows[1]).toMatchObject({
      task_id: TASK_B,
      kind: 'subtask_addition',
      status: 'proposed',
      field: 'subtasks',
      reasons: ['evidence_missing'],
    })
  })

  it("inserts a rejected row with task_id null for a 'reject' decision", async () => {
    const fake = makeFake()
    const result = await run(fake, [
      enrichDecision({ verdict: 'reject', reasons: ['duplicate_action'] }),
      subtaskDecision({
        verdict: 'reject',
        reasons: ['malformed_item'],
        payload: { taskId: null, text: null, evidence: null },
      }),
    ])

    expect(fake.rpcCalls).toHaveLength(0)
    expect(result.rejectedCount).toBe(2)
    expect(result.proposedCount).toBe(0) // rejected rows are not proposals

    const rows = fake.insertedRows()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ user_id: USER, request_id: REQUEST_ID, brain_dump_id: DUMP_ID, status: 'rejected', task_id: null })
    }
    // the task the model named survives in the payload even though task_id is null
    expect(rows[0].payload).toMatchObject({ taskId: TASK_A })
    expect(rows[0].field).toBe('description')
    expect(rows[1].field).toBe('subtasks')
    expect(rows[1].reasons).toEqual(['malformed_item'])
  })

  it('writes proposed and rejected rows in a single batched insert', async () => {
    const fake = makeFake({ rpcOverride: () => ({ data: [{ outcome: 'conflict', action_id: null }], error: null }) })
    await run(fake, [
      enrichDecision(), // becomes stale -> proposed
      enrichDecision({ verdict: 'propose', reasons: ['text_too_long'] }),
      subtaskDecision({ verdict: 'reject', reasons: ['task_not_allowed'] }),
    ])
    expect(fake.inserts).toHaveLength(1)
    expect(fake.inserts[0].rows.map(r => r.status)).toEqual(['proposed', 'proposed', 'rejected'])
  })

  it('makes no calls at all for an empty decision list', async () => {
    const fake = makeFake()
    const result = await run(fake, [])
    expect(fake.rpcCalls).toHaveLength(0)
    expect(fake.inserts).toHaveLength(0)
    expect(result).toMatchObject({ enrichmentsApplied: 0, subtaskAdditions: 0, proposedCount: 0, rejectedCount: 0 })
  })
})

// ─── Same-task chaining ──────────────────────────────────────────────────────

describe('applyGuardDecisions — several actions on one task', () => {
  it('lands two enrichments on the same task; the second builds on the first, not the snapshot', async () => {
    const fake = makeFake()
    const original = fake.tasks[TASK_A].description
    const first = formatEnrichedDescription(original, 'Contact Jake from CyberX')
    const second = formatEnrichedDescription(first, 'Resume due Friday')

    const result = await run(fake, [
      enrichDecision({ index: 0, text: 'Contact Jake from CyberX' }),
      enrichDecision({ index: 1, text: 'Resume due Friday' }),
    ])

    expect(result.enrichmentsApplied).toBe(2)
    expect(result.proposedCount).toBe(0)
    expect(fake.rpcCalls[1].args.p_expected).toBe(first)
    expect(fake.rpcCalls[1].args.p_new).toBe(second)
    expect(fake.tasks[TASK_A].description).toBe(second)
  })

  it('lands two subtask additions on the same task in order', async () => {
    const fake = makeFake()
    const result = await run(fake, [
      subtaskDecision({ index: 0, text: 'Ask Sarah to review it' }),
      subtaskDecision({ index: 1, text: 'Email the final PDF' }),
    ])

    expect(result.subtaskAdditions).toBe(2)
    expect(fake.tasks[TASK_B].subtasks.map(s => (s as { title: string }).title)).toEqual([
      'Update LinkedIn profile',
      'Ask Sarah to review it',
      'Email the final PDF',
    ])
    expect(new Set(fake.tasks[TASK_B].subtasks.map(s => (s as { id: string }).id)).size).toBe(3)
  })

  it('applies an enrichment and a subtask on the same task independently', async () => {
    const fake = makeFake()
    const result = await run(fake, [
      enrichDecision({ taskId: TASK_B, text: 'Jake wants a one-page PDF' }),
      subtaskDecision({ taskId: TASK_B }),
    ])
    expect(result.enrichmentsApplied).toBe(1)
    expect(result.subtaskAdditions).toBe(1)
    expect(fake.tasks[TASK_B].description).toBe('Jake wants a one-page PDF')
    expect(fake.tasks[TASK_B].subtasks).toHaveLength(2)
  })

  it('sends the later action to proposed too when the first one hit a conflict', async () => {
    const fake = makeFake()
    const stale = snapshot()
    fake.tasks[TASK_A].description = 'Changed underneath us'

    const result = await run(
      fake,
      [enrichDecision({ index: 0, text: 'one eleven chars' }), enrichDecision({ index: 1, text: 'two eleven chars' })],
      stale
    )

    expect(result.enrichmentsApplied).toBe(0)
    expect(result.proposedCount).toBe(2)
    expect(fake.tasks[TASK_A].description).toBe('Changed underneath us')
  })

  it('writes exactly the length the guard projected, so the checked limit is the stored limit', async () => {
    const fake = makeFake()
    const t1 = 'Contact Jake from CyberX'
    const t2 = 'Resume due Friday'
    const original = fake.tasks[TASK_A].description
    const projected = formatEnrichedDescription(formatEnrichedDescription(original, t1), t2)

    // Limit set to exactly the projected length: both must pass the guard and both must land.
    const decisions = guardActions({
      dump: DUMP,
      allowedTasks: snapshot(),
      enrichments: [
        { task_id: TASK_A, additional_context: t1, evidence: EVIDENCE_JAKE },
        { task_id: TASK_A, additional_context: t2, evidence: 'send him my updated resume by Friday' },
      ],
      subtaskAdditions: [],
      limits: { descriptionMaxLength: projected.length },
    })
    expect(decisions.map(d => d.verdict)).toEqual(['apply', 'apply'])

    await run(fake, decisions)
    expect(fake.tasks[TASK_A].description).toBe(projected)
    expect(fake.tasks[TASK_A].description!.length).toBe(projected.length)
  })
})

// ─── Writes are awaited ──────────────────────────────────────────────────────

describe('applyGuardDecisions — all writes are awaited', () => {
  it('has no RPC or insert still in flight when the promise resolves, and never overlaps RPCs', async () => {
    const fake = makeFake({
      delayMs: 5,
      rpcOverride: i =>
        i === 1 ? { data: [{ outcome: 'conflict', action_id: null }], error: null } : undefined,
    })

    await run(fake, [
      enrichDecision({ index: 0, text: 'first note about Jake' }),
      enrichDecision({ index: 1, text: 'second note about Jake' }), // conflicts -> queued
      subtaskDecision(),
      enrichDecision({ index: 2, verdict: 'propose', reasons: ['text_too_long'] }),
      enrichDecision({ index: 3, verdict: 'reject', reasons: ['duplicate_action'] }),
    ])

    const { inFlight, maxInFlight, started, settled } = fake.stats()
    expect(inFlight).toBe(0)
    expect(started).toBe(settled)
    expect(started).toBe(fake.rpcCalls.length + fake.inserts.length)
    expect(maxInFlight).toBe(1)
    expect(fake.inserts).toHaveLength(1)
    expect(fake.inserts[0].rows).toHaveLength(3)
  })
})
