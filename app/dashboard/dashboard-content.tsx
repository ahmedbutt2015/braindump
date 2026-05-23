'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { BrainDumpInput } from '@/components/brain-dump-input'
import { TaskList, Task } from '@/components/task-list'
import { BrainDump } from '@/components/recent-dumps'
import { BrainMascot } from '@/components/brain-mascot'
import { Logo } from '@/components/logo'

interface DashboardContentProps {
  initialTasks: Task[]
  initialDumps: BrainDump[]
  userEmail?: string
}

const supabase = createClient()

async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function fetchDumps(): Promise<BrainDump[]> {
  const { data, error } = await supabase
    .from('brain_dumps')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return data || []
}

export function DashboardContent({ initialTasks, initialDumps, userEmail }: DashboardContentProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggleDark = () => {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      try { localStorage.setItem('bd-theme', 'dark') } catch { /* ignore */ }
    } else {
      document.documentElement.classList.remove('dark')
      try { localStorage.setItem('bd-theme', 'light') } catch { /* ignore */ }
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const { data: tasks = initialTasks, isLoading: tasksLoading } = useSWR(
    'tasks', fetchTasks, { fallbackData: initialTasks }
  )
  const { data: dumps = initialDumps } = useSWR(
    'dumps', fetchDumps, { fallbackData: initialDumps }
  )

  const handleDumpSubmit = useCallback(async (content: string) => {
    setIsProcessing(true)
    try {
      const response = await fetch('/api/extract-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const result = await response.json()

      if (!response.ok) {
        if (result.modelLoading) {
          toast.warning('AI model is warming up', {
            description: `Try again in ~${result.retryAfter ?? 20} seconds. Hugging Face free tier needs a moment to start.`,
            duration: 8000,
          })
        } else {
          toast.error(result.error ?? 'Failed to process your thoughts.')
        }
        return
      }

      const enrichmentNote = result.enrichmentsApplied > 0
        ? ` · Enriched ${result.enrichmentsApplied} existing task${result.enrichmentsApplied !== 1 ? 's' : ''}`
        : ''
      toast.success(`Extracted ${result.tasksExtracted} task${result.tasksExtracted !== 1 ? 's' : ''}${enrichmentNote}`, {
        description: result.summary,
      })
      await Promise.all([mutate('tasks'), mutate('dumps')])
    } catch {
      toast.error('Failed to process your thoughts. Check your connection and try again.')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleStatusChange = useCallback(async (taskId: string, status: Task['status']) => {
    mutate('tasks', (current: Task[] | undefined) =>
      current?.map(t => t.id === taskId ? { ...t, status } : t), false)
    const { error } = await supabase
      .from('tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', taskId)
    if (error) mutate('tasks')
  }, [])

  const handleDelete = useCallback(async (taskId: string) => {
    mutate('tasks', (current: Task[] | undefined) =>
      current?.filter(t => t.id !== taskId), false)
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) mutate('tasks')
  }, [])

  const pendingCount   = tasks.filter(t => t.status === 'pending').length
  const inProgCount    = tasks.filter(t => t.status === 'in_progress').length
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const initials = userEmail ? userEmail.slice(0, 1).toUpperCase() : '?'
  const todayLabel = format(new Date(), "EEEE · MMM d").toUpperCase()

  return (
    <div style={{
      display: 'flex', height: '100dvh', overflow: 'hidden',
      background: 'var(--bg)', fontFamily: 'var(--body)', color: 'var(--ink)',
    }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 240, flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--bg-tint)',
        display: 'flex', flexDirection: 'column',
        padding: '18px 14px', gap: 18, overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{ padding: '0 6px' }}>
          <Logo size="sm" />
        </div>

        {/* Search (cosmetic) */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', borderRadius: 'var(--r-sm)',
          background: 'var(--surface)', border: '1px solid var(--line)',
        }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="t-small" style={{ flex: 1, color: 'var(--muted-foreground)' }}>Search dumps</span>
          <span className="t-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.5, fontSize: 10 }}>⌘K</span>
        </div>

        {/* Views nav */}
        <div>
          <div className="t-mono" style={{ color: 'var(--muted-foreground)', padding: '0 8px', marginBottom: 6 }}>VIEWS</div>
          {[
            { label: 'Today',  count: pendingCount,  active: true },
            { label: 'Tasks',  count: tasks.length,  active: false },
            { label: 'Dumps',  count: dumps.length,  active: false },
          ].map(({ label, count, active }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center',
              padding: '7px 10px', borderRadius: 'var(--r-sm)',
              background: active ? 'var(--surface)' : 'transparent',
              border: active ? '1px solid var(--line)' : '1px solid transparent',
              color: active ? 'var(--ink)' : 'var(--muted-foreground)',
              fontSize: 13, marginBottom: 2, fontWeight: active ? 500 : 400, cursor: 'pointer',
            }}>
              <span style={{ flex: 1 }}>{label}</span>
              <span className="t-mono" style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{count}</span>
            </div>
          ))}
        </div>

        {/* Recent dumps */}
        {dumps.length > 0 && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="t-mono" style={{ color: 'var(--muted-foreground)', padding: '0 8px', marginBottom: 6 }}>
              RECENT DUMPS
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {dumps.slice(0, 4).map(dump => (
                <div key={dump.id} style={{
                  display: 'flex', padding: '5px 10px', borderRadius: 'var(--r-sm)',
                  fontSize: 12, color: 'var(--muted-foreground)', gap: 7,
                }}>
                  <span style={{
                    width: 4, height: 4, borderRadius: 999,
                    background: 'var(--violet)', flexShrink: 0, marginTop: 7,
                  }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dump.content}
                  </span>
                  <span className="t-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.55, fontSize: 10, flexShrink: 0 }}>
                    {formatDistanceToNow(new Date(dump.created_at), { addSuffix: false })
                      .replace('about ', '')
                      .replace(' hours', 'h')
                      .replace(' hour', 'h')
                      .replace(' minutes', 'm')
                      .replace(' minute', 'm')
                      .replace('less than a minute', 'now')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User row */}
        <div style={{
          marginTop: 'auto',
          padding: 10, borderRadius: 'var(--r-md)',
          background: 'var(--surface)', border: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 999, flexShrink: 0,
            background: 'linear-gradient(135deg, var(--violet) 0%, var(--violet-deep) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 11, fontWeight: 600,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 12, fontWeight: 500, color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {userEmail ?? 'You'}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            title="Sign out"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted-foreground)', padding: 4, display: 'flex', alignItems: 'center',
              borderRadius: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M9 10l3-3-3-3M12 7H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Header bar */}
        <div style={{
          height: 54, padding: '0 28px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--line)',
          background: 'color-mix(in oklch, var(--bg) 80%, transparent)',
          backdropFilter: 'blur(8px)',
        }}>
          <div>
            <div className="t-eyebrow">{todayLabel}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>Today</div>
          </div>
          <button
            type="button"
            onClick={toggleDark}
            title={isDark ? 'Switch to light' : 'Switch to dark'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, borderRadius: 8,
              border: '1px solid var(--line)', background: 'var(--surface)',
              cursor: 'pointer', color: 'var(--muted-foreground)',
            }}
          >
            {isDark ? (
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="4" />
                <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
              </svg>
            )}
          </button>
        </div>

        {/* Scrollable grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>

            {/* ── Left column ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>

              {/* Daily brief card */}
              <div style={{
                padding: '18px 22px',
                borderRadius: 'var(--r-lg)',
                background: 'linear-gradient(135deg, color-mix(in oklch, var(--violet) 10%, var(--surface)) 0%, var(--surface) 65%)',
                border: '1px solid var(--line)',
                display: 'flex', gap: 20, alignItems: 'center',
              }}>
                <div style={{ flexShrink: 0 }}>
                  <BrainMascot
                    size={90}
                    state={isProcessing ? 'thinking' : tasks.length === 0 ? 'idle' : 'happy'}
                    showHalo={false}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-eyebrow" style={{ marginBottom: 6 }}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'long' })} · daily brief
                  </div>
                  <div style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--ink)' }}>
                    {isProcessing ? (
                      'Thinking… extracting tasks from your dump.'
                    ) : tasks.length === 0 ? (
                      <>No tasks yet. Dump your thoughts below — I&apos;ll sort them out.</>
                    ) : (
                      <>
                        {pendingCount} task{pendingCount !== 1 ? 's' : ''} open
                        {inProgCount > 0 ? `, ${inProgCount} in progress` : ''}.
                        {dumps.length > 0 ? ` ${dumps.length} thought${dumps.length !== 1 ? 's' : ''} remembered.` : ''}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Brain dump input */}
              <BrainDumpInput onSubmit={handleDumpSubmit} isProcessing={isProcessing} />

              {/* Stats strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { n: pendingCount,   l: 'open',      c: 'var(--violet)' },
                  { n: inProgCount,    l: 'in progress' },
                  { n: completedCount, l: 'completed',  c: 'var(--done)' },
                  { n: dumps.length,   l: 'dumps' },
                ].map(({ n, l, c }, i) => (
                  <div key={i} style={{
                    padding: 14, borderRadius: 'var(--r-md)',
                    background: 'var(--surface)', border: '1px solid var(--line)',
                  }}>
                    <div style={{
                      fontSize: 26, fontWeight: 600,
                      color: c || 'var(--ink)', letterSpacing: '-0.02em',
                    }}>
                      {n}
                    </div>
                    <div className="t-small" style={{ marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Task list */}
              <div>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  marginBottom: 14,
                }}>
                  <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>Tasks</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span className="chip" style={{
                      background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)',
                    }}>
                      All · {tasks.length}
                    </span>
                    <span className="chip">To do · {pendingCount}</span>
                    <span className="chip">Doing · {inProgCount}</span>
                  </div>
                </div>
                <TaskList
                  tasks={tasks}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  isLoading={tasksLoading}
                />
              </div>
            </div>

            {/* ── Right panel ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Latest dump */}
              {dumps.length > 0 ? (
                <div style={{
                  padding: 16, borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  boxShadow: 'var(--shadow-1)',
                }}>
                  <div className="t-eyebrow" style={{ marginBottom: 4 }}>Latest dump</div>
                  <div className="t-mono" style={{ color: 'var(--muted-foreground)', fontSize: 10, marginBottom: 10 }}>
                    {formatDistanceToNow(new Date(dumps[0].created_at), { addSuffix: true }).toUpperCase()}
                  </div>
                  <div style={{
                    fontSize: 13.5, lineHeight: 1.6, color: 'var(--muted-foreground)',
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {dumps[0].content}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: 20, borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  textAlign: 'center',
                }}>
                  <div className="t-eyebrow" style={{ marginBottom: 8 }}>No dumps yet</div>
                  <div style={{ fontSize: 13.5, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                    Dump your first thought above — text or voice.
                  </div>
                </div>
              )}

              {/* Memory card */}
              <div style={{
                padding: 16, borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)', border: '1px solid var(--line)',
              }}>
                <div className="t-eyebrow" style={{ marginBottom: 8 }}>Memory</div>
                <div style={{ fontSize: 13.5, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
                  {dumps.length === 0 ? (
                    'No thoughts stored yet. Your brain starts empty.'
                  ) : (
                    <>
                      Your brain has held onto{' '}
                      <strong style={{ color: 'var(--ink)' }}>
                        {dumps.length} dump{dumps.length !== 1 ? 's' : ''}
                      </strong>.
                      {tasks.length > 0 && tasks[tasks.length - 1] && (
                        <>
                          {' '}Earliest open task:{' '}
                          <em>&ldquo;{tasks[tasks.length - 1].title}&rdquo;</em>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Linked context placeholder */}
              {tasks.length > 0 && (
                <div style={{
                  padding: 16, borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  boxShadow: 'var(--shadow-1)',
                }}>
                  <div className="t-eyebrow" style={{ marginBottom: 10 }}>Linked context</div>
                  <div style={{ fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.55 }}>
                    When a new dump mentions something already in your tasks, the AI enriches the existing task instead of creating a duplicate.
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--violet)', display: 'inline-block' }} />
                    <span className="t-mono" style={{ color: 'var(--violet)' }}>
                      {completedCount} enriched this session
                    </span>
                  </div>
                </div>
              )}

              {/* Account links */}
              <div style={{
                padding: 14, borderRadius: 'var(--r-md)',
                background: 'var(--surface)', border: '1px solid var(--line)',
              }}>
                <div className="t-eyebrow" style={{ marginBottom: 10 }}>Account</div>
                <a href="/auth/forgot-password" style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none', padding: '3px 0',
                }}>
                  <span style={{ color: 'var(--violet)' }}>→</span> Change password
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
