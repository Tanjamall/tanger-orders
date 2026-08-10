import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  Buildings,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartBar,
  CheckCircle,
  ClipboardText,
  Copy,
  Cube,
  GearSix,
  MagnifyingGlass,
  MapPin,
  Moon,
  NavigationArrow,
  NoteBlank,
  Package,
  Path,
  Pause,
  PencilSimple,
  Play,
  Plus,
  SignOut,
  Stack,
  Sun,
  Tag,
  Trash,
  Truck,
  User,
  UserCheck,
  UserPlus,
  UsersThree,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/fraunces/700.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import { initialOrders, initialProducts, people } from './data'
import { supabase } from './supabase'
import type { Order, PaymentStatus, Product, Status } from './types'

const statuses: Status[] = ['New', 'Confirmed', 'Preparing', 'Out for delivery', 'Delivered', 'Cancelled']
const orderFilters: { label: string; value: Status | 'All' }[] = [
  { label: 'All', value: 'All' },
  { label: 'New', value: 'New' },
  { label: 'Confirmed', value: 'Confirmed' },
  { label: 'Delivered', value: 'Delivered' },
  { label: 'Canceled', value: 'Cancelled' },
]
const paymentStatuses: PaymentStatus[] = ['Pay on delivery', 'Paid', 'Unpaid']
type ConfirmationEmployee = { id: string; name: string; bonus: number; active: boolean }
const money = (value: number) => `${Math.round(value)} DH`
const uid = () => crypto.randomUUID()
const isConfirmedOrder = (status: Status) => ['Confirmed', 'Preparing', 'Out for delivery', 'Delivered'].includes(status)
const dateKey = (value: Date | string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const monthStartKey = () => { const today = new Date(); return dateKey(new Date(today.getFullYear(), today.getMonth(), 1)) }
const monthEndKey = (value = new Date()) => dateKey(new Date(value.getFullYear(), value.getMonth() + 1, 0))
const dateStamp = (key: string) => { const [year, month, day] = key.split('-'); return `${day}/${month}/${year}` }
const longDate = (key: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00`))
const shortDate = (key: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${key}T12:00:00`))
const monthLabel = (key: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${key}T12:00:00`))
type DateRange = { start: string; end: string }
const normalizedRange = (first: string, second: string): DateRange => first <= second ? { start: first, end: second } : { start: second, end: first }
const rangeLabel = ({ start, end }: DateRange) => {
  const startDate = new Date(`${start}T12:00:00`); const endDate = new Date(`${end}T12:00:00`)
  if (start === end) return shortDate(start)
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) return `${startDate.getDate()}–${shortDate(end)}`
  return `${shortDate(start)} – ${shortDate(end)}`
}
const isWholeMonth = ({ start, end }: DateRange) => {
  const startDate = new Date(`${start}T12:00:00`)
  return startDate.getDate() === 1 && end === monthEndKey(startDate)
}

function productCost(product: Product, all: Product[]): number {
  if (!product.components) return product.cost
  return product.components.reduce((sum, component) => {
    const child = all.find((item) => item.id === component.productId)
    return sum + (child ? productCost(child, all) * component.quantity : 0)
  }, 0)
}

function bundleStock(product: Product, all: Product[]) {
  if (!product.components?.length) return product.stock
  return Math.min(...product.components.map((component) => {
    const child = all.find((item) => item.id === component.productId)
    return child ? Math.floor(child.stock / component.quantity) : 0
  }))
}

export default function App() {
  const devDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setLoading(false) })
    return () => listener.subscription.unsubscribe()
  }, [])
  if (!devDemo && loading) return <div className="gate">Connecting to Tanger Orders…</div>
  if (!devDemo && supabase && !session) return <AuthScreen />
  return <OrderApp session={session} devDemo={devDemo} />
}

function OrderApp({ session, devDemo }: { session: Session | null; devDemo: boolean }) {
  const [tab, setTab] = useState<'orders' | 'inventory' | 'profit' | 'employees' | 'map' | 'settings'>(() => {
    const requested = devDemo ? new URLSearchParams(window.location.search).get('tab') : null
    return requested && ['orders', 'inventory', 'profit', 'employees', 'map', 'settings'].includes(requested) ? requested as 'orders' | 'inventory' | 'profit' | 'employees' | 'map' | 'settings' : 'orders'
  })
  const [dark, setDark] = useState(() => localStorage.getItem('quiet-ledger-theme') === 'dark')
  const [orderRange, setOrderRange] = useState<DateRange>(() => ({ start: monthStartKey(), end: monthEndKey() }))
  const [showOrderCalendar, setShowOrderCalendar] = useState(false)
  const [orders, setOrders] = useState<Order[]>(() => devDemo ? initialOrders : JSON.parse(localStorage.getItem('tanger-orders') || 'null') ?? initialOrders)
  const [products, setProducts] = useState<Product[]>(() => devDemo ? initialProducts : JSON.parse(localStorage.getItem('tanger-products') || 'null') ?? initialProducts)
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
  const [, setNotice] = useState('Demo data is saved only in this browser until Supabase is connected.')
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => devDemo ? 'demo-workspace' : null)
  const [workspaceCode, setWorkspaceCode] = useState<string | null>(() => devDemo ? 'TNG-4821' : null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; join_code: string; is_owner: boolean }[]>(() => devDemo ? [{ id: 'demo-workspace', name: 'Tanger Orders', join_code: 'TNG-4821', is_owner: true }] : [])
  const [members, setMembers] = useState<{ id: string; display_name: string | null }[]>([])
  const [confirmationEmployees, setConfirmationEmployees] = useState<ConfirmationEmployee[]>(() => devDemo ? [{ id: 'demo-amina', name: 'Amina', bonus: 5, active: true }, { id: 'demo-karim', name: 'Karim', bonus: 5, active: true }] : [])
  const [showConfirmationTeam, setShowConfirmationTeam] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [profitStart, setProfitStart] = useState(monthStartKey)
  const [profitEnd, setProfitEnd] = useState(() => dateKey(new Date()))

  useEffect(() => { if (!devDemo) localStorage.setItem('tanger-orders', JSON.stringify(orders)) }, [orders, devDemo])
  useEffect(() => { if (!devDemo) localStorage.setItem('tanger-products', JSON.stringify(products)) }, [products, devDemo])
  useEffect(() => {
    localStorage.setItem('quiet-ledger-theme', dark ? 'dark' : 'light')
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  async function loadCloud() {
    if (!supabase || !session) return
    const { data: profile, error } = await supabase.from('profiles').select('workspace_id').eq('id', session.user.id).single()
    if (error) { setNotice(`Database setup needed: ${error.message}`); return }
    if (!profile.workspace_id) { setWorkspaceId(null); return }
    setWorkspaceId(profile.workspace_id)
    const [workspace, productRows, orderRows, profileRows, employeeRows] = await Promise.all([
      supabase.from('workspaces').select('join_code').eq('id', profile.workspace_id).single(),
      supabase.from('products').select('*').order('created_at'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, display_name'),
      supabase.from('confirmation_employees').select('*').order('created_at'),
    ])
    if (productRows.error || orderRows.error || employeeRows.error) { setNotice(`Could not load shared data: ${(productRows.error || orderRows.error || employeeRows.error)?.message}`); return }
    setWorkspaceCode(workspace.data?.join_code ?? null); setMembers(profileRows.data ?? [])
    const { data: memberships } = await supabase.rpc('list_my_workspaces')
    setWorkspaces(memberships ?? [])
    setProducts(productRows.data.map((row: any) => ({ id: row.id, name: row.name, cost: Number(row.cost), price: Number(row.price), stock: row.stock, lowStockAt: row.low_stock_at, components: row.components ?? undefined })))
    setConfirmationEmployees(employeeRows.data.map((row: any) => ({ id: row.id, name: row.name, bonus: Number(row.bonus_per_confirmation), active: row.active })))
    setOrders(orderRows.data.map((row: any) => ({ id: row.id, client: row.client_name, phone: row.phone, address: row.address, locationUrl: row.location_url ?? undefined, items: row.items, status: row.status, paymentStatus: row.payment_status, assignedTo: row.assigned_to ?? '', deliveryCharge: Number(row.delivery_charge), otherExpense: Number(row.other_expense), notes: row.notes, createdAt: row.created_at, deliveredAt: row.delivered_at ?? undefined, confirmationEmployeeId: row.confirmation_employee_id ?? undefined, confirmationBonus: Number(row.confirmation_bonus ?? 0), confirmedAt: row.confirmed_at ?? undefined })))
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
    const channel = client.channel(`tanger-orders-${workspaceId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadCloud).on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, loadCloud).on('postgres_changes', { event: '*', schema: 'public', table: 'confirmation_employees' }, loadCloud).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [workspaceId])

  const confirmationCost = (order: Order) => order.confirmationEmployeeId ? order.confirmationBonus ?? confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId)?.bonus ?? 0 : 0
  const delivered = orders.filter((order) => order.status === 'Delivered')
  const profitOrders = delivered.filter((order) => {
    const orderDate = dateKey(order.deliveredAt || order.createdAt)
    return (!profitStart || orderDate >= profitStart) && (!profitEnd || orderDate <= profitEnd)
  })
  const profitTotals = useMemo(() => profitOrders.reduce((sum, order) => {
    const revenue = order.items.reduce((value, item) => value + item.quantity * item.unitPrice, 0)
    const costs = order.items.reduce((value, item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      return value + (product ? productCost(product, products) * item.quantity : 0)
    }, 0) + order.deliveryCharge + order.otherExpense
    const confirmationBonus = confirmationCost(order)
    return { revenue: sum.revenue + revenue, profit: sum.profit + revenue - costs - confirmationBonus, confirmationBonuses: sum.confirmationBonuses + confirmationBonus }
  }, { revenue: 0, profit: 0, confirmationBonuses: 0 }), [profitOrders, products, confirmationEmployees])
  const selectedRangeOrders = orders.filter((order) => { const created = dateKey(order.createdAt); return created >= orderRange.start && created <= orderRange.end })
  const selectedRangeDelivered = orders.filter((order) => { const deliveredAt = dateKey(order.deliveredAt || order.createdAt); return order.status === 'Delivered' && deliveredAt >= orderRange.start && deliveredAt <= orderRange.end })
  const selectedRangeProfit = selectedRangeDelivered.reduce((sum, order) => {
    const revenue = order.items.reduce((value, item) => value + item.quantity * item.unitPrice, 0)
    const costs = order.items.reduce((value, item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      return value + (product ? productCost(product, products) * item.quantity : 0)
    }, 0) + order.deliveryCharge + order.otherExpense + confirmationCost(order)
    return sum + revenue - costs
  }, 0)
  const employeeSummaries = confirmationEmployees.map((employee) => {
    const confirmations = orders.filter((order) => order.confirmationEmployeeId === employee.id && order.confirmedAt)
    const productNames = [...new Set(confirmations.flatMap((order) => order.items.map((item) => products.find((product) => product.id === item.productId)?.name).filter((name): name is string => Boolean(name))))]
    return { employee, count: confirmations.length, bonus: confirmations.reduce((sum, order) => sum + (order.confirmationBonus ?? employee.bonus), 0), productNames }
  }).filter(({ employee, count }) => employee.active || count > 0)
  const selectedEmployee = confirmationEmployees.find((employee) => employee.id === selectedEmployeeId)
  const selectedEmployeeOrders = selectedEmployee ? orders.filter((order) => order.confirmationEmployeeId === selectedEmployee.id && order.confirmedAt).sort((first, second) => new Date(second.confirmedAt || 0).getTime() - new Date(first.confirmedAt || 0).getTime()) : []

  const visibleOrders = selectedRangeOrders
    .filter((order) => `${order.client} ${order.phone} ${order.address}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'All' || order.status === statusFilter))
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime())
  const orderGroups = visibleOrders.reduce<{ date: string; orders: Order[] }[]>((groups, order) => {
    const day = dateKey(order.createdAt); const latest = groups[groups.length - 1]
    if (latest?.date === day) latest.orders.push(order); else groups.push({ date: day, orders: [order] })
    return groups
  }, [])
  const currentMonthRange = orderRange.start === monthStartKey() && orderRange.end === monthEndKey()
  const orderRangeTitle = isWholeMonth(orderRange) ? monthLabel(orderRange.start) : rangeLabel(orderRange)
  const changeStatus = async (id: string, status: Status) => {
    const currentOrder = orders.find((order) => order.id === id)
    const deliveredAt = status === 'Delivered' ? currentOrder?.deliveredAt || new Date().toISOString() : undefined
    const confirmedAt = currentOrder?.confirmedAt || (isConfirmedOrder(status) ? new Date().toISOString() : undefined)
    const employee = confirmationEmployees.find((item) => item.id === currentOrder?.confirmationEmployeeId)
    const confirmationBonus = currentOrder?.confirmationBonus ?? (employee?.bonus || 0)
    setOrders((all) => all.map((order) => order.id === id ? { ...order, status, deliveredAt, confirmedAt, confirmationBonus } : order))
    if (supabase && workspaceId) { const { error } = await supabase.from('orders').update({ status, delivered_at: deliveredAt ?? null, confirmed_at: confirmedAt ?? null, confirmation_bonus: confirmationBonus }).eq('id', id); if (error) setNotice(error.message) }
  }

  async function addOrder(form: HTMLFormElement) {
    const values = new FormData(form)
    const product = products.find((item) => item.id === values.get('product'))
    if (!product) return
    const quantity = Number(values.get('quantity')) || 1
    const status = values.get('status') as Status || 'New'
    const createdAt = new Date().toISOString()
    const confirmationEmployeeId = String(values.get('confirmationEmployeeId') || '') || undefined
    const confirmationEmployee = confirmationEmployees.find((employee) => employee.id === confirmationEmployeeId)
    const order: Order = {
      id: uid(), client: String(values.get('client') || ''), phone: String(values.get('phone') || ''), address: String(values.get('address') || ''),
      items: [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }], status, paymentStatus: values.get('paymentStatus') as PaymentStatus || 'Pay on delivery',
      assignedTo: String(values.get('assignedTo')), deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: Number(values.get('otherExpense')) || 0, createdAt, deliveredAt: status === 'Delivered' ? createdAt : undefined, confirmationEmployeeId, confirmationBonus: confirmationEmployee?.bonus || 0, confirmedAt: isConfirmedOrder(status) ? createdAt : undefined, locationUrl: String(values.get('locationUrl') || ''), notes: String(values.get('notes') || ''),
    }
    setOrders((all) => [order, ...all])
    if (supabase && workspaceId) {
      const { error } = await supabase.from('orders').insert({ workspace_id: workspaceId, client_name: order.client, phone: order.phone, address: order.address, location_url: order.locationUrl || null, items: order.items, status: order.status, payment_status: order.paymentStatus, assigned_to: order.assignedTo || null, delivery_charge: order.deliveryCharge, other_expense: order.otherExpense, notes: order.notes, delivered_at: order.deliveredAt ?? null, confirmation_employee_id: order.confirmationEmployeeId ?? null, confirmation_bonus: order.confirmationBonus ?? 0, confirmed_at: order.confirmedAt ?? null })
      if (error) setNotice(error.message)
    }
    setShowOrder(false); setNotice(supabase && workspaceId ? 'Order added to the shared workspace.' : 'Order added to this browser preview.')
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
    const status = values.get('status') as Status
    const confirmationEmployeeId = String(values.get('confirmationEmployeeId') || '') || undefined
    const confirmationEmployee = confirmationEmployees.find((employee) => employee.id === confirmationEmployeeId)
    const isSameConfirmer = confirmationEmployeeId === editingOrder.confirmationEmployeeId
    const confirmedAt = editingOrder.confirmedAt || (isConfirmedOrder(status) ? new Date().toISOString() : undefined)
    const confirmationBonus = confirmationEmployeeId ? (isSameConfirmer && editingOrder.confirmedAt ? editingOrder.confirmationBonus ?? confirmationEmployee?.bonus ?? 0 : confirmationEmployee?.bonus ?? 0) : 0
    const updated: Order = { ...editingOrder, client: String(values.get('client')), phone: String(values.get('phone')), address: String(values.get('address')), locationUrl: String(values.get('locationUrl') || ''), items: product ? [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }] : editingOrder.items, assignedTo: String(values.get('assignedTo')), status, paymentStatus: values.get('paymentStatus') as PaymentStatus, deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: Number(values.get('otherExpense')) || 0, notes: String(values.get('notes') || ''), deliveredAt: status === 'Delivered' ? editingOrder.deliveredAt || new Date().toISOString() : undefined, confirmationEmployeeId, confirmationBonus, confirmedAt }
    setOrders((all) => all.map((order) => order.id === updated.id ? updated : order))
    if (supabase && workspaceId) { const { error } = await supabase.from('orders').update({ client_name: updated.client, phone: updated.phone, address: updated.address, location_url: updated.locationUrl || null, items: updated.items, assigned_to: updated.assignedTo || null, status: updated.status, payment_status: updated.paymentStatus, delivery_charge: updated.deliveryCharge, other_expense: updated.otherExpense, notes: updated.notes, delivered_at: updated.deliveredAt ?? null, confirmation_employee_id: updated.confirmationEmployeeId ?? null, confirmation_bonus: updated.confirmationBonus ?? 0, confirmed_at: updated.confirmedAt ?? null }).eq('id', updated.id); if (error) setNotice(error.message) }
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
    await loadCloud()
  }

  async function deleteWorkspace(targetWorkspaceId: string, workspaceName: string) {
    if (!supabase || !window.confirm(`Delete “${workspaceName}” and all of its orders, inventory, and profit history? This cannot be undone.`)) return
    const { error } = await supabase.rpc('delete_workspace', { target_workspace_id: targetWorkspaceId })
    if (error) { setNotice(error.message); return }
    await loadCloud()
  }

  async function addConfirmationEmployee(form: HTMLFormElement) {
    const values = new FormData(form)
    const name = String(values.get('name') || '').trim()
    const bonus = Number(values.get('bonus'))
    if (!name) return
    if (!supabase) {
      setConfirmationEmployees((all) => [...all, { id: uid(), name, bonus: Number.isFinite(bonus) ? Math.max(0, bonus) : 5, active: true }])
      form.reset()
      return
    }
    const { error } = await supabase.rpc('create_confirmation_employee', { employee_name: name, employee_bonus: Number.isFinite(bonus) ? Math.max(0, bonus) : 5 })
    if (error) { setNotice(error.message); return }
    form.reset(); await loadCloud()
  }

  async function editConfirmationEmployee(employee: ConfirmationEmployee) {
    const name = window.prompt('Employee name', employee.name)?.trim()
    if (!name) return
    const bonusValue = window.prompt('Bonus for each confirmed order (DH)', String(employee.bonus))
    if (bonusValue === null) return
    const bonus = Number(bonusValue)
    if (!Number.isFinite(bonus) || bonus < 0) { setNotice('Enter a valid bonus amount.'); return }
    if (!supabase) { setConfirmationEmployees((all) => all.map((item) => item.id === employee.id ? { ...item, name, bonus } : item)); return }
    const { error } = await supabase.rpc('update_confirmation_employee', { employee_id: employee.id, employee_name: name, employee_bonus: bonus, employee_active: employee.active })
    if (error) { setNotice(error.message); return }
    await loadCloud()
  }

  async function toggleConfirmationEmployee(employee: ConfirmationEmployee) {
    if (!supabase) { setConfirmationEmployees((all) => all.map((item) => item.id === employee.id ? { ...item, active: !item.active } : item)); return }
    const { error } = await supabase.rpc('update_confirmation_employee', { employee_id: employee.id, employee_name: employee.name, employee_bonus: employee.bonus, employee_active: !employee.active })
    if (error) { setNotice(error.message); return }
    await loadCloud()
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

  return <main className={`app-shell ${dark ? 'theme-dark' : 'theme-light'}`}>
    {supabase && session && !workspaceId ? <WorkspaceScreen onReady={loadCloud} /> : <>
    {tab !== 'map' && <div className="ledger-scroll"><div className="ledger-content">
    {tab === 'orders' && <section className="page quiet-orders">
      <PageHeader title="Orders" subtitle={orderRangeTitle} dark={dark} toggleTheme={() => setDark(!dark)} actions={<><button className={`square-action ${showSearch ? 'is-active' : ''}`} aria-label="Search orders" onClick={() => setShowSearch(!showSearch)}><MagnifyingGlass /></button><button className="square-action" aria-label="Plan route" onClick={() => void planRoute()}><Path /></button></>} />
      <section className="profit-date-bar"><div><span>{currentMonthRange ? "This month's profit" : 'Range profit'}</span><strong>{money(selectedRangeProfit)}</strong><small><CheckCircle />{selectedRangeDelivered.length} delivered</small></div><button type="button" className="date-control" onClick={() => setShowOrderCalendar(true)} aria-haspopup="dialog"><CalendarBlank /><span><b>{currentMonthRange ? 'This month' : 'Selected range'}</b><small>{rangeLabel(orderRange)}</small></span><CaretDown /></button></section>
      {showSearch && <label className="search-field"><MagnifyingGlass /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, phone, or address" /><button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X /></button></label>}
      <div className="filter-rail" aria-label="Filter orders by status">{orderFilters.map((filter) => {
        const count = filter.value === 'All' ? selectedRangeOrders.length : selectedRangeOrders.filter((order) => order.status === filter.value).length
        return <button key={filter.value} className={statusFilter === filter.value ? 'selected' : ''} onClick={() => setStatusFilter(filter.value)}><span>{filter.label}</span><small>{count}</small></button>
      })}</div>
      <section className="ledger-section range-ledger">{orderGroups.map((group) => <div className="order-day-group" key={group.date}><h2><span>{group.date === dateKey(new Date()) ? 'Today' : longDate(group.date)}</span><small>{group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'}</small></h2><div className="order-ledger">{group.orders.map((order) => <OrderCard key={order.id} order={order} products={products} members={members} confirmationEmployees={confirmationEmployees} onStatus={changeStatus} onEdit={setEditingOrder} />)}</div></div>)}{!visibleOrders.length && <EmptyState icon={<ClipboardText />} title="No matching orders" copy="Try another range, status, or search." />}</section>
    </section>}

    {tab === 'inventory' && <section className="page">
      <PageHeader title="Inventory" subtitle="Products and bundles" dark={dark} toggleTheme={() => setDark(!dark)} actions={<button className="text-action" onClick={() => setShowBundle(true)}><Stack />Bundle</button>} />
      <section className="inventory-overview"><Cube /><b>{products.length}</b><span>items</span><i /><WarningCircle weight="fill" /><b>{products.filter((product) => !product.components && product.stock <= product.lowStockAt).length}</b><span>low stock</span></section>
      <div className="inventory-ledger">{products.map((product) => { const low = !product.components && product.stock <= product.lowStockAt; return <article className="inventory-row" key={product.id}><span className="product-icon">{product.components ? <Stack /> : <Package />}</span><div className="inventory-copy"><h3>{product.name}</h3><p>{product.components ? `${product.components.length} products in bundle` : `Cost ${money(product.cost)} · Selling ${money(product.price)}`}</p>{product.components && <p>Cost {money(productCost(product, products))} · Selling {money(product.price)}</p>}</div><div className={`stock-copy ${low ? 'is-low' : ''}`}><b>{product.components ? bundleStock(product, products) : product.stock}</b><span>{product.components ? 'calculated' : low ? 'Low stock' : 'in stock'}</span></div><div className="inventory-row-actions"><button aria-label={`Edit ${product.name}`} onClick={() => setEditingProduct(product)}><PencilSimple /></button><button className="danger-icon" aria-label={`Delete ${product.name}`} onClick={() => void deleteProduct(product)}><Trash /></button></div></article> })}</div>
      <p className="info-strip"><NoteBlank />Bundle stock is calculated from the products inside it.</p>
    </section>}

    {tab === 'profit' && <section className="page">
      <PageHeader title="Profit" subtitle="Delivered orders only" dark={dark} toggleTheme={() => setDark(!dark)} />
      <section className="range-control" aria-label="Choose profit date range"><label><span>From</span><div><CalendarBlank /><input type="date" value={profitStart} max={profitEnd || undefined} onChange={(event) => setProfitStart(event.target.value)} /></div></label><i /><label><span>To</span><div><CalendarBlank /><input type="date" value={profitEnd} min={profitStart || undefined} max={dateKey(new Date())} onChange={(event) => setProfitEnd(event.target.value)} /></div></label></section>
      <div className="quick-range"><button className={profitStart === dateKey(new Date()) && profitEnd === dateKey(new Date()) ? 'selected' : ''} onClick={() => { const today = dateKey(new Date()); setProfitStart(today); setProfitEnd(today) }}>Today</button><button onClick={() => { setProfitStart(monthStartKey()); setProfitEnd(dateKey(new Date())) }}>This month</button></div>
      <section className="net-profit"><span>Net profit</span><strong>{money(profitTotals.profit)}</strong><p>From <b>{profitOrders.length} delivered {profitOrders.length === 1 ? 'order' : 'orders'}</b></p></section>
      <section className="profit-grid"><Metric icon={<Tag />} label="Sales" value={money(profitTotals.revenue)} /><Metric icon={<ClipboardText />} label="Orders" value={String(profitOrders.length)} /><Metric icon={<UsersThree />} label="Team bonuses" value={money(profitTotals.confirmationBonuses)} /><Metric icon={<ChartBar />} label="Average net" value={money(profitOrders.length ? profitTotals.profit / profitOrders.length : 0)} /></section>
      <section className="ledger-section completed-sales"><h2>Completed sales</h2>{profitOrders.map((order) => { const bonus = confirmationCost(order); const confirmer = confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId); return <article key={order.id}><CheckCircle weight="fill" /><div><h3>{order.client}</h3><p>{dateStamp(dateKey(order.deliveredAt || order.createdAt))}</p><span>{order.items.map((item) => `${products.find((product) => product.id === item.productId)?.name ?? 'Product'} ×${item.quantity}`).join(', ')}</span>{confirmer && <small>Confirmation: {confirmer.name} · -{money(bonus)}</small>}</div><strong>{money(order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))}</strong></article> })}{!profitOrders.length && <EmptyState icon={<ChartBar />} title="No completed sales" copy="Choose a date range with delivered orders." />}</section>
    </section>}


    {tab === 'employees' && <section className="page employees-page">
      {selectedEmployee ? <>
        <PageHeader title={selectedEmployee.name} subtitle={selectedEmployee.active ? 'Active confirmation employee' : 'Inactive confirmation employee'} dark={dark} toggleTheme={() => setDark(!dark)} back={() => setSelectedEmployeeId(null)} />
        <div className="employee-detail"><section><span>Confirmation bonus earned</span><strong>{money(selectedEmployeeOrders.reduce((sum, order) => sum + (order.confirmationBonus ?? selectedEmployee.bonus), 0))}</strong><small>{selectedEmployeeOrders.length} confirmed {selectedEmployeeOrders.length === 1 ? 'order' : 'orders'} in total</small></section><h3>Confirmation history</h3>{selectedEmployeeOrders.map((order) => <article key={order.id}><div><b>{order.client}</b><p>{dateStamp(dateKey(order.confirmedAt || order.createdAt))} · {order.items.map((item) => products.find((product) => product.id === item.productId)?.name ?? 'Product').join(', ')}</p><span>{order.status}</span></div><strong>{money(order.confirmationBonus ?? selectedEmployee.bonus)}</strong></article>)}{!selectedEmployeeOrders.length && <EmptyState icon={<UserCheck />} title="No confirmations yet" copy="Assign this employee when confirming an order." />}</div>
      </> : <>
        <PageHeader title="Employees" subtitle="Confirmation work and bonuses" dark={dark} toggleTheme={() => setDark(!dark)} actions={<button className="square-action" aria-label="Open settings" onClick={() => setTab('settings')}><GearSix /></button>} />
        <p className="page-intro">Tap an employee to view confirmation history.</p>
        <div className="employee-ledger">{employeeSummaries.map(({ employee, count, bonus, productNames }) => <button className="employee-row" key={employee.id} onClick={() => setSelectedEmployeeId(employee.id)}><span className="employee-avatar">{employee.name.slice(0, 1).toUpperCase()}</span><span className="employee-name"><b>{employee.name}</b><small className={employee.active ? 'active' : 'inactive'}><i />{employee.active ? 'Active' : 'Inactive'}</small></span><span className="employee-work"><b><User />{count} confirmed {count === 1 ? 'order' : 'orders'}</b><small>{productNames.length ? productNames.join(' · ') : 'No products confirmed yet'}</small></span><strong>{money(bonus)}</strong><CaretRight /></button>)}{!employeeSummaries.length && <EmptyState icon={<UsersThree />} title="No employees yet" copy="Add confirmation employees from Settings." />}</div>
      </>}
    </section>}

    {tab === 'settings' && <section className="page settings-page">
      <PageHeader title="Settings" subtitle="Workspaces, team, and app controls" dark={dark} toggleTheme={() => setDark(!dark)} back={() => setTab('employees')} />
      <section className="settings-section"><h2>Shared workspace</h2><p>Use this code to invite a partner.</p><button className="workspace-code" onClick={() => { if (workspaceCode) void navigator.clipboard.writeText(workspaceCode); setNotice('Workspace code copied.') }}><strong>{workspaceCode ?? 'Loading…'}</strong><Copy /></button><div className="workspace-list">{workspaces.map((workspace) => <div className={workspace.id === workspaceId ? 'current' : ''} key={workspace.id}><button onClick={() => void switchWorkspace(workspace.id)}><Buildings /><span>{workspace.name}{workspace.id === workspaceId && <small> · Current</small>}</span></button>{workspace.is_owner && <button className="danger-icon" aria-label={`Delete ${workspace.name}`} onClick={() => void deleteWorkspace(workspace.id, workspace.name)}><Trash /></button>}</div>)}</div><div className="settings-inline-actions"><button onClick={() => void manageWorkspace('create')}><Plus />Create workspace</button><button onClick={() => void manageWorkspace('join')}><UserPlus />Join workspace</button></div></section>
      <section className="settings-section"><div className="settings-section-head"><div><h2>Confirmation team</h2><p>Admins can confirm orders with no bonus.</p></div><button className="mini-primary" onClick={() => setShowConfirmationTeam(true)}><Plus />Add</button></div><div className="team-list">{confirmationEmployees.map((employee) => <article key={employee.id}><span className="team-avatar"><User /></span><div><h3>{employee.name}</h3><p>{money(employee.bonus)} per confirmation · <b>{employee.active ? 'Active' : 'Inactive'}</b></p></div><button aria-label={`Edit ${employee.name}`} onClick={() => void editConfirmationEmployee(employee)}><PencilSimple /></button><button aria-label={employee.active ? `Pause ${employee.name}` : `Activate ${employee.name}`} onClick={() => void toggleConfirmationEmployee(employee)}>{employee.active ? <Pause /> : <Play />}</button></article>)}{!confirmationEmployees.length && <EmptyState icon={<UsersThree />} title="No employees yet" copy="Add your confirmation team here." />}</div></section>
      <section className="account-actions"><button onClick={() => void loadCloud()}><ArrowsClockwise />Refresh shared data</button><button className="sign-out" onClick={() => void supabase?.auth.signOut()}><SignOut />Sign out</button></section>
    </section>}

    </div></div>}

    {tab === 'map' && <section className="map-screen"><DeliveryMap orders={orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Cancelled')} /><div className="map-heading"><h1>Map</h1><p>{orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Cancelled').length} active deliveries</p></div><button className="map-theme" onClick={() => setDark(!dark)}>{dark ? <Moon weight="fill" /> : <Sun />}<span>{dark ? 'Dark' : 'Light'}</span><CaretDown /></button><div className="map-legend"><span><i className="delivery" />{orders.filter((order) => order.status === 'Out for delivery').length} Out for delivery</span><b>·</b><span><i className="confirmed" />{orders.filter((order) => order.status === 'Confirmed').length} Confirmed</span></div></section>}

    <nav className="ledger-bottom-nav"><NavButton icon="orders" label="Orders" active={tab === 'orders'} onClick={() => setTab('orders')} /><NavButton icon="inventory" label="Inventory" active={tab === 'inventory'} onClick={() => setTab('inventory')} /><NavButton icon="profit" label="Profit" active={tab === 'profit'} onClick={() => setTab('profit')} /><NavButton icon="employees" label="Employees" active={tab === 'employees' || tab === 'settings'} onClick={() => { setSelectedEmployeeId(null); setTab('employees') }} /><NavButton icon="map" label="Map" active={tab === 'map'} onClick={() => setTab('map')} /></nav>
    {tab === 'orders' && <button className="ledger-fab" onClick={() => setShowOrder(true)}><Plus />New order</button>}
    {tab === 'inventory' && <button className="ledger-fab" onClick={() => setShowProduct(true)}><Plus />Product</button>}

    {showOrderCalendar && <DateRangeCalendar value={orderRange} onChange={setOrderRange} close={() => setShowOrderCalendar(false)} />}
    {showOrder && <Modal title="New order" close={() => setShowOrder(false)}><OrderForm products={products} members={members} confirmationEmployees={confirmationEmployees} onSubmit={addOrder} /></Modal>}
    {editingOrder && <Modal title="Edit order" close={() => setEditingOrder(null)}><OrderForm order={editingOrder} products={products} members={members} confirmationEmployees={confirmationEmployees} onSubmit={updateOrder} submitLabel="Save changes" /></Modal>}
    {showConfirmationTeam && <Modal title="Confirmation team" close={() => setShowConfirmationTeam(false)}><div className="confirmation-team"><p className="team-intro">Add your confirmation staff here. Admin confirmations are always recorded with no bonus.</p><form onSubmit={(event) => { event.preventDefault(); void addConfirmationEmployee(event.currentTarget) }} className="form"><label className="form-field"><span>Employee name</span><input required name="name" /></label><label className="form-field"><span>Bonus per confirmed order (DH)</span><input required name="bonus" type="number" min="0" step="1" defaultValue="5" /></label><button className="primary full">Add employee</button></form><div className="confirmation-team-list">{confirmationEmployees.map((employee) => <article key={employee.id}><div><b>{employee.name}</b><p>{money(employee.bonus)} per confirmation · {employee.active ? 'Active' : 'Inactive'}</p></div><div><button onClick={() => void editConfirmationEmployee(employee)}>Edit</button><button onClick={() => void toggleConfirmationEmployee(employee)}>{employee.active ? 'Pause' : 'Activate'}</button></div></article>)}{!confirmationEmployees.length && <p className="empty-date-range">No confirmation employees yet.</p>}</div></div></Modal>}
    {showProduct && <Modal title="Add product" close={() => setShowProduct(false)}><form onSubmit={(event) => { event.preventDefault(); void addProduct(event.currentTarget) }} className="form"><label className="form-field"><span>Product name</span><input required name="name" /></label><div className="form-row"><label className="form-field"><span>Buying cost</span><input required name="cost" type="number" /></label><label className="form-field"><span>Selling price</span><input required name="price" type="number" /></label></div><div className="form-row"><label className="form-field"><span>Opening stock</span><input required name="stock" type="number" /></label><label className="form-field"><span>Low-stock warning</span><input name="lowStockAt" type="number" defaultValue="3" /></label></div><button className="primary full">Save product</button></form></Modal>}
    {editingProduct && <Modal title={`Edit ${editingProduct.components ? 'bundle' : 'product'}`} close={() => setEditingProduct(null)}><form onSubmit={(event) => { event.preventDefault(); void updateProduct(event.currentTarget) }} className="form"><label className="form-field"><span>Name</span><input required name="name" defaultValue={editingProduct.name} /></label><div className="form-row"><label className="form-field"><span>Cost</span><input name="cost" type="number" defaultValue={editingProduct.components ? productCost(editingProduct, products) : editingProduct.cost} disabled={Boolean(editingProduct.components)} /></label><label className="form-field"><span>Selling price</span><input required name="price" type="number" defaultValue={editingProduct.price} /></label></div>{!editingProduct.components && <div className="form-row"><label className="form-field"><span>Stock</span><input name="stock" type="number" defaultValue={editingProduct.stock} /></label><label className="form-field"><span>Low-stock warning</span><input name="lowStockAt" type="number" defaultValue={editingProduct.lowStockAt} /></label></div>}<button className="primary full">Save changes</button></form></Modal>}
    {showBundle && <Modal title="Create bundle" close={() => setShowBundle(false)}><form onSubmit={(event) => { event.preventDefault(); void addBundle(event.currentTarget) }} className="form"><label className="form-field"><span>Bundle name</span><input required name="name" /></label><label className="form-field"><span>Bundle selling price</span><input required name="price" type="number" /></label><p className="form-note">Products inside this bundle</p>{bundleLines.map((line, index) => <div className="bundle-line" key={index}><label className="form-field"><span>Product {index + 1}</span><select value={line.productId} onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, productId: event.target.value } : item))}><option value="">Choose product</option>{products.filter((product) => !product.components).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}</select></label><label className="form-field"><span>Quantity</span><input type="number" min="1" value={line.quantity} onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, quantity: Number(event.target.value) || 1 } : item))} /></label>{bundleLines.length > 2 && <button className="remove-line" type="button" aria-label={`Remove product ${index + 1}`} onClick={() => setBundleLines((all) => all.filter((_item, lineIndex) => lineIndex !== index))}><X /></button>}</div>)}<button className="add-line" type="button" onClick={() => setBundleLines((all) => [...all, { productId: '', quantity: 1 }])}><Plus />Add another product</button><button className="primary full">Save bundle</button></form></Modal>}
    {showRoutePlan && <Modal title="Delivery route" close={() => setShowRoutePlan(false)}><div className="route-plan">{routeBusy && <p>Finding the best delivery order from your current location…</p>}{routeError && <p className="route-error">{routeError}</p>}{!routeBusy && !routeError && plannedOrders.map((order, index) => <article key={order.id}><b>{index + 1}</b><div><strong>{order.client}</strong><span>{order.address}</span></div><a href={navigationUrl(order)} target="_blank"><NavigationArrow />Navigate</a></article>)}</div></Modal>}
    </>}
  </main>
}

function OrderForm({ order, products, members, confirmationEmployees, onSubmit, submitLabel = 'Save order' }: { order?: Order; products: Product[]; members: { id: string; display_name: string | null }[]; confirmationEmployees: ConfirmationEmployee[]; onSubmit: (form: HTMLFormElement) => Promise<void>; submitLabel?: string }) {
  const assignees = members.length ? members.map((member) => ({ value: member.id, label: member.display_name || 'Team member' })) : people.map((person) => ({ value: person, label: person }))
  return <form onSubmit={(event) => { event.preventDefault(); void onSubmit(event.currentTarget) }} className="form">
    <label className="form-field"><span>Customer name</span><input required name="client" defaultValue={order?.client} /></label>
    <label className="form-field"><span>WhatsApp number</span><input required name="phone" defaultValue={order?.phone} /></label>
    <label className="form-field"><span>Address <small>Arabic or English</small></span><input required name="address" defaultValue={order?.address} /></label>
    <label className="form-field"><span>Google Maps link <small>Optional</small></span><input name="locationUrl" type="url" defaultValue={order?.locationUrl} /></label>
    <label className="form-field"><span>Product or bundle</span><select name="product" defaultValue={order?.items[0]?.productId}>{products.map((product) => <option value={product.id} key={product.id}>{product.components ? 'Bundle: ' : ''}{product.name} — {money(product.price)}</option>)}</select></label>
    <div className="form-row"><label className="form-field"><span>Quantity</span><input name="quantity" type="number" min="1" defaultValue={order?.items[0]?.quantity || 1} /></label><label className="form-field"><span>Custom price <small>Optional</small></span><input name="price" type="number" defaultValue={order?.items[0]?.unitPrice} /></label></div>
    <div className="form-row"><label className="form-field"><span>Delivery person</span><select name="assignedTo" defaultValue={order?.assignedTo}>{assignees.map((person) => <option value={person.value} key={person.value}>{person.label}</option>)}</select></label><label className="form-field"><span>Delivery expense</span><input name="deliveryCharge" type="number" defaultValue={order?.deliveryCharge} /></label></div>
    <div className="form-row"><label className="form-field"><span>Order status</span><select name="status" defaultValue={order?.status || 'New'}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label className="form-field"><span>Payment status</span><select name="paymentStatus" defaultValue={order?.paymentStatus || 'Pay on delivery'}>{paymentStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
    <label className="form-field"><span>Confirmed by</span><select name="confirmationEmployeeId" defaultValue={order?.confirmationEmployeeId || ''}><option value="">Admin (no bonus)</option>{confirmationEmployees.filter((employee) => employee.active || employee.id === order?.confirmationEmployeeId).map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {money(employee.bonus)} per confirmation</option>)}</select></label>
    <label className="form-field"><span>Other expense <small>Optional</small></span><input name="otherExpense" type="number" defaultValue={order?.otherExpense} /></label>
    <label className="form-field"><span>Note</span><textarea name="notes" defaultValue={order?.notes} /></label>
    <button className="primary full">{submitLabel}</button>
  </form>
}

function OrderCard({ order, products, members, confirmationEmployees, onStatus, onEdit }: { order: Order; products: Product[]; members: { id: string; display_name: string | null }[]; confirmationEmployees: ConfirmationEmployee[]; onStatus: (id: string, status: Status) => void; onEdit: (order: Order) => void }) {
  const lines = order.items.map((item) => `${products.find((p) => p.id === item.productId)?.name ?? 'Product'} ×${item.quantity}`).join(', ')
  const assignee = members.find(member => member.id === order.assignedTo)?.display_name || order.assignedTo || 'Unassigned'
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const confirmer = confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId)
  const tone = order.status.toLowerCase().replaceAll(' ', '-')
  return <article className={`order-row tone-${tone}`}><span className="status-rail"><i /></span><div className="order-primary"><div className="order-heading"><div><h3>{order.client}</h3><a href={`https://wa.me/${order.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{order.phone}</a></div><div className="row-actions"><label className={`status-control tone-${tone}`}><StatusIcon status={order.status} /><select aria-label="Order status" value={order.status} onChange={(event) => void onStatus(order.id, event.target.value as Status)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select><CaretDown /></label><button aria-label={`Edit ${order.client}`} onClick={() => onEdit(order)}><PencilSimple /></button></div></div><div className="address-line">{order.locationUrl?.trim() ? <a href={navigationUrl(order)} target="_blank" rel="noreferrer"><span>{order.address}</span><ArrowSquareOut /><span className="map-mini"><MapPin /></span></a> : <span>{order.address}</span>}</div><p className="product-line">{lines}</p>{order.notes?.trim() && <p className="note-line"><NoteBlank /><span><b>Note:</b> {order.notes}</span></p>}<div className="order-meta"><span><Tag />{money(total)}</span><span><User />{assignee}</span>{confirmer && <span><UserCheck />Confirmed by {confirmer.name}</span>}</div></div></article>
}

function PageHeader({ title, subtitle, dark, toggleTheme, actions, back }: { title: string; subtitle: string; dark: boolean; toggleTheme: () => void; actions?: ReactNode; back?: () => void }) { return <header className="ledger-header"><div className="ledger-title-wrap">{back && <button className="back-icon" aria-label="Go back" onClick={back}><ArrowLeft /></button>}<div><h1>{title}</h1><p>{subtitle}</p></div></div><div className="header-actions"><button className="square-action theme-toggle" aria-label={dark ? 'Use light mode' : 'Use dark mode'} onClick={toggleTheme}>{dark ? <Moon weight="fill" /> : <Sun />}</button>{actions}</div></header> }

function DateRangeCalendar({ value, onChange, close }: { value: DateRange; onChange: (range: DateRange) => void; close: () => void }) {
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(`${value.start}T12:00:00`); return new Date(date.getFullYear(), date.getMonth(), 1) })
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const dragAnchor = useRef<string | null>(null)
  const dragMoved = useRef(false)
  const continuingSelection = useRef(false)
  const today = dateKey(new Date())
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
  const calendarStart = new Date(monthStart); calendarStart.setDate(calendarStart.getDate() - ((calendarStart.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_item, index) => { const day = new Date(calendarStart); day.setDate(calendarStart.getDate() + index); return day })
  const selectTo = (anchor: string, target: string) => onChange(normalizedRange(anchor, target))
  const chooseWithKeyboard = (key: string) => {
    if (selectionAnchor) { selectTo(selectionAnchor, key); setSelectionAnchor(null) }
    else { onChange({ start: key, end: key }); setSelectionAnchor(key) }
  }
  const startDrag = (key: string, pointerId: number) => {
    const anchor = selectionAnchor ?? key
    dragAnchor.current = anchor; dragMoved.current = false; continuingSelection.current = Boolean(selectionAnchor)
    if (selectionAnchor) selectTo(selectionAnchor, key); else onChange({ start: key, end: key })
    grid.current?.setPointerCapture(pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragAnchor.current) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-date]')
    const key = target?.dataset.date
    if (!key) return
    if (key !== dragAnchor.current) dragMoved.current = true
    selectTo(dragAnchor.current, key)
  }
  const endDrag = () => {
    if (!dragAnchor.current) return
    if (dragMoved.current || continuingSelection.current) setSelectionAnchor(null); else setSelectionAnchor(dragAnchor.current)
    dragAnchor.current = null
  }
  const resetToMonth = () => {
    const now = new Date(); const range = { start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: monthEndKey(now) }
    onChange(range); setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectionAnchor(null)
  }
  return <div className="range-calendar-scrim" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="range-calendar" role="dialog" aria-modal="true" aria-label="Choose order date range">
      <header><div><span>Order range</span><strong>{rangeLabel(value)}</strong></div><button type="button" onClick={close} aria-label="Close calendar"><X /></button></header>
      <div className="calendar-month-nav"><button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} aria-label="Previous month"><CaretLeft /></button><h2>{monthLabel(dateKey(visibleMonth))}</h2><button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} aria-label="Next month"><CaretRight /></button></div>
      <p className="calendar-hint">Press and swipe across dates, or tap a start and end date.</p>
      <div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid" ref={grid} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        {days.map((day) => { const key = dateKey(day); const inMonth = day.getMonth() === visibleMonth.getMonth(); const inRange = key >= value.start && key <= value.end; const edge = key === value.start || key === value.end
          return <button key={key} type="button" data-date={key} className={`${inMonth ? '' : 'outside'} ${inRange ? 'in-range' : ''} ${edge ? 'range-edge' : ''} ${key === today ? 'today' : ''}`} aria-label={longDate(key)} aria-pressed={inRange} onPointerDown={(event) => { event.preventDefault(); startDrag(key, event.pointerId) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseWithKeyboard(key) } }}><span>{day.getDate()}</span></button> })}
      </div>
      <footer><button type="button" className="calendar-reset" onClick={resetToMonth}>This month</button><button type="button" className="calendar-done" onClick={close}>Show orders</button></footer>
    </section>
  </div>
}
function StatusIcon({ status }: { status: Status }) { if (status === 'Out for delivery') return <Truck />; if (status === 'Delivered' || status === 'Confirmed') return <CheckCircle />; if (status === 'Cancelled') return <X />; if (status === 'Preparing') return <Package />; return <ClipboardText /> }
function NavButton({ icon, label, active, onClick }: { icon: 'orders' | 'inventory' | 'profit' | 'employees' | 'map'; label: string; active: boolean; onClick: () => void }) { const icons = { orders: <ClipboardText />, inventory: <Cube />, profit: <ChartBar />, employees: <UsersThree />, map: <MapPin /> }; return <button className={active ? 'active' : ''} onClick={onClick}>{icons[icon]}<span>{label}</span></button> }
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="profit-metric"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></div> }
function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) { return <div className="empty-state"><span>{icon}</span><b>{title}</b><p>{copy}</p></div> }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={close}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button aria-label="Close" onClick={close}><X /></button></div>{children}</section></div> }
function navigationUrl(order: Order) { return order.locationUrl || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}&travelmode=driving&dir_action=navigate` }
type Coordinates = { latitude: number; longitude: number }
function mapCoordinates(locationUrl?: string): Coordinates | null {
  if (!locationUrl) return null
  const source = decodeURIComponent(locationUrl)
  const patterns: { expression: RegExp; reverse?: boolean }[] = [
    { expression: /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /[?&](?:q|query|ll|destination|origin)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
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
function locationCacheKey(locationUrl: string) { return `tanger-location:v2:${locationUrl}` }
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
  return <main className="gate"><p className="eyebrow">LOCAL DELIVERY · TANGER</p><h1>Tanger Orders</h1><p>One shared place for every order.</p><form className="form auth-form" onSubmit={submit}>{signUp && <label className="form-field"><span>Your name</span><input name="name" required /></label>}<label className="form-field"><span>Email</span><input name="email" type="email" required /></label><label className="form-field"><span>Password <small>6+ characters</small></span><input name="password" type="password" minLength={6} required /></label><button className="primary full">{signUp ? 'Create account' : 'Sign in'}</button></form><button className="link-button" onClick={() => setSignUp(!signUp)}>{signUp ? 'Already have an account? Sign in' : 'New here? Create account'}</button>{message && <p className="message">{message}</p>}</main>
}

function WorkspaceScreen({ onReady }: { onReady: () => Promise<void> }) {
  const [mode, setMode] = useState<'create' | 'join'>('create'); const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    const value = String(new FormData(event.currentTarget).get('value'))
    const { error } = await supabase.rpc(mode === 'create' ? 'create_workspace' : 'join_workspace', mode === 'create' ? { workspace_name: value } : { code: value })
    if (error) setMessage(error.message); else await onReady()
  }
  return <main className="gate"><p className="eyebrow">FIRST-TIME SETUP</p><h1>{mode === 'create' ? 'Create your shared workspace' : 'Join your partner'}</h1><p>{mode === 'create' ? 'You will receive a code to share with your friend.' : 'Enter the code shown in your partner’s app.'}</p><form className="form auth-form" onSubmit={submit}><label className="form-field"><span>{mode === 'create' ? 'Business name' : 'Workspace code'}</span><input name="value" required /></label><button className="primary full">{mode === 'create' ? 'Create workspace' : 'Join workspace'}</button></form><button className="link-button" onClick={() => setMode(mode === 'create' ? 'join' : 'create')}>{mode === 'create' ? 'I have a code' : 'I need to create one'}</button>{message && <p className="message">{message}</p>}</main>
}

function DeliveryMap({ orders }: { orders: Order[] }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
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

    map.current?.remove();
    map.current = L.map(element.current, { zoomControl: false }).setView([currentLocation.latitude, currentLocation.longitude], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    const layer = L.layerGroup().addTo(map.current);
    const markerIcon = new L.Icon({ iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
    const currentLabel = usingFallbackLocation ? 'Hay El Majd (location permission unavailable)' : 'Your current location';
    L.marker([currentLocation.latitude, currentLocation.longitude], { icon: markerIcon })
      .bindPopup(`<strong>${currentLabel}</strong>`)
      .addTo(layer);

    points.forEach(({ order, coordinates }, index) => {
      L.marker([coordinates.latitude, coordinates.longitude], { icon: markerIcon, zIndexOffset: 1000 })
        .bindPopup(`<strong>${index + 1}. ${order.client}</strong><br>${order.address}<br><a href="${navigationUrl(order)}" target="_blank">Open in Google Maps</a>`)
        .addTo(layer);
    });

    const bounds: [number, number][] = [[currentLocation.latitude, currentLocation.longitude], ...points.map(({ coordinates }): [number, number] => [coordinates.latitude, coordinates.longitude])];
    map.current.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 14, animate: false });
    const invalidateTimer = window.setTimeout(() => map.current?.invalidateSize({ animate: false }), 100);
    return () => { window.clearTimeout(invalidateTimer); const currentMap = map.current; map.current = null; currentMap?.stop(); currentMap?.remove(); };
  }, [resolvedOrders, currentLocation, usingFallbackLocation]);

  return <><div ref={element} className="map-canvas" />{!resolvedOrders.length && <p className="map-empty">Add Google Maps location links to orders to see them here.</p>}</>;
}
