import { ArrowUpRight } from '@phosphor-icons/react'
import type { AnalyticsSnapshot, buildBusinessAnalytics } from '../../domain/analytics'
import { money } from '../../domain/orders'

const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : '—'
type Props = { page: 'overview' | 'products' | 'customers' | 'inventory' | 'about'; business: ReturnType<typeof buildBusinessAnalytics>; analysis: AnalyticsSnapshot; onProduct: (id: string) => void }

export function BusinessPanels({ page, business, analysis, onProduct }: Props) {
  return <>
    {page === 'overview' && <section className="analysis-section growth-operations">
      <header><div><span>04 / Delivery outcomes</span><h2>From order to doorstep</h2></div><b className="growth-badge">{business.successRate === null ? '—' : `${business.successRate.toFixed(1)}%`} success</b></header>
      <p className="growth-note">{business.cohortOrders} orders created in the selected period, shown by current status. Success = delivered ÷ closed orders.</p>
      <div className="status-distribution">{business.statuses.map(({ status, count }) => <div key={status}><span>{status}</span><div><i className={status === 'Canceled' ? 'is-canceled' : ''} style={{ width: `${business.cohortOrders ? count / business.cohortOrders * 100 : 0}%` }} /></div><strong>{count}</strong></div>)}</div>
      <div className="growth-small-stats"><div><span>Delivery time</span><b>{business.averageDeliveryDays === null ? '—' : `${business.averageDeliveryDays.toFixed(1)} days`}</b><small>{business.deliverySamples} selected deliveries with timestamps</small></div><div><span>Canceled / closed</span><b>{percent(business.canceled, business.closedOrders)}</b><small>{business.canceled} canceled orders</small></div></div>
      <div className="growth-callout"><b>Open now · all dates</b><p>{business.pipeline} orders worth {money(business.pipelineValue)} · {business.aging} waiting 7+ days.</p></div>
    </section>}
    {page === 'customers' && <section className="analysis-section growth-customers" id="customer-insights">
      <header><div><span>05 / Customer health</span><h2>Give them a reason to return</h2></div></header>
      <div className="growth-small-stats"><div><span>Identified buyers</span><b>{business.buyers.length}</b><small>Delivered orders in this period</small></div><div><span>Repeat buyers</span><b>{percent(business.repeatBuyers, business.buyers.length)}</b><small>{business.repeatBuyers} with 2+ lifetime deliveries by period end</small></div></div>
      <h3 className="growth-subheading">Top customers by period revenue</h3>
      {business.buyers.slice(0, 5).map((buyer, index) => <div className="growth-customer-row" key={index}><span className="buyer-rank">{String(index + 1).padStart(2, '0')}</span><div><b>{buyer.name}</b><small>{buyer.orders} orders · {buyer.repeat ? 'Repeat buyer' : 'First delivery'}</small></div><strong>{money(buyer.revenue)}</strong></div>)}
      {!business.buyers.length && <p className="analysis-empty">Delivered orders with phone numbers will build this report.</p>}
      <p className="growth-note">Matched by normalized phone number. {business.missingPhones} deliveries excluded because no usable number was recorded.</p>
    </section>}
    {page === 'overview' && <section className="analysis-section growth-payments">
      <header><div><span>06 / Payment collection</span><h2>Delivered is not always paid</h2></div></header>
      <div className="growth-ledger-line"><span>Marked paid</span><strong>{money(business.paid)}</strong></div><div className="growth-ledger-line"><span>Not marked paid</span><strong>{money(business.unpaid)}</strong></div>
      <div className="growth-callout"><b>{business.unpaidOrders} delivered orders to check</b><p>Includes “Unpaid” and “Pay on delivery”. Confirm collection and update their payment status.</p></div>
      <p className="growth-note">Uses selected delivery dates and current payment status. Payment dates and partial payments are not recorded, so this is not a cash-flow report.</p>
    </section>}
    {page === 'inventory' && <section className="analysis-section growth-inventory" id="inventory-health">
      <header><div><span>07 / Inventory health</span><h2>Keep your next sale in stock</h2></div><b className="growth-badge">Current snapshot</b></header>
      <div className="growth-small-stats inventory-stats"><div><span>Stock at current cost</span><b>{money(business.stockValue)}</b><small>Physical products only</small></div><div><span>At / below threshold</span><b>{business.lowStock} products</b><small>{business.idleStock} stocked products with no 30-day sales</small></div><div><span>Restocks in selected period</span><b>{money(business.restockSpend)}</b><small>{business.restockUnits} units received</small></div></div>
      <div className="growth-table-scroll inventory-scroll" tabIndex={0} role="region" aria-label="Inventory health table"><table className="growth-table"><thead><tr><th scope="col">Product</th><th scope="col">Available now</th><th scope="col">30-day demand</th><th scope="col">Days of cover</th><th scope="col">Attention</th></tr></thead><tbody>{business.inventory.map(p => <tr key={p.id}><th scope="row"><button className="product-history-link" onClick={() => onProduct(p.id)}>{p.name}{p.bundle && <small>Bundle</small>}<ArrowUpRight /></button></th><td>{p.stock}</td><td>{p.units}</td><td>{p.cover === null ? '—' : p.cover.toFixed(1)}</td><td><span className={`stock-signal ${p.stock <= 0 || p.low ? 'needs-attention' : ''}`}>{p.stock <= 0 ? 'Out of stock' : p.low ? 'Low stock' : p.units === 0 ? 'No recent demand' : 'In stock'}</span></td></tr>)}</tbody></table></div>
      {!business.inventory.length && <p className="analysis-empty">Add products to track stock health.</p>}
      <p className="growth-note">Stock and cover use today, independent of the date filter. Cover = available ÷ average daily demand over the last 30 days, including bundle components. An estimate, not a demand forecast. Stock value uses current costs; purchases are not deducted again from order profit.</p>
    </section>}
    {page === 'overview' && <section className="analysis-section growth-timing">
      <header><div><span>08 / Sales rhythm</span><h2>Find your strongest days</h2></div></header>
      <p className="growth-note">Total delivered profit by weekday in the selected period.</p>
      <div className="weekday-grid">{[1, 2, 3, 4, 5, 6, 0].map(day => { const point = analysis.weekdays.find(p => p.key === String(day)); const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const peak = Math.max(1, ...analysis.weekdays.map(p => Math.abs(p.profit))); return <div key={day}><span>{names[day]}</span><div><i className={(point?.profit ?? 0) < 0 ? 'is-negative' : ''} style={{ height: `${Math.abs(point?.profit ?? 0) / peak * 100}%` }} /></div><strong>{point ? money(point.profit) : '0 DH'}</strong><small>{point?.orders ?? 0} orders</small></div> })}</div>
      <div className="growth-small-stats"><div><span>Best date by profit</span><b>{analysis.bestDay?.key ?? '—'}</b><small>{analysis.bestDay ? money(analysis.bestDay.profit) : 'No deliveries'}</small></div><div><span>Best month by profit</span><b>{analysis.bestMonth?.label ?? '—'}</b><small>{analysis.bestMonth ? money(analysis.bestMonth.profit) : 'No deliveries'}</small></div></div>
      <p className="growth-note">Weekday totals are not normalized for the number of each weekday in the range. Red bars indicate losses.</p>
    </section>}
  </>
}
