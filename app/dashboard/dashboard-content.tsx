'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { CaptureZone, type CaptureSubmitResult } from '@/components/capture-zone'
import { TaskList, type Task } from '@/components/task-list'
import { TaskDetailPanel } from '@/components/task-detail-panel'
import type { BrainDump } from '@/components/recent-dumps'
import { Logo } from '@/components/logo'
import { useIsMobile } from '@/hooks/use-mobile'

type DashboardView = 'capture' | 'tasks' | 'inbox' | 'notes' | 'search' | 'settings'

const VIEW_TITLES: Record<DashboardView, string> = {
  capture: 'Taking notes',
  tasks: 'All tasks',
  inbox: 'Inbox',
  notes: 'Recent notes',
  search: 'Search',
  settings: 'Settings',
}

const DUMPS_PAGE_SIZE = 20

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
  subtaskAdditions?: number
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

async function fetchDumps(limit: number): Promise<BrainDump[]> {
  const { data, error } = await supabase
    .from('brain_dumps')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export function DashboardContent({ initialTasks, initialDumps, userEmail }: DashboardContentProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [tutorialDismissed, setTutorialDismissed] = useState(false)
  const [activeView, setActiveView] = useState<DashboardView>('capture')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const router = useRouter()
  const isMobile = useIsMobile()
  const captureSectionRef = useRef<HTMLDivElement | null>(null)
  const taskSectionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setActiveView('search')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  const [dumpsLimit, setDumpsLimit] = useState(DUMPS_PAGE_SIZE)

  const { data: tasks = initialTasks, isLoading: tasksLoading } = useSWR(
    'tasks',
    fetchTasks,
    { fallbackData: initialTasks },
  )
  const { data: dumps = initialDumps } = useSWR(
    ['dumps', dumpsLimit],
    ([, limit]) => fetchDumps(limit as number),
    { fallbackData: initialDumps },
  )
  const hasMoreDumps = dumps.length === dumpsLimit

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

      const parts: string[] = []
      const extracted = result.tasksExtracted ?? 0
      const enriched = result.enrichmentsApplied ?? 0
      const subtasks = result.subtaskAdditions ?? 0
      if (extracted > 0) parts.push(`${extracted} new task${extracted !== 1 ? 's' : ''}`)
      if (enriched > 0) parts.push(`${enriched} enriched`)
      if (subtasks > 0) parts.push(`${subtasks} subtask${subtasks !== 1 ? 's' : ''} added`)
      const toastTitle = parts.length > 0 ? parts.join(' · ') : 'Nothing new to extract'
      toast.success(toastTitle, { description: result.summary })

      await Promise.all([
        mutate('tasks'),
        mutate((key) => Array.isArray(key) && key[0] === 'dumps'),
      ])

      return {
        transcript: result.transcript ?? content,
        summary: result.summary ?? 'Captured your dump.',
        tasksExtracted: result.tasksExtracted ?? 0,
        enrichmentsApplied: result.enrichmentsApplied ?? 0,
        subtaskAdditions: result.subtaskAdditions ?? 0,
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

  const handleDumpDelete = useCallback(async (dumpId: string) => {
    mutate(
      (key) => Array.isArray(key) && key[0] === 'dumps',
      (current: BrainDump[] | undefined) => current?.filter(d => d.id !== dumpId),
      false,
    )
    mutate(
      'tasks',
      (current: Task[] | undefined) => current?.filter(t => t.brain_dump_id !== dumpId),
      false,
    )
    const res = await fetch(`/api/brain-dumps/${dumpId}`, { method: 'DELETE' })
    if (!res.ok) {
      mutate((key) => Array.isArray(key) && key[0] === 'dumps')
      mutate('tasks')
      toast.error('Failed to delete note.')
    }
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
          activeView={activeView}
          onNavigate={setActiveView}
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
            title={VIEW_TITLES[activeView]}
          />

          {activeView === 'capture' && (
            <>
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
                      onOpen={setSelectedTask}
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
            </>
          )}

          {activeView === 'tasks' && (
            <TasksPageView
              tasks={tasks}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onOpen={setSelectedTask}
              isLoading={tasksLoading}
            />
          )}

          {activeView === 'inbox' && (
            <InboxPageView
              tasks={pendingTasks}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          )}

          {activeView === 'notes' && (
            <NotesPageView
              dumps={dumps}
              tasks={tasks}
              onOpenTask={setSelectedTask}
              onDelete={handleDumpDelete}
              hasMore={hasMoreDumps}
              onLoadMore={() => setDumpsLimit(l => l + DUMPS_PAGE_SIZE)}
            />
          )}

          {activeView === 'search' && (
            <SearchPageView tasks={tasks} dumps={dumps} onStatusChange={handleStatusChange} onDelete={handleDelete} onOpen={setSelectedTask} />
          )}

          {activeView === 'settings' && (
            <SettingsPageView userEmail={userEmail} onSignOut={handleSignOut} />
          )}
        </div>
      </main>

      <TaskDetailPanel
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onDelete={handleDelete}
      />
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
  activeView,
  onNavigate,
}: {
  pendingCount: number
  tasksCount: number
  dumps: BrainDump[]
  initials: string
  userEmail?: string
  isDark: boolean
  onToggleDark: () => void
  onSignOut: () => Promise<void>
  activeView: DashboardView
  onNavigate: (view: DashboardView) => void
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
      <div
        style={{ padding: '0 6px', cursor: 'pointer' }}
        onClick={() => onNavigate('capture')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('capture') }}
      >
        <Logo size="sm" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <SidebarNavItem label="Taking notes" count={1} active={activeView === 'capture'} onClick={() => onNavigate('capture')} />
        <SidebarNavItem label="Tasks" count={tasksCount} active={activeView === 'tasks'} onClick={() => onNavigate('tasks')} />
        <SidebarNavItem label="Inbox" count={pendingCount} active={activeView === 'inbox'} onClick={() => onNavigate('inbox')} />
        <SidebarNavItem label="Recent notes" count={dumps.length} active={activeView === 'notes'} onClick={() => onNavigate('notes')} />
        <SidebarNavItem label="Search" count={0} active={activeView === 'search'} onClick={() => onNavigate('search')} />
        <SidebarNavItem label="Settings" count={0} active={activeView === 'settings'} onClick={() => onNavigate('settings')} />
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
  onClick,
}: {
  label: string
  count: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--r-md)',
        border: active ? '1px solid var(--line)' : '1px solid transparent',
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s',
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
  title,
}: {
  isMobile: boolean
  todayLabel: string
  userLabel: string
  initials: string
  isDark: boolean
  onToggleDark: () => void
  title: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <div>
        <div className="t-eyebrow">{todayLabel}</div>
        <div style={{ fontSize: isMobile ? 24 : 30, lineHeight: 1.05, fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>
          {title}
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

type FilterPriority = 'all' | 'high' | 'medium' | 'low'
type FilterStatus = 'all' | 'pending' | 'in_progress' | 'completed'
type SortBy = 'newest' | 'due_date' | 'priority'

function applyFilter(tasks: Task[], priority: FilterPriority, status: FilterStatus, sort: SortBy): Task[] {
  let result = tasks
  if (priority !== 'all') result = result.filter(t => t.priority === priority)
  if (status !== 'all') result = result.filter(t => t.status === status)
  const priorityRank = { high: 0, medium: 1, low: 2 }
  if (sort === 'due_date') {
    result = [...result].sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    })
  } else if (sort === 'priority') {
    result = [...result].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
  }
  return result
}

function TaskFilterBar({
  priority, setPriority, status, setStatus, sort, setSort, total,
}: {
  priority: FilterPriority
  setPriority: (v: FilterPriority) => void
  status: FilterStatus
  setStatus: (v: FilterStatus) => void
  sort: SortBy
  setSort: (v: SortBy) => void
  total: number
}) {
  const active = priority !== 'all' || status !== 'all' || sort !== 'newest'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['all', 'high', 'medium', 'low'] as FilterPriority[]).map(p => (
          <button
            key={p}
            type="button"
            className="chip"
            onClick={() => setPriority(p)}
            style={{
              cursor: 'pointer',
              background: priority === p ? 'var(--ink)' : 'transparent',
              color: priority === p ? 'var(--bg)' : 'var(--ink-2)',
              borderColor: priority === p ? 'var(--ink)' : 'var(--line)',
            }}
          >
            {p === 'all' ? `All · ${total}` : p}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 16, background: 'var(--line)', flexShrink: 0 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {([['all', 'Any status'], ['pending', 'Open'], ['in_progress', 'In progress'], ['completed', 'Done']] as [FilterStatus, string][]).map(([s, label]) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => setStatus(s)}
            style={{
              cursor: 'pointer',
              background: status === s ? 'var(--surface-2)' : 'transparent',
              color: status === s ? 'var(--ink)' : 'var(--ink-2)',
              borderColor: status === s ? 'var(--line-strong)' : 'var(--line)',
              fontWeight: status === s ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 16, background: 'var(--line)', flexShrink: 0 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {([['newest', 'Newest'], ['due_date', 'Due date'], ['priority', 'Priority']] as [SortBy, string][]).map(([s, label]) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => setSort(s)}
            style={{
              cursor: 'pointer',
              background: sort === s ? 'color-mix(in oklch, var(--violet) 12%, var(--surface))' : 'transparent',
              color: sort === s ? 'var(--violet)' : 'var(--ink-2)',
              borderColor: sort === s ? 'color-mix(in oklch, var(--violet) 30%, var(--line))' : 'var(--line)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {active && (
        <button
          type="button"
          className="chip"
          onClick={() => { setPriority('all'); setStatus('all'); setSort('newest') }}
          style={{ cursor: 'pointer', color: 'var(--high)', borderColor: 'color-mix(in oklch, var(--high) 30%, var(--line))' }}
        >
          × clear
        </button>
      )}
    </div>
  )
}

function TasksPageView({
  tasks,
  onStatusChange,
  onDelete,
  onOpen,
  isLoading,
}: {
  tasks: Task[]
  onStatusChange: (id: string, status: Task['status']) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (task: Task) => void
  isLoading: boolean
}) {
  const [priority, setPriority] = useState<FilterPriority>('all')
  const [status, setStatus] = useState<FilterStatus>('all')
  const [sort, setSort] = useState<SortBy>('newest')
  const filtered = applyFilter(tasks, priority, status, sort)

  return (
    <div style={{ marginTop: 22 }}>
      <TaskFilterBar
        priority={priority} setPriority={setPriority}
        status={status} setStatus={setStatus}
        sort={sort} setSort={setSort}
        total={tasks.length}
      />
      <TaskList
        tasks={filtered}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        onOpen={onOpen}
        isLoading={isLoading}
      />
    </div>
  )
}

function InboxPageView({
  tasks,
  onStatusChange,
  onDelete,
}: {
  tasks: Task[]
  onStatusChange: (id: string, status: Task['status']) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  if (tasks.length === 0) {
    return (
      <div style={{ marginTop: 22 }}>
        <div className="card" style={{ padding: '36px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Inbox is clear</div>
          <div style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            All pending tasks done. Capture a new note to get more.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {tasks.map(task => (
        <div key={task.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <span style={{
            marginTop: 3,
            width: 9,
            height: 9,
            borderRadius: 999,
            background: task.priority === 'high' ? 'var(--high)' : task.priority === 'medium' ? 'var(--med)' : 'var(--low)',
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{task.title}</div>
            {task.description && (
              <div style={{ marginTop: 3, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>{task.description}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" className="btn sm" onClick={() => void onStatusChange(task.id, 'in_progress')}>
              Start →
            </button>
            <button type="button" className="btn sm" style={{ background: 'var(--done)', color: 'white', borderColor: 'var(--done)' }} onClick={() => void onStatusChange(task.id, 'completed')}>
              Done
            </button>
            <button type="button" className="btn sm ghost" onClick={() => void onDelete(task.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function NotesPageView({
  dumps,
  tasks,
  onOpenTask,
  onDelete,
  hasMore,
  onLoadMore,
}: {
  dumps: BrainDump[]
  tasks: Task[]
  onOpenTask: (task: Task) => void
  onDelete: (id: string) => Promise<void>
  hasMore: boolean
  onLoadMore: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (dumps.length === 0) {
    return (
      <div style={{ marginTop: 22 }}>
        <div className="card" style={{ padding: '36px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>No notes yet</div>
          <div style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Capture your first thought to see it here.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {dumps.map(dump => {
        const isExpanded = expandedId === dump.id
        const linkedTasks = tasks.filter(t => t.brain_dump_id === dump.id)

        return (
          <div key={dump.id} className="card" style={{ padding: '14px 16px', transition: 'background 0.1s' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                onClick={() => setExpandedId(isExpanded ? null : dump.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10 }}>
                    {format(new Date(dump.created_at), 'EEE, MMM d · h:mm a').toUpperCase()}
                  </div>
                  {linkedTasks.length > 0 && (
                    <span
                      className="chip"
                      style={{
                        background: 'color-mix(in oklch, var(--violet) 14%, transparent)',
                        borderColor: 'transparent',
                        color: 'var(--violet)',
                        fontSize: 10,
                      }}
                    >
                      {linkedTasks.length} task{linkedTasks.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55, whiteSpace: isExpanded ? 'pre-wrap' : 'normal', wordBreak: 'break-word' }}>
                  {isExpanded ? dump.content : shorten(dump.content, 160)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => void onDelete(dump.id)}
                  title="Delete note"
                  style={{
                    width: 26, height: 26, borderRadius: 7,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--copy-muted)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--high)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'color-mix(in oklch, var(--high) 30%, var(--line))' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--copy-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent' }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                    <path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" />
                  </svg>
                </button>
                <svg
                  width="14" height="14" viewBox="0 0 14 14" fill="none"
                  stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                  onClick={() => setExpandedId(isExpanded ? null : dump.id)}
                  style={{ cursor: 'pointer', color: 'var(--ink-2)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                >
                  <path d="M5 3l4 4-4 4" />
                </svg>
              </div>
            </div>

            {isExpanded && linkedTasks.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
                <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 9, marginBottom: 8 }}>
                  TASKS FROM THIS NOTE
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {linkedTasks.map(task => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenTask(task) }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 'var(--r-sm)',
                        border: '1px solid var(--line)',
                        background: 'var(--surface)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <span style={{
                        width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                        background: task.priority === 'high' ? 'var(--high)' : task.priority === 'medium' ? 'var(--med)' : 'var(--low)',
                      }} />
                      <span style={{
                        flex: 1,
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--ink)',
                        textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                        opacity: task.status === 'completed' ? 0.6 : 1,
                      }}>
                        {task.title}
                      </span>
                      <span className="chip" style={{ fontSize: 10, flexShrink: 0 }}>
                        {task.status === 'in_progress' ? 'in progress' : task.status}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" style={{ color: 'var(--ink-2)', flexShrink: 0 }}>
                        <path d="M4 2l4 4-4 4" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {hasMore && (
        <button
          type="button"
          className="btn"
          onClick={onLoadMore}
          style={{ alignSelf: 'center', marginTop: 4 }}
        >
          Load more notes
        </button>
      )}
    </div>
  )
}

function SearchPageView({
  tasks,
  dumps,
  onStatusChange,
  onDelete,
  onOpen,
}: {
  tasks: Task[]
  dumps: BrainDump[]
  onStatusChange: (id: string, status: Task['status']) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (task: Task) => void
}) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  const matchedTasks = q
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      )
    : []

  const matchedDumps = q
    ? dumps.filter(d => d.content.toLowerCase().includes(q))
    : []

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <svg
          width="16" height="16"
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-2)', pointerEvents: 'none' }}
        >
          <circle cx="6.5" cy="6.5" r="5" />
          <path d="M10.5 10.5l4 4" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tasks and notes…"
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '11px 14px 11px 38px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            color: 'var(--ink)',
            fontSize: 15,
            fontFamily: 'var(--body)',
            outline: 'none',
          }}
        />
      </div>

      {!q && (
        <div className="card" style={{ padding: '36px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, color: 'var(--ink-2)' }}>Type to search across all tasks and notes.</div>
        </div>
      )}

      {q && matchedTasks.length === 0 && matchedDumps.length === 0 && (
        <div className="card" style={{ padding: '36px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>No results for &ldquo;{query}&rdquo;</div>
          <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--ink-2)' }}>Try a different word or phrase.</div>
        </div>
      )}

      {matchedTasks.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div className="t-eyebrow" style={{ marginBottom: 10 }}>
            Tasks · {matchedTasks.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matchedTasks.map(task => (
              <div key={task.id} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{
                  marginTop: 4,
                  width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                  background: task.priority === 'high' ? 'var(--high)' : task.priority === 'medium' ? 'var(--med)' : 'var(--low)',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>
                    <Highlight text={task.title} query={q} />
                  </div>
                  {task.description && (
                    <div style={{ marginTop: 3, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                      <Highlight text={shorten(task.description, 140)} query={q} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn sm ghost" onClick={() => onOpen(task)}>Open</button>
                  <button type="button" className="btn sm ghost" style={{ color: 'var(--high)' }} onClick={() => void onDelete(task.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {matchedDumps.length > 0 && (
        <div>
          <div className="t-eyebrow" style={{ marginBottom: 10 }}>
            Notes · {matchedDumps.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matchedDumps.map(dump => (
              <div key={dump.id} className="card" style={{ padding: '12px 14px' }}>
                <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10, marginBottom: 6 }}>
                  {format(new Date(dump.created_at), 'EEE, MMM d · h:mm a').toUpperCase()}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55 }}>
                  <Highlight text={shorten(dump.content, 240)} query={q} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query ? (
          <mark key={i} style={{ background: 'color-mix(in oklch, var(--violet) 22%, transparent)', color: 'inherit', borderRadius: 2 }}>
            {part}
          </mark>
        ) : part
      )}
    </>
  )
}

function SettingsPageView({
  userEmail,
  onSignOut,
}: {
  userEmail?: string
  onSignOut: () => Promise<void>
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [pwError, setPwError] = useState('')
  const [emailError, setEmailError] = useState('')

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match.'); return }
    setPwStatus('saving')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setPwError(error.message); setPwStatus('error') }
    else { setPwStatus('done'); setNewPassword(''); setConfirmPassword('') }
  }

  const handleEmailChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError('')
    if (!newEmail.includes('@')) { setEmailError('Enter a valid email address.'); return }
    setEmailStatus('saving')
    const { error } = await supabase.auth.updateUser({ email: newEmail })
    if (error) { setEmailError(error.message); setEmailStatus('error') }
    else { setEmailStatus('done'); setNewEmail('') }
  }

  return (
    <div style={{ marginTop: 22, maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Account info */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div className="t-eyebrow">Account</div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="avatar" style={{ width: 40, height: 40, fontSize: 16, borderRadius: 12 }}>
            {userEmail ? userEmail.slice(0, 1).toUpperCase() : '?'}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{userEmail ?? 'Unknown'}</div>
            <div className="t-mono" style={{ color: 'var(--copy-muted)', fontSize: 10 }}>your workspace</div>
          </div>
        </div>
      </div>

      {/* Change email */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div className="t-eyebrow">Change email</div>
        <form onSubmit={(e) => void handleEmailChange(e)} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="email"
            value={newEmail}
            onChange={e => { setNewEmail(e.target.value); setEmailStatus('idle') }}
            placeholder="New email address"
            style={inputStyle}
          />
          {emailError && <div style={{ fontSize: 12.5, color: 'var(--high)' }}>{emailError}</div>}
          {emailStatus === 'done' && (
            <div style={{ fontSize: 12.5, color: 'var(--done)' }}>Check your new inbox for a confirmation link.</div>
          )}
          <button
            type="submit"
            className="btn sm primary"
            disabled={!newEmail || emailStatus === 'saving'}
            style={{ alignSelf: 'flex-start' }}
          >
            {emailStatus === 'saving' ? 'Saving…' : 'Update email'}
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div className="t-eyebrow">Change password</div>
        <form onSubmit={(e) => void handlePasswordChange(e)} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="password"
            value={newPassword}
            onChange={e => { setNewPassword(e.target.value); setPwStatus('idle') }}
            placeholder="New password (min 8 characters)"
            style={inputStyle}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={e => { setConfirmPassword(e.target.value); setPwStatus('idle') }}
            placeholder="Confirm new password"
            style={inputStyle}
          />
          {pwError && <div style={{ fontSize: 12.5, color: 'var(--high)' }}>{pwError}</div>}
          {pwStatus === 'done' && <div style={{ fontSize: 12.5, color: 'var(--done)' }}>Password updated.</div>}
          <button
            type="submit"
            className="btn sm"
            disabled={!newPassword || !confirmPassword || pwStatus === 'saving'}
            style={{ alignSelf: 'flex-start' }}
          >
            {pwStatus === 'saving' ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="card" style={{ padding: '18px 20px', borderColor: 'color-mix(in oklch, var(--high) 22%, var(--line))' }}>
        <div className="t-eyebrow" style={{ color: 'var(--high)' }}>Sign out</div>
        <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          You will be taken back to the login page.
        </div>
        <button
          type="button"
          className="btn sm ghost"
          style={{ marginTop: 12, color: 'var(--high)', borderColor: 'color-mix(in oklch, var(--high) 30%, var(--line))' }}
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 12px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 13.5,
  fontFamily: 'var(--body)',
  outline: 'none',
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
