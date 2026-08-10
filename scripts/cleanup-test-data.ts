import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import path from 'path'

const env = loadEnv('test', path.resolve(process.cwd()), '')
Object.assign(process.env, env)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_USER_EMAIL!,
    password: process.env.TEST_USER_PASSWORD!,
  })
  if (authErr) { console.error('Auth failed:', authErr.message); process.exit(1) }

  const { error: e1 } = await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { error: e2 } = await supabase.from('brain_dumps').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('Tasks deleted:', e1 ? e1.message : 'OK')
  console.log('Dumps deleted:', e2 ? e2.message : 'OK')
}

main().catch(err => { console.error(err); process.exit(1) })
