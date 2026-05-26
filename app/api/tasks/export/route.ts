import { createClient } from '@/lib/supabase/server'

function escapeCsv(val: string | null | undefined): string {
  const s = val ?? ''
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, description, priority, status, due_date, created_at, notes, tags')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }

  const rows = tasks ?? []
  const { searchParams } = new URL(request.url)
  const fmt = searchParams.get('format') === 'csv' ? 'csv' : 'json'

  if (fmt === 'csv') {
    const header = 'id,title,description,priority,status,due_date,created_at,notes,tags'
    const lines = rows.map(t => [
      t.id,
      escapeCsv(t.title),
      escapeCsv(t.description),
      t.priority,
      t.status,
      t.due_date ?? '',
      t.created_at,
      escapeCsv(t.notes),
      escapeCsv((t.tags as string[] | null)?.join(', ')),
    ].join(','))
    const csv = [header, ...lines].join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="braindump-tasks.csv"',
      },
    })
  }

  return new Response(JSON.stringify(rows, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="braindump-tasks.json"',
    },
  })
}
