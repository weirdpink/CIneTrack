import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { activityByMonth, type Entry } from '../lib/library'
import { SectionHead } from './ui'

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const count = payload[0]?.value ?? 0
  return (
    <div className="border border-border bg-background px-3.5 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.22)]">
      <div className="font-display text-[26px] leading-none tabular-nums">{count}</div>
      <div className="rule-label mt-1.5">
        {label} · {count === 1 ? 'title' : 'titles'}
      </div>
    </div>
  )
}

function MonthDot(props: { cx?: number; cy?: number; value?: number }) {
  const { cx, cy, value } = props
  if (cx == null || cy == null || !value) return <g />
  return <circle cx={cx} cy={cy} r={3} fill="var(--background)" stroke="var(--primary)" strokeWidth={2} />
}

/** Lazily loaded by Home so the d3/recharts chunk never blocks first paint. */
export default function MonthlyChart({ entries }: { entries: Entry[] }) {
  const chart = useMemo(() => activityByMonth(entries, 12), [entries])
  const busiest = useMemo(
    () => chart.reduce((a, b) => (b.count > a.count ? b : a), chart[0] ?? { count: 0, label: '' }),
    [chart],
  )
  const total = useMemo(() => chart.reduce((s, m) => s + m.count, 0), [chart])
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <section>
      <SectionHead
        title="Monthly log"
        note="Completed titles in each of the trailing twelve months."
        rule={false}
        right={
          busiest?.count ? (
            <span className="rule-label">
              Busiest · {busiest.label} — {busiest.count} titles
            </span>
          ) : undefined
        }
      />
      <div className="w-full border border-border bg-card px-2 pb-2 pt-4">
        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <p className="rule-label">No completions in the last 12 months</p>
            <p className="text-[12px] text-muted-foreground">Finished movies and series will chart here.</p>
          </div>
        ) : (
          <div
            role="img"
            aria-label={`Completions per month. ${total} total. Busiest month ${busiest.label} with ${busiest.count}.`}
          >
            <ResponsiveContainer width="100%" height={220} minWidth={0} minHeight={220} debounce={50}>
              <AreaChart data={chart} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="monthlyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
                <XAxis
                  dataKey="label"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                  fontFamily="var(--font-mono)"
                />
                <YAxis hide domain={[0, 'auto']} />
                <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--primary)', strokeOpacity: 0.35 }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#monthlyFill)"
                  dot={<MonthDot />}
                  activeDot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--background)', strokeWidth: 2 }}
                  isAnimationActive={!reduceMotion}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  )
}
