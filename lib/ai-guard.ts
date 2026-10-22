import { EnrichmentSchema, SubtaskAdditionSchema } from '@/lib/ai-schemas'

// Deterministic gate for model-proposed mutations to EXISTING tasks.
//
// The prompt asks the model for a verbatim `evidence` quote with every
// enrichment and subtask addition, but a prompt is a request, not a guarantee.
// guardActions() is the check in code: it decides, per action, whether the
// change may be applied, should only be recorded as a proposal, or is garbage.
//
// Pure by design: no I/O, no clock, no randomness. Callers inject anything
// that needs an id or a timestamp, so every case is unit-testable.
//
// It proves provenance (the quote is really in the dump), not relevance (that
// the quote supports the change). The limits below are placeholders to be
// tuned against real model output.

export type ActionKind = 'enrichment' | 'subtask_addition'

// reject  — nothing a human could act on (no valid target, empty text, junk). Never applied or shown.
// propose — structurally valid but not trustworthy enough to apply (evidence or size failures).
// apply   — passed every check.
export type GuardVerdict = 'apply' | 'propose' | 'reject'

export type GuardReason =
  | 'malformed_item'
  | 'task_id_missing'
  | 'task_not_allowed'
  | 'text_empty'
  | 'duplicate_action'
  | 'duplicate_subtask'
  | 'evidence_missing'
  | 'evidence_too_short'
  | 'evidence_too_long'
  | 'evidence_not_in_dump'
  | 'text_too_long'
  | 'description_too_long'
  | 'over_action_limit'

export interface GuardLimits {
  evidenceMinLength: number
  evidenceMaxLength: number
  subtaskTitleMaxLength: number
  enrichmentTextMaxLength: number
  descriptionMaxLength: number
  maxActions: number
  maxActionsPerTask: number
}

export const DEFAULT_GUARD_LIMITS: Readonly<GuardLimits> = {
  evidenceMinLength: 12,
  evidenceMaxLength: 200,
  subtaskTitleMaxLength: 200,
  enrichmentTextMaxLength: 500,
  descriptionMaxLength: 5000,
  maxActions: 10,
  maxActionsPerTask: 3,
}

export interface AllowedTask {
  title: string
  description: string | null
  subtasks: unknown
}

export interface GuardInput {
  dump: string
  // Keyed by lowercase task id. Must be the same set of tasks the model was shown.
  allowedTasks: ReadonlyMap<string, AllowedTask>
  // Raw items from the parsed model response; each is validated individually.
  enrichments: readonly unknown[]
  subtaskAdditions: readonly unknown[]
  limits?: Partial<GuardLimits>
}

export interface GuardDecision {
  kind: ActionKind
  // Position within its own input array (enrichments / subtaskAdditions).
  index: number
  verdict: GuardVerdict
  reasons: GuardReason[]
  // Normalised (trimmed, task id lowercased) values; null when absent or unparseable.
  payload: { taskId: string | null; text: string | null; evidence: string | null }
}

const REJECT_REASONS: ReadonlySet<GuardReason> = new Set<GuardReason>([
  'malformed_item',
  'task_id_missing',
  'task_not_allowed',
  'text_empty',
  'duplicate_action',
  'duplicate_subtask',
])

const ENRICHMENT_SEPARATOR = '\n\nUpdate: '

// The description an enrichment produces. Shared with the apply step so the
// length the guard checks is the length that gets written.
export function formatEnrichedDescription(existing: string | null, context: string): string {
  return existing ? `${existing}${ENRICHMENT_SEPARATOR}${context}` : context
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g
const CURLY_SINGLE = /[\u2018\u2019\u201A\u201B\u2032]/g
const CURLY_DOUBLE = /[\u201C\u201D\u201E\u201F\u2033]/g
const DASHES = /[\u2010-\u2015\u2212]/g

// Canonical form used for evidence matching and duplicate detection. Zero-width
// characters are stripped before NFKC so that stripping can never expose a
// sequence NFKC would have composed (keeps the function idempotent).
export function normalizeForMatch(text: string): string {
  return text
    .replace(ZERO_WIDTH, '')
    .normalize('NFKC')
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function mergeLimits(overrides: Partial<GuardLimits> | undefined): GuardLimits {
  const merged: GuardLimits = { ...DEFAULT_GUARD_LIMITS }
  if (!overrides) return merged
  for (const key of Object.keys(DEFAULT_GUARD_LIMITS) as Array<keyof GuardLimits>) {
    const value = overrides[key]
    if (typeof value === 'number') merged[key] = value
  }
  return merged
}

function existingSubtaskTitles(task: AllowedTask): Set<string> {
  const titles = new Set<string>()
  if (!Array.isArray(task.subtasks)) return titles
  for (const s of task.subtasks) {
    const title = (s as { title?: unknown } | null)?.title
    if (typeof title === 'string') titles.add(normalizeForMatch(title))
  }
  return titles
}

function parseItem(
  kind: ActionKind,
  item: unknown
): { taskId?: string | null; text?: string | null; evidence?: string | null } | null {
  if (kind === 'enrichment') {
    const parsed = EnrichmentSchema.safeParse(item)
    if (!parsed.success) return null
    const { task_id, additional_context, evidence } = parsed.data
    return { taskId: task_id, text: additional_context, evidence }
  }
  const parsed = SubtaskAdditionSchema.safeParse(item)
  if (!parsed.success) return null
  const { task_id, subtask_title, evidence } = parsed.data
  return { taskId: task_id, text: subtask_title, evidence }
}

export function guardActions(input: GuardInput): GuardDecision[] {
  const limits = mergeLimits(input.limits)
  const normalizedDump = normalizeForMatch(input.dump)

  const decisions: GuardDecision[] = []
  // Structurally valid actions seen so far, for duplicate detection.
  const seenKeys = new Set<string>()
  // Non-rejected actions so far; proposals count because they are stored too.
  let admitted = 0
  const admittedPerTask = new Map<string, number>()
  // Description each task would have after the enrichments already marked "apply".
  const projectedDescriptions = new Map<string, string | null>()

  const entries: Array<{ kind: ActionKind; index: number; item: unknown }> = [
    ...input.enrichments.map((item, index) => ({ kind: 'enrichment' as const, index, item })),
    ...input.subtaskAdditions.map((item, index) => ({ kind: 'subtask_addition' as const, index, item })),
  ]

  for (const { kind, index, item } of entries) {
    const fields = parseItem(kind, item)
    if (!fields) {
      decisions.push({
        kind,
        index,
        verdict: 'reject',
        reasons: ['malformed_item'],
        payload: { taskId: null, text: null, evidence: null },
      })
      continue
    }

    const taskId = (fields.taskId ?? '').trim().toLowerCase()
    const text = (fields.text ?? '').trim()
    const evidence = (fields.evidence ?? '').trim()
    const payload = { taskId: taskId || null, text: text || null, evidence: evidence || null }
    const reasons: GuardReason[] = []

    // Stage 1 — structural checks. Any failure here is a reject.
    let task: AllowedTask | undefined
    if (!taskId) {
      reasons.push('task_id_missing')
    } else {
      task = input.allowedTasks.get(taskId)
      if (!task) reasons.push('task_not_allowed')
    }
    if (!text) reasons.push('text_empty')

    if (task && text) {
      const key = `${kind}|${taskId}|${normalizeForMatch(text)}`
      if (seenKeys.has(key)) {
        reasons.push('duplicate_action')
      } else if (kind === 'subtask_addition' && existingSubtaskTitles(task).has(normalizeForMatch(text))) {
        reasons.push('duplicate_subtask')
      } else {
        seenKeys.add(key)
      }
    }

    if (reasons.some(r => REJECT_REASONS.has(r)) || !task) {
      decisions.push({ kind, index, verdict: 'reject', reasons, payload })
      continue
    }

    // Stage 2 — trust checks. Failures downgrade to a proposal; all are collected.
    if (!evidence) {
      reasons.push('evidence_missing')
    } else {
      const normalizedEvidence = normalizeForMatch(evidence)
      if (normalizedEvidence.length < limits.evidenceMinLength) reasons.push('evidence_too_short')
      if (normalizedEvidence.length > limits.evidenceMaxLength) reasons.push('evidence_too_long')
      if (!normalizedDump.includes(normalizedEvidence)) reasons.push('evidence_not_in_dump')
    }

    const textMax = kind === 'enrichment' ? limits.enrichmentTextMaxLength : limits.subtaskTitleMaxLength
    if (text.length > textMax) reasons.push('text_too_long')

    let projected: string | null = null
    if (kind === 'enrichment') {
      const current = projectedDescriptions.has(taskId) ? projectedDescriptions.get(taskId)! : task.description
      projected = formatEnrichedDescription(current, text)
      if (projected.length > limits.descriptionMaxLength) reasons.push('description_too_long')
    }

    if (admitted >= limits.maxActions || (admittedPerTask.get(taskId) ?? 0) >= limits.maxActionsPerTask) {
      reasons.push('over_action_limit')
    }

    admitted++
    admittedPerTask.set(taskId, (admittedPerTask.get(taskId) ?? 0) + 1)

    const verdict: GuardVerdict = reasons.length === 0 ? 'apply' : 'propose'
    if (verdict === 'apply' && projected !== null) projectedDescriptions.set(taskId, projected)

    decisions.push({ kind, index, verdict, reasons, payload })
  }

  return decisions
}
