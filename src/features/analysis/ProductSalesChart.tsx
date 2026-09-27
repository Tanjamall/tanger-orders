import { useMemo, useState } from 'react'
import { calendarSeries, type ProductEvent } from '../../domain/analytics'
import { eventDateKey, money } from '../../domain/orders'

export function ProductSalesChart({ history }: { history: ProductEvent[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const points = useMemo(() => {
    const days = new Map<string, { date: string; units: number; profit: number }>()
    for (const event of history) {
      if (event.label !== 'Sale') continue
      const date = eventDateKey(event.date)
      const point = days.get(date) ?? { date, units: 0, profit: 0 }
      point.units += event.quantity; point.profit += event.profit ?? 0; days.set(date, point)
    }
    const recorded = [...days.values()].sort((a,b) => a.date.localeCompare(b.date))
    const monthly = recorded.length > 1 && Date.parse(recorded.at(-1)!.date) - Date.parse(recorded[0].date) > 120 * 86400000
    const grouped = new Map<string, {key:string;label:string;orders:number;revenue:number;profit:number}>()
    for (const point of recorded) {
      const key = monthly ? point.date.slice(0,7) : point.date
      const row = grouped.get(key) ?? {key,label:key,orders:0,revenue:0,profit:0}
      row.orders += point.units; row.profit += point.profit; grouped.set(key,row)
    }
    return calendarSeries([...grouped.values()],null,monthly ? 'months' : 'days').map(p=>({date:p.key,units:p.orders,profit:p.profit}))
  }, [history])
  const peak = Math.max(1,...points.map(p=>p.units))
  const x = (i: number) => 28 + (points.length > 1 ? i/(points.length-1) : .5)*340
  const y = (units: number) => 142 - units/peak*112
  const active = selected === null ? null : points[Math.min(selected,points.length-1)]
  return <section className="product-sales-chart"><h3>{points[0]?.date.length === 7 ? 'Monthly sales (units)' : 'Daily sales (units)'}</h3>{points.length ? <><svg viewBox="0 0 390 178" className="growth-chart" role="img" tabIndex={0} aria-label="Product daily sales. Use arrow keys to explore." onKeyDown={e=>{ if(e.key==='Escape')setSelected(null); if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setSelected(Math.max(0,Math.min(points.length-1,(selected??-1)+(e.key==='ArrowRight'?1:-1))))} }} onPointerMove={e=>{const box=e.currentTarget.getBoundingClientRect();setSelected(Math.max(0,Math.min(points.length-1,Math.round(((e.clientX-box.left)/box.width*390-28)/340*(points.length-1)))))}}>{[0,.5,1].map(t=><g key={t}><line x1="28" x2="368" y1={y(peak*t)} y2={y(peak*t)} className="chart-grid"/><text x="20" y={y(peak*t)+4} textAnchor="end">{(peak*t).toLocaleString('en-GB',{maximumFractionDigits:1})}</text></g>)}<path d={points.map((p,i)=>`${i?'L':'M'}${x(i)},${y(p.units)}`).join(' ')} className="chart-current"/>{points.map((p,i)=><circle key={p.date} cx={x(i)} cy={y(p.units)} r="3.5" className="chart-dot"/>)}<text x="28" y="169">{points[0].date.slice(5)}</text>{points.length>1&&<text x="368" y="169" textAnchor="end">{points.at(-1)!.date.slice(5)}</text>}</svg><p className="growth-note" aria-live="polite">{active ? `${active.date} · ${active.units} units · ${money(active.profit)} profit` : 'Zero-sales dates included · hover or use arrow keys'}</p></> : <p className="analysis-empty">No delivered sales in these dates.</p>}</section>
}
