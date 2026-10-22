import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  guardActions,
  normalizeForMatch,
  formatEnrichedDescription,
  DEFAULT_GUARD_LIMITS,
  type AllowedTask,
  type GuardInput,
  type GuardLimits,
} from '@/lib/ai-guard'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TASK_A = '11111111-1111-4111-8111-111111111111'
const TASK_B = '22222222-2222-4222-8222-222222222222'
const FOREIGN = '99999999-9999-4999-8999-999999999999'

const DUMP = [
  "Met Jake at the networking event, he's a hiring manager at CyberX.",
  'Need to send him my updated resume by Friday.',
  'Also ask Sarah to review the resume before sending.',
].join('\n')

const EVIDENCE_JAKE = "he's a hiring manager at CyberX"
const EVIDENCE_SARAH = 'ask Sarah to review the resume'

function allowedTasks(): Map<string, AllowedTask> {
  return new Map<string, AllowedTask>([
    [TASK_A, {
      title: 'Research security job openings',
      description: 'Check the cybersecurity openings on LinkedIn weekly',
      subtasks: [{ id: 's1', title: 'Update LinkedIn profile', completed: false, created_at: '2026-01-01T00:00:00Z' }],
    }],
    [TASK_B, { title: 'Update resume', description: null, subtasks: [] }],
  ])
}

function enrich(over: Record<string, unknown> = {}) {
  return {
    task_id: TASK_A,
    additional_context: 'Contact Jake from CyberX',
    evidence: EVIDENCE_JAKE,
    ...over,
  }
}

function subtask(over: Record<string, unknown> = {}) {
  return {
    task_id: TASK_B,
    subtask_title: 'Ask Sarah to review it',
    evidence: EVIDENCE_SARAH,
    ...over,
  }
}

function run(over: Partial<GuardInput> = {}) {
  return guardActions({
    dump: DUMP,
    allowedTasks: allowedTasks(),
    enrichments: [],
    subtaskAdditions: [],
    ...over,
  })
}

function limits(over: Partial<GuardLimits>): Partial<GuardLimits> {
  return over
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── normalizeForMatch ───────────────────────────────────────────────────────

describe('normalizeForMatch', () => {
  it('lowercases and collapses whitespace, including newlines and tabs', () => {
    expect(normalizeForMatch('  Hello \n\t  WORLD  ')).toBe('hello world')
  })

  it('maps curly quotes and typographic dashes to ASCII', () => {
    expect(normalizeForMatch('he\u2019s \u201Cin\u201D \u2013 out')).toBe('he\'s "in" - out')
  })

  it('strips zero-width characters', () => {
    expect(normalizeForMatch('Ja\u200Bke\uFEFF')).toBe('jake')
  })

  it('treats non-breaking space as whitespace and applies NFKC', () => {
    expect(normalizeForMatch('a\u00A0b')).toBe('a b')
    expect(normalizeForMatch('\uFB01le')).toBe('file')
  })

  it('is idempotent', () => {
    const samples = ["He\u2019s  \u201Cin\u201D\n", 'e\u200B\u0301clair', 'plain']
    for (const s of samples) {
      const once = normalizeForMatch(s)
      expect(normalizeForMatch(once)).toBe(once)
    }
  })

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(normalizeForMatch('')).toBe('')
    expect(normalizeForMatch(' \n\t ')).toBe('')
  })
})

// ─── formatEnrichedDescription ───────────────────────────────────────────────

describe('formatEnrichedDescription', () => {
  it('returns the context alone when there is no existing description', () => {
    expect(formatEnrichedDescription(null, 'ctx')).toBe('ctx')
    expect(formatEnrichedDescription('', 'ctx')).toBe('ctx')
  })

  it('appends with the "Update:" separator when a description exists', () => {
    expect(formatEnrichedDescription('old', 'ctx')).toBe('old\n\nUpdate: ctx')
  })
})

// ─── Evidence ────────────────────────────────────────────────────────────────

describe('evidence', () => {
  it('applies when the evidence is an exact substring of the dump', () => {
    const [d] = run({ enrichments: [enrich()] })
    expect(d.verdict).toBe('apply')
    expect(d.reasons).toEqual([])
  })

  it.each([
    ['different case', "HE'S A HIRING MANAGER AT CYBERX"],
    ['extra whitespace', "he's   a  hiring\tmanager at CyberX"],
    ['curly apostrophe', 'he\u2019s a hiring manager at CyberX'],
    ['zero-width characters', "he's a hir\u200Bing manager at CyberX"],
  ])('matches despite %s', (_label, evidence) => {
    const [d] = run({ enrichments: [enrich({ evidence })] })
    expect(d.verdict).toBe('apply')
  })

  it('matches when a zero-width space, written as an escape, is embedded in the evidence', () => {
    const evidence = "he's a hiring man\u200bager at CyberX"
    // Guard against a vacuous test: the evidence really contains the character,
    // and a plain substring search would NOT find it in the dump.
    expect(evidence).toContain('\u200b')
    expect(DUMP.includes(evidence)).toBe(false)
    const [d] = run({ enrichments: [enrich({ evidence })] })
    expect(d.verdict).toBe('apply')
    expect(d.reasons).toEqual([])
  })

  it('matches when the dump has a newline where the evidence has a space', () => {
    const [d] = run({ enrichments: [enrich({ evidence: 'by Friday. Also ask Sarah' })] })
    expect(d.verdict).toBe('apply')
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   \n '],
  ])('proposes with evidence_missing when evidence is %s', (_label, evidence) => {
    const [d] = run({ enrichments: [enrich({ evidence })] })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(['evidence_missing'])
  })

  it('proposes with evidence_too_short for a trivially short quote present in the dump', () => {
    const [d] = run({ enrichments: [enrich({ evidence: 'Jake' })] })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(['evidence_too_short'])
  })

  it('proposes with evidence_too_short for punctuation-only evidence', () => {
    const [d] = run({ enrichments: [enrich({ evidence: '.' })] })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toContain('evidence_too_short')
  })

  it('proposes with evidence_not_in_dump for a paraphrase', () => {
    const [d] = run({ enrichments: [enrich({ evidence: 'Jake works as a recruiter at CyberX' })] })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(['evidence_not_in_dump'])
  })

  it('proposes when two real fragments are stitched together with an ellipsis', () => {
    const [d] = run({ enrichments: [enrich({ evidence: 'Met Jake at the networking event ... review the resume' })] })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(['evidence_not_in_dump'])
  })

  it('treats regex metacharacters literally', () => {
    const dump = 'Call the dentist (urgent) about the crown.'
    const hit = run({ dump, enrichments: [enrich({ evidence: 'the dentist (urgent) about' })] })
    expect(hit[0].verdict).toBe('apply')
    const miss = run({ dump, enrichments: [enrich({ evidence: 'the dentist.*about the crown' })] })
    expect(miss[0].reasons).toEqual(['evidence_not_in_dump'])
  })

  it('does not accept a quote that exists only in the target task description', () => {
    const [d] = run({ enrichments: [enrich({ evidence: 'cybersecurity openings on LinkedIn' })] })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(['evidence_not_in_dump'])
  })

  it('does not accept a quote that exists only in the target task title', () => {
    const [d] = run({ enrichments: [enrich({ evidence: 'Research security job openings' })] })
    expect(d.reasons).toEqual(['evidence_not_in_dump'])
  })

  it('proposes with evidence_too_long above the configured maximum', () => {
    const [d] = run({
      enrichments: [enrich()],
      limits: limits({ evidenceMaxLength: EVIDENCE_JAKE.length - 1 }),
    })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(['evidence_too_long'])
  })

  it('accepts evidence exactly at the maximum and exactly at the minimum', () => {
    const atMax = run({ enrichments: [enrich()], limits: limits({ evidenceMaxLength: EVIDENCE_JAKE.length }) })
    expect(atMax[0].verdict).toBe('apply')
    const atMin = run({ enrichments: [enrich()], limits: limits({ evidenceMinLength: EVIDENCE_JAKE.length }) })
    expect(atMin[0].verdict).toBe('apply')
    const belowMin = run({ enrichments: [enrich()], limits: limits({ evidenceMinLength: EVIDENCE_JAKE.length + 1 }) })
    expect(belowMin[0].reasons).toEqual(['evidence_too_short'])
  })

  it('applies the same evidence rules to subtask additions', () => {
    const ok = run({ subtaskAdditions: [subtask()] })
    expect(ok[0].verdict).toBe('apply')
    const bad = run({ subtaskAdditions: [subtask({ evidence: 'Sarah will definitely review it' })] })
    expect(bad[0].verdict).toBe('propose')
    expect(bad[0].reasons).toEqual(['evidence_not_in_dump'])
  })
})

// ─── Task id ─────────────────────────────────────────────────────────────────

describe('task_id', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('rejects with task_id_missing when task_id is %s', (_label, task_id) => {
    const [d] = run({ enrichments: [enrich({ task_id })] })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toContain('task_id_missing')
  })

  it.each([
    ['a UUID that is not in the allowed set', FOREIGN],
    ['the placeholder string the model sometimes returns', 'exact UUID of the existing task'],
    ['<task_id>', '<task_id>'],
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
  ])('rejects with task_not_allowed for %s', (_label, task_id) => {
    const [d] = run({ enrichments: [enrich({ task_id })] })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toEqual(['task_not_allowed'])
  })

  it('normalises case and surrounding whitespace before the allowed-set lookup', () => {
    const [d] = run({ enrichments: [enrich({ task_id: `  ${TASK_A.toUpperCase()} ` })] })
    expect(d.verdict).toBe('apply')
    expect(d.payload.taskId).toBe(TASK_A)
  })

  it('rejects subtask additions for tasks outside the allowed set', () => {
    const [d] = run({ subtaskAdditions: [subtask({ task_id: FOREIGN })] })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toEqual(['task_not_allowed'])
  })

  it('rejects an invalid task even when the evidence is also bad (reject outranks propose)', () => {
    const [d] = run({ enrichments: [enrich({ task_id: FOREIGN, evidence: 'made up quote that is not there' })] })
    expect(d.verdict).toBe('reject')
  })
})

// ─── Text ────────────────────────────────────────────────────────────────────

describe('text', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', ' \n\t '],
  ])('rejects with text_empty when the enrichment text is %s', (_label, additional_context) => {
    const [d] = run({ enrichments: [enrich({ additional_context })] })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toContain('text_empty')
  })

  it('rejects with text_empty when the subtask title is whitespace only', () => {
    const [d] = run({ subtaskAdditions: [subtask({ subtask_title: '   ' })] })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toContain('text_empty')
  })

  it('trims the text it returns in the payload', () => {
    const [d] = run({ enrichments: [enrich({ additional_context: '  Contact Jake  \n' })] })
    expect(d.payload.text).toBe('Contact Jake')
  })

  it('applies an enrichment exactly at the cap and proposes one character over', () => {
    const text = 'x'.repeat(40)
    const at = run({ enrichments: [enrich({ additional_context: text })], limits: limits({ enrichmentTextMaxLength: 40 }) })
    expect(at[0].verdict).toBe('apply')
    const over = run({ enrichments: [enrich({ additional_context: text + 'x' })], limits: limits({ enrichmentTextMaxLength: 40 }) })
    expect(over[0].verdict).toBe('propose')
    expect(over[0].reasons).toEqual(['text_too_long'])
  })

  it('applies a subtask title exactly at the cap and proposes one character over', () => {
    const title = 'y'.repeat(30)
    const at = run({ subtaskAdditions: [subtask({ subtask_title: title })], limits: limits({ subtaskTitleMaxLength: 30 }) })
    expect(at[0].verdict).toBe('apply')
    const over = run({ subtaskAdditions: [subtask({ subtask_title: title + 'y' })], limits: limits({ subtaskTitleMaxLength: 30 }) })
    expect(over[0].verdict).toBe('propose')
    expect(over[0].reasons).toEqual(['text_too_long'])
  })

  it('measures length after trimming, so padding does not push text over the cap', () => {
    const [d] = run({
      enrichments: [enrich({ additional_context: `   ${'z'.repeat(20)}   ` })],
      limits: limits({ enrichmentTextMaxLength: 20 }),
    })
    expect(d.verdict).toBe('apply')
  })

  it('does not truncate over-long text; the full text is kept for the proposal', () => {
    const text = 'w'.repeat(60)
    const [d] = run({ enrichments: [enrich({ additional_context: text })], limits: limits({ enrichmentTextMaxLength: 40 }) })
    expect(d.payload.text).toBe(text)
  })

  it('collects both reasons when text is too long and evidence is not in the dump', () => {
    const [d] = run({
      enrichments: [enrich({ additional_context: 'q'.repeat(50), evidence: 'a sentence that is nowhere in the dump' })],
      limits: limits({ enrichmentTextMaxLength: 40 }),
    })
    expect(d.verdict).toBe('propose')
    expect(d.reasons).toEqual(expect.arrayContaining(['text_too_long', 'evidence_not_in_dump']))
  })
})

// ─── Resulting description length ────────────────────────────────────────────

describe('description length', () => {
  const existing = allowedTasks().get(TASK_A)!.description

  it('counts the "Update:" separator towards the resulting description length', () => {
    const text = 'Contact Jake from CyberX'
    const exact = formatEnrichedDescription(existing, text).length
    const at = run({ enrichments: [enrich()], limits: limits({ descriptionMaxLength: exact }) })
    expect(at[0].verdict).toBe('apply')
    const over = run({ enrichments: [enrich()], limits: limits({ descriptionMaxLength: exact - 1 }) })
    expect(over[0].verdict).toBe('propose')
    expect(over[0].reasons).toEqual(['description_too_long'])
  })

  it('accounts for earlier applied enrichments to the same task in the same response', () => {
    const first = 'first context for resume'
    const second = 'second context for resume'
    const cap = formatEnrichedDescription(null, first).length + 5
    const out = run({
      enrichments: [
        enrich({ task_id: TASK_B, additional_context: first, evidence: 'updated resume by Friday' }),
        enrich({ task_id: TASK_B, additional_context: second, evidence: 'updated resume by Friday' }),
      ],
      limits: limits({ descriptionMaxLength: cap }),
    })
    expect(out[0].verdict).toBe('apply')
    expect(out[1].verdict).toBe('propose')
    expect(out[1].reasons).toEqual(['description_too_long'])
  })

  it('does not count a proposed enrichment towards the running description', () => {
    const first = 'first context for resume'
    const second = 'second ctx'
    const cap = formatEnrichedDescription(null, second).length
    const out = run({
      enrichments: [
        enrich({ task_id: TASK_B, additional_context: first, evidence: 'not in the dump at all, sorry' }),
        enrich({ task_id: TASK_B, additional_context: second, evidence: 'updated resume by Friday' }),
      ],
      limits: limits({ descriptionMaxLength: cap }),
    })
    expect(out[0].verdict).toBe('propose')
    expect(out[1].verdict).toBe('apply')
  })

  it('does not apply the description cap to subtask additions', () => {
    const [d] = run({ subtaskAdditions: [subtask()], limits: limits({ descriptionMaxLength: 1 }) })
    expect(d.verdict).toBe('apply')
  })
})

// ─── Limits and duplicates ───────────────────────────────────────────────────

describe('limits and duplicates', () => {
  it('proposes actions beyond the per-response limit with over_action_limit', () => {
    const out = run({
      enrichments: [
        enrich({ additional_context: 'one context' }),
        enrich({ task_id: TASK_B, additional_context: 'two context', evidence: 'updated resume by Friday' }),
        enrich({ additional_context: 'three context' }),
      ],
      limits: limits({ maxActions: 2 }),
    })
    expect(out.map(d => d.verdict)).toEqual(['apply', 'apply', 'propose'])
    expect(out[2].reasons).toEqual(['over_action_limit'])
  })

  it('proposes actions beyond the per-task limit with over_action_limit', () => {
    const out = run({
      subtaskAdditions: [
        subtask({ subtask_title: 'step one' }),
        subtask({ subtask_title: 'step two' }),
        subtask({ subtask_title: 'step three' }),
      ],
      limits: limits({ maxActionsPerTask: 2 }),
    })
    expect(out.map(d => d.verdict)).toEqual(['apply', 'apply', 'propose'])
    expect(out[2].reasons).toEqual(['over_action_limit'])
  })

  it('does not let rejected items consume the action budget', () => {
    const out = run({
      enrichments: [
        enrich({ task_id: FOREIGN }),
        enrich({ task_id: null }),
        enrich({ additional_context: 'a real one' }),
      ],
      limits: limits({ maxActions: 1 }),
    })
    expect(out.map(d => d.verdict)).toEqual(['reject', 'reject', 'apply'])
  })

  it('lets proposed items consume the action budget', () => {
    const out = run({
      enrichments: [
        enrich({ evidence: null, additional_context: 'unquoted one' }),
        enrich({ additional_context: 'quoted one' }),
      ],
      limits: limits({ maxActions: 1 }),
    })
    expect(out[0].verdict).toBe('propose')
    expect(out[1].verdict).toBe('propose')
    expect(out[1].reasons).toEqual(['over_action_limit'])
  })

  it('rejects an identical enrichment repeated for the same task with duplicate_action', () => {
    const out = run({ enrichments: [enrich(), enrich()] })
    expect(out[0].verdict).toBe('apply')
    expect(out[1].verdict).toBe('reject')
    expect(out[1].reasons).toEqual(['duplicate_action'])
  })

  it('detects duplicates through normalisation (case and whitespace)', () => {
    const out = run({
      enrichments: [
        enrich({ additional_context: 'Contact Jake from CyberX' }),
        enrich({ additional_context: 'contact   JAKE from cyberx' }),
      ],
    })
    expect(out[1].reasons).toEqual(['duplicate_action'])
  })

  it('does not treat the same text on different tasks as a duplicate', () => {
    const out = run({
      enrichments: [
        enrich({ task_id: TASK_A }),
        enrich({ task_id: TASK_B, evidence: 'updated resume by Friday' }),
      ],
    })
    expect(out.map(d => d.verdict)).toEqual(['apply', 'apply'])
  })

  it('rejects a subtask whose title already exists on the task, case-insensitively', () => {
    const [d] = run({
      subtaskAdditions: [subtask({ task_id: TASK_A, subtask_title: 'update linkedin PROFILE' })],
    })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toEqual(['duplicate_subtask'])
  })

  it('tolerates a task whose subtasks value is not an array', () => {
    const tasks = allowedTasks()
    tasks.set(TASK_B, { title: 'Update resume', description: null, subtasks: null })
    const [d] = run({ allowedTasks: tasks, subtaskAdditions: [subtask()] })
    expect(d.verdict).toBe('apply')
  })
})

// ─── Malformed items ─────────────────────────────────────────────────────────

describe('malformed items', () => {
  it('rejects only the malformed items and still processes their neighbours', () => {
    const out = run({
      enrichments: [
        { task_id: 42, additional_context: 'numeric id' },
        null,
        enrich({ evidence: { quote: EVIDENCE_JAKE } }),
        'just a string',
        enrich(),
      ],
    })
    expect(out.map(d => d.verdict)).toEqual(['reject', 'reject', 'reject', 'reject', 'apply'])
    expect(out.slice(0, 4).every(d => d.reasons.includes('malformed_item'))).toBe(true)
    expect(out[0].payload).toEqual({ taskId: null, text: null, evidence: null })
  })

  it('treats a non-string subtask title as malformed', () => {
    const [d] = run({ subtaskAdditions: [subtask({ subtask_title: ['a', 'b'] })] })
    expect(d.verdict).toBe('reject')
    expect(d.reasons).toEqual(['malformed_item'])
  })

  it('ignores unknown extra keys on an otherwise valid item', () => {
    const [d] = run({ enrichments: [enrich({ confidence: 0.99 })] })
    expect(d.verdict).toBe('apply')
  })
})

// ─── Output shape, ordering, purity ──────────────────────────────────────────

describe('output shape and ordering', () => {
  it('returns enrichments first, then subtask additions, each with kind and original index', () => {
    const out = run({
      enrichments: [enrich({ additional_context: 'e0' }), enrich({ additional_context: 'e1' })],
      subtaskAdditions: [subtask({ subtask_title: 's0' })],
    })
    expect(out.map(d => [d.kind, d.index])).toEqual([
      ['enrichment', 0],
      ['enrichment', 1],
      ['subtask_addition', 0],
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(run()).toEqual([])
  })

  it('returns the normalised payload for an applied action', () => {
    const [d] = run({ enrichments: [enrich({ evidence: `  ${EVIDENCE_JAKE}  ` })] })
    expect(d.payload).toEqual({
      taskId: TASK_A,
      text: 'Contact Jake from CyberX',
      evidence: EVIDENCE_JAKE,
    })
  })
})

describe('purity', () => {
  it('does not mutate frozen inputs and is deterministic', () => {
    const input: GuardInput = {
      dump: DUMP,
      allowedTasks: allowedTasks(),
      enrichments: deepFreeze([enrich(), enrich({ evidence: 'nope, not in the dump' })]),
      subtaskAdditions: deepFreeze([subtask()]),
      limits: deepFreeze({ maxActions: 5 }),
    }
    for (const t of input.allowedTasks.values()) deepFreeze(t)
    const before = JSON.stringify([input.enrichments, input.subtaskAdditions, [...input.allowedTasks]])

    const first = guardActions(input)
    const second = guardActions(input)

    expect(second).toEqual(first)
    expect(JSON.stringify([input.enrichments, input.subtaskAdditions, [...input.allowedTasks]])).toBe(before)
  })

  it('never reads the clock or any randomness source', () => {
    const now = vi.spyOn(Date, 'now')
    const rand = vi.spyOn(Math, 'random')
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID')
    run({ enrichments: [enrich()], subtaskAdditions: [subtask()] })
    expect(now).not.toHaveBeenCalled()
    expect(rand).not.toHaveBeenCalled()
    expect(uuid).not.toHaveBeenCalled()
  })

  it('merges partial limits over the defaults', () => {
    expect(DEFAULT_GUARD_LIMITS.maxActions).toBeGreaterThan(0)
    const out = run({
      enrichments: [enrich({ additional_context: 'x'.repeat(DEFAULT_GUARD_LIMITS.enrichmentTextMaxLength + 1) })],
      limits: limits({ maxActions: 3 }),
    })
    expect(out[0].reasons).toEqual(['text_too_long'])
  })
})
