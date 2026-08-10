/**
 * Backfill embeddings for tasks that were created before embedding was deployed.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts
 *
 * Requires in .env.local:
 *   TEST_USER_EMAIL=ahmed@test.co
 *   TEST_USER_PASSWORD=ahmed@test.co
 *
 * The script processes tasks in batches of 8 with a short delay between
 * batches to stay within HuggingFace free-tier rate limits.
 */

import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import path from 'path'

// Load .env.local
const env = loadEnv('test', path.resolve(process.cwd()), '')
Object.assign(process.env, env)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN!
const EMBED_URL = 'https://api-inference.huggingface.co/models/BAAI/bge-small-en-v1.5'
const BATCH_SIZE = 8
const BATCH_DELAY_MS = 1500

// ─── Embedding helpers ─────────────────────────────────────────────────────

function meanPool(tokenEmbeddings: number[][]): number[] {
  const dims = tokenEmbeddings[0].length
  const out = new Array<number>(dims).fill(0)
  for (const tok of tokenEmbeddings) for (let i = 0; i < dims; i++) out[i] += tok[i]
  return out.map(v => v / tokenEmbeddings.length)
}

function parseEmbedding(data: unknown): number[] {
  if (!Array.isArray(data) || !data.length) throw new Error('Empty embedding response')
  if (typeof data[0] === 'number') return data as number[]
  if (Array.isArray(data[0])) {
    const inner = data[0] as unknown[]
    if (typeof inner[0] === 'number') return inner as number[]
    if (Array.isArray(inner[0])) return meanPool(inner as number[][])
  }
  throw new Error(`Unknown embedding shape: ${JSON.stringify(data).slice(0, 80)}`)
}

async function embedText(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text }),
      signal: AbortSignal.timeout(20_000),
    })
    const body = await res.json()

    if (res.status === 503 && body?.error?.includes('loading')) {
      const wait = Math.min((body.estimated_time ?? 20) * 1000, 30_000)
      console.log(`  Model loading — waiting ${Math.round(wait / 1000)}s…`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (!res.ok) throw new Error(`HF ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
    return parseEmbedding(body)
  }
  throw new Error('Embedding failed after all retries')
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD

  if (!email || !password) {
    console.error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const { data: { session }, error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError || !session) { console.error('Sign-in failed:', authError?.message); process.exit(1) }

  const userId = session.user.id
  console.log(`Signed in as ${email} (${userId.substring(0, 8)}…)`)

  // Count tasks needing backfill
  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('embedding', null)

  if (!count) { console.log('No tasks need backfilling.'); return }
  console.log(`Found ${count} task(s) without embeddings. Processing in batches of ${BATCH_SIZE}…\n`)

  let offset = 0
  let embedded = 0
  let failed = 0

  while (true) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, description')
      .eq('user_id', userId)
      .is('embedding', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (!tasks || tasks.length === 0) break

    await Promise.all(tasks.map(async (task, i) => {
      const text = task.description ? `${task.title}. ${task.description.substring(0, 300)}` : task.title
      try {
        const vector = await embedText(text)
        const { error } = await supabase
          .from('tasks')
          .update({ embedding: toVectorLiteral(vector) })
          .eq('id', task.id)
          .eq('user_id', userId)

        if (error) throw error
        embedded++
        console.log(`  ✓ [${embedded + failed}/${count}] "${task.title.substring(0, 60)}"`)
      } catch (err) {
        failed++
        console.warn(`  ✗ [${embedded + failed}/${count}] "${task.title.substring(0, 60)}" — ${(err as Error).message}`)
      }
    }))

    offset += BATCH_SIZE
    if (offset < (count ?? 0)) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  console.log(`\nDone. ${embedded} embedded, ${failed} failed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
