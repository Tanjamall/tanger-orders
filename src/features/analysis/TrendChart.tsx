import { useMemo, useState } from 'react'
import { calendarSeries, type AnalyticsSnapshot } from '../../domain/analytics'
import { money, type DateRange } from '../../domain/orders'

export function TrendChart({ analysis, previous, range, previousRange }: { analysis: AnalyticsSnapshot; previous: AnalyticsSnapshot | null; range: DateRange | null; previousRange: DateRange | null }) {
  const [metric, setMetric] = useState<'revenue' | 'profit' | 'orders'>('revenue')
  const [group, setGroup] = useState<'days' | 'months'>('days')
  const [selected, setSelected] = useState<number | null>(null)
  const longRange = range ? Date.parse(range.end) - Date.parse(range.start) > 120 * 86400000 : analysis.days.length > 120 || (analysis.days.length > 1 && Date.parse(analysis.days.at(-1)!.key) - Date.parse(analysis.days[0].key) > 120 * 86400000)
  const grouping = longRange ? 'months' : group
  const points = useMemo(() => calendarSeries(analysis[grouping], range, grouping), [analysis, range, grouping])
  const prior = useMemo(() => previous ? calendarSeries(previous[grouping], previousRange, grouping) : [], [previous, previousRange, grouping])
  const values = [...points, ...prior].map(point => point[metric])
  const low = Math.min(0, ...values)
  const high = metric === 'orders' ? Math.max(4, Math.ceil(Math.max(0, ...values) / 4) * 4) : Math.max(1, ...values)
  const x = (i: number, length = points.length) => 62 + (length > 1 ? i / (length - 1) : 0.5) * 710
  const y = (value: number) => 222 - (value - low) / (high - low) * 196
  const line = (data: typeof points) => data.map((point, index) => `${index ? 'L' : 'M'}${x(index, data.length)},${y(point[metric])}`).join(' ')
  const activeIndex = selected === null ? null : Math.min(selected, points.length - 1)
  const active = activeIndex === null ? null : points[activeIndex]
  const format = (value: number) => metric === 'orders' ? String(Math.round(value)) : money(value)
  const labels = [...new Set([0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2), Math.floor((points.length - 1) * 3 / 4), points.length - 1])].filter(i => i >= 0)
  return <section className="analysis-section growth-trend" id="sales-trend">
    <header><div><span>01 / Performance over time</span><h2>The shape of your business</h2></div><label className="growth-select">Group by<select aria-label="Chart grouping" value={grouping} disabled={longRange} onChange={event => { setGroup(event.target.value as typeof group); setSelected(null) }}><option value="days">Day</option><option value="months">Month</option></select></label></header>
    <div className="trend-controls"><div className="growth-segments" aria-label="Chart metric">{(['revenue', 'profit', 'orders'] as const).map(key => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{key === 'profit' ? 'Order profit' : key === 'orders' ? 'Delivered orders' : 'Revenue'}</button>)}</div><div className="trend-legend"><span><i />Selected period</span>{previous && <span><i className="prior" />Previous period</span>}</div></div>
    <div className="trend-readout" aria-live="polite">{active ? <><b>{active.label}</b><strong>{money(active.profit)} profit</strong><span>{money(active.revenue)} sales · {active.orders} orders</span><button onClick={() => setSelected(null)} aria-label="Dismiss chart details">×</button></> : <span>Hover, click, or focus the chart and use arrow keys to explore.</span>}</div>
    {points.length ? <svg className="growth-chart" viewBox="0 0 810 266" role="img" tabIndex={0} aria-label={`${metric} by ${grouping}. Use left and right arrows for details, Escape to dismiss.`} onKeyDown={event => { if (event.key === 'Escape') setSelected(null); if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setSelected(Math.max(0, Math.min(points.length - 1, (activeIndex ?? -1) + (event.key === 'ArrowRight' ? 1 : -1)))) } }} onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); const position = (event.clientX - box.left) / box.width * 810; setSelected(Math.max(0, Math.min(points.length - 1, Math.round((position - 62) / 710 * (points.length - 1))))) }} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setSelected(Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - box.left) / box.width * 810 - 62) / 710 * (points.length - 1))))) }}>
      {[0, 1, 2, 3, 4].map(tick => { const value = low + (high - low) * tick / 4; return <g key={tick}><line x1="62" x2="772" y1={y(value)} y2={y(value)} className="chart-grid" /><text x="52" y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}</text></g> })}
      {low < 0 && <line x1="62" x2="772" y1={y(0)} y2={y(0)} className="chart-zero" />}
      <path d={`${line(points)} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="chart-area" />
      {prior.length > 0 && <path d={line(prior)} className="chart-previous" />}
      <path d={line(points)} className="chart-current" />
      {points.length === 1 && <circle cx={x(0)} cy={y(points[0][metric])} r="4" className="chart-dot" />}
      {active && activeIndex !== null && <g><line x1={x(activeIndex)} x2={x(activeIndex)} y1="20" y2="222" className="chart-cursor" /><circle cx={x(activeIndex)} cy={y(active[metric])} r="5" className="chart-dot" /><title>{active.label}: {format(active[metric])}</title></g>}
      {labels.map(index => <text key={index} x={x(index)} y="251" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{points[index].label}</text>)}
    </svg> : <p className="analysis-empty">Delivered orders will build this trend.</p>}
    <p className="growth-note">{metric === 'orders' ? 'Delivered orders' : 'DH'} · Zero-activity dates included.{longRange && ' Long ranges are grouped by month.'}{previous && (grouping === 'months' ? ' Monthly bins aligned by position; edge months may be partial.' : ' Previous period aligned from its first date.')}</p>
  </section>
}
