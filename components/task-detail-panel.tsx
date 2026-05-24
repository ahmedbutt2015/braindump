'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { mutate } from 'swr'
import type { Task, Subtask } from '@/components/task-list'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

interface SourceDump {
  id: string
  content: string
  created_at: string
}

interface TaskDetailPanelProps {
  task: Task | null
  onClose: () => void
  onDelete: (taskId: string) => Promise<void>
}

const PRIORITY_CONFIG = {
  low: { color: 'var(--low)', label: 'Low' },
  medium: { color: 'var(--med)', label: 'Medium' },
  high: { color: 'var(--high)', label: 'High' },
} as const

const STATUS_CONFIG = {
  pending: { label: 'Pending' },
  in_progress: { label: 'In progress' },
  completed: { label: 'Completed' },
} as const

export function TaskDetailPanel({ task, onClose, onDelete }: TaskDetailPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [status, setStatus] = useState<Task['status']>('pending')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [scheduleType, setScheduleType] = useState<'none' | 'once' | 'daily' | 'weekly'>('none')
  const [scheduledDate, setScheduledDate] = useState('')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtaskText, setNewSubtaskText] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [sourceDump, setSourceDump] = useState<SourceDump | null>(null)
  const [dumpExpanded, setDumpExpanded] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setPriority(task.priority)
    setStatus(task.status)
    setDueDate(task.due_date ? task.due_date.split('T')[0] : '')
    setNotes(task.notes ?? '')
    setScheduleType(task.schedule_type ?? 'none')
    setScheduledDate(task.scheduled_date ?? '')
    setSubtasks(Array.isArray(task.subtasks) ? task.subtasks : [])
    setSaveStatus('idle')
    setSourceDump(null)
    setDumpExpanded(false)

    if (task.brain_dump_id) {
      supabase
        .from('brain_dumps')
        .select('id, content, created_at')
        .eq('id', task.brain_dump_id)
        .single()
        .then(({ data }) => { if (data) setSourceDump(data) })
    }
  }, [task?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [])

  const persist = useCallback(async (changes: Record<string, unknown>) => {
    if (!task) return
    setSaveStatus('saving')
    const { error } = await supabase
      .from('tasks')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', task.id)
    if (!error) {
      await mutate('tasks')
      setSaveStatus('saved')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 1800)
    } else {
      setSaveStatus('idle')
    }
  }, [task])

  const handleAddSubtask = async () => {
    const text = newSubtaskText.trim()
    if (!text) return
    const newSub: Subtask = {
      id: crypto.randomUUID(),
      title: text,
      completed: false,
      created_at: new Date().toISOString(),
    }
    const updated = [...subtasks, newSub]
    setSubtasks(updated)
    setNewSubtaskText('')
    await persist({ subtasks: updated })
  }

  const handleToggleSubtask = async (id: string) => {
    const updated = subtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s)
    setSubtasks(updated)
    await persist({ subtasks: updated })
  }

  const handleDeleteSubtask = async (id: string) => {
    const updated = subtasks.filter(s => s.id !== id)
    setSubtasks(updated)
    await persist({ subtasks: updated })
  }

  if (!task) return null

  const completedSubtasks = subtasks.filter(s => s.completed).length

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 79, background: 'rgba(0,0,0,0.18)' }}
      />
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: '100%',
        maxWidth: 460,
        zIndex: 80,
        background: 'var(--bg)',
        borderLeft: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-24px 0 64px rgba(0,0,0,0.1)',
        animation: 'slide-in-right 0.22s ease-out',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <div className="t-eyebrow" style={{ flex: 1 }}>Task detail</div>
          <div className="t-mono" style={{
            fontSize: 9,
            color: saveStatus === 'saved' ? 'var(--done)' : 'var(--copy-muted)',
            minWidth: 36,
            textAlign: 'right',
          }}>
            {saveStatus === 'saving' ? 'SAVING…' : saveStatus === 'saved' ? 'SAVED ✓' : ''}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              width: 28, height: 28,
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-2)', cursor: 'pointer',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 12px' }}>

          {/* Title */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => { if (title.trim()) void persist({ title: title.trim() }) }}
            placeholder="Task title"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--line)',
              outline: 'none',
              fontFamily: 'var(--body)',
              lineHeight: 1.3,
              padding: '2px 0 10px',
              marginBottom: 18,
            }}
          />

          {/* Priority */}
          <PanelSection label="Priority">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPriority(p); void persist({ priority: p }) }}
                  className="chip dot"
                  style={{
                    color: PRIORITY_CONFIG[p].color,
                    background: priority === p ? 'color-mix(in oklch, currentColor 12%, var(--surface))' : 'transparent',
                    borderColor: priority === p ? 'currentColor' : 'var(--line)',
                    cursor: 'pointer',
                    fontWeight: priority === p ? 700 : 400,
                    opacity: priority === p ? 1 : 0.6,
                  }}
                >
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
          </PanelSection>

          {/* Status */}
          <PanelSection label="Status">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['pending', 'in_progress', 'completed'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatus(s); void persist({ status: s }) }}
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    background: status === s ? 'var(--surface-2)' : 'transparent',
                    borderColor: status === s ? 'var(--line-strong)' : 'var(--line)',
                    color: status === s ? 'var(--ink)' : 'var(--ink-2)',
                    fontWeight: status === s ? 600 : 400,
                  }}
                >
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </PanelSection>

          {/* Due date */}
          <PanelSection label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              onBlur={() => void persist({ due_date: dueDate || null })}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: 12.5,
                fontFamily: 'var(--mono)',
                outline: 'none',
              }}
            />
          </PanelSection>

          {/* Schedule */}
          <PanelSection label="Schedule">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['none', 'once', 'daily', 'weekly'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setScheduleType(type); void persist({ schedule_type: type }) }}
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    background: scheduleType === type ? 'var(--surface-2)' : 'transparent',
                    borderColor: scheduleType === type ? 'var(--line-strong)' : 'var(--line)',
                    color: scheduleType === type ? 'var(--ink)' : 'var(--ink-2)',
                    fontWeight: scheduleType === type ? 600 : 400,
                    textTransform: 'capitalize',
                  }}
                >
                  {type === 'none' ? 'No schedule' : type}
                </button>
              ))}
            </div>
            {(scheduleType === 'once' || scheduleType === 'weekly') && (
              <input
                type="date"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                onBlur={() => void persist({ scheduled_date: scheduledDate || null })}
                style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 12.5,
                  fontFamily: 'var(--mono)',
                  outline: 'none',
                }}
              />
            )}
          </PanelSection>

          {/* Description */}
          <PanelSection label="Description">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => void persist({ description: description || null })}
              placeholder="Add description or context…"
              rows={3}
              style={textareaStyle}
            />
          </PanelSection>

          {/* Subtasks */}
          <PanelSection label={`Subtasks${subtasks.length > 0 ? ` · ${completedSubtasks}/${subtasks.length} done` : ''}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {subtasks.map(sub => (
                <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void handleToggleSubtask(sub.id)}
                    style={{
                      width: 16, height: 16,
                      borderRadius: 4,
                      border: sub.completed ? 'none' : '1.5px solid var(--line-strong)',
                      background: sub.completed ? 'var(--done)' : 'transparent',
                      flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    {sub.completed && (
                      <svg width="9" height="9" viewBox="0 0 12 12">
                        <path d="M2.5 6.5 5 9l4.5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                  <span style={{
                    flex: 1, fontSize: 13.5, color: 'var(--ink)',
                    textDecoration: sub.completed ? 'line-through' : 'none',
                    opacity: sub.completed ? 0.55 : 1,
                  }}>
                    {sub.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSubtask(sub.id)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--copy-muted)', cursor: 'pointer',
                      fontSize: 16, lineHeight: 1, padding: '0 2px',
                    }}
                    title="Remove subtask"
                  >
                    ×
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: subtasks.length > 0 ? 6 : 0 }}>
                <input
                  value={newSubtaskText}
                  onChange={e => setNewSubtaskText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddSubtask() } }}
                  placeholder="Add a subtask…"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--line)',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: 13,
                    fontFamily: 'var(--body)',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void handleAddSubtask()}
                  disabled={!newSubtaskText.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          </PanelSection>

          {/* Notes */}
          <PanelSection label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => void persist({ notes: notes || null })}
              placeholder="Extended notes, links, context…"
              rows={4}
              style={textareaStyle}
            />
          </PanelSection>

          {/* Source dump */}
          {sourceDump && (
            <PanelSection label="Source note">
              <button
                type="button"
                onClick={() => setDumpExpanded(e => !e)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--line)',
                  background: dumpExpanded
                    ? 'color-mix(in oklch, var(--violet) 6%, var(--surface))'
                    : 'var(--surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="t-mono" style={{ color: 'var(--violet)', fontSize: 9 }}>
                    {formatDistanceToNow(new Date(sourceDump.created_at), { addSuffix: true }).toUpperCase()}
                  </span>
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none"
                    stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"
                    style={{ color: 'var(--ink-2)', flexShrink: 0, transform: dumpExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                  >
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                </div>
                <div style={{
                  fontSize: 12.5,
                  color: 'var(--ink)',
                  lineHeight: 1.55,
                  whiteSpace: dumpExpanded ? 'pre-wrap' : 'nowrap',
                  overflow: 'hidden',
                  textOverflow: dumpExpanded ? 'unset' : 'ellipsis',
                  wordBreak: 'break-word',
                }}>
                  {sourceDump.content}
                </div>
              </button>
            </PanelSection>
          )}

          {/* Meta */}
          <div style={{ paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
            <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10, lineHeight: 1.9 }}>
              <div>Created {format(new Date(task.created_at), 'EEE, MMM d · h:mm a')}</div>
              {task.tags && task.tags.length > 0 && <div>Tags: {task.tags.join(', ')}</div>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--line)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <button
            type="button"
            className="btn sm ghost"
            style={{ color: 'var(--high)', borderColor: 'color-mix(in oklch, var(--high) 25%, var(--line))' }}
            onClick={() => { void onDelete(task.id).then(onClose) }}
          >
            Delete
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  )
}

function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="t-mono" style={{ fontSize: 9, color: 'var(--copy-muted)', marginBottom: 7, letterSpacing: '0.06em' }}>
        {label.toUpperCase()}
      </div>
      {children}
    </div>
  )
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 13.5,
  lineHeight: 1.6,
  resize: 'vertical',
  minHeight: 80,
  fontFamily: 'var(--body)',
  outline: 'none',
}
