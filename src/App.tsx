import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { initialOrders, initialProducts, people } from './data'
import { supabase } from './supabase'
import type { Order, PaymentStatus, Product, Status } from './types'

const statuses: Status[] = ['New', 'Confirmed', 'Preparing', 'Out for delivery', 'Delivered', 'Cancelled']
const paymentStatuses: PaymentStatus[] = ['Pay on delivery', 'Paid', 'Unpaid']
const money = (value: number) => `${Math.round(value)} DH`
const uid = () => crypto.randomUUID()

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
  const [tab, setTab] = useState<'orders' | 'inventory' | 'profit'>('orders')
  const [orders, setOrders] = useState<Order[]>(() => JSON.parse(localStorage.getItem('tanger-orders') || 'null') ?? initialOrders)
  const [products, setProducts] = useState<Product[]>(() => JSON.parse(localStorage.getItem('tanger-products') || 'null') ?? initialProducts)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All')
  const [showOrder, setShowOrder] = useState(false)
  const [showProduct, setShowProduct] = useState(false)
  const [showBundle, setShowBundle] = useState(false)
  const [bundleLines, setBundleLines] = useState([{ productId: '', quantity: 1 }, { productId: '', quantity: 1 }])
  const [showSearch, setShowSearch] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [notice, setNotice] = useState('Demo data is saved only in this browser until Supabase is connected.')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceCode, setWorkspaceCode] = useState<string | null>(null)
  const [members, setMembers] = useState<{ id: string; display_name: string | null }[]>([])

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
    setProducts(productRows.data.map((row: any) => ({ id: row.id, name: row.name, cost: Number(row.cost), price: Number(row.price), stock: row.stock, lowStockAt: row.low_stock_at, components: row.components ?? undefined })))
    setOrders(orderRows.data.map((row: any) => ({ id: row.id, client: row.client_name, phone: row.phone, address: row.address, items: row.items, status: row.status, paymentStatus: row.payment_status, assignedTo: row.assigned_to ?? '', deliveryCharge: Number(row.delivery_charge), otherExpense: Number(row.other_expense), notes: row.notes, createdAt: row.created_at })))
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
  const totals = useMemo(() => delivered.reduce((sum, order) => {
    const revenue = order.items.reduce((value, item) => value + item.quantity * item.unitPrice, 0) + order.deliveryCharge
    const costs = order.items.reduce((value, item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      return value + (product ? productCost(product, products) * item.quantity : 0)
    }, 0) + order.otherExpense
    return { revenue: sum.revenue + revenue, profit: sum.profit + revenue - costs }
  }, { revenue: 0, profit: 0 }), [delivered, products])

  const visibleOrders = orders.filter((order) => `${order.client} ${order.phone} ${order.address}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'All' || order.status === statusFilter))
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
      items: [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }], status: 'New', paymentStatus: 'Pay on delivery',
      assignedTo: String(values.get('assignedTo')), deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: 0, createdAt: new Date().toISOString(), notes: String(values.get('notes') || ''),
    }
    setOrders((all) => [order, ...all])
    if (supabase && workspaceId) {
      const { error } = await supabase.from('orders').insert({ workspace_id: workspaceId, client_name: order.client, phone: order.phone, address: order.address, items: order.items, status: order.status, payment_status: order.paymentStatus, assigned_to: order.assignedTo || null, delivery_charge: order.deliveryCharge, other_expense: 0, notes: order.notes })
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

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">LOCAL DELIVERY · TANGER</p><h1>Tanger Orders</h1></div>
      <button className="avatar" title="Account menu" aria-expanded={showAccountMenu} onClick={() => setShowAccountMenu(!showAccountMenu)}>S</button>
    </header>

    {showAccountMenu && <section className="account-menu">
      <p>Shared workspace</p>
      <strong>{workspaceCode ?? 'Loading code…'}</strong>
      <button onClick={() => void loadCloud()}>Refresh shared orders</button>
      <button className="sign-out" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
    </section>}

    {supabase && !workspaceId ? <WorkspaceScreen onReady={loadCloud} /> : <>
    {tab === 'orders' && <section className="page">
      <div className="page-heading"><div><h2>Orders</h2><p>{orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length} active orders to manage</p></div><div className="order-actions"><button className={`icon-button ${showSearch ? 'is-active' : ''}`} title="Search orders" aria-label="Search orders" onClick={() => setShowSearch(!showSearch)}>⌕</button><button className="primary" onClick={() => setShowOrder(true)}>+ New order</button></div></div>
      {showSearch && <label className="search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, number, or address" /></label>}
      <div className="status-scroll" aria-label="Filter orders by status"><button className={`status filter-chip ${statusFilter === 'All' ? 'selected' : ''}`} onClick={() => setStatusFilter('All')}>All <b>{orders.length}</b></button>{statuses.map((status) => <button className={`status filter-chip ${status.toLowerCase().replaceAll(' ', '-')} ${statusFilter === status ? 'selected' : ''}`} key={status} onClick={() => setStatusFilter(status)}>{status} <b>{orders.filter(o => o.status === status).length}</b></button>)}</div>
      <div className="order-list">{visibleOrders.map((order) => <OrderCard key={order.id} order={order} products={products} members={members} onStatus={changeStatus} />)}</div>
    </section>}

    {tab === 'inventory' && <section className="page">
      <div className="page-heading"><div><h2>Inventory</h2><p>Products and bundles you are ready to sell</p></div><div className="inventory-actions"><button className="secondary" onClick={() => setShowBundle(true)}>◇ Bundle</button><button className="primary" onClick={() => setShowProduct(true)}>+ Product</button></div></div>
      <div className="inventory-list">{products.map((product) => <article className="inventory-card" key={product.id}><div className="product-mark">{product.components ? '◇' : '□'}</div><div className="grow"><h3>{product.name}</h3><p>{product.components ? `${product.components.length} products in bundle · Cost ${money(productCost(product, products))}` : `Cost ${money(product.cost)} · Selling ${money(product.price)}`}</p></div><div className="stock"><b>{product.components ? 'Bundle' : product.stock}</b><span>{product.components ? 'calculated' : 'in stock'}</span></div>{!product.components && product.stock <= product.lowStockAt && <span className="low">Low stock</span>}</article>)}</div>
      <aside className="bundle-note"><b>◇ Bundles</b><span>When a bundle is delivered, the stock of every product inside it is reduced automatically.</span></aside>
    </section>}

    {tab === 'profit' && <section className="page">
      <div className="page-heading"><div><h2>Profit</h2><p>Delivered orders only</p></div><button className="period">This month⌄</button></div>
      <section className="hero-profit"><p>NET PROFIT</p><strong>{money(totals.profit)}</strong><span>From {delivered.length} delivered orders</span></section>
      <div className="metric-grid"><Metric label="Sales" value={money(totals.revenue)} /><Metric label="This week" value={money(totals.profit)} /><Metric label="Today" value={money(orders.filter(o => o.status === 'Delivered' && new Date(o.createdAt).toDateString() === new Date().toDateString()).reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), 0))} /></div>
      <h3 className="section-title">Completed sales</h3><div className="profit-list">{delivered.map(order => <article key={order.id}><div><b>{order.client}</b><p>{new Date(order.createdAt).toLocaleDateString('en-GB')}</p></div><strong>{money(order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))}</strong></article>)}</div>
    </section>}

    <nav className="bottom-nav"><NavButton icon="▣" label="Orders" active={tab === 'orders'} onClick={() => setTab('orders')} /><NavButton icon="□" label="Inventory" active={tab === 'inventory'} onClick={() => setTab('inventory')} /><NavButton icon="◔" label="Profit" active={tab === 'profit'} onClick={() => setTab('profit')} /></nav>

    {showOrder && <Modal title="New order" close={() => setShowOrder(false)}><form onSubmit={(event) => { event.preventDefault(); void addOrder(event.currentTarget) }} className="form"><input required name="client" placeholder="Client name" /><input required name="phone" placeholder="WhatsApp number" /><input required name="address" placeholder="Address (Arabic or English)" /><select name="product">{products.map(p => <option value={p.id} key={p.id}>{p.components ? '◇ ' : ''}{p.name} — {money(p.price)}</option>)}</select><div className="form-row"><input name="quantity" type="number" min="1" defaultValue="1" placeholder="Qty" /><input name="price" type="number" placeholder="Custom price" /></div><div className="form-row"><select name="assignedTo">{(members.length ? members.map(m => ({ value: m.id, label: m.display_name || 'Team member' })) : people.map(p => ({ value: p, label: p }))).map(person => <option value={person.value} key={person.value}>{person.label}</option>)}</select><input name="deliveryCharge" type="number" placeholder="Delivery fee" /></div><textarea name="notes" placeholder="Notes (optional)" /><button className="primary full">Save order</button></form></Modal>}
    {showProduct && <Modal title="Add product" close={() => setShowProduct(false)}><form onSubmit={(event) => { event.preventDefault(); void addProduct(event.currentTarget) }} className="form"><input required name="name" placeholder="Product name" /><div className="form-row"><input required name="cost" type="number" placeholder="Buying cost" /><input required name="price" type="number" placeholder="Selling price" /></div><div className="form-row"><input required name="stock" type="number" placeholder="Opening stock" /><input name="lowStockAt" type="number" defaultValue="3" placeholder="Low-stock warning" /></div><button className="primary full">Save product</button></form></Modal>}
    {showBundle && <Modal title="Create bundle" close={() => setShowBundle(false)}><form onSubmit={(event) => { event.preventDefault(); void addBundle(event.currentTarget) }} className="form"><input required name="name" placeholder="Bundle name" /><input required name="price" type="number" placeholder="Bundle selling price" /><p className="form-note">Products inside this bundle</p>{bundleLines.map((line, index) => <div className="bundle-line" key={index}><select value={line.productId} onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, productId: event.target.value } : item))}><option value="">Choose product</option>{products.filter((product) => !product.components).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}</select><input type="number" min="1" value={line.quantity} aria-label="Quantity" onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, quantity: Number(event.target.value) || 1 } : item))} />{bundleLines.length > 2 && <button className="remove-line" type="button" onClick={() => setBundleLines((all) => all.filter((_item, lineIndex) => lineIndex !== index))}>×</button>}</div>)}<button className="add-line" type="button" onClick={() => setBundleLines((all) => [...all, { productId: '', quantity: 1 }])}>+ Add another product</button><button className="primary full">Save bundle</button></form></Modal>}
    </>}
  </main>
}

function OrderCard({ order, products, members, onStatus }: { order: Order; products: Product[]; members: { id: string; display_name: string | null }[]; onStatus: (id: string, status: Status) => void }) {
  const lines = order.items.map((item) => `${item.quantity}× ${products.find((p) => p.id === item.productId)?.name ?? 'Product'}`).join(', ')
  const assignee = members.find(member => member.id === order.assignedTo)?.display_name || order.assignedTo || 'Unassigned'
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) + order.deliveryCharge
  return <article className="order-card compact-order"><div className="compact-order-head"><div className="client-block"><h3>{order.client}</h3><a href={`https://wa.me/${order.phone.replace(/\D/g, '')}`} target="_blank">{order.phone} ↗</a></div><select className={`status-picker ${order.status.toLowerCase().replaceAll(' ', '-')}`} aria-label="Order status" value={order.status} onChange={(event) => void onStatus(order.id, event.target.value as Status)}>{statuses.map(status => <option key={status}>{status}</option>)}</select></div><p className="compact-items">{lines}</p><p className="compact-address">⌖ {order.address}</p><div className="compact-meta"><span>◉ {assignee}</span><span>{order.paymentStatus}</span><b>{money(total)}</b></div></article>
}

function NavButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) { return <button className={active ? 'nav-active' : ''} onClick={onClick}><span>{icon}</span>{label}</button> }
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric"><p>{label}</p><strong>{value}</strong></article> }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={close}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={close}>×</button></div>{children}</section></div> }

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
