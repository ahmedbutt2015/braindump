import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardContent } from './dashboard-content'

export default async function DashboardPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  // Fetch initial data
  const [{ data: tasks }, { data: dumps }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('brain_dumps')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)
  ])

  return (
    <DashboardContent 
      initialTasks={tasks || []} 
      initialDumps={dumps || []}
      userEmail={user.email}
    />
  )
}
