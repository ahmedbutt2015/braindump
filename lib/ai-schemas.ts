import { z } from 'zod'

// Schemas for the extract-tasks model response.
//
// NOTE: app/api/extract-tasks/route.ts still declares its own inline copies of
// these (without `evidence`). The route is switched over to this module in the
// session that wires in the guard; until then the two must not be confused.

export const nullableString = z.string().nullable().optional().transform(v =>
  (v === 'null' || v === 'undefined' || v === '' || v == null) ? null : v
)

export const TaskSchema = z.object({
  title: z.string(),
  description: nullableString,
  priority: z.enum(['low', 'medium', 'high']).catch('medium'),
  due_date: nullableString,
})

// Per-item schemas. Every action must carry a verbatim `evidence` quote from the
// dump; a missing quote is not a parse failure; the guard downgrades it to
// "proposed". These are applied one item at a time by guardActions().
export const EnrichmentSchema = z.object({
  task_id: z.string().nullable().optional(),
  additional_context: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
})

export const SubtaskAdditionSchema = z.object({
  task_id: z.string().nullable().optional(),
  subtask_title: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
})

// Envelope. `enrichments` and `subtask_additions` are deliberately left as
// unknown[]: one malformed item must not fail the whole parse (that would 500
// before the dump is saved). guardActions() validates each item individually
// against the schemas above and rejects the bad ones.
export const ExtractedTasksSchema = z.object({
  tasks: z.array(TaskSchema),
  enrichments: z.array(z.unknown()).optional().default([]),
  subtask_additions: z.array(z.unknown()).optional().default([]),
  summary: z.string(),
})

export type ExtractedTasks = z.infer<typeof ExtractedTasksSchema>
export type EnrichmentItem = z.infer<typeof EnrichmentSchema>
export type SubtaskAdditionItem = z.infer<typeof SubtaskAdditionSchema>
