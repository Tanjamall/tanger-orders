import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { initialOrders, initialProducts, people } from './data'
import { supabase } from './supabase'
import type { Order, PaymentStatus, Product, Status } from './types'

const statuses: Status[] = ['New', 'Confirmed', 'Preparing', 'Out for delivery', 'Delivered', 'Cancelled']
const paymentStatuses: PaymentStatus[] = ['Pay on delivery', 'Paid', 'Unpaid']
const money = (value: number) => `${Math.round(value)} DH`
const uid = () => crypto.randomUUID()
const dateKey = (value: Date | string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const monthStartKey = () => { const today = new Date(); return dateKey(new Date(today.getFullYear(), today.getMonth(), 1)) }
const dateStamp = (key: string) => { const [year, month, day] = key.split('-'); return `${day}/${month}/${year}` }
function dateHeading(key: string) { const today = dateKey(new Date()); const yesterday = dateKey(new Date(Date.now() - 86400000)); return key === today ? 'Today' : key === yesterday ? 'Yesterday' : dateStamp(key) }

function productCost(product: Product, all: Product[]): number {
  if (!product.components) return product.cost
  return product.components.reduce((sum, component) => {
    const child = all.find((item) => item.id === component.productId)
    return sum + (child ? productCost(child, all) * component.quantity : 0)
  }, 0)
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setLoading(false) })
    return () => listener.subscription.unsubscribe()
  }, [])
  if (loading) return <div className="gate">Connecting to Tanger Orders…</div>
  if (supabase && !session) return <AuthScreen />
  return <OrderApp session={session} />
}

function OrderApp({ session }: { session: Session | null }) {
  const [tab, setTab] = useState<'orders' | 'inventory' | 'profit' | 'map'>('orders')
  const [orders, setOrders] = useState<Order[]>(() => JSON.parse(localStorage.getItem('tanger-orders') || 'null') ?? initialOrders)
  const [products, setProducts] = useState<Product[]>(() => JSON.parse(localStorage.getItem('tanger-products') || 'null') ?? initialProducts)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All')
  const [showOrder, setShowOrder] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [showProduct, setShowProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [showBundle, setShowBundle] = useState(false)
  const [bundleLines, setBundleLines] = useState([{ productId: '', quantity: 1 }, { productId: '', quantity: 1 }])
  const [showSearch, setShowSearch] = useState(false)
  const [showRoutePlan, setShowRoutePlan] = useState(false)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [plannedOrders, setPlannedOrders] = useState<Order[]>([])
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [notice, setNotice] = useState('Demo data is saved only in this browser until Supabase is connected.')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceCode, setWorkspaceCode] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; join_code: string; is_owner: boolean }[]>([])
  const [members, setMembers] = useState<{ id: string; display_name: string | null }[]>([])
  const [profitStart, setProfitStart] = useState(monthStartKey)
  const [profitEnd, setProfitEnd] = useState(() => dateKey(new Date()))

  useEffect(() => { localStorage.setItem('tanger-orders', JSON.stringify(orders)) }, [orders])
  useEffect(() => { localStorage.setItem('tanger-products', JSON.stringify(products)) }, [products])

  async function loadCloud() {
    if (!supabase || !session) return
    const { data: profile, error } = await supabase.from('profiles').select('workspace_id').eq('id', session.user.id).single()
    if (error) { setNotice(`Database setup needed: ${error.message}`); return }
    if (!profile.workspace_id) { setWorkspaceId(null); return }
    setWorkspaceId(profile.workspace_id)
    const [workspace, productRows, orderRows, profileRows] = await Promise.all([
      supabase.from('workspaces').select('join_code').eq('id', profile.workspace_id).single(),
      supabase.from('products').select('*').order('created_at'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, display_name'),
    ])
    if (productRows.error || orderRows.error) { setNotice(`Could not load shared data: ${(productRows.error || orderRows.error)?.message}`); return }
    setWorkspaceCode(workspace.data?.join_code ?? null); setMembers(profileRows.data ?? [])
    const { data: memberships } = await supabase.rpc('list_my_workspaces')
    setWorkspaces(memberships ?? [])
    setProducts(productRows.data.map((row: any) => ({ id: row.id, name: row.name, cost: Number(row.cost), price: Number(row.price), stock: row.stock, lowStockAt: row.low_stock_at, components: row.components ?? undefined })))
    setOrders(orderRows.data.map((row: any) => ({ id: row.id, client: row.client_name, phone: row.phone, address: row.address, locationUrl: row.location_url ?? undefined, items: row.items, status: row.status, paymentStatus: row.payment_status, assignedTo: row.assigned_to ?? '', deliveryCharge: Number(row.delivery_charge), otherExpense: Number(row.other_expense), notes: row.notes, createdAt: row.created_at })))
    setNotice('Live shared data is connected.')
  }
  useEffect(() => { void loadCloud() }, [session])
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void loadCloud() }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [session])
  useEffect(() => {
    if (!supabase || !workspaceId) return
    const client = supabase
    const channel = client.channel(`tanger-orders-${workspaceId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadCloud).on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, loadCloud).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [workspaceId])

  const delivered = orders.filter((order) => order.status === 'Delivered')
  const profitOrders = delivered.filter((order) => {
    const orderDate = dateKey(order.createdAt)
    return (!profitStart || orderDate >= profitStart) && (!profitEnd || orderDate <= profitEnd)
  })
  const profitTotals = useMemo(() => profitOrders.reduce((sum, order) => {
    const revenue = order.items.reduce((value, item) => value + item.quantity * item.unitPrice, 0)
    const costs = order.items.reduce((value, item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      return value + (product ? productCost(product, products) * item.quantity : 0)
    }, 0) + order.deliveryCharge + order.otherExpense
    return { revenue: sum.revenue + revenue, profit: sum.profit + revenue - costs }
  }, { revenue: 0, profit: 0 }), [profitOrders, products])

  const visibleOrders = orders
    .filter((order) => `${order.client} ${order.phone} ${order.address}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'All' || order.status === statusFilter))
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime())
  const ordersByDate = visibleOrders.reduce<{ key: string; orders: Order[] }[]>((groups, order) => {
    const key = dateKey(order.createdAt); const group = groups.find((item) => item.key === key)
    if (group) group.orders.push(order); else groups.push({ key, orders: [order] })
    return groups
  }, [])
  const changeStatus = async (id: string, status: Status) => {
    setOrders((all) => all.map((order) => order.id === id ? { ...order, status } : order))
    if (supabase && workspaceId) { const { error } = await supabase.from('orders').update({ status }).eq('id', id); if (error) setNotice(error.message) }
  }

  async function addOrder(form: HTMLFormElement) {
    const values = new FormData(form)
    const product = products.find((item) => item.id === values.get('product'))
    if (!product) return
    const quantity = Number(values.get('quantity')) || 1
    const order: Order = {
      id: uid(), client: String(values.get('client') || ''), phone: String(values.get('phone') || ''), address: String(values.get('address') || ''),
      items: [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }], status: values.get('status') as Status || 'New', paymentStatus: values.get('paymentStatus') as PaymentStatus || 'Pay on delivery',
      assignedTo: String(values.get('assignedTo')), deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: Number(values.get('otherExpense')) || 0, createdAt: new Date().toISOString(), locationUrl: String(values.get('locationUrl') || ''), notes: String(values.get('notes') || ''),
    }
    setOrders((all) => [order, ...all])
    if (supabase && workspaceId) {
      const { error } = await supabase.from('orders').insert({ workspace_id: workspaceId, client_name: order.client, phone: order.phone, address: order.address, location_url: order.locationUrl || null, items: order.items, status: order.status, payment_status: order.paymentStatus, assigned_to: order.assignedTo || null, delivery_charge: order.deliveryCharge, other_expense: order.otherExpense, notes: order.notes })
      if (error) setNotice(error.message)
    }
    setShowOrder(false); setNotice('Order added. Connect Supabase to share it with your partner.')
  }

  async function addProduct(form: HTMLFormElement) {
    const values = new FormData(form)
    const product = { id: uid(), name: String(values.get('name')), cost: Number(values.get('cost')) || 0, price: Number(values.get('price')) || 0, stock: Number(values.get('stock')) || 0, lowStockAt: Number(values.get('lowStockAt')) || 3 }
    setProducts((all) => [...all, product])
    if (supabase && workspaceId) { const { error } = await supabase.from('products').insert({ workspace_id: workspaceId, name: product.name, cost: product.cost, price: product.price, stock: product.stock, low_stock_at: product.lowStockAt }); if (error) setNotice(error.message) }
    setShowProduct(false)
  }

  async function updateOrder(form: HTMLFormElement) {
    if (!editingOrder) return
    const values = new FormData(form)
    const product = products.find((item) => item.id === values.get('product'))
    const quantity = Number(values.get('quantity')) || 1
    const updated: Order = { ...editingOrder, client: String(values.get('client')), phone: String(values.get('phone')), address: String(values.get('address')), locationUrl: String(values.get('locationUrl') || ''), items: product ? [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }] : editingOrder.items, assignedTo: String(values.get('assignedTo')), status: values.get('status') as Status, paymentStatus: values.get('paymentStatus') as PaymentStatus, deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: Number(values.get('otherExpense')) || 0, notes: String(values.get('notes') || '') }
    setOrders((all) => all.map((order) => order.id === updated.id ? updated : order))
    if (supabase && workspaceId) { const { error } = await supabase.from('orders').update({ client_name: updated.client, phone: updated.phone, address: updated.address, location_url: updated.locationUrl || null, items: updated.items, assigned_to: updated.assignedTo || null, status: updated.status, payment_status: updated.paymentStatus, delivery_charge: updated.deliveryCharge, other_expense: updated.otherExpense, notes: updated.notes }).eq('id', updated.id); if (error) setNotice(error.message) }
    setEditingOrder(null)
  }

  async function addBundle(form: HTMLFormElement) {
    const values = new FormData(form)
    const components = bundleLines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: Math.max(1, line.quantity) }))
    if (components.length < 2) { setNotice('Choose at least two products for the bundle.'); return }
    const bundle = { id: uid(), name: String(values.get('name')), cost: 0, price: Number(values.get('price')) || 0, stock: 0, lowStockAt: 0, components }
    setProducts((all) => [...all, bundle])
    if (supabase && workspaceId) {
      const { error } = await supabase.from('products').insert({ workspace_id: workspaceId, name: bundle.name, cost: 0, price: bundle.price, stock: 0, low_stock_at: 0, components: bundle.components })
      if (error) setNotice(error.message)
    }
    setBundleLines([{ productId: '', quantity: 1 }, { productId: '', quantity: 1 }])
    setShowBundle(false)
  }

  async function updateProduct(form: HTMLFormElement) {
    if (!editingProduct) return
    const values = new FormData(form)
    const updated: Product = { ...editingProduct, name: String(values.get('name')), cost: Number(values.get('cost')) || 0, price: Number(values.get('price')) || 0, stock: Number(values.get('stock')) || 0, lowStockAt: Number(values.get('lowStockAt')) || 0 }
    setProducts((all) => all.map((product) => product.id === updated.id ? updated : product))
    if (supabase && workspaceId) { const { error } = await supabase.from('products').update({ name: updated.name, cost: updated.cost, price: updated.price, stock: updated.stock, low_stock_at: updated.lowStockAt }).eq('id', updated.id); if (error) setNotice(error.message) }
    setEditingProduct(null)
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) return
    setProducts((all) => all.filter((item) => item.id !== product.id))
    if (supabase && workspaceId) { const { error } = await supabase.from('products').delete().eq('id', product.id); if (error) { setNotice(error.message); void loadCloud() } }
  }

  async function manageWorkspace(action: 'create' | 'join') {
    if (!supabase) return
    const value = window.prompt(action === 'create' ? 'New workspace name' : 'Workspace code')
    if (!value) return
    const { error } = await supabase.rpc(action === 'create' ? 'create_workspace' : 'join_workspace', action === 'create' ? { workspace_name: value } : { code: value })
    if (error) { setNotice(error.message); return }
    await loadCloud()
  }

  async function switchWorkspace(id: string) {
    if (!supabase || id === workspaceId) return
    const { error } = await supabase.rpc('switch_workspace', { target_workspace_id: id })
    if (error) { setNotice(error.message); return }
    await loadCloud(); setShowAccountMenu(false)
  }

  async function deleteWorkspace(targetWorkspaceId: string, workspaceName: string) {
    if (!supabase || !window.confirm(`Delete “${workspaceName}” and all of its orders, inventory, and profit history? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_workspace', { target_workspace_id: targetWorkspaceId })
    if (error) { setNotice(error.message); return }
    setShowAccountMenu(false); await loadCloud()
  }

  async function planRoute() {
    const deliveries = orders.filter((order) => ['Confirmed', 'Preparing', 'Out for delivery'].includes(order.status) && Boolean(order.locationUrl?.trim()))
    if (!deliveries.length) { setRouteError('Add or confirm at least one delivery first.'); setShowRoutePlan(true); return }
    if (!navigator.geolocation) { setRouteError('Location is not available on this phone.'); setShowRoutePlan(true); return }
    setRouteBusy(true); setRouteError(''); setShowRoutePlan(true)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const resolvedDeliveries = await Promise.all(deliveries.map(async (order): Promise<{ order: Order; coordinates: Coordinates } | null> => {
          const location = await resolveLocation(order.locationUrl)
          const coordinates = location.coordinates || mapCoordinates(location.locationUrl)
          return coordinates ? { order, coordinates } : null
        }))
        const remaining = resolvedDeliveries.filter((delivery): delivery is { order: Order; coordinates: Coordinates } => delivery !== null)
        if (!remaining.length) throw new Error('None of the active delivery links could be read. Open the Map tab once, then try again.')
        const planned: Order[] = []; let current: Coordinates = { latitude: coords.latitude, longitude: coords.longitude }
        while (remaining.length) { const nearestIndex = remaining.reduce((best, item, index) => distanceKm(current, item.coordinates) < distanceKm(current, remaining[best].coordinates) ? index : best, 0); const [next] = remaining.splice(nearestIndex, 1); planned.push(next.order); current = next.coordinates }
        setPlannedOrders(planned)
      } catch (error) { setRouteError(error instanceof Error ? error.message : 'Could not plan this route.') } finally { setRouteBusy(false) }
    }, () => { setRouteBusy(false); setRouteError('Allow location access to plan the deliveries from where you are.') }, { enableHighAccuracy: true, timeout: 10000 })
  }

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">LOCAL DELIVERY · TANGER</p><h1>Tanger Orders</h1></div>
      <button className="avatar" title="Account menu" aria-expanded={showAccountMenu} onClick={() => setShowAccountMenu(!showAccountMenu)}>S</button>
    </header>

    {showAccountMenu && <section className="account-menu">
      <p>Shared workspace</p>
      <strong>{workspaceCode ?? 'Loading code…'}</strong>
      <p className="workspace-label">Your workspaces</p>
      <div className="workspace-list">{workspaces.map((workspace) => <div className={`workspace-row ${workspace.id === workspaceId ? 'current-workspace' : ''}`} key={workspace.id}><button onClick={() => void switchWorkspace(workspace.id)}>⌂ {workspace.name}{workspace.id === workspaceId && ' · Current'}</button>{workspace.is_owner && <button className="row-delete" aria-label={`Delete ${workspace.name}`} title="Delete workspace" onClick={() => void deleteWorkspace(workspace.id, workspace.name)}>⌫</button>}</div>)}</div>
      <div className="workspace-tools"><button onClick={() => void manageWorkspace('create')}>＋ Create</button><button onClick={() => void manageWorkspace('join')}>↗ Join</button></div>
      <button onClick={() => void loadCloud()}>↻ Refresh shared orders</button>
      <button className="sign-out" onClick={() => void supabase?.auth.signOut()}>↪ Sign out</button>
    </section>}

    {supabase && !workspaceId ? <WorkspaceScreen onReady={loadCloud} /> : <>
    {tab === 'orders' && <section className="page">
      <div className="page-heading"><div><h2>Orders</h2><p>{orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length} active orders to manage</p></div><div className="order-actions"><button className="route-button" onClick={() => void planRoute()}>Route</button><button className={`icon-button ${showSearch ? 'is-active' : ''}`} title="Search orders" aria-label="Search orders" onClick={() => setShowSearch(!showSearch)}>⌕</button><button className="primary" onClick={() => setShowOrder(true)}>+ New order</button></div></div>
      {showSearch && <label className="search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, number, or address" /></label>}
      <div className="status-scroll" aria-label="Filter orders by status"><button className={`status filter-chip ${statusFilter === 'All' ? 'selected' : ''}`} onClick={() => setStatusFilter('All')}>All <b>{orders.length}</b></button>{statuses.map((status) => <button className={`status filter-chip ${status.toLowerCase().replaceAll(' ', '-')} ${statusFilter === status ? 'selected' : ''}`} key={status} onClick={() => setStatusFilter(status)}>{status} <b>{orders.filter(o => o.status === status).length}</b></button>)}</div>
      <div className="order-list">{ordersByDate.map((group) => <section className="order-day" key={group.key}><h3>{dateHeading(group.key)}</h3>{group.orders.map((order) => <OrderCard key={order.id} order={order} products={products} members={members} onStatus={changeStatus} onEdit={setEditingOrder} />)}</section>)}</div>
    </section>}

    {tab === 'inventory' && <section className="page">
      <div className="page-heading"><div><h2>Inventory</h2><p>Products and bundles you are ready to sell</p></div><div className="inventory-actions"><button className="secondary" onClick={() => setShowBundle(true)}>◇ Bundle</button><button className="primary" onClick={() => setShowProduct(true)}>+ Product</button></div></div>
      <div className="inventory-list">{products.map((product) => <article className="inventory-card" key={product.id}><div className="product-mark">{product.components ? '◇' : '□'}</div><div className="grow"><h3>{product.name}</h3><p>{product.components ? `${product.components.length} products in bundle · Cost ${money(productCost(product, products))}` : `Cost ${money(product.cost)} · Selling ${money(product.price)}`}</p></div><div className="stock"><b>{product.components ? 'Bundle' : product.stock}</b><span>{product.components ? 'calculated' : 'in stock'}</span></div><div className="inventory-actions-row"><button title="Edit" onClick={() => setEditingProduct(product)}>✎</button><button className="inventory-delete" title="Delete" onClick={() => void deleteProduct(product)}>⌫</button></div>{!product.components && product.stock <= product.lowStockAt && <span className="low">Low stock</span>}</article>)}</div>
      <aside className="bundle-note"><b>◇ Bundles</b><span>When a bundle is delivered, the stock of every product inside it is reduced automatically.</span></aside>
    </section>}

    {tab === 'profit' && <section className="page">
      <div className="page-heading"><div><h2>Profit</h2><p>Delivered orders only</p></div></div>
      <section className="date-filter" aria-label="Choose profit date range"><div><label>From<input type="date" value={profitStart} max={profitEnd || undefined} onChange={(event) => setProfitStart(event.target.value)} /></label><label>To<input type="date" value={profitEnd} min={profitStart || undefined} max={dateKey(new Date())} onChange={(event) => setProfitEnd(event.target.value)} /></label></div><div className="date-quick-actions"><button onClick={() => { const today = dateKey(new Date()); setProfitStart(today); setProfitEnd(today) }}>Today</button><button onClick={() => { setProfitStart(monthStartKey()); setProfitEnd(dateKey(new Date())) }}>This month</button></div></section>
      <section className="hero-profit"><p>NET PROFIT</p><strong>{money(profitTotals.profit)}</strong><span>From {profitOrders.length} delivered {profitOrders.length === 1 ? 'order' : 'orders'}</span></section>
      <div className="metric-grid"><Metric label="Sales" value={money(profitTotals.revenue)} /><Metric label="Orders" value={String(profitOrders.length)} /><Metric label="Average profit" value={money(profitOrders.length ? profitTotals.profit / profitOrders.length : 0)} /></div>
      <h3 className="section-title">Completed sales</h3><div className="profit-list">{profitOrders.map(order => <article key={order.id}><div><b>{order.client}</b><p>{dateStamp(dateKey(order.createdAt))}</p></div><strong>{money(order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))}</strong></article>)}{!profitOrders.length && <p className="empty-date-range">No delivered orders in this date range.</p>}</div>
    </section>}

    {tab === 'map' && <section className="page map-page"><div className="page-heading"><div><h2>Delivery map</h2><p>Orders with a Google Maps location</p></div></div><DeliveryMap orders={orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Cancelled')} /></section>}

    <nav className="bottom-nav"><NavButton icon="orders" label="Orders" active={tab === 'orders'} onClick={() => setTab('orders')} /><NavButton icon="inventory" label="Inventory" active={tab === 'inventory'} onClick={() => setTab('inventory')} /><NavButton icon="profit" label="Profit" active={tab === 'profit'} onClick={() => setTab('profit')} /><NavButton icon="map" label="Map" active={tab === 'map'} onClick={() => setTab('map')} /></nav>

    {showOrder && <Modal title="New order" close={() => setShowOrder(false)}><form onSubmit={(event) => { event.preventDefault(); void addOrder(event.currentTarget) }} className="form"><input required name="client" placeholder="Client name" /><input required name="phone" placeholder="WhatsApp number" /><input required name="address" placeholder="Address (Arabic or English)" /><input name="locationUrl" type="url" placeholder="Google Maps location link (optional)" /><select name="product">{products.map(p => <option value={p.id} key={p.id}>{p.components ? '◇ ' : ''}{p.name} — {money(p.price)}</option>)}</select><div className="form-row"><input name="quantity" type="number" min="1" defaultValue="1" placeholder="Qty" /><input name="price" type="number" placeholder="Custom price" /></div><div className="form-row"><select name="assignedTo">{(members.length ? members.map(m => ({ value: m.id, label: m.display_name || 'Team member' })) : people.map(p => ({ value: p, label: p }))).map(person => <option value={person.value} key={person.value}>{person.label}</option>)}</select><input name="deliveryCharge" type="number" placeholder="Delivery expense" /></div><div className="form-row"><select name="status" defaultValue="New">{statuses.map(status => <option key={status}>{status}</option>)}</select><select name="paymentStatus" defaultValue="Pay on delivery">{paymentStatuses.map(status => <option key={status}>{status}</option>)}</select></div><input name="otherExpense" type="number" placeholder="Other expense" /><textarea name="notes" placeholder="Notes (optional)" /><button className="primary full">Save order</button></form></Modal>}
    {editingOrder && <Modal title="Edit order" close={() => setEditingOrder(null)}><form onSubmit={(event) => { event.preventDefault(); void updateOrder(event.currentTarget) }} className="form"><input required name="client" defaultValue={editingOrder.client} placeholder="Client name" /><input required name="phone" defaultValue={editingOrder.phone} placeholder="WhatsApp number" /><input required name="address" defaultValue={editingOrder.address} placeholder="Address (Arabic or English)" /><input name="locationUrl" type="url" defaultValue={editingOrder.locationUrl} placeholder="Google Maps location link (optional)" /><select name="product" defaultValue={editingOrder.items[0]?.productId}>{products.map(p => <option value={p.id} key={p.id}>{p.components ? '◇ ' : ''}{p.name} — {money(p.price)}</option>)}</select><div className="form-row"><input name="quantity" type="number" min="1" defaultValue={editingOrder.items[0]?.quantity || 1} placeholder="Qty" /><input name="price" type="number" defaultValue={editingOrder.items[0]?.unitPrice} placeholder="Custom price" /></div><div className="form-row"><select name="assignedTo" defaultValue={editingOrder.assignedTo}>{(members.length ? members.map(m => ({ value: m.id, label: m.display_name || 'Team member' })) : people.map(p => ({ value: p, label: p }))).map(person => <option value={person.value} key={person.value}>{person.label}</option>)}</select><input name="deliveryCharge" type="number" defaultValue={editingOrder.deliveryCharge} placeholder="Delivery expense" /></div><div className="form-row"><select name="status" defaultValue={editingOrder.status}>{statuses.map(status => <option key={status}>{status}</option>)}</select><select name="paymentStatus" defaultValue={editingOrder.paymentStatus}>{paymentStatuses.map(status => <option key={status}>{status}</option>)}</select></div><input name="otherExpense" type="number" defaultValue={editingOrder.otherExpense} placeholder="Other expense" /><textarea name="notes" defaultValue={editingOrder.notes} placeholder="Notes (optional)" /><button className="primary full">Save changes</button></form></Modal>}
    {showProduct && <Modal title="Add product" close={() => setShowProduct(false)}><form onSubmit={(event) => { event.preventDefault(); void addProduct(event.currentTarget) }} className="form"><input required name="name" placeholder="Product name" /><div className="form-row"><input required name="cost" type="number" placeholder="Buying cost" /><input required name="price" type="number" placeholder="Selling price" /></div><div className="form-row"><input required name="stock" type="number" placeholder="Opening stock" /><input name="lowStockAt" type="number" defaultValue="3" placeholder="Low-stock warning" /></div><button className="primary full">Save product</button></form></Modal>}
    {editingProduct && <Modal title={`Edit ${editingProduct.components ? 'bundle' : 'product'}`} close={() => setEditingProduct(null)}><form onSubmit={(event) => { event.preventDefault(); void updateProduct(event.currentTarget) }} className="form"><input required name="name" defaultValue={editingProduct.name} placeholder="Name" /><div className="form-row"><input name="cost" type="number" defaultValue={editingProduct.components ? productCost(editingProduct, products) : editingProduct.cost} placeholder="Cost" disabled={Boolean(editingProduct.components)} /><input required name="price" type="number" defaultValue={editingProduct.price} placeholder="Selling price" /></div>{!editingProduct.components && <div className="form-row"><input name="stock" type="number" defaultValue={editingProduct.stock} placeholder="Stock" /><input name="lowStockAt" type="number" defaultValue={editingProduct.lowStockAt} placeholder="Low-stock warning" /></div>}<button className="primary full">Save changes</button></form></Modal>}
    {showBundle && <Modal title="Create bundle" close={() => setShowBundle(false)}><form onSubmit={(event) => { event.preventDefault(); void addBundle(event.currentTarget) }} className="form"><input required name="name" placeholder="Bundle name" /><input required name="price" type="number" placeholder="Bundle selling price" /><p className="form-note">Products inside this bundle</p>{bundleLines.map((line, index) => <div className="bundle-line" key={index}><select value={line.productId} onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, productId: event.target.value } : item))}><option value="">Choose product</option>{products.filter((product) => !product.components).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}</select><input type="number" min="1" value={line.quantity} aria-label="Quantity" onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, quantity: Number(event.target.value) || 1 } : item))} />{bundleLines.length > 2 && <button className="remove-line" type="button" onClick={() => setBundleLines((all) => all.filter((_item, lineIndex) => lineIndex !== index))}>×</button>}</div>)}<button className="add-line" type="button" onClick={() => setBundleLines((all) => [...all, { productId: '', quantity: 1 }])}>+ Add another product</button><button className="primary full">Save bundle</button></form></Modal>}
    {showRoutePlan && <Modal title="Delivery route" close={() => setShowRoutePlan(false)}><div className="route-plan">{routeBusy && <p>Finding the best delivery order from your current location…</p>}{routeError && <p className="route-error">{routeError}</p>}{!routeBusy && !routeError && plannedOrders.map((order, index) => <article key={order.id}><b>{index + 1}</b><div><strong>{order.client}</strong><span>{order.address}</span></div><a href={navigationUrl(order)} target="_blank">Navigate ↗</a></article>)}</div></Modal>}
    </>}
  </main>
}

function OrderCard({ order, products, members, onStatus, onEdit }: { order: Order; products: Product[]; members: { id: string; display_name: string | null }[]; onStatus: (id: string, status: Status) => void; onEdit: (order: Order) => void }) {
  const lines = order.items.map((item) => `${item.quantity}× ${products.find((p) => p.id === item.productId)?.name ?? 'Product'}`).join(', ')
  const assignee = members.find(member => member.id === order.assignedTo)?.display_name || order.assignedTo || 'Unassigned'
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  return <article className="order-card compact-order"><div className="compact-order-head"><div className="client-block"><h3>{order.client}</h3><a href={`https://wa.me/${order.phone.replace(/\D/g, '')}`} target="_blank">{order.phone} ↗</a></div><div className="order-head-actions">{order.locationUrl?.trim() && <a className="map-order" href={navigationUrl(order)} target="_blank" rel="noreferrer" title="Open in Google Maps">⌖</a>}<button className="edit-order" title="Edit order" onClick={() => onEdit(order)}>✎</button><select className={`status-picker ${order.status.toLowerCase().replaceAll(' ', '-')}`} aria-label="Order status" value={order.status} onChange={(event) => void onStatus(order.id, event.target.value as Status)}>{statuses.map(status => <option key={status}>{status}</option>)}</select></div></div><p className="compact-items">{lines}</p><p className="compact-address">⌖ {order.address}</p><div className="compact-meta"><span>◉ {assignee}</span><span>{order.paymentStatus}</span><b>{money(total)}</b></div></article>
}

function NavButton({ icon, label, active, onClick }: { icon: 'orders' | 'inventory' | 'profit' | 'map'; label: string; active: boolean; onClick: () => void }) { return <button className={active ? 'nav-active' : ''} onClick={onClick}><NavIcon name={icon} />{label}</button> }
function NavIcon({ name }: { name: 'orders' | 'inventory' | 'profit' | 'map' }) { const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }; return <svg viewBox="0 0 24 24" aria-hidden="true">{name === 'orders' && <><rect x="4" y="3.5" width="16" height="17" rx="2.5" {...common} /><path d="M8 8h8M8 12h8M8 16h5" {...common} /></>}{name === 'inventory' && <><path d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5z" {...common} /><path d="M4 8.5 12 13l8-4.5M12 13v8" {...common} /></>}{name === 'profit' && <><path d="M4 19.5V13m5 6.5V9m5 10.5V5m5 14.5v-8" {...common} /><path d="m4 9 5-3 5 2 6-4" {...common} /></>}{name === 'map' && <><path d="m3.5 6 6-2.5 5 2.5 6-2.5v14l-6 2.5-5-2.5-6 2.5z" {...common} /><path d="M9.5 3.5v14m5-11.5v14" {...common} /></>}</svg> }
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric"><p>{label}</p><strong>{value}</strong></article> }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={close}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={close}>×</button></div>{children}</section></div> }
function navigationUrl(order: Order) { return order.locationUrl || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}&travelmode=driving&dir_action=navigate` }
type Coordinates = { latitude: number; longitude: number }
function mapCoordinates(locationUrl?: string): Coordinates | null {
  if (!locationUrl) return null
  const source = decodeURIComponent(locationUrl)
  const patterns: { expression: RegExp; reverse?: boolean }[] = [
    { expression: /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /[?&](?:q|query|ll|center|destination|origin)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/ },
    { expression: /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/, reverse: true },
    { expression: /\/place\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
  ]
  for (const { expression, reverse } of patterns) {
    const match = source.match(expression)
    if (!match) continue
    const [latitude, longitude] = reverse ? [Number(match[2]), Number(match[1])] : [Number(match[1]), Number(match[2])]
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude }
  }
  return null
}
type LocationResolution = { locationUrl?: string; coordinates?: Coordinates }
function locationCacheKey(locationUrl: string) { return `tanger-location:${locationUrl}` }
async function resolveLocation(locationUrl?: string): Promise<LocationResolution> {
  const directCoordinates = mapCoordinates(locationUrl)
  if (!locationUrl || directCoordinates) return { locationUrl, coordinates: directCoordinates ?? undefined }
  try {
    const cached = localStorage.getItem(locationCacheKey(locationUrl))
    if (cached) {
      const result = JSON.parse(cached) as LocationResolution
      if (result.coordinates) return result
    }
  } catch { /* A blocked storage area should not prevent location lookup. */ }
  try {
    const response = await fetch('/api/resolve-location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationUrl }) })
    if (!response.ok) return { locationUrl }
    const data = await response.json() as LocationResolution
    const result = { locationUrl: data.locationUrl || locationUrl, coordinates: data.coordinates || mapCoordinates(data.locationUrl) || undefined }
    if (result.coordinates) localStorage.setItem(locationCacheKey(locationUrl), JSON.stringify(result))
    return result
  } catch { return { locationUrl } }
}
async function expandedLocationUrl(locationUrl?: string) { return (await resolveLocation(locationUrl)).locationUrl }
function distanceKm(first: Coordinates, second: Coordinates) { const radians = (value: number) => value * Math.PI / 180; const deltaLatitude = radians(second.latitude - first.latitude); const deltaLongitude = radians(second.longitude - first.longitude); const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(deltaLongitude / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) }

function AuthScreen() {
  const [signUp, setSignUp] = useState(false); const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    const values = new FormData(event.currentTarget); const email = String(values.get('email')); const password = String(values.get('password'))
    const result = signUp ? await supabase.auth.signUp({ email, password, options: { data: { display_name: String(values.get('name')) }, emailRedirectTo: window.location.origin } }) : await supabase.auth.signInWithPassword({ email, password })
    setMessage(result.error?.message || (signUp ? 'Check your email to confirm your account, then sign in.' : 'Signed in.'))
  }
  return <main className="gate"><p className="eyebrow">LOCAL DELIVERY · TANGER</p><h1>Tanger Orders</h1><p>One shared place for every order.</p><form className="form auth-form" onSubmit={submit}>{signUp && <input name="name" required placeholder="Your name" />}<input name="email" type="email" required placeholder="Email" /><input name="password" type="password" minLength={6} required placeholder="Password (6+ characters)" /><button className="primary full">{signUp ? 'Create account' : 'Sign in'}</button></form><button className="link-button" onClick={() => setSignUp(!signUp)}>{signUp ? 'Already have an account? Sign in' : 'New here? Create account'}</button>{message && <p className="message">{message}</p>}</main>
}

function WorkspaceScreen({ onReady }: { onReady: () => Promise<void> }) {
  const [mode, setMode] = useState<'create' | 'join'>('create'); const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    const value = String(new FormData(event.currentTarget).get('value'))
    const { error } = await supabase.rpc(mode === 'create' ? 'create_workspace' : 'join_workspace', mode === 'create' ? { workspace_name: value } : { code: value })
    if (error) setMessage(error.message); else await onReady()
  }
  return <main className="gate"><p className="eyebrow">FIRST-TIME SETUP</p><h1>{mode === 'create' ? 'Create your shared workspace' : 'Join your partner'}</h1><p>{mode === 'create' ? 'You will receive a code to share with your friend.' : 'Enter the code shown in your partner’s app.'}</p><form className="form auth-form" onSubmit={submit}><input name="value" required placeholder={mode === 'create' ? 'Business name, e.g. Tanger Finds' : 'Workspace code'} /><button className="primary full">{mode === 'create' ? 'Create workspace' : 'Join workspace'}</button></form><button className="link-button" onClick={() => setMode(mode === 'create' ? 'join' : 'create')}>{mode === 'create' ? 'I have a code' : 'I need to create one'}</button>{message && <p className="message">{message}</p>}</main>
}

function DeliveryMap({ orders }: { orders: Order[] }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const fallbackLocation: Coordinates = { latitude: 35.7410429, longitude: -5.803754 };
  const [currentLocation, setCurrentLocation] = useState<Coordinates>(fallbackLocation);
  const [usingFallbackLocation, setUsingFallbackLocation] = useState(true);
  const [resolvedOrders, setResolvedOrders] = useState<{ order: Order; coordinates: Coordinates }[]>([]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setCurrentLocation({ latitude: coords.latitude, longitude: coords.longitude }); setUsingFallbackLocation(false); },
      () => setUsingFallbackLocation(true),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    void Promise.all(orders.map(async (order): Promise<{ order: Order; coordinates: Coordinates } | null> => {
      const location = await resolveLocation(order.locationUrl);
      const coordinates = location.coordinates || mapCoordinates(location.locationUrl);
      return coordinates ? { order, coordinates } : null;
    })).then((locations) => setResolvedOrders(locations.filter((location): location is { order: Order; coordinates: Coordinates } => location !== null)));
  }, [orders]);

  useEffect(() => {
    if (!element.current) return;
    const points = [...resolvedOrders].sort((a, b) => distanceKm(currentLocation, a.coordinates) - distanceKm(currentLocation, b.coordinates));

    if (!map.current) {
      map.current = L.map(element.current, { zoomControl: false }).setView([currentLocation.latitude, currentLocation.longitude], 12);
      L.control.zoom({ position: 'bottomright' }).addTo(map.current);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    }

    markerLayer.current?.remove();
    const layer = L.layerGroup().addTo(map.current);
    markerLayer.current = layer;
    const currentLabel = usingFallbackLocation ? 'Hay El Majd (location permission unavailable)' : 'Your current location';
    L.circleMarker([currentLocation.latitude, currentLocation.longitude], { radius: 11, color: '#fff8eb', weight: 3, fillColor: '#c85a45', fillOpacity: 1 })
      .bindPopup(`<strong>${currentLabel}</strong>`)
      .addTo(layer);

    points.forEach(({ order, coordinates }, index) => {
      const icon = L.divIcon({ className: 'delivery-number-pin', html: `<span>${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      L.marker([coordinates.latitude, coordinates.longitude], { icon, zIndexOffset: 1000 })
        .bindPopup(`<strong>${order.client}</strong><br>${order.address}<br><a href="${navigationUrl(order)}" target="_blank">Open in Google Maps ↗</a>`)
        .addTo(layer);
    });

    const bounds: [number, number][] = [[currentLocation.latitude, currentLocation.longitude], ...points.map(({ coordinates }): [number, number] => [coordinates.latitude, coordinates.longitude])];
    map.current.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 14 });
    return () => { layer.remove(); };
  }, [resolvedOrders, currentLocation, usingFallbackLocation]);

  return <><div ref={element} className="delivery-map" />{!resolvedOrders.length && <p className="map-empty">Add Google Maps location links to orders to see them here.</p>}</>;
}
