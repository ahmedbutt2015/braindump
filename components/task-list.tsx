'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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

const priorityColors = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-accent/20 text-accent-foreground',
  high: 'bg-destructive/20 text-destructive',
}

const statusLabels = {
  pending: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
}

export function TaskList({ tasks, onStatusChange, onDelete, isLoading }: TaskListProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (tasks.length === 0) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-muted-foreground">No tasks yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Dump your thoughts above to extract tasks</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress')
  const completedTasks = tasks.filter(t => t.status === 'completed')

  return (
    <div className="space-y-6">
      {pendingTasks.length > 0 && (
        <TaskSection
          title="To Do"
          description={`${pendingTasks.length} task${pendingTasks.length > 1 ? 's' : ''}`}
          tasks={pendingTasks}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
      )}
      
      {inProgressTasks.length > 0 && (
        <TaskSection
          title="In Progress"
          description={`${inProgressTasks.length} task${inProgressTasks.length > 1 ? 's' : ''}`}
          tasks={inProgressTasks}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
      )}
      
      {completedTasks.length > 0 && (
        <TaskSection
          title="Completed"
          description={`${completedTasks.length} task${completedTasks.length > 1 ? 's' : ''}`}
          tasks={completedTasks}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

function TaskSection({ 
  title, 
  description, 
  tasks, 
  onStatusChange, 
  onDelete 
}: { 
  title: string
  description: string
  tasks: Task[]
  onStatusChange: (taskId: string, status: Task['status']) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.map(task => (
          <TaskItem 
            key={task.id} 
            task={task} 
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function TaskItem({ 
  task, 
  onStatusChange,
  onDelete 
}: { 
  task: Task
  onStatusChange: (taskId: string, status: Task['status']) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}) {
  const nextStatus: Record<Task['status'], Task['status']> = {
    pending: 'in_progress',
    in_progress: 'completed',
    completed: 'pending',
  }

  return (
    <div className={cn(
      "p-4 rounded-lg border border-border/50 bg-card/50 transition-all hover:border-border",
      task.status === 'completed' && "opacity-60"
    )}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onStatusChange(task.id, nextStatus[task.status])}
          className={cn(
            "mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
            task.status === 'completed' 
              ? "bg-primary border-primary" 
              : task.status === 'in_progress'
              ? "border-primary"
              : "border-muted-foreground/30 hover:border-primary/50"
          )}
          aria-label={`Mark as ${statusLabels[nextStatus[task.status]]}`}
        >
          {task.status === 'completed' && (
            <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {task.status === 'in_progress' && (
            <div className="w-2 h-2 rounded-full bg-primary" />
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn(
              "font-medium text-sm",
              task.status === 'completed' && "line-through text-muted-foreground"
            )}>
              {task.title}
            </h4>
            <Badge variant="secondary" className={cn("text-xs flex-shrink-0", priorityColors[task.priority])}>
              {task.priority}
            </Badge>
          </div>
          
          {task.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {task.description}
            </p>
          )}
          
          <div className="flex items-center gap-2 mt-2">
            {task.due_date && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {new Date(task.due_date).toLocaleDateString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(task.id)}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive ml-auto"
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
