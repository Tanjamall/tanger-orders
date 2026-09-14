import { useMemo, useState, type ReactNode } from 'react'
import { ChartBar, CheckCircle, Coins, Cube, Package, Path, Receipt, TrendUp } from '@phosphor-icons/react'
import { analyticsRange, buildAnalytics, productHistory, type AnalyticsPreset, type PeriodPoint } from '../../domain/analytics'
import { money, rangeLabel, type ConfirmationEmployee } from '../../domain/orders'
import type { InventoryBatch, Order, Product } from '../../types'

type AnalysisPageProps = {
  orders: Order[]
  products: Product[]
  employees: ConfirmationEmployee[]
  batches: InventoryBatch[]
}

const presets: { value: AnalyticsPreset; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
]

function Insight({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article className="analysis-insight"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>
}

function MiniBars({ points }: { points: PeriodPoint[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const visible = points
  const active = points.find((point) => point.key === selected)
  const peak = Math.max(1, ...visible.map((point) => Math.max(point.revenue, 0)))
  return <><div className="analysis-chart-detail" role="status">{active ? <><strong>{active.label} · {money(active.profit)} profit</strong><span>{money(active.revenue)} sales · {active.orders} orders</span><button aria-label="Dismiss profit details" onClick={() => setSelected(null)}>×</button></> : <span>Tap a bar for profit details. Scroll to see all dates.</span>}</div><div className="analysis-bars interactive-bars" aria-label="Revenue over time" onKeyDown={(event) => { if (event.key === 'Escape') setSelected(null) }}>
    {visible.map((point) => <button type="button" key={point.key} aria-pressed={selected === point.key} aria-label={`${point.label}: ${money(point.profit)} profit`} onClick={() => setSelected(selected === point.key ? null : point.key)}><span><i style={{ height: `${Math.max(5, (Math.max(point.revenue, 0) / peak) * 100)}%` }} /></span><small>{point.label}</small></button>)}
  </div></>
}

export function AnalysisPage({ orders, products, employees, batches }: AnalysisPageProps) {
  const [preset, setPreset] = useState<AnalyticsPreset | 'custom'>('month')
  const [custom, setCustom] = useState(() => analyticsRange('month')!)
  const [draft, setDraft] = useState(custom)
  const [productId, setProductId] = useState('')
  const [search, setSearch] = useState('')
  const [historyAll, setHistoryAll] = useState(true)
  const [group, setGroup] = useState<'days' | 'months'>('days')
  const range = useMemo(() => preset === 'custom' ? custom : analyticsRange(preset), [preset, custom])
  const history = useMemo(() => productHistory(productId, orders, products, employees, batches, historyAll ? null : range), [productId, orders, products, employees, batches, historyAll, range])
  const choices = useMemo(() => [...new Map([...products.map((p) => [p.id, p.name] as const), ...orders.flatMap((o) => o.items.filter((i) => !products.some((p) => p.id === i.productId)).map((i) => [i.productId, `Archived product ${i.productId.slice(0, 8)}`] as const))])].filter(([, name]) => name.toLowerCase().includes(search.toLowerCase())), [products, orders, search])
  const analysis = useMemo(() => buildAnalytics(orders, products, employees, range), [orders, products, employees, range])
  const { totals } = analysis
  const deliveryShare = totals.revenue ? (totals.deliveryCost / totals.revenue) * 100 : 0
  const averageDelivery = totals.orders ? totals.deliveryCost / totals.orders : 0

  return <div className="analysis-page-content">
    <div className="quick-range analysis-range" aria-label="Analysis period">{presets.map((item) => <button key={item.value} className={preset === item.value ? 'selected' : ''} aria-pressed={preset === item.value} onClick={() => setPreset(item.value)}>{item.label}</button>)}<button className={preset === 'custom' ? 'selected' : ''} aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>Custom</button></div>
    {preset === 'custom' && <form className="analysis-custom" onSubmit={(event) => { event.preventDefault(); if (draft.start && draft.end && draft.start <= draft.end) setCustom(draft) }}><label>From<input type="date" required value={draft.start} max={draft.end} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label><label>To<input type="date" required min={draft.start} value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label><button type="submit">Apply dates</button></form>}
    <p className="period-caption">{range ? rangeLabel(range) : 'All recorded activity'} · Financials use delivery date</p>

    <section className="analysis-hero">
      <div><span>Net profit</span><strong>{money(totals.profit)}</strong><p>{totals.margin.toFixed(1)}% margin from {totals.orders} delivered {totals.orders === 1 ? 'order' : 'orders'}</p></div>
      <TrendUp weight="duotone" />
    </section>

    <section className="analysis-kpis" aria-label="Key performance indicators">
      <Insight icon={<Coins />} label="Revenue" value={money(totals.revenue)} detail={`${money(totals.averageOrder)} average order`} />
      <Insight icon={<Receipt />} label="Total cost" value={money(totals.totalCost)} detail={`${totals.revenue ? ((totals.totalCost / totals.revenue) * 100).toFixed(1) : '0.0'}% of revenue`} />
      <Insight icon={<CheckCircle />} label="Fulfillment" value={`${analysis.fulfillmentRate.toFixed(0)}%`} detail={`${analysis.canceledOrders} canceled · ${analysis.pendingOrders} pending`} />
      <Insight icon={<Package />} label="Units sold" value={String(totals.units)} detail={`${totals.orders ? (totals.units / totals.orders).toFixed(1) : '0.0'} per order`} />
    </section>

    <section className="analysis-section analysis-trend">
      <header><div><span>Performance</span><h2>{group === 'months' ? 'Monthly trend' : 'Sales days'}</h2></div><select aria-label="Chart grouping" value={group} onChange={(event) => setGroup(event.target.value as 'days' | 'months')}><option value="days">Days</option><option value="months">Months</option></select></header>
      <MiniBars key={`${group}-${range?.start}-${range?.end}`} points={analysis[group]} />
      {!analysis.days.length && <p className="analysis-empty">Delivered orders will build this trend.</p>}
    </section>

    <section className="analysis-section cost-ledger">
      <header><div><span>Profit equation</span><h2>Where the money went</h2></div></header>
      <div><span>Sales revenue</span><strong>{money(totals.revenue)}</strong></div>
      <div><span><Cube />Product cost</span><strong>− {money(totals.productCost)}</strong></div>
      <div><span><Path />Delivery cost</span><strong>− {money(totals.deliveryCost)}</strong></div>
      <div><span>Confirmation bonuses</span><strong>− {money(totals.confirmationCost)}</strong></div>
      <div><span>Other expenses</span><strong>− {money(totals.otherCost)}</strong></div>
      <div className="cost-total"><span>Net profit</span><strong>{money(totals.profit)}</strong></div>
      <p>Delivery averages {money(averageDelivery)} per delivered order and uses {deliveryShare.toFixed(1)}% of revenue.</p>
    </section>

    <section className="analysis-section product-ranking">
      <header><div><span>Product performance</span><h2>Best performers</h2></div><small>Ranked by net profit</small></header>
      {analysis.products.map((product, index) => <article key={product.id}><b>{String(index + 1).padStart(2, '0')}</b><div><button className="product-history-link" onClick={() => { setProductId(product.id); setSearch(''); document.getElementById('product-history')?.scrollIntoView({ block: 'start' }) }}>{product.name} ↗</button><p>{product.units} units · {product.orders} orders · {product.margin.toFixed(1)}% margin</p></div><span><strong>{money(product.profit)}</strong><small>{money(product.revenue)} sales</small></span></article>)}
      {!analysis.products.length && <p className="analysis-empty">No delivered products in this period.</p>}
    </section>

    <section className="analysis-section product-history" id="product-history">
      <header><div><span>Explore</span><h2>Product history</h2></div></header>
      <label>Find a product<input type="search" placeholder="Search products" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <select aria-label="Product history" value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Choose a product</option>{choices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <label className="history-scope"><input type="checkbox" checked={historyAll} onChange={(event) => setHistoryAll(event.target.checked)} />Full history (all dates)</label>
      <p className="period-caption">{historyAll ? 'All recorded dates' : range ? rangeLabel(range) : 'All recorded dates'} · Sales use delivery date; stock uses receipt date.</p>
      {productId && <div className="history-events">{history.map((entry) => <article key={entry.id}><div><strong>{entry.label}</strong><small>{new Date(entry.date).toLocaleDateString()} · {entry.detail}</small></div><div><strong>{entry.quantity} units · {money(entry.amount)}</strong><small>{entry.profit === undefined ? entry.id.startsWith('batch-') ? 'Stock cost' : 'Order value' : `${money(entry.profit)} net profit`}</small></div></article>)}</div>}
      <p className="analysis-empty">{!productId ? 'Choose any product to see its sales, orders, and stock receipts.' : !history.length ? 'No recorded activity for this product in these dates.' : `${history.length} recorded events. Sale profit includes allocated delivery, bonus, and other costs.`}</p>
    </section>

    <section className="analysis-section timing-insights">
      <header><div><span>Timing</span><h2>When you perform best</h2></div><ChartBar /></header>
      <div className="timing-row"><span>Best sales day</span><strong>{analysis.bestDay?.label ?? 'No data'}</strong><small>{analysis.bestDay ? money(analysis.bestDay.profit) : 'Profit'}</small></div>
      <div className="timing-row"><span>Best weekday</span><strong>{analysis.bestWeekday?.label ?? 'No data'}</strong><small>{analysis.bestWeekday ? `${analysis.bestWeekday.orders} orders` : 'Orders'}</small></div>
      <div className="timing-row"><span>Best month</span><strong>{analysis.bestMonth?.label ?? 'No data'}</strong><small>{analysis.bestMonth ? money(analysis.bestMonth.profit) : 'Profit'}</small></div>
    </section>
  </div>
}
