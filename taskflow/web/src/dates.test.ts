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
