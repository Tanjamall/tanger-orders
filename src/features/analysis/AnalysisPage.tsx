import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, DownloadSimple } from '@phosphor-icons/react'
import { analyticsChange, analyticsCsv, analyticsRange, buildAnalytics, buildBusinessAnalytics, previousAnalyticsRange, productHistory, type AnalyticsPreset } from '../../domain/analytics'
import { money, rangeLabel, type ConfirmationEmployee } from '../../domain/orders'
import type { InventoryBatch, Order, Product } from '../../types'
import { TrendChart } from './TrendChart'
import { BusinessPanels } from './BusinessPanels'
import './analysis.css'

type AnalysisPageProps = { orders: Order[]; products: Product[]; employees: ConfirmationEmployee[]; batches: InventoryBatch[]; dataState?: 'ready' | 'loading' | 'error' }
const presets: { value: AnalyticsPreset; label: string }[] = [{ value: 'month', label: 'This month' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' }]
type SortKey = 'name' | 'units' | 'orders' | 'revenue' | 'cost' | 'profit' | 'margin'
const reportPages = [['overview', 'Overview'], ['products', 'Products'], ['customers', 'Customers'], ['inventory', 'Inventory'], ['about', 'About the numbers']] as const
type ReportPage = typeof reportPages[number][0]
const pageFromLocation = (): ReportPage => reportPages.find(([page]) => window.location.hash === `#analysis/${page}`)?.[0] ?? 'overview'
export const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : '—'
const decimalMoney = (value: number) => `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })} DH`

function Metric({ label, value, detail, current, previous, accent = false }: { label: string; value: string; detail: string; current: number; previous?: number; accent?: boolean }) {
  return <article className={`growth-metric ${accent ? 'metric-accent' : ''}`}><span>{label}</span><strong>{value}</strong><p>{detail}</p>{previous !== undefined && <small className={current < previous ? 'change-down' : current > previous ? 'change-up' : ''}>{current !== previous && (current > previous ? <ArrowUp /> : <ArrowDown />)}{analyticsChange(current, previous)}<em> vs previous</em></small>}</article>
}

export function AnalysisPage({ orders, products, employees, batches, dataState = 'ready' }: AnalysisPageProps) {
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
  }
  const [preset, setPreset] = useState<AnalyticsPreset | 'custom'>('month')
  const [custom, setCustom] = useState(() => analyticsRange('month')!)
  const [draft, setDraft] = useState(custom)
  const [compare, setCompare] = useState(true)
  const [productId, setProductId] = useState('')
  const [search, setSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
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
  const openHistory = (id: string) => { setProductId(id); setHistorySearch(''); navigate('products'); requestAnimationFrame(() => { document.getElementById('product-history')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); document.getElementById('history-product')?.focus({ preventScroll: true }) }) }
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
      ['Payments on selected deliveries', 'DH'], ['Marked paid', business.paid], ['Not marked paid', business.unpaid], [],
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
  const costs = [['Product cost', totals.productCost], ['Delivery', totals.deliveryCost], ['Confirmation bonuses', totals.confirmationCost], ['Other order expenses', totals.otherCost]] as const
  return <div className={`analysis-page-content growth-dashboard report-${page}`}>
    <div className="growth-toolbar">
      <div className="quick-range analysis-range" aria-label="Analysis period">{presets.map(item => <button key={item.value} className={preset === item.value ? 'selected' : ''} aria-pressed={preset === item.value} onClick={() => setPreset(item.value)}>{item.label}</button>)}<button className={preset === 'custom' ? 'selected' : ''} aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>Custom dates</button></div>
      <div className="growth-toolbar-actions"><label><input type="checkbox" checked={compare && !!range} disabled={!range} onChange={event => setCompare(event.target.checked)} />Compare previous period</label><button className="growth-export" disabled={dataState !== 'ready'} onClick={exportReport}><DownloadSimple />Export report</button></div>
      {preset === 'custom' && <form className="analysis-custom" onSubmit={event => { event.preventDefault(); if (draft.start && draft.end && draft.start <= draft.end) setCustom(draft) }}><label>From<input type="date" required value={draft.start} max={draft.end} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label><label>To<input type="date" required min={draft.start} value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label><button type="submit">Apply dates</button></form>}
      <div className="growth-period"><strong>{range ? rangeLabel(range) : 'All recorded activity'}</strong><span>{comparisonRange ? `vs ${rangeLabel(comparisonRange)}` : 'No period comparison'} · DH · Casablanca time</span></div>
      <span className="sr-only" role="status">{exported}</span>
    </div>
    {dataState !== 'ready' && <p className="growth-data-status" role="status">{dataState === 'error' ? 'Some records could not refresh. These figures may be incomplete or out of date. Use Retry to load the full report.' : 'Loading workspace history. Figures may change as records arrive.'} Export will be available after all records load.</p>}
    <nav className="growth-jumps" aria-label="Analytics sections">{reportPages.map(([value, label]) => <a key={value} href={`#analysis/${value}`} aria-current={page === value ? 'page' : undefined} onClick={event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(value) } }}>{label}</a>)}</nav>
    {page === 'overview' && <>
    <section className="growth-kpis" aria-label="Key performance indicators">
      <Metric label="Order profit" value={money(totals.profit)} detail={`${totals.margin.toFixed(1)}% after recorded costs`} current={totals.profit} previous={previous?.totals.profit} accent />
      <Metric label="Delivered revenue" value={money(totals.revenue)} detail={`${money(totals.totalCost)} in recorded costs`} current={totals.revenue} previous={previous?.totals.revenue} />
      <Metric label="Delivered orders" value={String(totals.orders)} detail={`${totals.units} units · ${totals.orders ? (totals.units / totals.orders).toFixed(1) : '0'} units / order`} current={totals.orders} previous={previous?.totals.orders} />
      <Metric label="Average order value" value={money(totals.averageOrder)} detail={`${money(totals.orders ? totals.profit / totals.orders : 0)} profit / order`} current={totals.averageOrder} previous={previous?.totals.averageOrder} />
    </section>
    <TrendChart key={`${range?.start}-${range?.end}`} analysis={analysis} previous={previous} range={range} previousRange={comparisonRange} />
    <section className="analysis-section growth-costs">
      <header><div><span>02 / Unit economics</span><h2>Revenue to profit</h2></div></header>
      <div className="growth-ledger-line"><span>Delivered revenue</span><strong>{money(totals.revenue)}</strong></div>
      {costs.map(([label, cost], index) => <div className="growth-cost-row" key={label}><div><span>{label}</span><strong>− {money(cost)}</strong></div><div className="cost-track"><i className={`cost-${index}`} style={{ width: `${totals.revenue > 0 ? Math.min(100, cost / totals.revenue * 100) : 0}%` }} /></div></div>)}
      <div className="growth-ledger-line ledger-result"><span>Order profit</span><strong className={totals.profit < 0 ? 'growth-negative' : ''}>{money(totals.profit)}</strong></div>
      <p className="growth-note">Delivery: {money(totals.orders ? totals.deliveryCost / totals.orders : 0)} / order · {percent(totals.deliveryCost, totals.revenue)} of revenue. Excludes unrecorded business expenses.</p>
    </section>
    </>}
    {page === 'products' && <section className="analysis-section growth-products" id="product-performance">
      <header><div><span>03 / Product performance</span><h2>Know what earns its place</h2></div><label className="growth-search"><span className="sr-only">Search product performance</span><input type="search" placeholder="Find a product…" value={search} onChange={event => setSearch(event.target.value)} /></label></header>
      <div className="growth-table-scroll" tabIndex={0} role="region" aria-label="Product performance table, scroll horizontally on small screens"><table className="growth-table"><thead><tr>{([['name', 'Product'], ['units', 'Units'], ['orders', 'Orders'], ['revenue', 'Revenue'], ['cost', 'Cost'], ['profit', 'Order profit'], ['margin', 'Margin']] as [SortKey, string][]).map(([key, label]) => <th key={key} scope="col" aria-sort={sort.key === key ? sort.ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => setSort({ key, ascending: sort.key === key ? !sort.ascending : key === 'name' })}>{label}{sort.key === key ? sort.ascending ? <ArrowUp /> : <ArrowDown /> : null}</button></th>)}<th scope="col">Revenue share</th></tr></thead><tbody>{ranked.map(p => <tr key={p.id}><th scope="row"><button className="product-history-link" onClick={() => openHistory(p.id)}>{p.name}<ArrowUpRight /></button></th><td>{p.units}</td><td>{p.orders}</td><td>{money(p.revenue)}</td><td>{money(p.cost)}</td><td className={p.profit < 0 ? 'growth-negative' : 'profit-cell'}>{money(p.profit)}</td><td>{p.margin.toFixed(1)}%</td><td><div className="share-cell"><i style={{ width: percent(p.revenue, totals.revenue) }} /><span>{percent(p.revenue, totals.revenue)}</span></div></td></tr>)}</tbody><tfoot><tr><th scope="row">{search ? 'Matching products' : 'Period total'}</th><td>{ranked.reduce((sum, p) => sum + p.units, 0)}</td><td>—</td><td>{money(ranked.reduce((sum, p) => sum + p.revenue, 0))}</td><td>{money(ranked.reduce((sum, p) => sum + p.cost, 0))}</td><td>{money(ranked.reduce((sum, p) => sum + p.profit, 0))}</td><td colSpan={2}>{ranked.length} products</td></tr></tfoot></table></div>
      {!ranked.length && <p className="analysis-empty">{search ? 'No products match your search.' : 'No delivered products in this period.'}</p>}
      <p className="growth-note">Click a product for its full history. Shared costs are allocated by revenue, or units for zero-value orders. Product order counts are not additive.</p>
    </section>}
    <BusinessPanels page={page} business={business} analysis={analysis} onProduct={openHistory} />
    {page === 'products' && <section className="analysis-section product-history growth-history" id="product-history">
      <header><div><span>09 / Product drill-down</span><h2>Every sale. Every restock.</h2></div></header>
      <div className="history-controls"><label>Find a product<input type="search" placeholder="Search products" value={historySearch} onChange={event => setHistorySearch(event.target.value)} /></label><label>Product<select id="history-product" aria-label="Product history" value={productId} onChange={event => setProductId(event.target.value)}><option value="">Choose a product</option>{choices.filter(([id, name]) => id === productId || name.toLowerCase().includes(historySearch.toLowerCase())).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      <label className="history-scope"><input type="checkbox" checked={historyAll} onChange={event => setHistoryAll(event.target.checked)} />Full history (all dates)</label>
      <p className="growth-note">{historyAll ? 'All recorded dates' : range ? rangeLabel(range) : 'All recorded dates'} · Sales use delivery date; stock uses receipt date. Bundle component consumption is included in inventory demand, not as separate sale events here.</p>
      {productId && <div className="history-events">{history.map(entry => <article key={entry.id}><div><strong>{entry.label}</strong><small>{new Date(entry.date).toLocaleDateString('en-GB', { timeZone: 'Africa/Casablanca' })} · {entry.detail}</small></div><div><strong>{entry.quantity} units · {decimalMoney(entry.amount)}</strong><small>{entry.profit === undefined ? entry.id.startsWith('batch-') ? 'Stock cost' : 'Order value' : `${decimalMoney(entry.profit)} order profit`}</small></div></article>)}</div>}
      <p className="analysis-empty">{!productId ? 'Choose a product above or click one in a report to explore its sales and stock receipts.' : !history.length ? 'No recorded activity for this product in these dates.' : `${history.length} recorded events. Sale profit includes allocated delivery, bonus, and other costs.`}</p>
    </section>}
    {page === 'about' && <section className="growth-definitions" id="report-definitions"><h2>About these numbers & what to track next</h2><div className="definitions-grid"><div><h3>How this report is calculated</h3><p>Revenue and order profit include delivered orders only, grouped by delivery date in Casablanca time. Order profit subtracts product cost, delivery, confirmation bonuses, and other recorded order expenses. It is not accounting net profit.</p><p>Comparisons use the immediately preceding range with the same number of calendar days, including zero-sales days. Today may still be in progress. “All time” has no prior comparison.</p><p>Delivery outcomes follow orders created in the selected period and their current status, not historical status transitions. Customer identity is inferred from phone numbers, so shared or changed numbers affect repeat-buyer results.</p></div><div><h3>Data quality in this period</h3><ul><li>{business.missingDeliveryDates} deliveries use creation date because delivery time is missing.</li><li>{business.estimatedCostOrders} delivered orders have at least one product cost estimated from the current catalog.</li><li>{business.missingPhones} deliveries have no usable phone number for customer analysis.</li></ul><p>Figures reflect the workspace records currently loaded. Stock values are estimates at current catalog cost. Restocks are purchase activity, not an additional sale expense.</p></div><div><h3>Next data to collect for growth</h3><p><b>Acquisition:</b> order source, campaign, and advertising spend → acquisition cost and return on ad spend.</p><p><b>True net profit:</b> overhead, payment fees, tax, refunds, returns, and failed-delivery costs.</p><p><b>Conversion & planning:</b> website visits, checkout events, structured delivery zones, supplier lead times, and payment dates.</p><p>These are not measured by the current order records.</p></div></div></section>}
  </div>
}
