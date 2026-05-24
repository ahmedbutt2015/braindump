'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { CaptureZone, type CaptureSubmitResult } from '@/components/capture-zone'
import { TaskList, type Task } from '@/components/task-list'
import type { BrainDump } from '@/components/recent-dumps'
import { Logo } from '@/components/logo'
import { useIsMobile } from '@/hooks/use-mobile'

interface DashboardContentProps {
  initialTasks: Task[]
  initialDumps: BrainDump[]
  userEmail?: string
}

interface ExtractTasksApiResponse {
  error?: string
  modelLoading?: boolean
  retryAfter?: number
  summary?: string
  tasksExtracted?: number
  enrichmentsApplied?: number
  extractedTasks?: CaptureSubmitResult['extractedTasks']
  transcript?: string
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
  if (error) throw error
  return data || []
}

export function DashboardContent({ initialTasks, initialDumps, userEmail }: DashboardContentProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [tutorialDismissed, setTutorialDismissed] = useState(false)
  const router = useRouter()
  const isMobile = useIsMobile()
  const captureSectionRef = useRef<HTMLDivElement | null>(null)
  const taskSectionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
    try {
      setTutorialDismissed(localStorage.getItem('bd-tutorial-dismissed') === '1')
    } catch {
      // ignore storage failures
    }
  }, [])

  const handleDismissTutorial = () => {
    setTutorialDismissed(true)
    try { localStorage.setItem('bd-tutorial-dismissed', '1') } catch { /* ignore */ }
  }

  const toggleDark = () => {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      try {
        localStorage.setItem('bd-theme', 'dark')
      } catch {
        // ignore storage failures
      }
    } else {
      document.documentElement.classList.remove('dark')
      try {
        localStorage.setItem('bd-theme', 'light')
      } catch {
        // ignore storage failures
      }
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const { data: tasks = initialTasks, isLoading: tasksLoading } = useSWR(
    'tasks',
    fetchTasks,
    { fallbackData: initialTasks },
  )
  const { data: dumps = initialDumps } = useSWR(
    'dumps',
    fetchDumps,
    { fallbackData: initialDumps },
  )

  const handleDumpSubmit = useCallback(async (content: string): Promise<CaptureSubmitResult | null> => {
    setIsProcessing(true)
    try {
      const response = await fetch('/api/extract-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const result: ExtractTasksApiResponse = await response.json()

      if (!response.ok) {
        if (result.modelLoading) {
          toast.warning('AI model is warming up', {
            description: `Try again in ~${result.retryAfter ?? 20} seconds. Hugging Face free tier needs a moment to start.`,
            duration: 8000,
          })
        } else {
          toast.error(result.error ?? 'Failed to process your thoughts.')
        }
        return null
      }

      const enrichmentNote = result.enrichmentsApplied && result.enrichmentsApplied > 0
        ? ` · Enriched ${result.enrichmentsApplied} existing task${result.enrichmentsApplied !== 1 ? 's' : ''}`
        : ''
      toast.success(`Extracted ${result.tasksExtracted ?? 0} task${(result.tasksExtracted ?? 0) !== 1 ? 's' : ''}${enrichmentNote}`, {
        description: result.summary,
      })

      await Promise.all([mutate('tasks'), mutate('dumps')])

      return {
        transcript: result.transcript ?? content,
        summary: result.summary ?? 'Captured your dump.',
        tasksExtracted: result.tasksExtracted ?? 0,
        enrichmentsApplied: result.enrichmentsApplied ?? 0,
        extractedTasks: result.extractedTasks ?? [],
      }
    } catch {
      toast.error('Failed to process your thoughts. Check your connection and try again.')
      return null
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleStatusChange = useCallback(async (taskId: string, status: Task['status']) => {
    mutate(
      'tasks',
      (current: Task[] | undefined) => current?.map(task => task.id === taskId ? { ...task, status } : task),
      false,
    )
    const { error } = await supabase
      .from('tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', taskId)
    if (error) mutate('tasks')
  }, [])

  const handleDelete = useCallback(async (taskId: string) => {
    mutate(
      'tasks',
      (current: Task[] | undefined) => current?.filter(task => task.id !== taskId),
      false,
    )
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) mutate('tasks')
  }, [])

  const pendingTasks = tasks.filter(task => task.status === 'pending')
  const inProgressTasks = tasks.filter(task => task.status === 'in_progress')
  const completedTasks = tasks.filter(task => task.status === 'completed')
  const latestDump = dumps[0]
  const initials = userEmail ? userEmail.slice(0, 1).toUpperCase() : '?'
  const userLabel = formatUserLabel(userEmail)
  const todayLabel = format(new Date(), 'EEEE, MMM d')

  return (
    <div style={{
      display: 'flex',
      minHeight: '100dvh',
      background: 'radial-gradient(circle at top left, color-mix(in oklch, var(--violet) 10%, transparent) 0%, transparent 30%), var(--bg)',
      color: 'var(--ink)',
      fontFamily: 'var(--body)',
    }}>
      {!isMobile && (
        <DashboardSidebar
          pendingCount={pendingTasks.length}
          tasksCount={tasks.length}
          dumps={dumps}
          initials={initials}
          userEmail={userEmail}
          isDark={isDark}
          onToggleDark={toggleDark}
          onSignOut={handleSignOut}
        />
      )}

      <main style={{ flex: 1, minWidth: 0 }}>
        <div style={{ maxWidth: 1380, margin: '0 auto', padding: isMobile ? '18px 16px 32px' : '28px 28px 40px' }}>
          <DashboardTopbar
            isMobile={isMobile}
            todayLabel={todayLabel}
            userLabel={userLabel}
            initials={initials}
            isDark={isDark}
            onToggleDark={toggleDark}
          />

          {!tutorialDismissed && (
            <TutorialCard
              onStartVoice={() => captureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              onOpenTasks={() => taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              onDismiss={handleDismissTutorial}
            />
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.2fr) 320px',
            gap: isMobile ? 18 : 24,
            alignItems: 'start',
            marginTop: 22,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
              <section ref={captureSectionRef}>
                <SectionHeading
                  eyebrow="Taking notes"
                  title="One place to talk, type, and let the app sort the rest."
                  body="Start with voice when you want speed. Type when you want precision. Either way, tasks show up below without clutter."
                />
                <div style={{ marginTop: 14 }}>
                  <CaptureZone
                    onSubmit={handleDumpSubmit}
                    isProcessing={isProcessing}
                    userLabel={userLabel}
                    userInitial={initials}
                    todayLabel={todayLabel}
                    dailyBrief={buildCaptureHint(tasks, dumps)}
                  />
                </div>
              </section>

              <section ref={taskSectionRef}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                  <SectionHeading
                    eyebrow="Tasks"
                    title="Open today"
                    body="A clean list of what came out of your dumps."
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="chip" style={{ background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)' }}>
                      All · {tasks.length}
                    </span>
                    <span className="chip">Open · {pendingTasks.length}</span>
                    <span className="chip">In progress · {inProgressTasks.length}</span>
                    <span className="chip">Done · {completedTasks.length}</span>
                  </div>
                </div>

                <TaskList
                  tasks={tasks}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  isLoading={tasksLoading}
                />
              </section>
            </div>

            <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <OverviewCard
                pendingCount={pendingTasks.length}
                inProgressCount={inProgressTasks.length}
                completedCount={completedTasks.length}
                dumpsCount={dumps.length}
              />
              <FocusCard
                title="Open today"
                emptyText="No open tasks yet. Your next voice note will land here."
                tasks={pendingTasks}
              />
              <FocusCard
                title="In progress"
                emptyText="Nothing in motion yet."
                tasks={inProgressTasks}
              />
              <RecentNotesCard dumps={dumps} latestDump={latestDump} />
              {isMobile && (
                <MobileAccountCard
                  isDark={isDark}
                  onToggleDark={toggleDark}
                  onSignOut={handleSignOut}
                />
              )}
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}

function DashboardSidebar({
  pendingCount,
  tasksCount,
  dumps,
  initials,
  userEmail,
  isDark,
  onToggleDark,
  onSignOut,
}: {
  pendingCount: number
  tasksCount: number
  dumps: BrainDump[]
  initials: string
  userEmail?: string
  isDark: boolean
  onToggleDark: () => void
  onSignOut: () => Promise<void>
}) {
  return (
    <aside style={{
      width: 252,
      flexShrink: 0,
      borderRight: '1px solid var(--line)',
      background: 'color-mix(in oklch, var(--surface) 82%, var(--bg))',
      padding: '22px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
    }}>
      <div style={{ padding: '0 6px' }}>
        <Logo size="sm" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <SidebarNavItem label="Taking notes" count={1} active />
        <SidebarNavItem label="Tasks" count={tasksCount} />
        <SidebarNavItem label="Inbox" count={pendingCount} />
        <SidebarNavItem label="Recent notes" count={dumps.length} />
      </div>

      <div className="card" style={{ padding: 14, background: 'linear-gradient(180deg, color-mix(in oklch, var(--violet) 12%, var(--surface)) 0%, var(--surface) 100%)' }}>
        <div className="t-eyebrow">Quick flow</div>
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
          Tap the voice circle, speak naturally, then stop to extract tasks.
        </div>
      </div>

      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11, padding: '0 6px' }}>RECENT NOTES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
          {dumps.slice(0, 5).map(dump => (
            <div key={dump.id} className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.45 }}>
                {shorten(dump.content, 76)}
              </div>
              <div className="t-mono" style={{ marginTop: 6, color: 'var(--copy-muted)', fontSize: 10 }}>
                {formatDistanceToNow(new Date(dump.created_at), { addSuffix: true }).toUpperCase()}
              </div>
            </div>
          ))}
          {dumps.length === 0 && (
            <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Your recent notes will show up here after the first capture.
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="avatar">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userEmail ?? 'You'}
          </div>
          <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10 }}>workspace</div>
        </div>
        <ThemeToggleButton isDark={isDark} onToggle={onToggleDark} />
        <button
          type="button"
          onClick={() => void onSignOut()}
          title="Sign out"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>
  )
}

function SidebarNavItem({
  label,
  count,
  active = false,
}: {
  label: string
  count: number
  active?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--r-md)',
        border: active ? '1px solid var(--line)' : '1px solid transparent',
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
      }}
    >
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: active ? 600 : 500 }}>{label}</span>
      <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11 }}>{count}</span>
    </div>
  )
}

function DashboardTopbar({
  isMobile,
  todayLabel,
  userLabel,
  initials,
  isDark,
  onToggleDark,
}: {
  isMobile: boolean
  todayLabel: string
  userLabel: string
  initials: string
  isDark: boolean
  onToggleDark: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <div>
        <div className="t-eyebrow">{todayLabel}</div>
        <div style={{ fontSize: isMobile ? 24 : 30, lineHeight: 1.05, fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>
          Taking notes
        </div>
        <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-2)', maxWidth: 580, lineHeight: 1.5 }}>
          Hi {userLabel}. Capture a thought quickly and turn it into something you can act on.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingTop: 4 }}>
        <ThemeToggleButton isDark={isDark} onToggle={onToggleDark} />
        {isMobile && <div className="avatar">{initials}</div>}
      </div>
    </div>
  )
}

function ThemeToggleButton({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-2)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

function TutorialCard({
  onStartVoice,
  onOpenTasks,
  onDismiss,
}: {
  onStartVoice: () => void
  onOpenTasks: () => void
  onDismiss: () => void
}) {
  const steps = [
    { number: '01', title: 'Start voice', text: 'Tap the large voice button and speak naturally.' },
    { number: '02', title: 'Stop to extract', text: 'When you stop, the app turns your note into tasks.' },
    { number: '03', title: 'Manage the result', text: 'Review open today, move items to in progress, or complete them.' },
  ]

  return (
    <section className="card" style={{
      padding: '16px 18px 18px',
      background: 'linear-gradient(135deg, color-mix(in oklch, var(--violet) 10%, var(--surface)) 0%, color-mix(in oklch, var(--cyan) 6%, var(--surface)) 100%)',
      borderColor: 'color-mix(in oklch, var(--violet) 22%, var(--line))',
      position: 'relative',
    }}>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 28,
          height: 28,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-2)',
          cursor: 'pointer',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M1 1l10 10M11 1L1 11" />
        </svg>
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', paddingRight: 36 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="t-eyebrow">Getting started</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>
            New here? Start with one quick voice note.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <button type="button" className="btn primary" onClick={onStartVoice}>Start voice</button>
          <button type="button" className="btn" onClick={onOpenTasks}>View tasks</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 14 }}>
        {steps.map(step => (
          <div key={step.number} className="card" style={{ padding: 12, background: 'color-mix(in oklch, var(--surface) 92%, transparent)' }}>
            <div className="t-mono" style={{ color: 'var(--violet)', fontSize: 10 }}>{step.number}</div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{step.title}</div>
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>{step.text}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <div>
      <div className="t-eyebrow">{eyebrow}</div>
      <div style={{ fontSize: 24, lineHeight: 1.15, fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>
        {title}
      </div>
      <div style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
        {body}
      </div>
    </div>
  )
}

function OverviewCard({
  pendingCount,
  inProgressCount,
  completedCount,
  dumpsCount,
}: {
  pendingCount: number
  inProgressCount: number
  completedCount: number
  dumpsCount: number
}) {
  const items = [
    { label: 'Open today', value: pendingCount, tone: 'var(--violet)' },
    { label: 'In progress', value: inProgressCount, tone: 'var(--cyan)' },
    { label: 'Completed', value: completedCount, tone: 'var(--done)' },
    { label: 'Notes saved', value: dumpsCount, tone: 'var(--ink)' },
  ]

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="t-eyebrow">Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
        {items.map(item => (
          <div key={item.label} style={{ padding: 12, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: item.tone }}>{item.value}</div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--ink-2)' }}>{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FocusCard({
  title,
  tasks,
  emptyText,
}: {
  title: string
  tasks: Task[]
  emptyText: string
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="t-eyebrow">{title}</div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tasks.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{emptyText}</div>
        ) : (
          tasks.slice(0, 4).map(task => (
            <div key={task.id} style={{ paddingBottom: 10, borderBottom: '1px dashed var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: task.priority === 'high' ? 'var(--high)' : task.priority === 'medium' ? 'var(--med)' : 'var(--low)' }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{task.title}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                {task.description?.trim() ? shorten(task.description.trim(), 88) : task.due_date ? `Due ${format(new Date(task.due_date), 'EEE, MMM d')}` : 'Captured from a recent note'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RecentNotesCard({
  dumps,
  latestDump,
}: {
  dumps: BrainDump[]
  latestDump?: BrainDump
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="t-eyebrow">Recent notes</div>
      {latestDump ? (
        <div style={{ marginTop: 10 }}>
          <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10 }}>
            LATEST · {formatDistanceToNow(new Date(latestDump.created_at), { addSuffix: true }).toUpperCase()}
          </div>
          <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55 }}>
            {shorten(latestDump.content, 180)}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          Your notes will appear here after the first capture.
        </div>
      )}

      {dumps.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {dumps.slice(1, 4).map(dump => (
            <div key={dump.id} style={{ paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                {shorten(dump.content, 96)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MobileAccountCard({
  isDark,
  onToggleDark,
  onSignOut,
}: {
  isDark: boolean
  onToggleDark: () => void
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>Account</div>
      <ThemeToggleButton isDark={isDark} onToggle={onToggleDark} />
      <button type="button" className="btn sm ghost" onClick={() => void onSignOut()}>
        Sign out
      </button>
    </div>
  )
}

function buildCaptureHint(tasks: Task[], dumps: BrainDump[]) {
  if (dumps.length === 0) return 'Start with one voice note. No transcript preview, just capture and extract.'
  if (tasks.length === 0) return 'Talk naturally. I will turn the next note into your first tasks.'

  const openCount = tasks.filter(task => task.status !== 'completed').length
  return `${openCount} open item${openCount === 1 ? '' : 's'} right now. Capture another note and I’ll sort it underneath.`
}

function formatUserLabel(userEmail?: string) {
  if (!userEmail) return 'there'
  const local = userEmail.split('@')[0] || 'there'
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function shorten(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trim()}…`
}
