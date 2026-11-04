import { describe, expect, it } from 'vitest'
import { makeTask } from './testing/fakeServer'
import { applyFilters, emptyFilters, filterTasks, matchesQuery, sortTasks } from './taskFilters'

const today = '2026-10-21'
const tasks = [
  makeTask({ id: 1, title: 'Late', dueDate: '2026-10-19', priority: 'High' }),
  makeTask({ id: 2, title: 'Now', dueDate: today, priority: 'Low' }),
  makeTask({ id: 3, title: 'Later', dueDate: '2026-11-01', priority: 'Urgent' }),
  makeTask({ id: 4, title: 'Loose', priority: 'Medium' }),
  makeTask({ id: 5, title: 'Done thing', isCompleted: true, status: 'Done', dueDate: '2026-10-01' }),
  makeTask({ id: 6, title: 'Cat task', categoryId: 3, categoryName: 'Work', tags: [{ id: 1, name: 'deep', color: '#000000' }] }),
]
const ids = (l: ReturnType<typeof filterTasks>) => l.map((t) => t.id)

describe('filterTasks', () => {
  it('implements every view like the server does', () => {
    expect(ids(filterTasks(tasks, { ...emptyFilters, view: 'overdue' }, today))).toEqual([1])
    expect(ids(filterTasks(tasks, { ...emptyFilters, view: 'today' }, today))).toEqual([2])
    expect(ids(filterTasks(tasks, { ...emptyFilters, view: 'upcoming' }, today))).toEqual([3])
    expect(ids(filterTasks(tasks, { ...emptyFilters, view: 'inbox' }, today))).toEqual([4])
    expect(ids(filterTasks(tasks, { ...emptyFilters, view: 'completed' }, today))).toEqual([5])
    expect(ids(filterTasks(tasks, { ...emptyFilters, view: 'active' }, today))).toEqual([1, 2, 3, 4, 6])
  })

  it('combines criteria', () => {
    expect(ids(filterTasks(tasks, { ...emptyFilters, priorities: ['High', 'Urgent'] }, today))).toEqual([1, 3])
    expect(ids(filterTasks(tasks, { ...emptyFilters, categoryId: 3 }, today))).toEqual([6])
    expect(ids(filterTasks(tasks, { ...emptyFilters, tagIds: [1] }, today))).toEqual([6])
    expect(ids(filterTasks(tasks, { ...emptyFilters, priorities: ['High'], view: 'overdue' }, today))).toEqual([1])
  })
})

describe('matchesQuery', () => {
  const t = makeTask({ id: 1, title: 'Plan trip', notes: 'book flights', tags: [{ id: 1, name: 'Travel', color: '#000000' }], categoryName: 'Life' })
  it('ANDs words across fields, case-insensitively', () => {
    expect(matchesQuery(t, 'plan flights')).toBe(true)
    expect(matchesQuery(t, 'PLAN life')).toBe(true)
    expect(matchesQuery(t, 'plan hotel')).toBe(false)
    expect(matchesQuery(t, '')).toBe(true)
  })
  it('#tag must equal a tag name', () => {
    expect(matchesQuery(t, '#travel')).toBe(true)
    expect(matchesQuery(t, '#trav')).toBe(false)
  })
  it('searches subtasks', () => {
    const s = makeTask({ id: 2, title: 'x', subtasks: [{ id: 1, taskId: 2, title: 'call bank', isCompleted: false, sortOrder: 0, createdAt: '', completedAt: null }] })
    expect(matchesQuery(s, 'bank')).toBe(true)
  })
})

describe('sortTasks', () => {
  it('sorts by priority (Urgent first), due (undated last) and title', () => {
    expect(sortTasks(tasks, 'priority', false).map((t) => t.priority).slice(0, 3)).toEqual(['Urgent', 'High', 'Medium'])
    expect(sortTasks(tasks, 'due', false).map((t) => t.id).slice(0, 3)).toEqual([5, 1, 2])
    expect(sortTasks(tasks, 'due', false).slice(-2).map((t) => t.id)).toEqual([4, 6])
    expect(sortTasks(tasks, 'title', false)[0].title).toBe('Cat task')
  })
  it('pinned first by default', () => {
    const pinned = [...tasks.slice(0, 2), makeTask({ id: 9, title: 'Zzz', isPinned: true })]
    expect(applyFilters(pinned, { ...emptyFilters, sort: 'title' }, today)[0].id).toBe(9)
    expect(sortTasks(pinned, 'title', false)[0].id).toBe(1)
  })
})
