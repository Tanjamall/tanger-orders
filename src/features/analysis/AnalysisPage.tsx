import { useMemo, useState, type ReactNode } from 'react'
import { ChartBar, CheckCircle, Coins, Cube, Package, Path, Receipt, TrendUp } from '@phosphor-icons/react'
import { analyticsRange, buildAnalytics, type AnalyticsPreset, type PeriodPoint } from '../../domain/analytics'
import { money, rangeLabel, type ConfirmationEmployee } from '../../domain/orders'
import type { Order, Product } from '../../types'

type AnalysisPageProps = {
  orders: Order[]
  products: Product[]
  employees: ConfirmationEmployee[]
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
  const visible = points.slice(-8)
  const peak = Math.max(1, ...visible.map((point) => Math.max(point.revenue, 0)))
  return <div className="analysis-bars" aria-label="Revenue over time">
    {visible.map((point) => <div key={point.key} title={`${point.label}: ${money(point.revenue)} revenue, ${money(point.profit)} profit`}><span><i style={{ height: `${Math.max(5, (Math.max(point.revenue, 0) / peak) * 100)}%` }} /></span><small>{point.label}</small></div>)}
  </div>
}

export function AnalysisPage({ orders, products, employees }: AnalysisPageProps) {
  const [preset, setPreset] = useState<AnalyticsPreset>('month')
  const range = useMemo(() => analyticsRange(preset), [preset])
  const analysis = useMemo(() => buildAnalytics(orders, products, employees, range), [orders, products, employees, range])
  const { totals } = analysis
  const deliveryShare = totals.revenue ? (totals.deliveryCost / totals.revenue) * 100 : 0
  const averageDelivery = totals.orders ? totals.deliveryCost / totals.orders : 0

  return <div className="analysis-page-content">
    <div className="quick-range analysis-range" aria-label="Analysis period">{presets.map((item) => <button key={item.value} className={preset === item.value ? 'selected' : ''} aria-pressed={preset === item.value} onClick={() => setPreset(item.value)}>{item.label}</button>)}</div>
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
      <header><div><span>Performance</span><h2>{preset === 'all' || preset === '90d' ? 'Monthly trend' : 'Sales days'}</h2></div><strong>{money(totals.revenue)}</strong></header>
      <MiniBars points={preset === 'all' || preset === '90d' ? analysis.months : analysis.days} />
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
      {analysis.products.slice(0, 6).map((product, index) => <article key={product.id}><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{product.name}</strong><p>{product.units} units · {product.orders} orders · {product.margin.toFixed(1)}% margin</p></div><span><strong>{money(product.profit)}</strong><small>{money(product.revenue)} sales</small></span></article>)}
      {!analysis.products.length && <p className="analysis-empty">No delivered products in this period.</p>}
    </section>

    <section className="analysis-section timing-insights">
      <header><div><span>Timing</span><h2>When you perform best</h2></div><ChartBar /></header>
      <div className="timing-row"><span>Best sales day</span><strong>{analysis.bestDay?.label ?? 'No data'}</strong><small>{analysis.bestDay ? money(analysis.bestDay.profit) : 'Profit'}</small></div>
      <div className="timing-row"><span>Best weekday</span><strong>{analysis.bestWeekday?.label ?? 'No data'}</strong><small>{analysis.bestWeekday ? `${analysis.bestWeekday.orders} orders` : 'Orders'}</small></div>
      <div className="timing-row"><span>Best month</span><strong>{analysis.bestMonth?.label ?? 'No data'}</strong><small>{analysis.bestMonth ? money(analysis.bestMonth.profit) : 'Profit'}</small></div>
    </section>
  </div>
}
