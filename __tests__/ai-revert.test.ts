import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isUuid, mapRevertResult } from '@/lib/ai-revert'

const ACTION_ID = '33333333-3333-4333-8333-333333333333'

// ─── isUuid ──────────────────────────────────────────────────────────────────

describe('isUuid', () => {
  it('accepts well-formed UUIDs of any case', () => {
    expect(isUuid(ACTION_ID)).toBe(true)
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
    expect(isUuid(ACTION_ID.toUpperCase())).toBe(true)
  })

  it.each([
    'not-a-uuid',
    '',
    ' ',
    '33333333-3333-4333-8333-33333333333',      // one char short
    '33333333-3333-4333-8333-3333333333333',    // one char long
    '33333333333343338333333333333333',          // no dashes
    `${ACTION_ID}\n`,                            // trailing newline must not slip past the anchor
    ` ${ACTION_ID}`,
    `${ACTION_ID}; drop table ai_actions`,
    '3333333g-3333-4333-8333-333333333333',      // non-hex
    '../../etc/passwd',
  ])('rejects %j', value => {
    expect(isUuid(value)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(42)).toBe(false)
    expect(isUuid({})).toBe(false)
    expect(isUuid([ACTION_ID])).toBe(false)
  })
})

// ─── mapRevertResult ─────────────────────────────────────────────────────────

function rpcOk(outcome: unknown, actionId: unknown = ACTION_ID) {
  return { data: [{ outcome, action_id: actionId }], error: null }
}

describe('mapRevertResult', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps reverted to 200 and echoes the action id', () => {
    const r = mapRevertResult(rpcOk('reverted'), ACTION_ID)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ success: true, outcome: 'reverted', actionId: ACTION_ID })
  })

  it('maps conflict to 409', () => {
    const r = mapRevertResult(rpcOk('conflict', null), ACTION_ID)
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ outcome: 'conflict' })
    expect(typeof r.body.error).toBe('string')
    expect(r.body.success).toBeUndefined()
  })

  it.each(['not_revertable', 'task_not_found'])('maps %s to 404', outcome => {
    const r = mapRevertResult(rpcOk(outcome, null), ACTION_ID)
    expect(r.status).toBe(404)
    expect(r.body).toMatchObject({ outcome })
    expect(typeof r.body.error).toBe('string')
    expect(r.body.success).toBeUndefined()
  })

  it('maps an RPC error to 500 and assumes nothing', () => {
    const r = mapRevertResult({ data: null, error: { message: 'boom', code: '28000' } }, ACTION_ID)
    expect(r.status).toBe(500)
    expect(r.body.success).toBeUndefined()
    expect(r.body.outcome).toBeUndefined()
  })

  it('does not trust a "reverted" outcome that arrives alongside an error', () => {
    const r = mapRevertResult({ data: [{ outcome: 'reverted', action_id: ACTION_ID }], error: { message: 'partial' } }, ACTION_ID)
    expect(r.status).toBe(500)
  })

  it('does not leak the raw database error to the client', () => {
    const r = mapRevertResult({ data: null, error: { message: 'relation "ai_actions" secret detail', code: 'XX000' } }, ACTION_ID)
    expect(JSON.stringify(r.body)).not.toContain('secret detail')
    expect(JSON.stringify(r.body)).not.toContain('XX000')
  })

  const malformed: Array<[string, unknown]> = [
    ['null data', null],
    ['undefined data', undefined],
    ['an empty result set', []],
    ['a non-array object', { outcome: 'reverted' }],
    ['a row without outcome', [{ action_id: ACTION_ID }]],
    ['a null row', [null]],
    ['a non-string outcome', [{ outcome: true }]],
    ['an unknown outcome string', [{ outcome: 'reverted-ish' }]],
    ['a different case', [{ outcome: 'REVERTED' }]],
    ['the apply-only outcome "applied"', [{ outcome: 'applied', action_id: ACTION_ID }]],
    ['a bare string', 'reverted'],
  ]

  it.each(malformed)('maps %s to 500', (_label, data) => {
    const r = mapRevertResult({ data, error: null }, ACTION_ID)
    expect(r.status).toBe(500)
    expect(r.body.success).toBeUndefined()
  })
})

// ─── POST /api/ai-actions/[id]/revert ────────────────────────────────────────

const getUser = vi.fn()
const rpc = vi.fn()
const createClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))

async function post(id: string, init: RequestInit = { method: 'POST' }) {
  const { POST } = await import('@/app/api/ai-actions/[id]/revert/route')
  const request = new Request(`http://localhost/api/ai-actions/${id}/revert`, init)
  const response = await POST(request, { params: Promise.resolve({ id }) })
  return { response, json: await response.json(), request }
}

describe('POST /api/ai-actions/[id]/revert', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    rpc.mockReset().mockResolvedValue(rpcOk('reverted'))
    createClient.mockReset().mockResolvedValue({ auth: { getUser }, rpc })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 without a user and never calls the RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { response } = await post(ACTION_ID)
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 401 when auth errors', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: { message: 'jwt expired' } })
    const { response } = await post(ACTION_ID)
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('authenticates before validating the id', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { response } = await post('not-a-uuid')
    expect(response.status).toBe(401)
  })

  it('returns 400 for a non-UUID id and never calls the RPC', async () => {
    const { response, json } = await post('not-a-uuid')
    expect(response.status).toBe(400)
    expect(typeof json.error).toBe('string')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls apply_ai_action with exactly { p_revert_of: id } and returns 200 on reverted', async () => {
    const { response, json } = await post(ACTION_ID)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('apply_ai_action', { p_revert_of: ACTION_ID })
    expect(response.status).toBe(200)
    expect(json).toMatchObject({ success: true, outcome: 'reverted', actionId: ACTION_ID })
  })

  it('ignores the request body completely, including a hostile or unparseable one', async () => {
    const hostile = JSON.stringify({
      p_revert_of: '99999999-9999-4999-8999-999999999999',
      p_task_id: '99999999-9999-4999-8999-999999999999',
      p_field: 'description',
      p_new: 'pwned',
      p_expected: null,
    })
    await post(ACTION_ID, { method: 'POST', body: hostile, headers: { 'Content-Type': 'application/json' } })
    expect(rpc).toHaveBeenLastCalledWith('apply_ai_action', { p_revert_of: ACTION_ID })

    const garbage = await post(ACTION_ID, { method: 'POST', body: '{not json', headers: { 'Content-Type': 'application/json' } })
    expect(garbage.response.status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith('apply_ai_action', { p_revert_of: ACTION_ID })
  })

  it('never reads the body stream', async () => {
    const { request } = await post(ACTION_ID, { method: 'POST', body: '{"x":1}' })
    expect(request.bodyUsed).toBe(false)
  })

  it.each([
    ['conflict', 409],
    ['not_revertable', 404],
    ['task_not_found', 404],
  ])('returns %s as %i', async (outcome, status) => {
    rpc.mockResolvedValue(rpcOk(outcome, null))
    const { response, json } = await post(ACTION_ID)
    expect(response.status).toBe(status)
    expect(json.outcome).toBe(outcome)
  })

  it('returns 500 on an RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { response } = await post(ACTION_ID)
    expect(response.status).toBe(500)
  })

  it('returns 500 on an unrecognised result', async () => {
    rpc.mockResolvedValue({ data: [{ outcome: 'applied' }], error: null })
    const { response } = await post(ACTION_ID)
    expect(response.status).toBe(500)
  })

  it('returns 500 when the RPC call throws', async () => {
    rpc.mockRejectedValue(new Error('network down'))
    const { response, json } = await post(ACTION_ID)
    expect(response.status).toBe(500)
    expect(JSON.stringify(json)).not.toContain('network down')
  })

  it('returns 500 when the client cannot be created', async () => {
    createClient.mockRejectedValue(new Error('no cookies'))
    const { response } = await post(ACTION_ID)
    expect(response.status).toBe(500)
  })
})
