import { useState } from 'react'
import { ArrowUpRight, MagnifyingGlass } from '@phosphor-icons/react'
import type { AnalyticsSnapshot, buildBusinessAnalytics } from '../../domain/analytics'
import { money } from '../../domain/orders'

const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : '—'
const amount = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 2 })
type Props = { page: 'overview' | 'products' | 'customers' | 'inventory' | 'about'; business: ReturnType<typeof buildBusinessAnalytics>; analysis: AnalyticsSnapshot; onProduct: (id: string) => void }

export function BusinessPanels({ page, business, onProduct }: Props) {
  const [query, setQuery] = useState('')
  const [stockFilter, setStockFilter] = useState('all')
  const [buyerFilter, setBuyerFilter] = useState('all')
  const buyers = business.buyers.filter(b => b.name.toLowerCase().includes(query.toLowerCase()) && (buyerFilter === 'all' || (buyerFilter === 'repeat' ? b.repeat : !b.repeat)))
  const inventory = business.inventory.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) && (stockFilter === 'all' || (stockFilter === 'low' ? p.low : p.stock > 0 && p.units === 0)))
  if (page === 'overview') {
    const delivered = business.statuses.find(s => s.status === 'Delivered')?.count ?? 0
    const rows = [['Delivered',delivered], ['Cancelled',business.canceled], ['In progress',business.cohortOrders-delivered-business.canceled]] as const
    return <section className="analysis-section growth-operations"><header><div><h2>Order outcomes</h2><p>Orders placed in selected period</p></div></header><div className="status-distribution">{rows.map(([label,count]) => <div key={label}><span>{label}</span><strong>{count}</strong><progress aria-label={label} max={Math.max(1,business.cohortOrders)} value={count} /><span>{percent(count,business.cohortOrders)}</span></div>)}</div></section>
  }
  return <>
    <section className="growth-kpis product-kpis" aria-label={page === 'customers' ? 'Customer metrics' : 'Inventory metrics'}>{(page === 'customers' ? [
      ['Identified buyers',String(business.buyers.length)], ['Repeat buyers',percent(business.repeatBuyers,business.buyers.length)], ['Revenue per buyer',money(business.buyers.length ? business.buyers.reduce((s,b)=>s+b.revenue,0)/business.buyers.length : 0)],
    ] : [['Stock at current cost',money(business.stockValue)], ['At / below threshold',`${business.lowStock} products`], ['Restocks in period',money(business.restockSpend)]]).map(([label,value]) => <article className="growth-metric" key={label}><strong>{value}</strong><span>{label}</span></article>)}</section>
    <section className="analysis-section report-records"><header><h2>{page === 'customers' ? 'Customers' : 'Inventory'}</h2><label className="growth-search"><MagnifyingGlass /><input type="search" aria-label={page === 'customers' ? 'Search customers' : 'Search inventory'} placeholder={page === 'customers' ? 'Search customers…' : 'Search inventory…'} value={query} onChange={e=>setQuery(e.target.value)} /></label></header>
    <div className="record-toolbar"><div className="growth-segments">{(page === 'customers' ? [['all','All buyers'],['repeat','Repeat buyers'],['first','First delivery']] : [['all','All products'],['low','Low stock'],['idle','No recent demand']]).map(([value,label]) => <button key={value} aria-pressed={(page === 'customers' ? buyerFilter : stockFilter) === value} onClick={()=>page === 'customers' ? setBuyerFilter(value) : setStockFilter(value)}>{label}</button>)}</div><span>{page === 'customers' ? `${buyers.length} customers · ranked by revenue` : `${inventory.length} products · current stock`}</span></div>
    <div className="growth-table-scroll"><table className="growth-table records-table"><thead><tr>{(page === 'customers' ? ['Customer','Delivered orders','Revenue (DH)','Profit (DH)','Avg. order (DH)','Relationship'] : ['Product','Available','30-day demand','Days of cover','Stock value (DH)','Attention']).map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{page === 'customers' ? buyers.map((buyer,index)=><tr key={index}><th scope="row"><bdi>{buyer.name}</bdi></th><td>{buyer.orders}</td><td>{amount(buyer.revenue)}</td><td className="profit-cell">{amount(buyer.profit)}</td><td>{amount(buyer.revenue/buyer.orders)}</td><td>{buyer.repeat ? 'Repeat buyer' : 'First delivery'}</td></tr>) : inventory.map(p=><tr key={p.id}><th scope="row"><button className="product-history-link" onClick={()=>onProduct(p.id)}><bdi>{p.name}</bdi><ArrowUpRight /></button>{p.bundle && <small className="bundle-label">Bundle</small>}</th><td>{p.stock}</td><td>{p.units}</td><td>{p.cover === null ? '—' : p.cover.toFixed(1)}</td><td>{p.bundle ? '—' : amount(p.value)}</td><td><span className={p.stock <= 0 || p.low ? 'growth-negative' : ''}>{p.stock <= 0 ? 'Out of stock' : p.low ? 'Low stock' : p.units === 0 ? 'No recent demand' : 'In stock'}</span></td></tr>)}</tbody></table></div>
    {!(page === 'customers' ? buyers.length : inventory.length) && <p className="analysis-empty">No {page === 'customers' ? 'customers' : 'products'} match this selection.</p>}
    <div className="report-explanation">{page === 'customers' ? <><h3>Understanding your customers</h3><p>Buyers are matched by normalized phone number. Repeat buyers have at least two lifetime deliveries by the end of the selected period. Revenue and profit above are for the selected period.</p><p>{business.missingPhones} deliveries excluded because no usable phone number was recorded.</p></> : <><h3>Planning your next restock</h3><p>Stock and days of cover reflect today. Cover uses average daily demand over the last 30 days, including bundle components. Stock value uses current catalog costs and excludes bundles to avoid double counting.</p><p>{business.idleStock} stocked products have no recent demand. {business.restockUnits} units were received in the selected period. Restock purchases are not deducted again from order profit.</p></>}</div>
    </section>
  </>
}
