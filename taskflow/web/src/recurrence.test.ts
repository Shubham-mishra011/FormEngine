import { describe, expect, it } from 'vitest'
import { describeRecurrence, formatMonthDays, parseMonthDays } from './recurrence'

describe('describeRecurrence', () => {
  it('reads naturally', () => {
    expect(describeRecurrence({ frequency: 'Daily', interval: 1 })).toBe('Every day')
    expect(describeRecurrence({ frequency: 'Weekly', interval: 1 })).toBe('Every week')
    expect(describeRecurrence({ frequency: 'Daily', interval: 3 })).toBe('Every 3 days')
    expect(describeRecurrence({ frequency: 'Weekly', interval: 2, weekdays: [3, 1] })).toBe('Every 2 weeks on Mon, Wed')
    expect(describeRecurrence({ frequency: 'Monthly', interval: 1, monthDays: [15, 1, -1] })).toBe('Every month on the 1st, 15th, last day')
    expect(describeRecurrence({ frequency: 'Yearly', interval: 1, endDate: '2030-01-01', maxOccurrences: 5 })).toBe('Every year, until 2030-01-01, 5 times')
  })

  it('ordinals', () => {
    expect(describeRecurrence({ frequency: 'Monthly', interval: 1, monthDays: [2, 3, 11, 22, 31] })).toContain('2nd, 3rd, 11th, 22nd, 31st')
  })
})

describe('month day parsing', () => {
  it('parses lists and "last"', () => {
    expect(parseMonthDays('1, 15 last')).toEqual([1, 15, -1])
    expect(parseMonthDays('')).toEqual([])
    expect(parseMonthDays('15,15')).toEqual([15])
  })
  it('rejects bad input', () => {
    expect(parseMonthDays('32')).toBeNull()
    expect(parseMonthDays('0')).toBeNull()
    expect(parseMonthDays('abc')).toBeNull()
    expect(parseMonthDays('1.5')).toBeNull()
  })
  it('round-trips', () => {
    expect(formatMonthDays([1, 15, -1])).toBe('1, 15, last')
  })
})
