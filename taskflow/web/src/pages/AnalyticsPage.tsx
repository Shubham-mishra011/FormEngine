import { useEffect, useRef, useState } from 'react'
import { api, type Analytics } from '../api'
import { formatDuration, shortDate } from '../format'

const RANGES = [7, 30, 90] as const

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  )
}

interface Point {
  key: string
  label: string
  created: number
  completed: number
}

/**
 * Completed-per-period bars with created-per-period as a line. Plain SVG, no chart library.
 * Every bar has a tooltip, and the figure has a text summary plus a table alternative,
 * so nothing is conveyed by colour alone.
 */
function TrendChart({
  points,
  unit,
  regionName,
  tableSummary,
}: {
  points: Point[]
  unit: 'day' | 'week' | 'month'
  regionName: string
  tableSummary: string
}) {
  const W = 640
  const H = 200
  const pad = { l: 28, r: 8, t: 8, b: 22 }
  const max = Math.max(1, ...points.map((d) => Math.max(d.completed, d.created)))
  const niceMax = max <= 4 ? max : Math.ceil(max / 2) * 2
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const step = innerW / points.length
  const barW = Math.max(2, step * 0.62)
  const y = (v: number) => pad.t + innerH - (v / niceMax) * innerH
  const x = (i: number) => pad.l + i * step + step / 2
  const line = points.map((d, i) => `${x(i).toFixed(1)},${y(d.created).toFixed(1)}`).join(' ')
  const scroller = useRef<HTMLDivElement>(null)
  // On narrow screens the chart scrolls sideways; start at the newest period, which is what people look at.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [points])
  const totalDone = points.reduce((n, d) => n + d.completed, 0)
  const peak = points.reduce((a, d) => (d.completed > a.completed ? d : a), points[0])
  const label = `Tasks completed per ${unit} over the last ${points.length} ${unit}s: ${totalDone} in total${
    peak.completed > 0 ? `, most ${unit === 'day' ? 'on' : 'in'} ${peak.label} (${peak.completed})` : ''
  }.`
  const ticks = [0, Math.round(niceMax / 2), niceMax].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <figure className="chart">
      {/* Scales uniformly (no distorted text); on narrow screens it scrolls sideways instead of shrinking. */}
      <div ref={scroller} className="chart-scroll" tabIndex={0} role="region" aria-label={`${regionName} (scrollable)`}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
                {t}
              </text>
            </g>
          ))}
          {points.map((d, i) => (
            <rect
              key={d.key}
              x={x(i) - barW / 2}
              y={y(d.completed)}
              width={barW}
              height={Math.max(0, pad.t + innerH - y(d.completed))}
              className="bar"
              rx="2"
            >
              <title>{`${d.label}: ${d.completed} completed, ${d.created} created`}</title>
            </rect>
          ))}
          <polyline points={line} className="created-line" fill="none" />
          <text x={pad.l} y={H - 6} className="axis">
            {points[0].label}
          </text>
          <text x={W - pad.r} y={H - 6} textAnchor="end" className="axis">
            {points[points.length - 1].label}
          </text>
        </svg>
      </div>
      <figcaption className="legend">
        <span>
          <i className="swatch bar-swatch" /> Completed
        </span>
        <span>
          <i className="swatch line-swatch" /> Created
        </span>
      </figcaption>
      <details>
        <summary>{tableSummary}</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{unit === 'day' ? 'Date' : unit === 'week' ? 'Week starting' : 'Month'}</th>
              <th scope="col">Created</th>
              <th scope="col">Completed</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.label}</th>
                <td>{d.created}</td>
                <td>{d.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function SplitBars({
  rows,
  caption,
}: {
  rows: { key: string; name: string; color?: string | null; total: number; completed: number }[]
  caption: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <ul className="split" aria-label={caption}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="split-head">
            <span className="split-name">
              {r.color && <i className="dot" style={{ background: r.color }} />}
              {r.name}
            </span>
            <span className="split-num">
              {r.completed}/{r.total} done
            </span>
          </div>
          <div
            className="split-track"
            role="img"
            aria-label={`${r.name}: ${r.completed} of ${r.total} completed`}
            style={{ width: `${(r.total / max) * 100}%` }}
          >
            <span className="split-done" style={{ width: r.total === 0 ? 0 : `${(r.completed / r.total) * 100}%`, background: r.color ?? undefined }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function AnalyticsPage() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bumping this re-runs the load (Retry)

  useEffect(() => {
    let cancelled = false
    api
      .analytics(days)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load analytics.')
      })
    return () => {
      cancelled = true
    }
  }, [days, attempt])

  if (error)
    return (
      <p className="banner" role="alert">
        <span>{error}</span>
        <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </p>
    )
  if (!data)
    return (
      <p className="empty-state" role="status">
        Loading analytics…
      </p>
    )

  const noStreakYet = !data.bestStreak

  return (
    <section className="analytics" aria-labelledby="analytics-h">
      <div className="page-head">
        <h2 id="analytics-h">Productivity</h2>
        <div className="range" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} aria-pressed={days === r} className={days === r ? 'on' : ''} onClick={() => setDays(r)}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      {data.total === 0 ? (
        <p className="empty-state" role="status">
          No tasks yet, so there is nothing to analyse. Add and complete a few tasks and your numbers will appear here.
        </p>
      ) : (
        <>
          <dl className="kpis">
            <Kpi label="Completed today" value={data.completedToday} hint={`${data.createdToday} created`} />
            <Kpi label="Completed this week" value={data.completedThisWeek} hint={`since ${shortDate(data.weekStart)} (Mon)`} />
            {data.completedThisMonth !== undefined && (
              <Kpi label="Completed this month" value={data.completedThisMonth} hint={`${data.createdThisMonth ?? 0} created`} />
            )}
            <Kpi label="Completion rate" value={`${Math.round(data.completionRate * 100)}%`} hint={`${data.completed} of ${data.total} tasks`} />
            <Kpi
              label="Avg. time to complete"
              value={formatDuration(data.averageHoursToComplete)}
              hint={data.averageHoursToComplete === null ? 'No completed tasks yet' : 'creation to completion'}
            />
            {data.currentStreak !== undefined && (
              <Kpi
                label="Current streak"
                value={noStreakYet ? '—' : plural(data.currentStreak, 'day')}
                hint={
                  noStreakYet
                    ? 'Complete a task to start a streak'
                    : data.currentStreak === 0
                      ? 'Complete a task today to start a new one'
                      : 'consecutive days with a completion'
                }
              />
            )}
            {data.bestStreak !== undefined && (
              <Kpi
                label="Best streak"
                value={noStreakYet ? '—' : plural(data.bestStreak, 'day')}
                hint={noStreakYet ? 'No completions recorded yet' : 'longest run so far'}
              />
            )}
            <Kpi label="Active" value={data.active} />
            <Kpi label="Overdue" value={data.overdue} />
          </dl>

          <h3>Completions over time</h3>
          <TrendChart
            points={data.daily.map((d) => ({ key: d.date, label: shortDate(d.date), created: d.created, completed: d.completed }))}
            unit="day"
            regionName="Completions chart"
            tableSummary="View the data as a table"
          />

          {data.weekly && data.weekly.length > 0 && (
            <>
              <h3>Weekly productivity</h3>
              <TrendChart
                points={data.weekly.map((w) => ({ key: w.start, label: w.label, created: w.created, completed: w.completed }))}
                unit="week"
                regionName="Weekly trend chart"
                tableSummary="View weekly data as a table"
              />
            </>
          )}
          {data.monthly && data.monthly.length > 0 && (
            <>
              <h3>Monthly productivity</h3>
              <TrendChart
                points={data.monthly.map((w) => ({ key: w.start, label: w.label, created: w.created, completed: w.completed }))}
                unit="month"
                regionName="Monthly trend chart"
                tableSummary="View monthly data as a table"
              />
            </>
          )}

          <div className="two-col">
            <div>
              <h3>By priority</h3>
              <SplitBars
                caption="Tasks by priority"
                rows={data.byPriority.map((p) => ({ key: p.priority, name: p.priority, total: p.total, completed: p.completed }))}
              />
            </div>
            <div>
              <h3>By category</h3>
              <SplitBars
                caption="Tasks by category"
                rows={data.byCategory.map((c) => ({
                  key: String(c.categoryId ?? 'none'),
                  name: c.name,
                  color: c.color,
                  total: c.total,
                  completed: c.completed,
                }))}
              />
            </div>
          </div>

          {data.overdueDetail && (
            <>
              <h3>Overdue tasks</h3>
              <div className="card" role="group" aria-label="Overdue statistics">
                {data.overdueDetail.count === 0 ? (
                  <p className="hint">Nothing is overdue.</p>
                ) : (
                  <>
                    <p>
                      <strong>{plural(data.overdueDetail.count, 'open task')}</strong>{' '}
                      {data.overdueDetail.count === 1 ? 'is' : 'are'} past due; the oldest is{' '}
                      <strong>{plural(data.overdueDetail.oldestDays, 'day')}</strong> late.
                    </p>
                    <ul className="overdue-split">
                      {data.overdueDetail.byPriority
                        .filter((p) => p.total > 0)
                        .map((p) => (
                          <li key={p.priority}>
                            <span className={`badge p-${p.priority.toLowerCase()}`}>{p.priority}</span> {p.total}
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
