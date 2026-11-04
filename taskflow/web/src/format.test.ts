import { formatDuration, formatSize, shortDate } from './format'
import { parseRoute } from './useRoute'

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '1 min'],
    [0.5, '30 min'],
    [0.99, '59 min'],
    [1, '1.0 h'],
    [5, '5.0 h'],
    [47.9, '47.9 h'],
    [48, '2.0 days'],
    [72, '3.0 days'],
  ])('%s hours -> %s', (hours, text) => expect(formatDuration(hours)).toBe(text))
})

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [53248, '52.0 KB'],
    [1048576, '1.0 MB'],
  ])('%s bytes -> %s', (n, text) => expect(formatSize(n)).toBe(text))
})

describe('shortDate', () => {
  it('does not shift across time zones', () => {
    const text = shortDate('2026-10-21')
    expect(text).toMatch(/21/)
    expect(text).not.toMatch(/20|22/)
  })
})

describe('parseRoute', () => {
  it.each([
    ['', 'dashboard', null],
    ['#', 'dashboard', null],
    ['#/', 'dashboard', null],
    ['#/analytics', 'analytics', null],
    ['#analytics', 'analytics', null],
    ['#/calendar', 'calendar', null],
    ['#/settings/backup', 'settings', 'backup'],
    ['#/data', 'settings', 'backup'],
    ['#/unknown', 'dashboard', null],
    ['#/__proto__', 'dashboard', null],
    ['#/constructor', 'dashboard', null],
  ])('%s -> %s (%s)', (hash, route, param) => expect(parseRoute(hash)).toEqual({ route, param }))

  it('uses the supplied fallback for unknown hashes', () => {
    expect(parseRoute('', 'tasks').route).toBe('tasks')
    expect(parseRoute('#/nope', 'kanban').route).toBe('kanban')
  })
})
