import { describe, it, expect } from 'vitest'

// Pure utility functions extracted from dashboard-content — tested without
// importing the React file (which would require a DOM environment).

function formatUserLabel(userEmail?: string) {
  if (!userEmail) return 'there'
  const local = userEmail.split('@')[0] || 'there'
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function shorten(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trim()}…`
}

describe('formatUserLabel', () => {
  it('returns "there" for undefined', () => {
    expect(formatUserLabel()).toBe('there')
  })

  it('capitalises a simple email prefix', () => {
    expect(formatUserLabel('ahmed@example.com')).toBe('Ahmed')
  })

  it('converts dots and underscores to spaces and title-cases each word', () => {
    expect(formatUserLabel('ahmed.the.butt@example.com')).toBe('Ahmed The Butt')
    expect(formatUserLabel('john_doe@example.com')).toBe('John Doe')
  })

  it('handles hyphens', () => {
    expect(formatUserLabel('mary-jane@example.com')).toBe('Mary Jane')
  })

  it('collapses multiple separators', () => {
    expect(formatUserLabel('a..b@example.com')).toBe('A B')
  })
})

describe('shorten', () => {
  it('returns the original string when within limit', () => {
    expect(shorten('hello', 10)).toBe('hello')
    expect(shorten('hello', 5)).toBe('hello')
  })

  it('truncates and appends ellipsis when over limit', () => {
    const result = shorten('hello world', 8)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBe(8)
  })

  it('trims trailing whitespace before the ellipsis', () => {
    // 'hello w ' is 8 chars; slice(0,7)='hello w', trim='hello w', but
    // we need the slice to land on a space. Use 'hello  x' (8), max=7:
    // slice(0,6)='hello ', trim='hello', +'…' → 'hello…'
    const result = shorten('hello  x', 7)
    expect(result).toBe('hello…')
  })
})

describe('applyFilter sort: due_date', () => {
  type Task = { id: string; due_date: string | null; priority: string; status: string }

  function applyFilter(tasks: Task[], sort: 'newest' | 'due_date' | 'priority'): Task[] {
    if (sort === 'due_date') {
      return [...tasks].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
    }
    if (sort === 'priority') {
      const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
      return [...tasks].sort((a, b) => rank[a.priority] - rank[b.priority])
    }
    return tasks
  }

  it('sorts by due_date ascending, nulls last', () => {
    const tasks: Task[] = [
      { id: 'c', due_date: null, priority: 'low', status: 'pending' },
      { id: 'a', due_date: '2026-06-01', priority: 'high', status: 'pending' },
      { id: 'b', due_date: '2026-05-15', priority: 'medium', status: 'pending' },
    ]
    const result = applyFilter(tasks, 'due_date')
    expect(result.map(t => t.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts by priority high → medium → low', () => {
    const tasks: Task[] = [
      { id: 'l', due_date: null, priority: 'low', status: 'pending' },
      { id: 'h', due_date: null, priority: 'high', status: 'pending' },
      { id: 'm', due_date: null, priority: 'medium', status: 'pending' },
    ]
    const result = applyFilter(tasks, 'priority')
    expect(result.map(t => t.id)).toEqual(['h', 'm', 'l'])
  })
})
