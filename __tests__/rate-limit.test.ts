import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the in-memory rate limiter directly — no DB, no mocking needed
import { checkTranscribeRateLimit } from '@/lib/rate-limit'

describe('checkTranscribeRateLimit', () => {
  beforeEach(() => {
    // Reset module between tests so the in-memory Map starts empty
    vi.resetModules()
  })

  it('allows the first request', async () => {
    const { checkTranscribeRateLimit: fn } = await import('@/lib/rate-limit')
    const result = fn('user-1')
    expect(result.allowed).toBe(true)
  })

  it('allows requests up to the limit', async () => {
    const { checkTranscribeRateLimit: fn } = await import('@/lib/rate-limit')
    const LIMIT = 30
    for (let i = 0; i < LIMIT; i++) {
      const result = fn('user-2')
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks the request after the limit is exceeded', async () => {
    const { checkTranscribeRateLimit: fn } = await import('@/lib/rate-limit')
    const LIMIT = 30
    for (let i = 0; i < LIMIT; i++) fn('user-3')
    const result = fn('user-3')
    expect(result.allowed).toBe(false)
    expect(result.resetInSeconds).toBeGreaterThan(0)
  })

  it('counts independently per user', async () => {
    const { checkTranscribeRateLimit: fn } = await import('@/lib/rate-limit')
    const LIMIT = 30
    for (let i = 0; i < LIMIT; i++) fn('user-a')
    // user-a is blocked, user-b is not
    expect(fn('user-a').allowed).toBe(false)
    expect(fn('user-b').allowed).toBe(true)
  })
})
