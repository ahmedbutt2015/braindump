'use client'

import { useState, useCallback } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { BrainDumpInput } from '@/components/brain-dump-input'
import { TaskList, Task } from '@/components/task-list'
import { RecentDumps, BrainDump } from '@/components/recent-dumps'

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

export function DashboardContent({ 
  initialTasks, 
  initialDumps, 
  userEmail 
}: DashboardContentProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  const { data: tasks = initialTasks, isLoading: tasksLoading } = useSWR(
    'tasks',
    fetchTasks,
    { fallbackData: initialTasks }
  )

  const { data: dumps = initialDumps, isLoading: dumpsLoading } = useSWR(
    'dumps',
    fetchDumps,
    { fallbackData: initialDumps }
  )

  const handleDumpSubmit = useCallback(async (content: string) => {
    setIsProcessing(true)
    
    try {
      const response = await fetch('/api/extract-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.modelLoading) {
          toast.warning('AI model is warming up', {
            description: `Try again in ~${result.retryAfter ?? 20} seconds. Hugging Face free tier needs a moment to start.`,
            duration: 8000,
          })
        } else {
          toast.error(result.error ?? 'Failed to process your thoughts. Please try again.')
        }
        return
      }

      const enrichmentNote = result.enrichmentsApplied > 0
        ? ` · Enriched ${result.enrichmentsApplied} existing task${result.enrichmentsApplied !== 1 ? 's' : ''}`
        : ''
      toast.success(`Extracted ${result.tasksExtracted} task${result.tasksExtracted !== 1 ? 's' : ''}${enrichmentNote}`, {
        description: result.summary,
      })

      await Promise.all([
        mutate('tasks'),
        mutate('dumps')
      ])
    } catch (error) {
      console.error('Error processing brain dump:', error)
      toast.error('Failed to process your thoughts. Check your connection and try again.')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleStatusChange = useCallback(async (taskId: string, status: Task['status']) => {
    // Optimistic update
    mutate('tasks', (current: Task[] | undefined) => 
      current?.map(t => t.id === taskId ? { ...t, status } : t),
      false
    )

    const { error } = await supabase
      .from('tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', taskId)

    if (error) {
      console.error('Error updating task:', error)
      mutate('tasks') // Revert on error
    }
  }, [])

  const handleDelete = useCallback(async (taskId: string) => {
    // Optimistic update
    mutate('tasks', (current: Task[] | undefined) => 
      current?.filter(t => t.id !== taskId),
      false
    )

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)

    if (error) {
      console.error('Error deleting task:', error)
      mutate('tasks') // Revert on error
    }
  }, [])

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const completedCount = tasks.filter(t => t.status === 'completed').length

  return (
    <div className="min-h-screen flex flex-col">
      <Header userEmail={userEmail} />
      
      <main className="flex-1 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Tasks" value={tasks.length} />
            <StatCard label="Pending" value={pendingCount} />
            <StatCard label="Completed" value={completedCount} />
            <StatCard label="Brain Dumps" value={dumps.length} />
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main content - Brain dump input and tasks */}
            <div className="lg:col-span-2 space-y-6">
              <BrainDumpInput 
                onSubmit={handleDumpSubmit} 
                isProcessing={isProcessing}
              />
              
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Your Tasks
                </h2>
                <TaskList 
                  tasks={tasks}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  isLoading={tasksLoading}
                />
              </div>
            </div>

            {/* Sidebar - Recent dumps */}
            <div className="lg:col-span-1">
              <RecentDumps dumps={dumps} isLoading={dumpsLoading} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border border-border/50 rounded-lg p-4 shadow-sm">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  )
}
