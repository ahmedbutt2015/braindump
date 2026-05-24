import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardContent } from './dashboard-content'
import { ErrorBoundary } from '@/components/error-boundary'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const [{ data: tasks }, { data: dumps }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('brain_dumps')
      .select('*')
      .order('created_at', { ascending: false })
  ])

  return (
    <ErrorBoundary>
      <DashboardContent
        initialTasks={tasks || []}
        initialDumps={dumps || []}
        userEmail={user.email}
      />
    </ErrorBoundary>
  )
}
