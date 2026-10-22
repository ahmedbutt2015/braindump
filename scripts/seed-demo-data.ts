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
  const { data: { session } } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_USER_EMAIL!,
    password: process.env.TEST_USER_PASSWORD!,
  })
  if (!session) { console.error('Sign-in failed'); process.exit(1) }
  const uid = session.user.id

  const { data: dump1 } = await supabase.from('brain_dumps').insert({
    user_id: uid,
    content: 'Met Jake Chen at the networking event tonight. He\'s a hiring manager at CyberX Security — they\'re actively hiring Senior Security Engineers. Should follow up and send my resume.',
  }).select().single()

  const { data: dump2 } = await supabase.from('brain_dumps').insert({
    user_id: uid,
    content: 'Need to update my resume — last touched in 2022. Also should research what cloud security certifications are in demand right now. AWS Security Specialty seems important.',
  }).select().single()

  const { data: dump3 } = await supabase.from('brain_dumps').insert({
    user_id: uid,
    content: 'Jake messaged me on LinkedIn! CyberX needs someone strong in AWS and zero-trust architecture. He wants my resume by Friday. Also need to write a custom cover letter for them.',
  }).select().single()

  const tasks = [
    {
      user_id: uid, brain_dump_id: dump1!.id,
      title: 'Follow up with Jake Chen about CyberX Security position',
      description: 'Met at networking event. Jake is hiring manager — wants resume by Friday. Focus on AWS + zero-trust experience.',
      priority: 'high', status: 'in_progress',
      subtasks: [
        { id: '1', title: 'Connect on LinkedIn', completed: true },
        { id: '2', title: 'Send resume + cover letter', completed: false },
      ],
    },
    {
      user_id: uid, brain_dump_id: dump2!.id,
      title: 'Update resume with last 3 years of experience',
      description: 'Last updated 2022. Merge LinkedIn export, old job application version, and portfolio doc. Tailor for cloud security roles.',
      priority: 'high', status: 'pending',
      subtasks: [
        { id: '1', title: 'Pull LinkedIn export', completed: false },
        { id: '2', title: 'Add AWS project highlights', completed: false },
        { id: '3', title: 'Ask Sarah to review', completed: false },
      ],
    },
    {
      user_id: uid, brain_dump_id: dump2!.id,
      title: 'Research cloud security certifications in demand',
      description: 'AWS Security Specialty, CISSP, and CKS (Kubernetes Security) seem most relevant for senior roles.',
      priority: 'medium', status: 'pending',
      subtasks: [],
    },
    {
      user_id: uid, brain_dump_id: dump3!.id,
      title: 'Write custom cover letter for CyberX',
      description: 'Emphasise zero-trust architecture and AWS experience. Reference Jake\'s mention of their current migration project.',
      priority: 'high', status: 'pending',
      subtasks: [],
    },
    {
      user_id: uid, brain_dump_id: dump3!.id,
      title: 'Practice system design interviews',
      description: 'Focus on distributed systems, AWS architecture, and security threat modelling.',
      priority: 'medium', status: 'pending',
      subtasks: [],
    },
    {
      user_id: uid, brain_dump_id: dump1!.id,
      title: 'Follow up with TechCorp application',
      description: 'Applied last month, no response. Send a polite follow-up email.',
      priority: 'low', status: 'pending',
      subtasks: [],
    },
    {
      user_id: uid, brain_dump_id: dump2!.id,
      title: 'Read NIST CSF 2.0 framework',
      description: 'New version released. Relevant for senior security roles.',
      priority: 'low', status: 'completed',
      subtasks: [],
    },
  ]

  for (const task of tasks) {
    const { error } = await supabase.from('tasks').insert(task).select().single()
    if (error) console.error('Task insert error:', error.message, 'for', task.title)
  }

  console.log('Demo data seeded.')
}

main().catch(err => { console.error(err); process.exit(1) })
