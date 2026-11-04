import { describe, expect, it } from 'vitest'
import type { Category, Tag } from './api'
import { parseQuickAdd } from './quickAdd'

const tags: Tag[] = [{ id: 1, name: 'home', color: '#000000', taskCount: 0 }, { id: 2, name: 'Work', color: '#000000', taskCount: 0 }]
const categories: Category[] = [{ id: 5, name: 'Finance', color: '#000000', taskCount: 0 }, { id: 6, name: 'Side Project', color: '#000000', taskCount: 0 }]
// 2026-10-21 is a Wednesday
const ctx = { tags, categories, today: '2026-10-21' }
const parse = (s: string) => parseQuickAdd(s, ctx)

describe('parseQuickAdd', () => {
  it('leaves an ordinary sentence untouched', () => {
    const r = parse('Buy milk and eggs')
    expect(r.title).toBe('Buy milk and eggs')
    expect(r.dueDate).toBeNull()
    expect(r.priority).toBeNull()
    expect(r.summary).toEqual([])
  })

  it('understands priority, tag, category, date and time together', () => {
    const r = parse('Pay rent tomorrow at 9am !high #home @Finance')
    expect(r).toMatchObject({ title: 'Pay rent', priority: 'High', dueDate: '2026-10-22', dueTime: '09:00', categoryId: 5, tagIds: [1] })
  })

  it('handles am/pm edge cases', () => {
    expect(parse('x at 12am').dueTime).toBe('00:00')
    expect(parse('x at 12pm').dueTime).toBe('12:00')
    expect(parse('x 5:30pm').dueTime).toBe('17:30')
    expect(parse('x at 17:45').dueTime).toBe('17:45')
  })

  it('does not treat bare numbers or impossible times as times', () => {
    expect(parse('Read chapter 12').title).toBe('Read chapter 12')
    expect(parse('x at 13pm').title).toContain('13pm')
    expect(parse('x 25:00').dueTime).toBeNull()
  })

  it('resolves weekday names to the next such day, never today', () => {
    expect(parse('Gym friday').dueDate).toBe('2026-10-23')
    expect(parse('Review wed').dueDate).toBe('2026-10-28')
    expect(parse('Call monday').dueDate).toBe('2026-10-26')
  })

  it('understands relative dates', () => {
    expect(parse('a next week').dueDate).toBe('2026-10-28')
    expect(parse('a in 3 days').dueDate).toBe('2026-10-24')
    expect(parse('a in 2 weeks').dueDate).toBe('2026-11-04')
    expect(parse('a 2026-12-31').dueDate).toBe('2026-12-31')
    expect(parse('a today').dueDate).toBe('2026-10-21')
  })

  it('ignores unknown tags and categories (they stay in the title)', () => {
    const r = parse('Plan #nope @Nowhere')
    expect(r.title).toBe('Plan #nope @Nowhere')
    expect(r.tagIds).toEqual([])
    expect(r.categoryId).toBeNull()
  })

  it('matches tags case-insensitively and categories with underscores for spaces', () => {
    const r = parse('Ship #work @side_project')
    expect(r.tagIds).toEqual([2])
    expect(r.categoryId).toBe(6)
  })

  it('parses estimates', () => {
    expect(parse('Write ~45m').estimatedMinutes).toBe(45)
    expect(parse('Write ~2h').estimatedMinutes).toBe(120)
  })

  it('parses recurrence', () => {
    expect(parse('Water plants daily').recurrence).toEqual({ frequency: 'Daily', interval: 1 })
    expect(parse('Pay rent every month').recurrence).toEqual({ frequency: 'Monthly', interval: 1 })
    expect(parse('Backup every 2 weeks').recurrence).toEqual({ frequency: 'Weekly', interval: 2 })
    expect(parse('Standup every weekday').recurrence).toEqual({ frequency: 'Weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] })
    const mon = parse('Gym every monday')
    expect(mon.recurrence).toEqual({ frequency: 'Weekly', interval: 1, weekdays: [1] })
    expect(mon.dueDate).toBe('2026-10-21')   // a repeat with no date starts today
    expect(mon.title).toBe('Gym')
  })

  it('a bare "every" with nothing after it stays in the title', () => {
    expect(parse('Do every thing').recurrence).toBeNull()
  })

  it('returns an empty title when only metadata was typed', () => {
    expect(parse('tomorrow !high').title).toBe('')
  })
})
