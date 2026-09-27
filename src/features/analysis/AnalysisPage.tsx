import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, DownloadSimple, CalendarBlank, CaretDown, MagnifyingGlass, X } from '@phosphor-icons/react'
import { analyticsChange, analyticsCsv, analyticsRange, buildAnalytics, buildBusinessAnalytics, previousAnalyticsRange, productHistory, type AnalyticsPreset } from '../../domain/analytics'
import { money, rangeLabel, type ConfirmationEmployee } from '../../domain/orders'
import type { InventoryBatch, Order, Product } from '../../types'
import { TrendChart } from './TrendChart'
import { ProductSalesChart } from './ProductSalesChart'
import { BusinessPanels } from './BusinessPanels'
import './analysis.css'

type AnalysisPageProps = { orders: Order[]; products: Product[]; employees: ConfirmationEmployee[]; batches: InventoryBatch[]; dataState?: 'ready' | 'loading' | 'error'; menu: ReactNode }
const presets: { value: AnalyticsPreset; label: string }[] = [{ value: 'month', label: 'This month' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' }]
type SortKey = 'name' | 'units' | 'orders' | 'revenue' | 'cost' | 'profit' | 'margin'
const reportPages = [['overview', 'Overview'], ['products', 'Products'], ['customers', 'Customers'], ['inventory', 'Inventory'], ['about', 'About']] as const
type ReportPage = typeof reportPages[number][0]
const pageFromLocation = (): ReportPage => reportPages.find(([page]) => window.location.hash === `#analysis/${page}`)?.[0] ?? 'overview'
export const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : '—'
const decimalMoney = (value: number) => `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })} DH`

function Metric({ label, value, current, previous, margin = false }: { label: string; value: string; current: number; previous?: number; margin?: boolean }) {
  const change = previous === undefined ? '' : margin ? `${current > previous ? '+' : ''}${(current - previous).toFixed(1)} pp` : analyticsChange(current, previous)
  return <article className="growth-metric"><strong>{value}</strong><span>{label}</span>{previous !== undefined && <small className={current < previous ? 'change-down' : 'change-up'} title="Compared with the previous period">{previous !== 0 && current !== previous && (current > previous ? <ArrowUp /> : <ArrowDown />)}{change}</small>}</article>
}
const amount = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 2 })

export function AnalysisPage({ orders, products, employees, batches, dataState = 'ready', menu }: AnalysisPageProps) {
  const [page, setPage] = useState<ReportPage>(pageFromLocation)
  useEffect(() => {
    const update = () => setPage(pageFromLocation())
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update) }
  }, [])
  useEffect(() => { document.querySelector('.ledger-scroll')?.scrollTo({ top: 0, behavior: 'instant' }) }, [page])
  function navigate(next: ReportPage) {
    if (next === page) return
    window.history.pushState(null, '', `#analysis/${next}`)
    setPage(next)
    if (next !== 'products') setProductId('')
  }
  const [preset, setPreset] = useState<AnalyticsPreset | 'custom'>('month')
  const [custom, setCustom] = useState(() => analyticsRange('month')!)
  const [draft, setDraft] = useState(custom)
  const [compare, setCompare] = useState(true)
  const [productId, setProductId] = useState('')
  const [search, setSearch] = useState('')
  const [activity, setActivity] = useState<'all' | 'sales' | 'restocks'>('all')
  const [dateOpen, setDateOpen] = useState(false)
  const [historyAll, setHistoryAll] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'profit', ascending: false })
  const [exported, setExported] = useState('')
  const range = useMemo(() => preset === 'custom' ? custom : analyticsRange(preset), [preset, custom])
  const comparisonRange = useMemo(() => compare ? previousAnalyticsRange(range) : null, [range, compare])
  const analysis = useMemo(() => buildAnalytics(orders, products, employees, range), [orders, products, employees, range])
  const previous = useMemo(() => comparisonRange ? buildAnalytics(orders, products, employees, comparisonRange) : null, [orders, products, employees, comparisonRange])
  const business = useMemo(() => buildBusinessAnalytics(orders, products, employees, batches, range), [orders, products, employees, batches, range])
  const history = useMemo(() => productHistory(productId, orders, products, employees, batches, historyAll ? null : range), [productId, orders, products, employees, batches, historyAll, range])
  const choices = useMemo(() => [...new Map([...products.map(p => [p.id, p.name] as const), ...orders.flatMap(o => o.items.filter(i => !products.some(p => p.id === i.productId)).map(i => [i.productId, `Archived product ${i.productId.slice(0, 8)}`] as const))])], [products, orders])
  const ranked = useMemo(() => analysis.products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const left = a[sort.key], right = b[sort.key]
    const result = typeof left === 'string' ? left.localeCompare(String(right)) : left - Number(right)
    return (sort.ascending ? 1 : -1) * result
  }), [analysis.products, sort, search])
  const { totals } = analysis
  const openHistory = (id: string) => {
    const closing = productId === id && page === 'products'
    setProductId(closing ? '' : id); setActivity('all'); navigate('products')
    if (!closing && window.matchMedia('(max-width:1099px)').matches) requestAnimationFrame(() => document.getElementById('product-history')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const closeHistory = () => { const id = productId; setProductId(''); requestAnimationFrame(() => document.getElementById(`product-row-${id}`)?.focus({ preventScroll: true })) }

  const selectedProduct = analysis.products.find(p => p.id === productId)
  const selectedName = choices.find(([id]) => id === productId)?.[1] ?? 'Product history'
  const events = history.filter(entry => activity === 'all' || (activity === 'sales' ? entry.label === 'Sale' : entry.label === 'Restock'))

  function exportReport() {
    const rows: (string | number)[][] = [
      ['Tanger Orders — business report'], ['Period', range?.start ?? 'All time', range?.end ?? 'All time'],
      ['Financial basis', 'Delivery date, Africa/Casablanca; missing delivery dates use creation date'],
      ['Profit basis', 'Revenue less recorded order costs; excludes unrecorded overhead, advertising, tax, returns and canceled-order costs'],
      ['Metric', 'Selected period', 'Previous period'],
      ...(['revenue', 'productCost', 'deliveryCost', 'confirmationCost', 'otherCost', 'totalCost', 'profit', 'margin', 'orders', 'units', 'averageOrder'] as const).map(key => [key, totals[key], previous?.totals[key] ?? 'Not compared']),
      ['Comparison dates', comparisonRange?.start ?? '', comparisonRange?.end ?? ''], [],
      ['Product', 'Units', 'Orders', 'Revenue DH', 'Allocated cost DH', 'Order profit DH', 'Margin %'],
      ...analysis.products.map(p => [p.name, p.units, p.orders, p.revenue, p.cost, p.profit, p.margin]), [],
      ['Delivery date', 'Revenue DH', 'Order profit DH', 'Delivered orders'], ...analysis.days.map(p => [p.key, p.revenue, p.profit, p.orders]), [],
      ['Cash on delivery', 'All delivered orders are paid'], [],
      ['Order creation cohort: current status', 'Count'], ...business.statuses.map(s => [s.status, s.count]), [],
      ['Customers with usable phone numbers', business.buyers.length], ['Repeat buyers by period end', business.repeatBuyers], ['Excluded deliveries: no usable phone', business.missingPhones], [],
      ['Inventory snapshot at export', new Date().toISOString()], ['Product', 'Available stock now', 'Units used last 30 days', 'Estimated days cover', 'Current cost value DH'],
      ...business.inventory.map(p => [p.name, p.stock, p.units, p.cover ?? 'No recent demand', p.value]),
      ['Stock value basis', 'Current product costs; bundles excluded from value'], ['Restock spend in selected period', business.restockSpend],
    ]
    const url = URL.createObjectURL(new Blob([analyticsCsv(rows)], { type: 'text/csv;charset=utf-8;' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `tanger-analysis-${range?.start ?? 'all'}-${range?.end ?? 'time'}.csv`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000); setExported('Report downloaded. Includes all products in the selected period.')
  }
  const costs = [['Product cost', totals.productCost], ['Delivery', totals.deliveryCost], ['Other order costs', totals.otherCost + totals.confirmationCost]] as const
  const rowButton = (p: { id: string; name: string }) => <button id={`product-row-${p.id}`} className="product-history-link" aria-expanded={productId === p.id} aria-controls={productId === p.id ? 'product-history' : undefined} onClick={() => openHistory(p.id)}><bdi>{p.name}</bdi><ArrowUpRight /></button>
  return <div className={`analysis-page-content growth-dashboard report-${page}`}>
    <header className="report-header"><div><h1>Analysis</h1><p>Your business at a glance.</p></div><div className="report-header-actions"><button className="report-date" onClick={() => { setDateOpen(!dateOpen); setDraft(range ?? custom) }} aria-expanded={dateOpen}><CalendarBlank /><span>{range ? rangeLabel(range) : 'All recorded activity'}</span><CaretDown /></button>{menu}</div></header>
    <div className="report-navigation">
      <nav className="growth-jumps" aria-label="Analytics sections">{reportPages.map(([value, label]) => <a key={value} href={`#analysis/${value}`} aria-current={page === value ? 'page' : undefined} onClick={event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(value) } }}>{label}</a>)}</nav>
      <div className="growth-toolbar"><div className="growth-segments analysis-range" aria-label="Analysis period">{presets.map(item => <button key={item.value} aria-pressed={preset === item.value} onClick={() => { setPreset(item.value); setDateOpen(false) }}>{item.label}</button>)}<button aria-pressed={preset === 'custom'} onClick={() => { setDateOpen(!dateOpen); setDraft(range ?? custom) }}>Custom dates</button></div><label className="compare-control"><input type="checkbox" checked={compare && !!range} disabled={!range} onChange={event => setCompare(event.target.checked)} />Compare previous period</label></div>
    </div>
    {dateOpen && <form className="analysis-custom" onSubmit={event => { event.preventDefault(); if (draft.start && draft.end && draft.start <= draft.end) { setCustom(draft); setPreset('custom'); setDateOpen(false) } }}><label>From<input type="date" required value={draft.start} max={draft.end} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label><label>To<input type="date" required min={draft.start} value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label><button type="submit">Apply dates</button><button type="button" onClick={() => setDateOpen(false)}>Cancel</button></form>}
    {dataState !== 'ready' && <p className="growth-data-status" role="status">{dataState === 'error' ? 'Some records could not refresh. These figures may be incomplete. Use Retry to load the full report.' : 'Loading workspace history. Figures may change as records arrive.'} Export is available when all records load.</p>}
    {(page === 'overview' || page === 'products') && <section className={`growth-kpis ${page === 'products' ? 'product-kpis' : ''}`} aria-label="Key performance indicators">
      <Metric label="Delivered revenue" value={money(totals.revenue)} current={totals.revenue} previous={page === 'overview' ? previous?.totals.revenue : undefined} />
      <Metric label="Order profit" value={money(totals.profit)} current={totals.profit} previous={page === 'overview' ? previous?.totals.profit : undefined} />
      {page === 'overview' && <Metric label="Delivered orders" value={String(totals.orders)} current={totals.orders} previous={previous?.totals.orders} />}
      <Metric label="Margin" value={`${totals.margin.toFixed(1)}%`} current={totals.margin} previous={page === 'overview' && previous?.totals.orders ? previous.totals.margin : undefined} margin />
    </section>}
    {page === 'overview' && <>
      <div className="overview-primary"><TrendChart key={`${range?.start}-${range?.end}`} analysis={analysis} previous={previous} range={range} previousRange={comparisonRange} />
      <section className="analysis-section growth-costs"><header><h2>Revenue to profit</h2></header><div className="cost-table" role="table" aria-label="Revenue to profit"><div className="cost-heading" role="row"><span role="columnheader">Item</span><span role="columnheader">Amount (DH)</span><span role="columnheader">Share</span><span /></div>{[['Delivered revenue', totals.revenue], ...costs, ['Order profit', totals.profit]].map(([label, raw], index) => { const value = Number(raw); return <div className={`cost-line ${index === 4 ? 'ledger-result' : ''}`} role="row" key={label}><span role="cell">{label}</span><strong role="cell">{index > 0 && index < 4 ? '−' : ''}{amount(value)}</strong><span role="cell">{percent(value, totals.revenue)}</span><progress aria-label={`${label} share`} max="100" value={totals.revenue ? Math.max(0, Math.min(100, value / totals.revenue * 100)) : 0} /></div> })}</div></section></div>
      <div className="overview-secondary"><section className="analysis-section leading-products"><header><h2>Leading products</h2><button className="report-link" onClick={() => navigate('products')}>View products <ArrowUpRight /></button></header><div className="growth-table-scroll"><table className="growth-table compact-table"><thead><tr><th>Product</th><th>Units</th><th>Revenue (DH)</th><th>Profit (DH)</th></tr></thead><tbody>{analysis.products.slice(0, 3).map(p => <tr key={p.id}><th scope="row">{rowButton(p)}</th><td>{p.units}</td><td>{amount(p.revenue)}</td><td>{amount(p.profit)}</td></tr>)}</tbody></table></div>{!analysis.products.length && <p className="analysis-empty">No delivered products in this period.</p>}</section><BusinessPanels page="overview" business={business} analysis={analysis} onProduct={openHistory} /></div>
      <details className="report-more"><summary>Sales rhythm &amp; operations</summary><div className="operations-detail"><div><h3>Profit by weekday</h3><div className="weekday-grid">{[1,2,3,4,5,6,0].map(day => { const point = analysis.weekdays.find(p => p.key === String(day)); return <div key={day}><span>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]}</span><strong>{money(point?.profit ?? 0)}</strong><small>{point?.orders ?? 0} orders</small></div> })}</div></div><div><h3>Operations</h3><p>Average delivery: {business.averageDeliveryDays?.toFixed(1) ?? '—'} days</p><p>Open now: {business.pipeline} orders · {money(business.pipelineValue)}</p><p>{business.aging} orders waiting 7+ days</p><p>Best day: {analysis.bestDay?.key ?? '—'} · {money(analysis.bestDay?.profit ?? 0)}</p><p>Best month: {analysis.bestMonth?.label ?? '—'} · {money(analysis.bestMonth?.profit ?? 0)}</p></div></div></details>
    </>}
    {page === 'products' && <div className={`product-workspace ${productId ? 'has-detail' : ''}`}><section className="analysis-section growth-products" id="product-performance">
      <header><h2>Products</h2><label className="growth-search"><MagnifyingGlass /><input aria-label="Search product performance" type="search" placeholder="Search products…" value={search} onChange={event => setSearch(event.target.value)} /></label></header>
      <div className="growth-table-scroll"><table className="growth-table product-table"><thead><tr>{([['name', 'Product'], ['units', 'Units'], ...(!productId ? [['orders','Orders']] : []), ['revenue', 'Revenue (DH)'], ...(!productId ? [['cost','Cost (DH)']] : []), ['profit', 'Profit (DH)'], ['margin', 'Margin']] as [SortKey, string][]).map(([key,label]) => <th key={key} scope="col" aria-sort={sort.key === key ? sort.ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => setSort({key, ascending: sort.key === key ? !sort.ascending : key === 'name'})}>{label}{sort.key === key && (sort.ascending ? <ArrowUp /> : <ArrowDown />)}</button></th>)}{!productId && <th>Share</th>}</tr></thead><tbody>{ranked.map(p => <tr key={p.id} className={productId === p.id ? 'selected' : ''}><th scope="row">{rowButton(p)}</th><td>{p.units}</td>{!productId && <td>{p.orders}</td>}<td>{amount(p.revenue)}</td>{!productId && <td>{amount(p.cost)}</td>}<td className={p.profit < 0 ? 'growth-negative' : 'profit-cell'}>{amount(p.profit)}</td><td>{p.margin.toFixed(1)}%</td>{!productId && <td>{percent(p.revenue,totals.revenue)}</td>}</tr>)}</tbody></table></div>
      {!ranked.length && <p className="analysis-empty">{search ? 'No products match your search.' : 'No delivered products in this period.'}</p>}<p className="growth-note">{ranked.length} products · Click a product to open its history. Click again to close.</p>
      <section className="profit-contribution"><h3>Profit contribution · Top 3 products</h3>{analysis.products.slice(0,3).map(p => <div key={p.id}><span><bdi>{p.name}</bdi></span><progress max={Math.max(1,...analysis.products.map(p => Math.abs(p.profit)))} value={Math.abs(p.profit)} /><strong className={p.profit < 0 ? 'growth-negative' : ''}>{money(p.profit)}</strong></div>)}</section>
      <label className="history-picker">Explore any product<select aria-label="Choose any product history" value={productId} onChange={event => setProductId(event.target.value)}><option value="">Choose a product</option>{choices.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </section>
    {productId && <aside className="analysis-section growth-history" id="product-history" aria-label="Product history" onKeyDown={event => { if (event.key === 'Escape') closeHistory() }}><header><div><h2><bdi>{selectedName}</bdi></h2><p>Product history</p></div><button className="detail-close" onClick={closeHistory} aria-label="Close product history"><X /></button></header><div className="detail-stats"><div><strong>{selectedProduct?.orders ?? 0}</strong><span>Orders</span></div><div><strong>{money(selectedProduct?.cost ?? 0)}</strong><span>Cost</span></div><div><strong>{percent(selectedProduct?.revenue ?? 0,totals.revenue)}</strong><span>Revenue share</span></div><div><strong>{selectedProduct?.units ?? 0}</strong><span>Units sold</span></div></div><p className="sr-only">Figures for the selected report period.</p><ProductSalesChart history={history} /><h3>Sales and restocks</h3><div className="growth-segments">{(['all','sales','restocks'] as const).map(value => <button key={value} aria-pressed={activity === value} onClick={() => setActivity(value)}>{value === 'all' ? 'All activity' : value === 'sales' ? 'Sales' : 'Restocks'}</button>)}</div><label className="history-scope"><input type="checkbox" checked={historyAll} onChange={event => setHistoryAll(event.target.checked)} />Full history (all dates)</label><div className="history-events">{events.map(entry => <article key={entry.id}><time>{new Date(entry.date).toLocaleDateString('en-GB',{timeZone:'Africa/Casablanca',day:'numeric',month:'short',year:'numeric'})}</time><div><strong>{entry.label}</strong><span>{entry.quantity} units · {decimalMoney(entry.amount)}</span><small>{entry.detail}{entry.profit !== undefined ? ` · ${decimalMoney(entry.profit)} profit` : ''}</small></div></article>)}</div>{!events.length && <p className="analysis-empty">No activity matches these filters.</p>}<p className="growth-note">{events.length} events. Sale profit includes allocated delivery, bonuses and other costs.</p></aside>}
    </div>}
    {(page === 'customers' || page === 'inventory') && <BusinessPanels key={page} page={page} business={business} analysis={analysis} onProduct={openHistory} />}
    {page === 'about' && <section className="growth-definitions" id="report-definitions"><h2>About these numbers & what to track next</h2><div className="definitions-grid"><div><h3>How this report is calculated</h3><p>Revenue and order profit include delivered orders only, grouped by delivery date in Casablanca time. Order profit subtracts product cost, delivery, confirmation bonuses, and other recorded order expenses. It is not accounting net profit.</p><p>Comparisons use the immediately preceding range with the same number of calendar days, including zero-sales days. Today may still be in progress. “All time” has no prior comparison.</p><p>Delivery outcomes follow orders created in the selected period and their current status, not historical status transitions. Customer identity is inferred from phone numbers, so shared or changed numbers affect repeat-buyer results.</p></div><div><h3>Data quality in this period</h3><ul><li>{business.missingDeliveryDates} deliveries use creation date because delivery time is missing.</li><li>{business.estimatedCostOrders} delivered orders have at least one product cost estimated from the current catalog.</li><li>{business.missingPhones} deliveries have no usable phone number for customer analysis.</li></ul><p>Figures reflect the workspace records currently loaded. Stock values are estimates at current catalog cost. Restocks are purchase activity, not an additional sale expense.</p></div><div><h3>Next data to collect for growth</h3><p><b>Acquisition:</b> order source, campaign, and advertising spend → acquisition cost and return on ad spend.</p><p><b>True net profit:</b> overhead, payment fees, tax, refunds, returns, and failed-delivery costs.</p><p><b>Conversion & planning:</b> website visits, checkout events, structured delivery zones, supplier lead times, and payment dates.</p><p>These are not measured by the current order records.</p></div></div></section>}
    <footer className="report-footer"><p>Order profit includes recorded order costs; overhead is not included.</p><button className="report-link" disabled={dataState !== 'ready'} onClick={exportReport}><DownloadSimple />Export report</button><span className="sr-only" role="status">{exported}</span></footer>
  </div>
}
