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
import { BrainMascot } from '@/components/brain-mascot'
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
  const router = useRouter()
  const isMobile = useIsMobile()
  const taskSectionRef = useRef<HTMLDivElement | null>(null)
  const latestDumpRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

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

  const pendingCount = tasks.filter(task => task.status === 'pending').length
  const inProgressCount = tasks.filter(task => task.status === 'in_progress').length
  const completedCount = tasks.filter(task => task.status === 'completed').length
  const linkedCount = tasks.filter(task => task.description?.trim()).length
  const initials = userEmail ? userEmail.slice(0, 1).toUpperCase() : '?'
  const userLabel = formatUserLabel(userEmail)
  const todayLabel = format(new Date(), 'EEEE · MMM d').toUpperCase()
  const mobileTodayLabel = format(new Date(), 'EEE · MMM d').toUpperCase()
  const dailyBrief = buildDailyBrief(tasks, dumps)
  const latestDump = dumps[0]

  return (
    <div style={{
      display: 'flex',
      minHeight: '100dvh',
      overflow: 'hidden',
      background: 'var(--bg)',
      fontFamily: 'var(--body)',
      color: 'var(--ink)',
    }}>
      {!isMobile && (
        <DesktopSidebar
          pendingCount={pendingCount}
          tasksCount={tasks.length}
          dumps={dumps}
          linkedCount={linkedCount}
          initials={initials}
          userEmail={userEmail}
          onSignOut={handleSignOut}
        />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!isMobile && <DesktopHeader todayLabel={todayLabel} isDark={isDark} onToggleDark={toggleDark} />}

        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '18px 16px 28px' : '24px 32px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 360px',
            gap: isMobile ? 18 : 28,
            alignItems: 'start',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 22, minWidth: 0 }}>
              {!isMobile && (
                <>
                  <DailyBriefCard
                    text={dailyBrief}
                    onOpenToday={() => taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    onSkimMore={() => latestDumpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  />
                  <StatsStrip
                    items={[
                      { value: pendingCount, label: 'open today', color: 'var(--violet)' },
                      { value: inProgressCount, label: 'in progress' },
                      { value: linkedCount, label: 'linked across dumps', color: 'var(--cyan)' },
                      { value: dumps.length, label: 'dumps remembered' },
                    ]}
                  />
                </>
              )}

              <CaptureZone
                onSubmit={handleDumpSubmit}
                isProcessing={isProcessing}
                userLabel={userLabel}
                userInitial={initials}
                todayLabel={mobileTodayLabel}
                dailyBrief={dailyBrief}
              />

              {isMobile && (
                <StatsStrip
                  compact
                  items={[
                    { value: pendingCount, label: 'open today', color: 'var(--violet)' },
                    { value: inProgressCount, label: 'in progress' },
                    { value: linkedCount, label: 'linked across dumps', color: 'var(--cyan)' },
                    { value: dumps.length, label: 'dumps remembered' },
                  ]}
                />
              )}

              <div ref={taskSectionRef}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                  <h3 className="t-h3">Tasks</h3>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="chip" style={{ background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)' }}>All · {tasks.length}</span>
                    <span className="chip">To do · {pendingCount}</span>
                    <span className="chip">Doing · {inProgressCount}</span>
                    <span className="chip">Done · {completedCount}</span>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <LinkedContextCard tasks={tasks} dumps={dumps} />
              <div ref={latestDumpRef}>
                <LatestDumpCard latestDump={latestDump} tasks={tasks} />
              </div>
              <MemoryCard dumps={dumps} tasks={tasks} />
              <AccountCard
                isMobile={isMobile}
                isDark={isDark}
                onToggleDark={toggleDark}
                onSignOut={handleSignOut}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DesktopSidebar({
  pendingCount,
  tasksCount,
  dumps,
  linkedCount,
  initials,
  userEmail,
  onSignOut,
}: {
  pendingCount: number
  tasksCount: number
  dumps: BrainDump[]
  linkedCount: number
  initials: string
  userEmail?: string
  onSignOut: () => Promise<void>
}) {
  return (
    <aside style={{
      width: 240,
      flexShrink: 0,
      borderRight: '1px solid var(--line)',
      background: 'var(--bg-tint)',
      display: 'flex',
      flexDirection: 'column',
      padding: '18px 14px',
      gap: 18,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '0 6px' }}>
        <Logo size="sm" />
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
      }}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="t-small" style={{ flex: 1 }}>Search dumps</span>
        <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10 }}>⌘K</span>
      </div>

      <div>
        <div className="t-mono" style={{ color: 'var(--copy-muted)', padding: '0 8px', marginBottom: 6 }}>VIEWS</div>
        {[
          { label: 'Today', count: pendingCount, active: true },
          { label: 'Inbox', count: Math.min(dumps.length, 4), active: false },
          { label: 'Tasks', count: tasksCount, active: false },
          { label: 'Dumps', count: dumps.length, active: false },
          { label: 'Linked', count: linkedCount, active: false },
        ].map(item => (
          <div
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '7px 10px',
              borderRadius: 'var(--r-sm)',
              background: item.active ? 'var(--surface)' : 'transparent',
              border: item.active ? '1px solid var(--line)' : '1px solid transparent',
              color: item.active ? 'var(--ink)' : 'var(--ink-2)',
              fontSize: 13,
              marginBottom: 2,
              fontWeight: item.active ? 500 : 400,
            }}
          >
            <span style={{ flex: 1 }}>{item.label}</span>
            <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11 }}>{item.count}</span>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="t-mono" style={{ color: 'var(--copy-muted)', padding: '0 8px', marginBottom: 6 }}>RECENT DUMPS</div>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {dumps.slice(0, 4).map(dump => (
            <div key={dump.id} style={{ display: 'flex', padding: '5px 10px', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--ink-2)', gap: 7 }}>
              <span style={{ width: 4, height: 4, borderRadius: 999, background: 'var(--violet)', flexShrink: 0, marginTop: 7 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dump.content}</span>
              <span className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10, flexShrink: 0 }}>
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

      <div className="card" style={{ marginTop: 'auto', padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="avatar">{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userEmail ?? 'You'}
          </div>
          <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10 }}>free · live memory</div>
        </div>
        <button
          type="button"
          onClick={() => void onSignOut()}
          title="Sign out"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--copy-muted)', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="m9 10 3-3-3-3M12 7H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </aside>
  )
}

function DesktopHeader({
  todayLabel,
  isDark,
  onToggleDark,
}: {
  todayLabel: string
  isDark: boolean
  onToggleDark: () => void
}) {
  return (
    <div style={{
      height: 54,
      padding: '0 28px',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid var(--line)',
      background: 'color-mix(in oklch, var(--bg) 80%, transparent)',
      backdropFilter: 'blur(8px)',
    }}>
      <div>
        <div className="t-eyebrow">{todayLabel}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>Today</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn sm ghost">Brief</button>
        <button
          type="button"
          onClick={onToggleDark}
          title={isDark ? 'Switch to light' : 'Switch to dark'}
          className="btn sm"
          style={{ width: 34, padding: 0 }}
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
    </div>
  )
}

function DailyBriefCard({
  text,
  onOpenToday,
  onSkimMore,
}: {
  text: string
  onOpenToday: () => void
  onSkimMore: () => void
}) {
  return (
    <div style={{
      padding: 22,
      borderRadius: 'var(--r-lg)',
      background: 'linear-gradient(135deg, color-mix(in oklch, var(--violet) 10%, var(--surface)) 0%, var(--surface) 65%)',
      border: '1px solid var(--line)',
      display: 'flex',
      gap: 22,
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <BrainMascot size={120} state="happy" showHalo={false} />
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="t-eyebrow">Today&apos;s brief · 9:42</div>
        <div style={{ fontSize: 19, lineHeight: 1.45, color: 'var(--ink)', marginTop: 6 }}>{text}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm primary" onClick={onOpenToday}>Open today</button>
          <button type="button" className="btn sm" onClick={onSkimMore}>Skim more</button>
        </div>
      </div>
    </div>
  )
}

function StatsStrip({
  items,
  compact = false,
}: {
  items: Array<{ value: number; label: string; color?: string }>
  compact?: boolean
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
      {items.map(item => (
        <div key={item.label} className="card" style={{ padding: 14 }}>
          <div className="t-h2" style={{ fontSize: compact ? 24 : 28, color: item.color || 'var(--ink)' }}>{item.value}</div>
          <div className="t-small" style={{ marginTop: 2 }}>{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function LinkedContextCard({
  tasks,
  dumps,
}: {
  tasks: Task[]
  dumps: BrainDump[]
}) {
  const linkedTask = tasks.find(task => task.description?.trim())
  const latestDump = dumps[0]

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="t-eyebrow">Linked context · live</div>
      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5 }}>
        {linkedTask && latestDump ? (
          <>
            <span style={{ color: 'var(--violet)', fontWeight: 500 }}>
              "{shorten(latestDump.content, 44)}"
            </span>{' '}
            connects to <span style={{ color: 'var(--ink)' }}>{linkedTask.title}</span>.
          </>
        ) : (
          'Mention a person or idea twice and BrainDump will connect the new dump back to the original task.'
        )}
      </div>
      <LinkGraph />
      <button type="button" className="btn sm" style={{ marginTop: 10 }}>Show graph</button>
    </div>
  )
}

function LatestDumpCard({
  latestDump,
  tasks,
}: {
  latestDump?: BrainDump
  tasks: Task[]
}) {
  if (!latestDump) {
    return (
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <div className="t-eyebrow" style={{ marginBottom: 8 }}>No dumps yet</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Dump your first thought above. Voice or text both work.</div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="t-eyebrow">Latest dump</div>
      <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 11, marginTop: 4 }}>
        {formatDistanceToNow(new Date(latestDump.created_at), { addSuffix: true }).toUpperCase()}
      </div>
      <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
        {latestDump.content}
      </div>
      {tasks.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
          <div className="t-mono" style={{ color: 'var(--copy-muted)' }}>EXTRACTED</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {tasks.slice(0, 3).map(task => (
              <span key={task.id} style={{ fontSize: 13, color: 'var(--ink)' }}>→ {task.title}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MemoryCard({
  dumps,
  tasks,
}: {
  dumps: BrainDump[]
  tasks: Task[]
}) {
  const earliestOpenTask = [...tasks]
    .filter(task => task.status !== 'completed')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]

  return (
    <div className="card" style={{ padding: 16, background: 'var(--surface-2)' }}>
      <div className="t-eyebrow">Memory</div>
      <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        {dumps.length === 0 ? (
          'No thoughts stored yet. Your brain starts empty.'
        ) : (
          <>
            Your brain has held onto <strong style={{ color: 'var(--ink)' }}>{dumps.length} dump{dumps.length === 1 ? '' : 's'}</strong>.
            {earliestOpenTask && (
              <>
                {' '}Earliest still-open thought: <em>"{earliestOpenTask.title}"</em>.
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AccountCard({
  isMobile,
  isDark,
  onToggleDark,
  onSignOut,
}: {
  isMobile: boolean
  isDark: boolean
  onToggleDark: () => void
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="t-eyebrow" style={{ marginBottom: 10 }}>Account</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {isMobile && (
          <button type="button" className="btn sm" onClick={onToggleDark} style={{ justifyContent: 'flex-start' }}>
            {isDark ? 'Switch to light' : 'Switch to dark'}
          </button>
        )}
        <a href="/auth/forgot-password" style={{ fontSize: 13, color: 'var(--ink-2)', textDecoration: 'none' }}>
          <span style={{ color: 'var(--violet)' }}>→</span> Change password
        </a>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => void onSignOut()}
          style={{ justifyContent: 'flex-start', paddingLeft: 0 }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

function LinkGraph() {
  return (
    <svg viewBox="0 0 280 130" style={{ width: '100%', marginTop: 10 }}>
      <defs>
        <radialGradient id="lg-node" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--violet)" />
          <stop offset="100%" stopColor="var(--violet-deep)" />
        </radialGradient>
      </defs>
      <g stroke="var(--line-strong)" strokeWidth="1.2" fill="none">
        <path d="M40 65 Q 90 30, 150 50" />
        <path d="M150 50 Q 200 30, 250 60" />
        <path d="M150 50 Q 180 90, 240 100" />
        <path d="M40 65 Q 80 100, 130 110" />
      </g>
      <circle cx="150" cy="50" r="11" fill="url(#lg-node)" />
      <text x="150" y="54" textAnchor="middle" fontSize="9" fill="white" fontFamily="var(--mono)">Link</text>
      {[
        [40, 65, 'Dump'],
        [250, 60, 'Task'],
        [240, 100, 'Context'],
        [130, 110, 'Idea'],
      ].map(([x, y, label]) => (
        <g key={label as string}>
          <circle cx={x as number} cy={y as number} r="6" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.2" />
          <text x={x as number} y={(y as number) - 10} textAnchor="middle" fontSize="9" fill="var(--ink-2)" fontFamily="var(--body)">
            {label as string}
          </text>
        </g>
      ))}
    </svg>
  )
}

function buildDailyBrief(tasks: Task[], dumps: BrainDump[]) {
  const dueSoon = tasks.find(task => task.due_date)
  const linked = tasks.find(task => task.description?.trim())
  const latestDump = dumps[0]

  const parts = [
    tasks.length > 0
      ? `You have ${tasks.filter(task => task.status !== 'completed').length} open thing${tasks.filter(task => task.status !== 'completed').length === 1 ? '' : 's'} in motion today.`
      : 'Fresh slate today. Nothing urgent is waiting on you yet.',
    dueSoon?.due_date
      ? `${dueSoon.title} is due ${format(new Date(dueSoon.due_date), 'EEE')}.`
      : linked
        ? `${linked.title} picked up new context from a recent dump.`
        : 'New dumps will start linking themselves as soon as you repeat a person, project, or idea.',
    latestDump
      ? `Latest note: "${shorten(latestDump.content, 72)}".`
      : 'Start with one quick voice dump and let the app sort the rest.',
  ]

  return parts.join(' ')
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
