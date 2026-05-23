'use client'

import { format, isPast, isToday, isTomorrow } from 'date-fns'

export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high'
  status: 'pending' | 'in_progress' | 'completed'
  due_date: string | null
  created_at: string
  brain_dump_id: string | null
}

interface TaskListProps {
  tasks: Task[]
  onStatusChange: (taskId: string, status: Task['status']) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  isLoading?: boolean
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

export function TaskList({ tasks, onStatusChange, onDelete, isLoading }: TaskListProps) {
  if (isLoading) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 0' }}>
          <svg className="animate-spin" width="22" height="22" fill="none" viewBox="0 0 24 24" style={{ color: 'var(--violet)' }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path fill="currentColor" opacity="0.75" d="M4 12a8 8 0 0 1 8-8V0C5.37 0 0 5.37 0 12h4Z" />
          </svg>
        </div>
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
        />
      ))}
    </div>
  )
}

function TaskRow({
  task,
  onStatusChange,
  onDelete,
}: {
  task: Task
  onStatusChange: (taskId: string, status: Task['status']) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
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
        opacity: done ? 0.65 : 1,
      }}
    >
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
              ↗ {links} dump{links === 1 ? '' : 's'}
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
  if (!task.description) return 0
  const updateCount = task.description.match(/update:/gi)?.length ?? 0
  const paragraphCount = task.description.split('\n').filter(Boolean).length
  return Math.max(1, Math.min(4, 1 + updateCount + Math.max(0, paragraphCount - 1)))
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
