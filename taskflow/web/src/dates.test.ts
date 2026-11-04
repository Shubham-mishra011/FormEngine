import { dueLabel, todayString } from './dates'

describe('dates', () => {
  it('formats local dates as yyyy-MM-dd', () => {
    expect(todayString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('labels relative days and flags overdue', () => {
    const today = '2026-03-10'
    expect(dueLabel('2026-03-10', today)).toEqual({ text: 'Today', overdue: false })
    expect(dueLabel('2026-03-11', today)).toEqual({ text: 'Tomorrow', overdue: false })
    expect(dueLabel('2026-03-09', today)).toEqual({ text: 'Yesterday', overdue: true })
    expect(dueLabel('2026-03-05', today)).toEqual({ text: '5 days overdue', overdue: true })
    expect(dueLabel('2026-03-20', today).overdue).toBe(false)
  })

  it('handles month and year boundaries', () => {
    expect(dueLabel('2026-02-28', '2026-03-01').text).toBe('Yesterday')
    expect(dueLabel('2027-01-01', '2026-12-31').text).toBe('Tomorrow')
  })
})

import { addDays, addMonths, clock, daysBetween, formatDate, formatMinutes, formatTime, monthGrid, startOfWeek, weekDays } from './dates'

describe('calendar arithmetic', () => {
  it('adds days across month and year ends without DST drift', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30)
  })
  it('adds months clamping to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
  it('finds the start of the week for either convention', () => {
    expect(startOfWeek('2026-10-21', 1)).toBe('2026-10-19') // Wed -> Mon
    expect(startOfWeek('2026-10-21', 0)).toBe('2026-10-18') // Wed -> Sun
    expect(startOfWeek('2026-10-18', 1)).toBe('2026-10-12') // Sun belongs to the previous Monday-week
    expect(weekDays('2026-10-21', 1)).toHaveLength(7)
  })
  it('builds a six-week month grid that contains the month', () => {
    const g = monthGrid('2026-10-21', 1)
    expect(g).toHaveLength(6)
    expect(g.every((w) => w.length === 7)).toBe(true)
    expect(g[0][0]).toBe('2026-09-28')
    expect(g.flat()).toContain('2026-10-31')
    expect(monthGrid('2026-02-10', 0)[0][0]).toBe('2026-02-01')
  })
})

describe('formatting', () => {
  it('formats dates by preference', () => {
    expect(formatDate('2026-10-21', 'iso')).toBe('2026-10-21')
    expect(formatDate('2026-10-21', 'dmy')).toBe('21 Oct')
    expect(formatDate('2026-10-21', 'mdy', true)).toBe('Oct 21, 2026')
  })
  it('formats times by preference', () => {
    expect(formatTime('14:05:00', '24h')).toBe('14:05')
    expect(formatTime('14:05:00', '12h')).toBe('2:05 PM')
    expect(formatTime('00:00:00', '12h')).toBe('12:00 AM')
    expect(formatTime('12:30:00', '12h')).toBe('12:30 PM')
  })
  it('formats durations and countdowns', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(90)).toBe('1h 30m')
    expect(formatMinutes(120)).toBe('2h')
    expect(clock(1500)).toBe('25:00')
    expect(clock(61)).toBe('01:01')
    expect(clock(-5)).toBe('00:00')
  })
})
