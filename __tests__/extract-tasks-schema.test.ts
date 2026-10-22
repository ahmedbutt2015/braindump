import { describe, it, expect } from 'vitest'
import { ExtractedTasksSchema, EnrichmentSchema, SubtaskAdditionSchema } from '@/lib/ai-schemas'

describe('ExtractedTasksSchema', () => {
  it('parses a valid full response', () => {
    const raw = {
      tasks: [{ title: 'Send invoice', description: 'To Jake', priority: 'high', due_date: '2026-06-01' }],
      enrichments: [{ task_id: 'abc-123', additional_context: 'Jake is at CyberX' }],
      subtask_additions: [{ task_id: 'abc-123', subtask_title: 'Send LinkedIn request' }],
      summary: 'Extracted 1 task and 1 enrichment.',
    }
    const result = ExtractedTasksSchema.parse(raw)
    expect(result.tasks).toHaveLength(1)
    expect(result.enrichments).toHaveLength(1)
    expect(result.subtask_additions).toHaveLength(1)
  })

  it('defaults enrichments and subtask_additions to [] when absent', () => {
    const raw = {
      tasks: [],
      summary: 'Nothing to extract.',
    }
    const result = ExtractedTasksSchema.parse(raw)
    expect(result.enrichments).toEqual([])
    expect(result.subtask_additions).toEqual([])
  })

  it('coerces string "null" to actual null in description and due_date', () => {
    const raw = {
      tasks: [{ title: 'Task', description: 'null', priority: 'low', due_date: 'null' }],
      summary: 'ok',
    }
    const result = ExtractedTasksSchema.parse(raw)
    expect(result.tasks[0].description).toBeNull()
    expect(result.tasks[0].due_date).toBeNull()
  })

  it('coerces empty string description to null', () => {
    const raw = {
      tasks: [{ title: 'Task', description: '', priority: 'medium', due_date: null }],
      summary: 'ok',
    }
    const result = ExtractedTasksSchema.parse(raw)
    expect(result.tasks[0].description).toBeNull()
  })

  it('catches unknown priority and falls back to medium', () => {
    const raw = {
      tasks: [{ title: 'Task', description: null, priority: 'critical', due_date: null }],
      summary: 'ok',
    }
    const result = ExtractedTasksSchema.parse(raw)
    expect(result.tasks[0].priority).toBe('medium')
  })

  it('throws on missing summary', () => {
    const raw = { tasks: [] }
    expect(() => ExtractedTasksSchema.parse(raw)).toThrow()
  })

  it('does not fail the whole parse when an enrichment or subtask item is malformed', () => {
    const raw = {
      tasks: [{ title: 'Send invoice', priority: 'high' }],
      enrichments: [{ task_id: 42 }, null, 'oops'],
      subtask_additions: [{ subtask_title: { nested: true } }],
      summary: 'ok',
    }
    const result = ExtractedTasksSchema.parse(raw)
    expect(result.tasks).toHaveLength(1)
    expect(result.enrichments).toHaveLength(3)
    expect(result.subtask_additions).toHaveLength(1)
  })

  it('still fails the parse when tasks is not an array', () => {
    expect(() => ExtractedTasksSchema.parse({ tasks: 'nope', summary: 'ok' })).toThrow()
  })
})

describe('EnrichmentSchema / SubtaskAdditionSchema evidence field', () => {
  it('accepts a present evidence string', () => {
    expect(EnrichmentSchema.parse({ task_id: 'x', additional_context: 'y', evidence: 'quote' }).evidence).toBe('quote')
    expect(SubtaskAdditionSchema.parse({ task_id: 'x', subtask_title: 'y', evidence: 'quote' }).evidence).toBe('quote')
  })

  it('accepts absent and null evidence (the guard downgrades these, the parse does not fail)', () => {
    expect(EnrichmentSchema.parse({ task_id: 'x', additional_context: 'y' }).evidence).toBeUndefined()
    expect(EnrichmentSchema.parse({ task_id: 'x', additional_context: 'y', evidence: null }).evidence).toBeNull()
    expect(SubtaskAdditionSchema.parse({ task_id: 'x', subtask_title: 'y' }).evidence).toBeUndefined()
  })

  it('rejects non-string evidence', () => {
    expect(EnrichmentSchema.safeParse({ task_id: 'x', additional_context: 'y', evidence: { q: 1 } }).success).toBe(false)
    expect(SubtaskAdditionSchema.safeParse({ task_id: 'x', subtask_title: 'y', evidence: 5 }).success).toBe(false)
  })
})

describe('UUID filter logic', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  it('accepts valid UUIDs', () => {
    expect(UUID_RE.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(UUID_RE.test('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('rejects placeholder strings the model sometimes returns', () => {
    expect(UUID_RE.test('exact UUID of the existing task')).toBe(false)
    expect(UUID_RE.test('<task_id>')).toBe(false)
    expect(UUID_RE.test('null')).toBe(false)
    expect(UUID_RE.test('')).toBe(false)
  })
})

describe('dedup overlap filter', () => {
  const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'also', 'just', 'then'])

  function overlapCount(titleWords: string[], coveredWords: Set<string>) {
    return titleWords.filter(w => coveredWords.has(w)).length
  }

  it('drops a new task whose title overlaps 2+ words with a subtask addition', () => {
    const coveredWords = new Set(['research', 'security', 'roles', 'linkedin'])
    const taskWords = 'research security openings'.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
    expect(overlapCount(taskWords, coveredWords)).toBeGreaterThanOrEqual(2)
  })

  it('keeps a new task whose title has fewer than 2 overlapping words', () => {
    const coveredWords = new Set(['email', 'jake'])
    const taskWords = 'research security openings'.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
    expect(overlapCount(taskWords, coveredWords)).toBeLessThan(2)
  })
})
