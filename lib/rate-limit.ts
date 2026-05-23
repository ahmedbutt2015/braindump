import type { SupabaseClient } from '@supabase/supabase-js'

const DUMP_LIMIT_PER_HOUR = 20
const TRANSCRIBE_LIMIT_PER_HOUR = 30

// DB-backed: counts brain_dumps in the last hour.
// Works correctly in serverless — no shared memory needed.
export async function checkDumpRateLimit(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; resetInSeconds: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from('brain_dumps')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo)

  // Fail open — don't block the user if the DB query fails
  if (error) return { allowed: true, resetInSeconds: 0 }

  return {
    allowed: (count ?? 0) < DUMP_LIMIT_PER_HOUR,
    resetInSeconds: 3600,
  }
}

// In-memory sliding window for the transcribe endpoint.
// Resets on cold start, but protects against burst usage within a single invocation lifetime.
const transcribeWindows = new Map<string, { count: number; windowStart: number }>()

export function checkTranscribeRateLimit(userId: string): { allowed: boolean; resetInSeconds: number } {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000

  const entry = transcribeWindows.get(userId)

  if (!entry || now - entry.windowStart > windowMs) {
    transcribeWindows.set(userId, { count: 1, windowStart: now })
    return { allowed: true, resetInSeconds: 0 }
  }

  if (entry.count >= TRANSCRIBE_LIMIT_PER_HOUR) {
    const resetInSeconds = Math.ceil((windowMs - (now - entry.windowStart)) / 1000)
    return { allowed: false, resetInSeconds }
  }

  entry.count++
  return { allowed: true, resetInSeconds: 0 }
}
