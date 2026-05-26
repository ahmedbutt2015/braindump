'use client'

import { format, isPast, isToday, isTomorrow } from 'date-fns'

export interface Subtask {
  id: string
  title: string
  completed: boolean
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'pending' | 'in_progress' | 'completed'
  due_date: string | null
  created_at: string
  brain_dump_id: string | null
  // Extended fields (optional until migration is run)
  subtasks?: Subtask[]
  notes?: string | null
  schedule_type?: 'none' | 'once' | 'daily' | 'weekly'
  scheduled_date?: string | null
  tags?: string[]
}

interface TaskListProps {
  tasks: Task[]
  onStatusChange: (taskId: string, status: Task['status']) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onOpen?: (task: Task) => void
  isLoading?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

const priorityMeta = {
  high: { color: 'var(--high)', label: 'high' },
  medium: { color: 'var(--med)', label: 'med' },
  low: { color: 'var(--low)', label: 'low' },
} as const

const nextStatus: Record<Task['status'], Task['status']> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
}

export function TaskList({ tasks, onStatusChange, onDelete, onOpen, isLoading, selectedIds, onToggleSelect }: TaskListProps) {
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[72, 55, 80, 63].map((w, i) => (
          <div key={i} className="card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="animate-pulse" style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--surface-2)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="animate-pulse" style={{ height: 13, borderRadius: 4, background: 'var(--surface-2)', width: `${w}%` }} />
              <div className="animate-pulse" style={{ height: 11, borderRadius: 4, background: 'var(--surface-2)', width: '38%', marginTop: 7 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <div className="animate-pulse" style={{ width: 36, height: 20, borderRadius: 999, background: 'var(--surface-2)' }} />
              <div className="animate-pulse" style={{ width: 28, height: 28, borderRadius: 10, background: 'var(--surface-2)' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <div style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          margin: '0 auto 14px',
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--violet)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
          </svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>No tasks yet</div>
        <div className="t-small" style={{ marginTop: 4 }}>Dump your thoughts above to extract tasks.</div>
      </div>
    )
  }

  const orderedTasks = [...tasks].sort((a, b) => {
    const rank = { pending: 0, in_progress: 1, completed: 2 }
    return rank[a.status] - rank[b.status]
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {orderedTasks.map(task => (
        <TaskRow
          key={task.id}
          task={task}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
          onOpen={onOpen}
          isSelected={selectedIds?.has(task.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}

function TaskRow({
  task,
  onStatusChange,
  onDelete,
  onOpen,
  isSelected,
  onToggleSelect,
}: {
  task: Task
  onStatusChange: (taskId: string, status: Task['status']) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onOpen?: (task: Task) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const done = task.status === 'completed'
  const inProgress = task.status === 'in_progress'
  const priority = priorityMeta[task.priority]
  const dueLabel = getDueLabel(task.due_date)
  const links = getLinkedDumpCount(task)
  const subLine = getSubLine(task)
  const enriched = Boolean(task.description)

  return (
    <div
      className="card"
      style={{
        padding: 12,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        opacity: done && !onToggleSelect ? 0.65 : 1,
        background: isSelected ? 'color-mix(in oklch, var(--violet) 8%, var(--surface))' : undefined,
        borderColor: isSelected ? 'color-mix(in oklch, var(--violet) 28%, var(--line))' : undefined,
      }}
    >
      {onToggleSelect ? (
        <button
          type="button"
          onClick={() => onToggleSelect(task.id)}
          aria-label={isSelected ? 'Deselect task' : 'Select task'}
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            border: isSelected ? 'none' : '1.5px solid var(--line-strong)',
            background: isSelected ? 'var(--violet)' : 'transparent',
            marginTop: 2,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {isSelected && (
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path d="M2.5 6.5 5 9l4.5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onStatusChange(task.id, nextStatus[task.status])}
          aria-label={`Mark as ${nextStatus[task.status].replace('_', ' ')}`}
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            border: done ? 'none' : '1.5px solid var(--line-strong)',
            background: done ? 'var(--done)' : 'transparent',
            marginTop: 2,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {done ? (
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path d="M2.5 6.5 5 9l4.5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          ) : inProgress ? (
            <div style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--violet)' }} />
          ) : null}
        </button>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--ink)',
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {task.title}
          </span>
          {links > 0 && (
            <span
              className="chip"
              style={{
                background: 'color-mix(in oklch, var(--violet) 14%, transparent)',
                borderColor: 'transparent',
                color: 'var(--violet)',
              }}
            >
              ↗ {links > 1 ? `${links} notes` : 'from note'}
            </span>
          )}
        </div>

        <div className="t-small" style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {enriched && <span style={{ color: 'var(--violet)' }}>↳</span>}
          <span style={{ color: enriched ? 'var(--violet)' : 'var(--copy-muted)' }}>{subLine}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
        {dueLabel && (
          <span
            className="chip"
            style={{
              background: dueLabel.tone === 'urgent'
                ? 'color-mix(in oklch, var(--high) 14%, transparent)'
                : 'var(--surface-2)',
              borderColor: dueLabel.tone === 'urgent'
                ? 'color-mix(in oklch, var(--high) 30%, var(--line))'
                : 'var(--line)',
              color: dueLabel.tone === 'urgent' ? 'var(--high)' : 'var(--ink-2)',
            }}
          >
            due {dueLabel.label}
          </span>
        )}
        <span className="chip dot" style={{ color: priority.color }}>
          {priority.label}
        </span>
        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(task)}
            aria-label="Open task detail"
            title="Open detail"
            style={{
              width: 28, height: 28,
              borderRadius: 10,
              border: '1px solid transparent',
              background: 'transparent',
              color: 'var(--copy-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3h6v6M11 3 4 10" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label="Delete task"
          style={{
            width: 28,
            height: 28,
            borderRadius: 10,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--copy-muted)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4 4 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function getLinkedDumpCount(task: Task) {
  if (!task.brain_dump_id) return 0
  const enrichmentCount = task.description?.match(/^Update:/gm)?.length ?? 0
  return 1 + enrichmentCount
}

function getSubLine(task: Task) {
  if (task.description?.trim()) return task.description.trim().split('\n')[0]
  if (task.status === 'in_progress') return 'from a recent dump · in progress'
  if (task.brain_dump_id) return 'from a recent voice dump'
  return `captured ${format(new Date(task.created_at), 'MMM d')}`
}

function getDueLabel(dueDate: string | null) {
  if (!dueDate) return null
  const date = new Date(dueDate)
  if (Number.isNaN(date.getTime())) return null

  if (isToday(date)) return { label: 'today', tone: 'urgent' as const }
  if (isTomorrow(date)) return { label: 'tom', tone: 'normal' as const }
  if (isPast(date)) return { label: format(date, 'EEE').toLowerCase(), tone: 'urgent' as const }
  return { label: format(date, 'EEE').toLowerCase(), tone: 'normal' as const }
}
