import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowsClockwise,
  BellRinging,
  BellSlash,
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
  LockKey,
  MagnifyingGlass,
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
  Tag,
  Trash,
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
import { EmptyState, FeatureBoundary, Metric, Modal, NavButton, PageHeader } from './components/ui'
import { initialOrders, initialProducts } from './data'
import { DesktopOrdersView, DesktopSidebar } from './features/orders/DesktopOrders'
import { OrderCard, OrderForm } from './features/orders/OrderComponents'
import {
  bundleStock,
  confirmationBonusFor,
  dateKey,
  dateStamp,
  isConfirmedOrder,
  isWholeMonth,
  itemCost,
  longDate,
  money,
  monthEndKey,
  monthLabel,
  monthStartKey,
  navigationUrl,
  normalizedRange,
  normalizeStatus,
  openingBatches,
  orderFilters,
  productCost,
  rangeLabel,
  shortDate,
  uid,
  type AppTab,
  type BonusBasis,
  type ConfirmationEmployee,
  type DateRange,
} from './domain/orders'
import { supabase } from './supabase'
import {
  authRedirectUrl,
  cloudflareApiUrl,
  getCurrentDevicePosition,
  isLocationPermissionDenied,
  listenForNativeAuthLinks,
  listenForNativeBackButton,
  type DevicePosition,
} from './nativePlatform'
import {
  consumePendingPushOrderIds,
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationState,
  initializePushNotifications,
  listenForPushNotificationOrders,
  type PushNotificationState,
} from './pushNotifications'
import type { InventoryBatch, Order, PaymentStatus, Product, Status } from './types'

type WorkspaceStatus = 'checking' | 'ready' | 'missing' | 'error'
type ResourceName = 'workspace' | 'orders' | 'products' | 'members' | 'employees' | 'inventory'
type ResourcePhase = 'idle' | 'loading' | 'ready' | 'error'
type PendingOrder = { workspaceId: string; order: Order; status: 'saving' | 'failed'; lastError?: string }

const emptyResourcePhases: Record<ResourceName, ResourcePhase> = {
  workspace: 'idle', orders: 'idle', products: 'idle', members: 'idle', employees: 'idle', inventory: 'idle',
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function orderFromRow(row: any): Order {
  return { id: row.id, client: row.client_name, phone: row.phone, address: row.address, locationUrl: row.location_url ?? undefined, items: row.items, status: normalizeStatus(row.status), paymentStatus: row.payment_status, assignedTo: row.assigned_to ?? '', deliveryCharge: Number(row.delivery_charge), otherExpense: Number(row.other_expense), notes: row.notes, createdAt: row.created_at, deliveredAt: row.delivered_at ?? undefined, confirmationEmployeeId: row.confirmation_employee_id ?? undefined, confirmationBonus: Number(row.confirmation_bonus ?? 0), confirmedAt: row.confirmed_at ?? undefined }
}

function orderToRow(order: Order, workspaceId: string) {
  return { id: order.id, workspace_id: workspaceId, client_name: order.client, phone: order.phone, address: order.address, location_url: order.locationUrl || null, items: order.items, status: order.status, payment_status: order.paymentStatus, assigned_to: order.assignedTo || null, delivery_charge: order.deliveryCharge, other_expense: order.otherExpense, notes: order.notes, delivered_at: order.deliveredAt ?? null, confirmation_employee_id: order.confirmationEmployeeId ?? null, confirmation_bonus: order.confirmationBonus ?? 0, confirmed_at: order.confirmedAt ?? null }
}

export default function App() {
  const devDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryUrl)
  useEffect(() => { void initializePushNotifications() }, [])
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(nextSession)
      setLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    let disposed = false
    let removeListener: () => void = () => undefined
    void listenForNativeAuthLinks((result) => {
      if (result.type === 'recovery') setPasswordRecovery(true)
      if (result.error) console.error('Authentication link error:', result.error)
    }).then((remove) => {
      if (disposed) remove()
      else removeListener = remove
    })
    return () => { disposed = true; removeListener() }
  }, [])
  if (!devDemo && loading) return <div className="gate">Connecting to Tanger Orders…</div>
  function finishPasswordRecovery() {
    setPasswordRecovery(false)
    clearPasswordRecoveryUrl()
  }
  if (!devDemo && passwordRecovery && supabase && session) return <PasswordRecoveryScreen onComplete={finishPasswordRecovery} />
  if (!devDemo && passwordRecovery && supabase && !session) return <RecoveryLinkError onBack={finishPasswordRecovery} />
  if (!devDemo && supabase && !session) return <AuthScreen />
  return <OrderApp session={session} devDemo={devDemo} />
}

function isPasswordRecoveryUrl() {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return query.get('type') === 'recovery' || hash.get('type') === 'recovery'
}

function clearPasswordRecoveryUrl() {
  const url = new URL(window.location.href)
  url.hash = ''
  url.searchParams.delete('type')
  url.searchParams.delete('code')
  url.searchParams.delete('token_hash')
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`)
}

function OrderApp({ session, devDemo }: { session: Session | null; devDemo: boolean }) {
  const storageOwner = session?.user.id ?? 'preview'
  const workspaceHintKey = `tanger-workspace:${storageOwner}`
  const cachedWorkspaceId = devDemo ? 'demo-workspace' : localStorage.getItem(workspaceHintKey)
  const initialOrdersStorageKey = `tanger-orders:${storageOwner}:${cachedWorkspaceId ?? 'unassigned'}`
  const initialProductsStorageKey = `tanger-products:${storageOwner}:${cachedWorkspaceId ?? 'unassigned'}`
  const outboxStorageKey = `tanger-order-outbox:${storageOwner}`
  const [tab, setTab] = useState<AppTab>(() => {
    const requested = devDemo ? new URLSearchParams(window.location.search).get('tab') : null
    return requested && ['orders', 'inventory', 'profit', 'employees', 'map', 'settings'].includes(requested) ? requested as AppTab : 'orders'
  })
  const [dark, setDark] = useState(() => localStorage.getItem('quiet-ledger-theme') === 'dark')
  const [orderRange, setOrderRange] = useState<DateRange>(() => ({ start: monthStartKey(), end: monthEndKey() }))
  const [showOrderCalendar, setShowOrderCalendar] = useState(false)
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>(() => devDemo ? [] : readStored<PendingOrder[]>(outboxStorageKey, []))
  const [orders, setOrders] = useState<Order[]>(() => {
    const stored = devDemo ? initialOrders : readStored<Order[]>(initialOrdersStorageKey, [])
    const queued = devDemo ? [] : readStored<PendingOrder[]>(outboxStorageKey, []).filter((entry) => entry.workspaceId === cachedWorkspaceId).map((entry) => entry.order)
    return [...queued, ...stored.filter((order) => !queued.some((queuedOrder) => queuedOrder.id === order.id))].map((order: Order) => ({ ...order, status: normalizeStatus(order.status) }))
  })
  const [products, setProducts] = useState<Product[]>(() => devDemo ? initialProducts : readStored<Product[]>(initialProductsStorageKey, []))
  const [inventoryBatches, setInventoryBatches] = useState<InventoryBatch[]>(() => devDemo ? openingBatches(initialProducts) : [])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All')
  const [showOrder, setShowOrder] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [showProduct, setShowProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [restockingProduct, setRestockingProduct] = useState<Product | null>(null)
  const [showBundle, setShowBundle] = useState(false)
  const [bundleLines, setBundleLines] = useState([{ productId: '', quantity: 1 }, { productId: '', quantity: 1 }])
  const [showSearch, setShowSearch] = useState(false)
  const [showRoutePlan, setShowRoutePlan] = useState(false)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [plannedOrders, setPlannedOrders] = useState<Order[]>([])
  const [, setNotice] = useState('Demo data is saved only in this browser until Supabase is connected.')
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => devDemo ? 'demo-workspace' : null)
  const ordersStorageKey = `tanger-orders:${storageOwner}:${workspaceId ?? cachedWorkspaceId ?? 'unassigned'}`
  const productsStorageKey = `tanger-products:${storageOwner}:${workspaceId ?? cachedWorkspaceId ?? 'unassigned'}`
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>(() => devDemo ? 'ready' : 'checking')
  const [workspaceError, setWorkspaceError] = useState('')
  const [resourcePhases, setResourcePhases] = useState<Record<ResourceName, ResourcePhase>>(() => devDemo ? Object.fromEntries(Object.keys(emptyResourcePhases).map((key) => [key, 'ready'])) as Record<ResourceName, ResourcePhase> : emptyResourcePhases)
  const [resourceErrors, setResourceErrors] = useState<Partial<Record<ResourceName, string>>>({})
  const [workspaceCode, setWorkspaceCode] = useState<string | null>(() => devDemo ? 'TNG-4821' : null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; join_code: string; is_owner: boolean }[]>(() => devDemo ? [{ id: 'demo-workspace', name: 'Tanger Orders', join_code: 'TNG-4821', is_owner: true }] : [])
  const [members, setMembers] = useState<{ id: string; display_name: string | null }[]>([])
  const [confirmationEmployees, setConfirmationEmployees] = useState<ConfirmationEmployee[]>(() => devDemo ? [{ id: 'demo-amina', name: 'Amina', bonus: 5, bonusBasis: 'per_order', active: true }, { id: 'demo-karim', name: 'Karim', bonus: 5, bonusBasis: 'per_item', active: true }] : [])
  const [showConfirmationTeam, setShowConfirmationTeam] = useState(false)
  const [editingConfirmationEmployee, setEditingConfirmationEmployee] = useState<ConfirmationEmployee | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [profitStart, setProfitStart] = useState(monthStartKey)
  const [profitEnd, setProfitEnd] = useState(() => dateKey(new Date()))
  const [pushState, setPushState] = useState<PushNotificationState>('prompt')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState('Get an alert when another admin adds or delivers an order.')
  const [highlightedPushOrderIds, setHighlightedPushOrderIds] = useState<string[]>(consumePendingPushOrderIds)
  const [showExitHint, setShowExitHint] = useState(false)
  const exitHintTimer = useRef<number | null>(null)
  const nativeBackAction = useRef<() => boolean>(() => false)
  const pendingOrdersRef = useRef(pendingOrders)
  const syncingOrderIds = useRef(new Set<string>())

  useEffect(() => listenForPushNotificationOrders((orderId) => {
    setHighlightedPushOrderIds((current) => current.includes(orderId) ? current : [...current, orderId])
  }), [])
  useEffect(() => { if (highlightedPushOrderIds.length) setTab('orders') }, [highlightedPushOrderIds.length])
  useEffect(() => {
    if (!highlightedPushOrderIds.length) return
    const timer = window.setTimeout(() => setHighlightedPushOrderIds([]), 3500)
    return () => window.clearTimeout(timer)
  }, [highlightedPushOrderIds])

  nativeBackAction.current = () => {
    if (editingConfirmationEmployee) { setEditingConfirmationEmployee(null); return true }
    if (showOrderCalendar) { setShowOrderCalendar(false); return true }
    if (editingOrder) { setEditingOrder(null); return true }
    if (showOrder) { setShowOrder(false); return true }
    if (showProduct) { setShowProduct(false); return true }
    if (editingProduct) { setEditingProduct(null); return true }
    if (restockingProduct) { setRestockingProduct(null); return true }
    if (showBundle) { setShowBundle(false); return true }
    if (showRoutePlan) { setShowRoutePlan(false); return true }
    if (showConfirmationTeam) { setShowConfirmationTeam(false); return true }
    if (showSearch) { setShowSearch(false); return true }
    if (selectedEmployeeId) { setSelectedEmployeeId(null); return true }
    if (tab !== 'orders') { setTab('orders'); return true }
    return false
  }

  useEffect(() => {
    let disposed = false
    let removeListener: () => void = () => undefined
    void listenForNativeBackButton(
      () => nativeBackAction.current(),
      () => {
        setShowExitHint(true)
        if (exitHintTimer.current) window.clearTimeout(exitHintTimer.current)
        exitHintTimer.current = window.setTimeout(() => setShowExitHint(false), 2000)
      },
    ).then((remove) => {
      if (disposed) remove()
      else removeListener = remove
    })
    return () => {
      disposed = true
      removeListener()
      if (exitHintTimer.current) window.clearTimeout(exitHintTimer.current)
    }
  }, [])

  useEffect(() => { pendingOrdersRef.current = pendingOrders; if (!devDemo) localStorage.setItem(outboxStorageKey, JSON.stringify(pendingOrders)) }, [pendingOrders, devDemo, outboxStorageKey])
  useEffect(() => { if (!devDemo) localStorage.setItem(ordersStorageKey, JSON.stringify(orders)) }, [orders, devDemo, ordersStorageKey])
  useEffect(() => { if (!devDemo) localStorage.setItem(productsStorageKey, JSON.stringify(products)) }, [products, devDemo, productsStorageKey])
  useEffect(() => {
    localStorage.setItem('quiet-ledger-theme', dark ? 'dark' : 'light')
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])
  useEffect(() => {
    if (!showSearch) return
    const dismissSearch = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.search-field') || target?.closest('[data-search-toggle]')) return
      setShowSearch(false)
    }
    const dismissWithEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowSearch(false) }
    document.addEventListener('pointerdown', dismissSearch)
    document.addEventListener('keydown', dismissWithEscape)
    return () => { document.removeEventListener('pointerdown', dismissSearch); document.removeEventListener('keydown', dismissWithEscape) }
  }, [showSearch])
  useEffect(() => { if (tab !== 'orders') setShowSearch(false) }, [tab])
  useEffect(() => {
    if (devDemo || !workspaceId || !session) return
    let cancelled = false
    void getPushNotificationState().then(async (state) => {
      if (state === 'enabled') {
        await enablePushNotifications(workspaceId, session.user.id)
      }
      if (!cancelled) setPushState(state)
    }).catch(() => { if (!cancelled) setPushState('unsupported') })
    return () => { cancelled = true }
  }, [devDemo, session, workspaceId])

  async function turnOnPushNotifications() {
    if (!workspaceId || !session) return
    setPushBusy(true)
    setPushMessage('Connecting this phone…')
    try {
      await enablePushNotifications(workspaceId, session.user.id)
      setPushState('enabled')
      setPushMessage('This phone will be notified when another admin adds or delivers an order.')
    } catch (error) {
      const state = await getPushNotificationState().catch(() => 'unsupported' as const)
      setPushState(state)
      setPushMessage(error instanceof Error ? error.message : 'Could not enable notifications on this phone.')
    } finally {
      setPushBusy(false)
    }
  }

  async function turnOffPushNotifications() {
    setPushBusy(true)
    setPushMessage('Removing this phone…')
    try {
      await disablePushNotifications()
      setPushState('disabled')
      setPushMessage('Notifications are off on this phone.')
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'Could not disable notifications on this phone.')
    } finally {
      setPushBusy(false)
    }
  }

  function resourceStarted(name: ResourceName) {
    setResourcePhases((current) => ({ ...current, [name]: 'loading' }))
    setResourceErrors((current) => { const next = { ...current }; delete next[name]; return next })
  }

  function resourceFinished(name: ResourceName) {
    setResourcePhases((current) => ({ ...current, [name]: 'ready' }))
  }

  function resourceFailed(name: ResourceName, error: unknown) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Could not refresh this data.'
    setResourcePhases((current) => ({ ...current, [name]: 'error' }))
    setResourceErrors((current) => ({ ...current, [name]: message }))
  }

  async function loadResource(name: ResourceName, work: () => Promise<void>) {
    resourceStarted(name)
    try { await work(); resourceFinished(name) } catch (error) { resourceFailed(name, error) }
  }

  async function loadWorkspaceMeta(id: string) {
    const client = supabase
    if (!client) return
    await loadResource('workspace', async () => {
      const [workspace, memberships] = await Promise.all([
        client.from('workspaces').select('join_code').eq('id', id).single(),
        client.rpc('list_my_workspaces'),
      ])
      if (workspace.error) throw workspace.error
      if (memberships.error) throw memberships.error
      setWorkspaceCode(workspace.data?.join_code ?? null)
      setWorkspaces(memberships.data ?? [])
    })
  }

  async function loadProducts(id: string) {
    const client = supabase
    if (!client) return
    await loadResource('products', async () => {
      const result = await client.from('products').select('*').eq('workspace_id', id).order('created_at')
      if (result.error) throw result.error
      setProducts(result.data.map((row: any) => ({ id: row.id, name: row.name, cost: Number(row.cost), price: Number(row.price), stock: row.stock, lowStockAt: row.low_stock_at, components: row.components ?? undefined })))
    })
  }

  async function loadOrders(id: string) {
    const client = supabase
    if (!client) return
    await loadResource('orders', async () => {
      const result = await client.from('orders').select('*').eq('workspace_id', id).order('created_at', { ascending: false })
      if (result.error) throw result.error
      const cloudOrders = result.data.map(orderFromRow)
      const queued = pendingOrdersRef.current.filter((entry) => entry.workspaceId === id).map((entry) => entry.order)
      setOrders([...queued, ...cloudOrders.filter((order) => !queued.some((queuedOrder) => queuedOrder.id === order.id))])
    })
  }

  async function loadMembers(id: string) {
    const client = supabase
    if (!client) return
    await loadResource('members', async () => {
      const result = await client.from('profiles').select('id, display_name').eq('workspace_id', id)
      if (result.error) throw result.error
      setMembers(result.data ?? [])
    })
  }

  async function loadEmployees(id: string) {
    const client = supabase
    if (!client) return
    await loadResource('employees', async () => {
      const result = await client.from('confirmation_employees').select('*').eq('workspace_id', id).order('created_at')
      if (result.error) throw result.error
      setConfirmationEmployees(result.data.map((row: any) => ({ id: row.id, name: row.name, bonus: Number(row.bonus_per_confirmation), bonusBasis: row.bonus_basis === 'per_item' ? 'per_item' : 'per_order', active: row.active })))
    })
  }

  async function loadInventory(id: string) {
    const client = supabase
    if (!client) return
    await loadResource('inventory', async () => {
      const result = await client.from('inventory_batches').select('*').eq('workspace_id', id).in('source', ['opening_balance', 'restock', 'correction']).order('received_at', { ascending: false })
      if (result.error) throw result.error
      setInventoryBatches(result.data.map((row: any) => ({ id: row.id, productId: row.product_id, unitCost: Number(row.unit_cost), originalQuantity: row.original_quantity, remainingQuantity: row.remaining_quantity, receivedAt: row.received_at, source: row.source })))
    })
  }

  async function refreshWorkspaceData(id = workspaceId) {
    if (!id) return
    await Promise.all([loadWorkspaceMeta(id), loadProducts(id), loadOrders(id), loadMembers(id), loadEmployees(id), loadInventory(id)])
  }

  async function loadCloud() {
    if (!supabase || !session) return
    if (!workspaceId) setWorkspaceStatus('checking')
    setWorkspaceError('')
    const { data: profile, error } = await supabase.from('profiles').select('workspace_id').eq('id', session.user.id).single()
    if (error) {
      setWorkspaceError(error.message)
      if (workspaceId) resourceFailed('workspace', error)
      else setWorkspaceStatus('error')
      return
    }
    if (!profile.workspace_id) {
      localStorage.removeItem(workspaceHintKey)
      setWorkspaceId(null)
      setOrders([]); setProducts([]); setInventoryBatches([]); setMembers([]); setConfirmationEmployees([])
      setWorkspaceStatus('missing')
      return
    }
    if (profile.workspace_id !== (workspaceId ?? cachedWorkspaceId)) {
      setOrders(pendingOrdersRef.current.filter((entry) => entry.workspaceId === profile.workspace_id).map((entry) => entry.order))
      setProducts([]); setInventoryBatches([]); setMembers([]); setConfirmationEmployees([])
    }
    localStorage.setItem(workspaceHintKey, profile.workspace_id)
    setWorkspaceId(profile.workspace_id)
    setWorkspaceStatus('ready')
    await refreshWorkspaceData(profile.workspace_id)
  }
  useEffect(() => { if (!devDemo) void loadCloud() }, [session])
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible' && workspaceStatus === 'ready') void refreshWorkspaceData() }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [workspaceId, workspaceStatus])
  useEffect(() => {
    if (!supabase || !workspaceId || workspaceStatus !== 'ready') return
    const client = supabase
    const channel = client.channel(`tanger-orders-${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `workspace_id=eq.${workspaceId}` }, () => void loadOrders(workspaceId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `workspace_id=eq.${workspaceId}` }, () => { void loadProducts(workspaceId); void loadInventory(workspaceId) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'confirmation_employees', filter: `workspace_id=eq.${workspaceId}` }, () => void loadEmployees(workspaceId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_batches', filter: `workspace_id=eq.${workspaceId}` }, () => void loadInventory(workspaceId))
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [workspaceId, workspaceStatus])
  useEffect(() => {
    if (workspaceStatus !== 'ready') return
    const retry = () => { for (const entry of pendingOrdersRef.current) void syncPendingOrder(entry) }
    retry()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [workspaceStatus, workspaceId])

  const confirmationCost = (order: Order) => order.confirmationEmployeeId
    ? order.confirmationBonus ?? confirmationBonusFor(confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId), order.items)
    : 0
  const delivered = orders.filter((order) => order.status === 'Delivered')
  const profitOrders = delivered.filter((order) => {
    const orderDate = dateKey(order.deliveredAt || order.createdAt)
    return (!profitStart || orderDate >= profitStart) && (!profitEnd || orderDate <= profitEnd)
  })
  const profitTotals = useMemo(() => profitOrders.reduce((sum, order) => {
    const revenue = order.items.reduce((value, item) => value + item.quantity * item.unitPrice, 0)
    const costs = order.items.reduce((value, item) => value + itemCost(item, products), 0) + order.deliveryCharge + order.otherExpense
    const confirmationBonus = confirmationCost(order)
    return { revenue: sum.revenue + revenue, profit: sum.profit + revenue - costs - confirmationBonus, confirmationBonuses: sum.confirmationBonuses + confirmationBonus }
  }, { revenue: 0, profit: 0, confirmationBonuses: 0 }), [profitOrders, products, confirmationEmployees])
  const selectedRangeOrders = orders.filter((order) => { const created = dateKey(order.createdAt); return created >= orderRange.start && created <= orderRange.end })
  const selectedRangeDelivered = orders.filter((order) => { const deliveredAt = dateKey(order.deliveredAt || order.createdAt); return order.status === 'Delivered' && deliveredAt >= orderRange.start && deliveredAt <= orderRange.end })
  const selectedRangeProfit = selectedRangeDelivered.reduce((sum, order) => {
    const revenue = order.items.reduce((value, item) => value + item.quantity * item.unitPrice, 0)
    const costs = order.items.reduce((value, item) => value + itemCost(item, products), 0) + order.deliveryCharge + order.otherExpense + confirmationCost(order)
    return sum + revenue - costs
  }, 0)
  const employeeSummaries = confirmationEmployees.map((employee) => {
    const confirmations = orders.filter((order) => order.confirmationEmployeeId === employee.id && order.confirmedAt)
    const productNames = [...new Set(confirmations.flatMap((order) => order.items.map((item) => products.find((product) => product.id === item.productId)?.name).filter((name): name is string => Boolean(name))))]
    const itemCount = confirmations.reduce((sum, order) => sum + order.items.reduce((quantity, item) => quantity + item.quantity, 0), 0)
    return { employee, count: confirmations.length, itemCount, bonus: confirmations.reduce((sum, order) => sum + (order.confirmationBonus ?? confirmationBonusFor(employee, order.items)), 0), productNames }
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
    const becameDelivered = currentOrder?.status !== 'Delivered' && status === 'Delivered'
    const deliveredAt = status === 'Delivered' ? currentOrder?.deliveredAt || new Date().toISOString() : undefined
    const confirmedAt = currentOrder?.confirmedAt || (isConfirmedOrder(status) ? new Date().toISOString() : undefined)
    const employee = confirmationEmployees.find((item) => item.id === currentOrder?.confirmationEmployeeId)
    const confirmationBonus = currentOrder && isConfirmedOrder(status)
      ? currentOrder.confirmedAt ? currentOrder.confirmationBonus ?? confirmationBonusFor(employee, currentOrder.items) : confirmationBonusFor(employee, currentOrder.items)
      : 0
    setOrders((all) => all.map((order) => order.id === id ? { ...order, status, deliveredAt, confirmedAt, confirmationBonus } : order))
    if (supabase && workspaceId) {
      const { error } = await supabase.from('orders').update({ status, delivered_at: deliveredAt ?? null, confirmed_at: confirmedAt ?? null, confirmation_bonus: confirmationBonus }).eq('id', id)
      if (error) { setNotice(error.message); return }
      if (becameDelivered) {
        const { data: notification, error: notificationError } = await supabase.functions.invoke('notify-new-order', { body: { orderId: id, event: 'delivered' } })
        if (notificationError) setNotice('Order delivered, but phone notifications could not be sent.')
        else setNotice(notification?.sent ? `Order delivered and ${notification.sent} phone notification${notification.sent === 1 ? '' : 's'} sent.` : 'Order marked as delivered.')
      }
    }
  }

  const deleteOrder = async (order: Order) => {
    if (order.status === 'Delivered') { setNotice('Delivered orders cannot be deleted because their stock cannot be restored.'); return }
    if (!window.confirm(`Delete the order for “${order.client}”? This cannot be undone.`)) return
    if (supabase && workspaceId) {
      const { error } = await supabase.from('orders').delete().eq('id', order.id).eq('workspace_id', workspaceId)
      if (error) { setNotice(`Could not delete the order: ${error.message}`); return }
    }
    setOrders((all) => all.filter((item) => item.id !== order.id))
    if (editingOrder?.id === order.id) setEditingOrder(null)
    setNotice(`Order for ${order.client} deleted.`)
  }

  function updatePendingOrders(change: (current: PendingOrder[]) => PendingOrder[]) {
    setPendingOrders((current) => {
      const next = change(current)
      pendingOrdersRef.current = next
      if (!devDemo) localStorage.setItem(outboxStorageKey, JSON.stringify(next))
      return next
    })
  }

  async function syncPendingOrder(entry: PendingOrder) {
    if (!supabase || syncingOrderIds.current.has(entry.order.id)) return
    syncingOrderIds.current.add(entry.order.id)
    updatePendingOrders((current) => current.map((item) => item.order.id === entry.order.id ? { ...item, status: 'saving', lastError: undefined } : item))
    try {
      const { data, error } = await supabase.from('orders').upsert(orderToRow(entry.order, entry.workspaceId), { onConflict: 'id', ignoreDuplicates: true }).select('id')
      if (error) throw error
      updatePendingOrders((current) => current.filter((item) => item.order.id !== entry.order.id))
      setNotice('Order saved to the shared workspace.')
      if (data?.length) {
        void supabase.functions.invoke('notify-new-order', { body: { orderId: entry.order.id } }).then(({ data: notification, error: notificationError }) => {
          if (notificationError) setNotice('Order saved, but phone notifications could not be sent.')
          else if (notification?.sent) setNotice(`Order saved and ${notification.sent} phone notification${notification.sent === 1 ? '' : 's'} sent.`)
        })
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The order could not reach the shared database.'
      updatePendingOrders((current) => current.map((item) => item.order.id === entry.order.id ? { ...item, status: 'failed', lastError: message } : item))
      setNotice(message)
    } finally {
      syncingOrderIds.current.delete(entry.order.id)
    }
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
    const items = [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }]
    const order: Order = {
      id: uid(), client: String(values.get('client') || ''), phone: String(values.get('phone') || ''), address: String(values.get('address') || ''),
      items, status, paymentStatus: values.get('paymentStatus') as PaymentStatus || 'Pay on delivery',
      assignedTo: String(values.get('assignedTo')), deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: Number(values.get('otherExpense')) || 0, createdAt, deliveredAt: status === 'Delivered' ? createdAt : undefined, confirmationEmployeeId, confirmationBonus: isConfirmedOrder(status) ? confirmationBonusFor(confirmationEmployee, items) : 0, confirmedAt: isConfirmedOrder(status) ? createdAt : undefined, locationUrl: String(values.get('locationUrl') || ''), notes: String(values.get('notes') || ''),
    }
    setOrders((all) => [order, ...all])
    setShowOrder(false)
    if (supabase && workspaceId) {
      const pending: PendingOrder = { workspaceId, order, status: 'saving' }
      updatePendingOrders((current) => [pending, ...current.filter((entry) => entry.order.id !== order.id)])
      void syncPendingOrder(pending)
      return
    }
    setNotice('Order added to this browser preview.')
  }

  async function addProduct(form: HTMLFormElement) {
    const values = new FormData(form)
    const product = { id: uid(), name: String(values.get('name')), cost: Number(values.get('cost')) || 0, price: Number(values.get('price')) || 0, stock: Number(values.get('stock')) || 0, lowStockAt: Number(values.get('lowStockAt')) || 3 }
    setProducts((all) => [...all, product])
    if (supabase && workspaceId) { const { error } = await supabase.from('products').insert({ workspace_id: workspaceId, name: product.name, cost: product.cost, price: product.price, stock: product.stock, low_stock_at: product.lowStockAt }); if (error) setNotice(error.message) }
    setShowProduct(false)
  }

  async function restockProduct(product: Product, quantity: number, unitCost: number) {
    if (!devDemo && supabase && workspaceId) {
      const { error } = await supabase.rpc('restock_product', { target_product_id: product.id, added_quantity: quantity, new_unit_cost: unitCost })
      if (error) { setNotice(error.message); return }
      await loadCloud()
    } else {
      const receivedAt = new Date().toISOString()
      setInventoryBatches((all) => [{ id: uid(), productId: product.id, unitCost, originalQuantity: quantity, remainingQuantity: quantity, receivedAt, source: 'restock' }, ...all])
      setProducts((all) => all.map((item) => item.id === product.id ? { ...item, stock: item.stock + quantity, cost: item.stock > 0 ? item.cost : unitCost } : item))
    }
    setRestockingProduct(null)
    setNotice(`${product.name} restocked. The oldest units will still be costed first.`)
  }

  async function updateOrder(form: HTMLFormElement) {
    if (!editingOrder) return
    const values = new FormData(form)
    const product = products.find((item) => item.id === values.get('product'))
    const quantity = Number(values.get('quantity')) || 1
    const status = values.get('status') as Status
    const becameDelivered = editingOrder.status !== 'Delivered' && status === 'Delivered'
    const confirmationEmployeeId = String(values.get('confirmationEmployeeId') || '') || undefined
    const confirmationEmployee = confirmationEmployees.find((employee) => employee.id === confirmationEmployeeId)
    const isSameConfirmer = confirmationEmployeeId === editingOrder.confirmationEmployeeId
    const confirmedAt = editingOrder.confirmedAt || (isConfirmedOrder(status) ? new Date().toISOString() : undefined)
    const updatedItems = product ? [{ productId: product.id, quantity, unitPrice: Number(values.get('price')) || product.price }] : editingOrder.items
    const itemsUnchanged = JSON.stringify(updatedItems) === JSON.stringify(editingOrder.items)
    const confirmationBonus = confirmationEmployeeId && isConfirmedOrder(status)
      ? isSameConfirmer && itemsUnchanged && editingOrder.confirmedAt
        ? editingOrder.confirmationBonus ?? confirmationBonusFor(confirmationEmployee, updatedItems)
        : confirmationBonusFor(confirmationEmployee, updatedItems)
      : 0
    const updated: Order = { ...editingOrder, client: String(values.get('client')), phone: String(values.get('phone')), address: String(values.get('address')), locationUrl: String(values.get('locationUrl') || ''), items: updatedItems, assignedTo: String(values.get('assignedTo')), status, paymentStatus: values.get('paymentStatus') as PaymentStatus, deliveryCharge: Number(values.get('deliveryCharge')) || 0, otherExpense: Number(values.get('otherExpense')) || 0, notes: String(values.get('notes') || ''), deliveredAt: status === 'Delivered' ? editingOrder.deliveredAt || new Date().toISOString() : undefined, confirmationEmployeeId, confirmationBonus, confirmedAt }
    setOrders((all) => all.map((order) => order.id === updated.id ? updated : order))
    if (supabase && workspaceId) {
      const { error } = await supabase.from('orders').update({ client_name: updated.client, phone: updated.phone, address: updated.address, location_url: updated.locationUrl || null, items: updated.items, assigned_to: updated.assignedTo || null, status: updated.status, payment_status: updated.paymentStatus, delivery_charge: updated.deliveryCharge, other_expense: updated.otherExpense, notes: updated.notes, delivered_at: updated.deliveredAt ?? null, confirmation_employee_id: updated.confirmationEmployeeId ?? null, confirmation_bonus: updated.confirmationBonus ?? 0, confirmed_at: updated.confirmedAt ?? null }).eq('id', updated.id)
      if (error) { setNotice(error.message); return }
      if (becameDelivered) {
        const { error: notificationError } = await supabase.functions.invoke('notify-new-order', { body: { orderId: updated.id, event: 'delivered' } })
        if (notificationError) setNotice('Order delivered, but phone notifications could not be sent.')
      }
    }
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
    const correctedStock = editingProduct.components ? editingProduct.stock : Math.max(0, Math.floor(Number(values.get('stock')) || 0))
    const correctedCost = editingProduct.components ? editingProduct.cost : Math.max(0, Number(values.get('cost')) || 0)
    const updated: Product = { ...editingProduct, name: String(values.get('name')), cost: correctedCost, price: Number(values.get('price')) || 0, stock: correctedStock, lowStockAt: Number(values.get('lowStockAt')) || 0 }
    const inventoryChanged = !editingProduct.components && (correctedStock !== editingProduct.stock || correctedCost !== editingProduct.cost)

    if (!devDemo && supabase && workspaceId) {
      if (inventoryChanged) {
        const { error } = await supabase.rpc('correct_product_inventory', {
          target_product_id: updated.id,
          corrected_stock: updated.stock,
          corrected_active_cost: updated.cost,
          correction_note: String(values.get('correctionNote') || ''),
        })
        if (error) { setNotice(error.message); return }
      }
      const { error } = await supabase.from('products').update({ name: updated.name, price: updated.price, low_stock_at: updated.lowStockAt }).eq('id', updated.id)
      if (error) { setNotice(error.message); await loadCloud(); return }
      await loadCloud()
    } else {
      if (inventoryChanged) {
        setInventoryBatches((all) => {
          const next = all.map((batch) => ({ ...batch }))
          const active = next.filter((batch) => batch.productId === updated.id && batch.remainingQuantity > 0).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))[0]
          if (active) active.unitCost = updated.cost
          const delta = updated.stock - editingProduct.stock
          if (delta > 0) {
            next.push({ id: uid(), productId: updated.id, unitCost: updated.cost, originalQuantity: delta, remainingQuantity: delta, receivedAt: new Date().toISOString(), source: 'correction' })
          } else if (delta < 0) {
            let toRemove = -delta
            const newest = next.filter((batch) => batch.productId === updated.id && batch.remainingQuantity > 0).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
            newest.forEach((batch) => { const removed = Math.min(toRemove, batch.remainingQuantity); batch.remainingQuantity -= removed; toRemove -= removed })
          }
          return next
        })
      }
      setProducts((all) => all.map((product) => product.id === updated.id ? updated : product))
    }
    setEditingProduct(null)
    setNotice(inventoryChanged ? `${updated.name} corrected. Existing delivered-order costs were not changed.` : `${updated.name} updated.`)
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
    const bonusBasis = values.get('bonusBasis') === 'per_item' ? 'per_item' : 'per_order'
    if (!name) return
    if (!supabase) {
      setConfirmationEmployees((all) => [...all, { id: uid(), name, bonus: Number.isFinite(bonus) ? Math.max(0, bonus) : 5, bonusBasis, active: true }])
      form.reset()
      return
    }
    const { error } = await supabase.rpc('create_confirmation_employee', { employee_name: name, employee_bonus: Number.isFinite(bonus) ? Math.max(0, bonus) : 5, employee_bonus_basis: bonusBasis })
    if (error) { setNotice(error.message); return }
    form.reset(); await loadCloud()
  }

  async function editConfirmationEmployee(form: HTMLFormElement) {
    if (!editingConfirmationEmployee) return
    const values = new FormData(form)
    const name = String(values.get('name') || '').trim()
    const bonusBasis: BonusBasis = values.get('bonusBasis') === 'per_item' ? 'per_item' : 'per_order'
    const bonus = Number(values.get('bonus'))
    if (!name) { setNotice('Enter the employee name.'); return }
    if (!Number.isFinite(bonus) || bonus < 0) { setNotice('Enter a valid bonus amount.'); return }
    if (!supabase) {
      setConfirmationEmployees((all) => all.map((item) => item.id === editingConfirmationEmployee.id ? { ...item, name, bonus, bonusBasis } : item))
      setEditingConfirmationEmployee(null)
      return
    }
    const { error } = await supabase.rpc('update_confirmation_employee', { employee_id: editingConfirmationEmployee.id, employee_name: name, employee_bonus: bonus, employee_bonus_basis: bonusBasis, employee_active: editingConfirmationEmployee.active })
    if (error) { setNotice(error.message); return }
    setEditingConfirmationEmployee(null)
    await loadCloud()
  }

  async function toggleConfirmationEmployee(employee: ConfirmationEmployee) {
    if (!supabase) { setConfirmationEmployees((all) => all.map((item) => item.id === employee.id ? { ...item, active: !item.active } : item)); return }
    const { error } = await supabase.rpc('update_confirmation_employee', { employee_id: employee.id, employee_name: employee.name, employee_bonus: employee.bonus, employee_bonus_basis: employee.bonusBasis, employee_active: !employee.active })
    if (error) { setNotice(error.message); return }
    await loadCloud()
  }

  async function planRoute() {
    const deliveries = orders.filter((order) => ['Confirmed', 'Out for delivery'].includes(order.status) && Boolean(order.locationUrl?.trim()))
    if (!deliveries.length) { setRouteError('Add or confirm at least one delivery first.'); setShowRoutePlan(true); return }
    setRouteBusy(true); setRouteError(''); setShowRoutePlan(true)
    try {
      const { coords } = await getCurrentDevicePosition({ enableHighAccuracy: true, timeout: 10000 })
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
    } catch (error) {
      setRouteError(isLocationPermissionDenied(error) ? 'Allow location access to plan the deliveries from where you are.' : error instanceof Error ? error.message : 'Could not plan this route.')
    } finally { setRouteBusy(false) }
  }

  const displayName = devDemo ? 'Amina Benali' : String(session?.user.user_metadata?.display_name || session?.user.email?.split('@')[0] || 'Team member')
  const failedPendingOrders = pendingOrders.filter((entry) => entry.status === 'failed')
  const savingPendingOrders = pendingOrders.filter((entry) => entry.status === 'saving')
  const failedResources = Object.keys(resourceErrors) as ResourceName[]
  const resourcesLoading = Object.values(resourcePhases).some((phase) => phase === 'loading')

  if (supabase && session && workspaceStatus === 'checking') return <AppBootScreen />
  if (supabase && session && workspaceStatus === 'error') return <AppBootScreen error={workspaceError} retry={() => void loadCloud()} />
  if (supabase && session && workspaceStatus === 'missing') return <WorkspaceScreen onReady={loadCloud} />

  return <main className={`app-shell ${dark ? 'theme-dark' : 'theme-light'}`}>
    <DesktopSidebar tab={tab} setTab={setTab} displayName={displayName} dark={dark} toggleTheme={() => setDark(!dark)} />
    {(failedPendingOrders.length > 0 || savingPendingOrders.length > 0 || failedResources.length > 0 || resourcesLoading) && <div className={`sync-banner ${failedPendingOrders.length || failedResources.length ? 'has-error' : ''}`} role="status" aria-live="polite">{failedPendingOrders.length > 0 ? <><WarningCircle weight="fill" /><span><b>{failedPendingOrders.length} order{failedPendingOrders.length === 1 ? '' : 's'} waiting to sync</b><small>Your order is safe on this device.</small></span><button onClick={() => failedPendingOrders.forEach((entry) => void syncPendingOrder(entry))}>Retry</button></> : failedResources.length > 0 ? <><WarningCircle weight="fill" /><span><b>Some data could not refresh</b><small>Showing the last saved information.</small></span><button onClick={() => void refreshWorkspaceData()}>Retry</button></> : savingPendingOrders.length > 0 ? <><ArrowsClockwise className="sync-spinner" /><span><b>Saving {savingPendingOrders.length === 1 ? 'order' : `${savingPendingOrders.length} orders`}…</b><small>You can keep working.</small></span></> : <><ArrowsClockwise className="sync-spinner" /><span><b>Refreshing shared data…</b><small>Available screens remain usable.</small></span></>}</div>}
    {tab !== 'map' && <FeatureBoundary resetKey={tab}><div className="ledger-scroll"><div className="ledger-content">
    {tab === 'orders' && <section className="page quiet-orders mobile-orders-view">
      <PageHeader title="Orders" subtitle={orderRangeTitle} dark={dark} toggleTheme={() => setDark(!dark)} actions={<><button className="square-action" aria-label="Open settings" onClick={() => setTab('settings')}><GearSix /></button><button data-search-toggle className={`square-action ${showSearch || query ? 'is-active' : ''}`} aria-label="Search orders" onClick={() => setShowSearch(!showSearch)}><MagnifyingGlass /></button><button className="square-action" aria-label="Plan route" onClick={() => void planRoute()}><Path /></button></>} />
      <section className="profit-date-bar"><div><span>{currentMonthRange ? "This month's profit" : 'Range profit'}</span><strong>{money(selectedRangeProfit)}</strong><small><CheckCircle />{selectedRangeDelivered.length} delivered</small></div><button type="button" className="date-control" onClick={() => setShowOrderCalendar(true)} aria-haspopup="dialog"><CalendarBlank /><span><b>{currentMonthRange ? 'This month' : 'Selected range'}</b><small>{rangeLabel(orderRange)}</small></span><CaretDown /></button></section>
      {showSearch && <label className="search-field"><MagnifyingGlass /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, phone, or address" /><button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X /></button></label>}
      <div className="filter-rail" aria-label="Filter orders by status">{orderFilters.map((filter) => {
        const count = filter.value === 'All' ? selectedRangeOrders.length : selectedRangeOrders.filter((order) => order.status === filter.value).length
        return <button key={filter.value} className={statusFilter === filter.value ? 'selected' : ''} onClick={() => setStatusFilter(filter.value)}><span>{filter.label}</span><small>{count}</small></button>
      })}</div>
      <section className="ledger-section range-ledger">{orderGroups.map((group) => <div className="order-day-group" key={group.date}><h2><span>{group.date === dateKey(new Date()) ? 'Today' : longDate(group.date)}</span><small>{group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'}</small></h2><div className="order-ledger">{group.orders.map((order) => <OrderCard key={order.id} order={order} highlighted={highlightedPushOrderIds.includes(order.id)} products={products} members={members} confirmationEmployees={confirmationEmployees} onStatus={changeStatus} onEdit={setEditingOrder} onDelete={deleteOrder} />)}</div></div>)}{!visibleOrders.length && resourcePhases.orders === 'loading' ? <DataLoading label="Loading orders" /> : !visibleOrders.length && <EmptyState icon={<ClipboardText />} title="No matching orders" copy="Try another range, status, or search." />}</section>
    </section>}

    {tab === 'orders' && <DesktopOrdersView orders={visibleOrders} rangeOrders={selectedRangeOrders} highlightedOrderIds={highlightedPushOrderIds} deliveredCount={selectedRangeDelivered.length} rangeProfit={selectedRangeProfit} rangeLabelText={rangeLabel(orderRange)} products={products} members={members} confirmationEmployees={confirmationEmployees} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} openCalendar={() => setShowOrderCalendar(true)} newOrder={() => setShowOrder(true)} planRoute={() => void planRoute()} onStatus={changeStatus} onEdit={setEditingOrder} onDelete={deleteOrder} />}

    {tab === 'inventory' && <section className="page">
      <PageHeader title="Inventory" subtitle="Products and bundles" actions={<button className="text-action" onClick={() => setShowBundle(true)}><Stack />Bundle</button>} />
      <section className="inventory-overview"><Cube /><b>{products.length}</b><span>items</span><i /><WarningCircle weight="fill" /><b>{products.filter((product) => !product.components && product.stock <= product.lowStockAt).length}</b><span>low stock</span></section>
      <div className="inventory-ledger">{products.map((product) => { const low = !product.components && product.stock <= product.lowStockAt; return <article className="inventory-row" key={product.id}><span className="product-icon">{product.components ? <Stack /> : <Package />}</span><div className="inventory-copy"><h3>{product.name}</h3><p>{product.components ? `${product.components.length} products in bundle` : `FIFO cost ${money(product.cost)} · Selling ${money(product.price)}`}</p>{product.components && <p>FIFO cost {money(productCost(product, products))} · Selling {money(product.price)}</p>}</div><div className={`stock-copy ${low ? 'is-low' : ''}`}><b>{product.components ? bundleStock(product, products) : product.stock}</b><span>{product.components ? 'calculated' : low ? 'Low stock' : 'in stock'}</span></div><div className="inventory-row-actions">{!product.components && <button className="restock-icon" aria-label={`Restock ${product.name}`} onClick={() => setRestockingProduct(product)}><ArrowsClockwise /></button>}<button aria-label={`Edit ${product.name}`} onClick={() => setEditingProduct(product)}><PencilSimple /></button><button className="danger-icon" aria-label={`Delete ${product.name}`} onClick={() => void deleteProduct(product)}><Trash /></button></div></article> })}</div>
      <p className="info-strip"><NoteBlank />Oldest stock is costed first. Bundle stock and cost come from the products inside it.</p>
    </section>}

    {tab === 'profit' && <section className="page">
      <PageHeader title="Profit" subtitle="Delivered orders only" />
      <section className="range-control" aria-label="Choose profit date range"><label><span>From</span><div><CalendarBlank /><input type="date" value={profitStart} max={profitEnd || undefined} onChange={(event) => setProfitStart(event.target.value)} /></div></label><i /><label><span>To</span><div><CalendarBlank /><input type="date" value={profitEnd} min={profitStart || undefined} max={dateKey(new Date())} onChange={(event) => setProfitEnd(event.target.value)} /></div></label></section>
      <div className="quick-range"><button className={profitStart === dateKey(new Date()) && profitEnd === dateKey(new Date()) ? 'selected' : ''} onClick={() => { const today = dateKey(new Date()); setProfitStart(today); setProfitEnd(today) }}>Today</button><button onClick={() => { setProfitStart(monthStartKey()); setProfitEnd(dateKey(new Date())) }}>This month</button></div>
      <section className="net-profit"><span>Net profit</span><strong>{money(profitTotals.profit)}</strong><p>From <b>{profitOrders.length} delivered {profitOrders.length === 1 ? 'order' : 'orders'}</b></p></section>
      <section className="profit-grid"><Metric icon={<Tag />} label="Sales" value={money(profitTotals.revenue)} /><Metric icon={<ClipboardText />} label="Orders" value={String(profitOrders.length)} /><Metric icon={<UsersThree />} label="Team bonuses" value={money(profitTotals.confirmationBonuses)} /><Metric icon={<ChartBar />} label="Average net" value={money(profitOrders.length ? profitTotals.profit / profitOrders.length : 0)} /></section>
      <section className="ledger-section completed-sales"><h2>Completed sales</h2>{profitOrders.map((order) => { const bonus = confirmationCost(order); const confirmer = confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId); return <article key={order.id}><CheckCircle weight="fill" /><div><h3>{order.client}</h3><p>{dateStamp(dateKey(order.deliveredAt || order.createdAt))}</p><span>{order.items.map((item) => `${products.find((product) => product.id === item.productId)?.name ?? 'Product'} ×${item.quantity}`).join(', ')}</span>{confirmer && <small>Confirmation: {confirmer.name} · -{money(bonus)}</small>}</div><strong>{money(order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))}</strong></article> })}{!profitOrders.length && <EmptyState icon={<ChartBar />} title="No completed sales" copy="Choose a date range with delivered orders." />}</section>
    </section>}


    {tab === 'employees' && <section className="page employees-page">
      {selectedEmployee ? <>
        <PageHeader title={selectedEmployee.name} subtitle={`${money(selectedEmployee.bonus)} per confirmed ${selectedEmployee.bonusBasis === 'per_item' ? 'item' : 'order'} · ${selectedEmployee.active ? 'Active' : 'Inactive'}`} back={() => setSelectedEmployeeId(null)} actions={<><button className="square-action" aria-label={`Edit ${selectedEmployee.name}`} onClick={() => setEditingConfirmationEmployee(selectedEmployee)}><PencilSimple /></button><button className="square-action" aria-label={selectedEmployee.active ? `Pause ${selectedEmployee.name}` : `Activate ${selectedEmployee.name}`} onClick={() => void toggleConfirmationEmployee(selectedEmployee)}>{selectedEmployee.active ? <Pause /> : <Play />}</button></>} />
        <div className="employee-detail"><section><span>Confirmation bonus earned</span><strong>{money(selectedEmployeeOrders.reduce((sum, order) => sum + (order.confirmationBonus ?? confirmationBonusFor(selectedEmployee, order.items)), 0))}</strong><small>{money(selectedEmployee.bonus)} per confirmed {selectedEmployee.bonusBasis === 'per_item' ? 'item' : 'order'} · {selectedEmployeeOrders.length} {selectedEmployeeOrders.length === 1 ? 'order' : 'orders'} in total</small></section><h3>Confirmation history</h3>{selectedEmployeeOrders.map((order) => <article key={order.id}><div><b>{order.client}</b><p>{dateStamp(dateKey(order.confirmedAt || order.createdAt))} · {order.items.map((item) => `${products.find((product) => product.id === item.productId)?.name ?? 'Product'} ×${item.quantity}`).join(', ')}</p><span>{order.status}</span></div><strong>{money(order.confirmationBonus ?? confirmationBonusFor(selectedEmployee, order.items))}</strong></article>)}{!selectedEmployeeOrders.length && <EmptyState icon={<UserCheck />} title="No confirmations yet" copy="Assign this employee when confirming an order." />}</div>
      </> : <>
        <PageHeader title="Employees" subtitle="Confirmation work and bonuses" actions={<button className="mini-primary" onClick={() => setShowConfirmationTeam(true)}><Plus />Add employee</button>} />
        <p className="page-intro">Tap an employee to view confirmation history.</p>
        <div className="employee-ledger">{employeeSummaries.map(({ employee, count, itemCount, bonus, productNames }) => <button className="employee-row" key={employee.id} onClick={() => setSelectedEmployeeId(employee.id)}><span className="employee-avatar">{employee.name.slice(0, 1).toUpperCase()}</span><span className="employee-name"><b>{employee.name}</b><small className={employee.active ? 'active' : 'inactive'}><i />{employee.active ? 'Active' : 'Inactive'}</small></span><span className="employee-work"><b><User />{employee.bonusBasis === 'per_item' ? `${itemCount} confirmed ${itemCount === 1 ? 'item' : 'items'}` : `${count} confirmed ${count === 1 ? 'order' : 'orders'}`}</b><small>{productNames.length ? productNames.join(' · ') : 'No products confirmed yet'}</small></span><strong>{money(bonus)}</strong><CaretRight /></button>)}{!employeeSummaries.length && <EmptyState icon={<UsersThree />} title="No employees yet" copy="Use Add employee above to create the first one." />}</div>
      </>}
    </section>}

    {tab === 'settings' && <section className="page settings-page">
      <PageHeader title="Settings" subtitle="Workspaces, notifications, and app controls" back={() => setTab('orders')} />
      <section className="settings-section"><h2>Shared workspace</h2><p>Use this code to invite a partner.</p><button className="workspace-code" onClick={() => { if (workspaceCode) void navigator.clipboard.writeText(workspaceCode); setNotice('Workspace code copied.') }}><strong>{workspaceCode ?? 'Loading…'}</strong><Copy /></button><div className="workspace-list">{workspaces.map((workspace) => <div className={workspace.id === workspaceId ? 'current' : ''} key={workspace.id}><button onClick={() => void switchWorkspace(workspace.id)}><Buildings /><span>{workspace.name}{workspace.id === workspaceId && <small> · Current</small>}</span></button>{workspace.is_owner && <button className="danger-icon" aria-label={`Delete ${workspace.name}`} onClick={() => void deleteWorkspace(workspace.id, workspace.name)}><Trash /></button>}</div>)}</div><div className="settings-inline-actions"><button onClick={() => void manageWorkspace('create')}><Plus />Create workspace</button><button onClick={() => void manageWorkspace('join')}><UserPlus />Join workspace</button></div></section>
      <section className="settings-section notification-settings"><div className="settings-section-head"><div><h2>Order notifications</h2><p aria-live="polite">{pushMessage}</p></div><span className={`notification-state state-${pushState}`}>{pushState === 'enabled' ? <BellRinging weight="fill" /> : <BellSlash />}</span></div>{pushState === 'unsupported' && <p className="notification-help">Install the app on your Home Screen and open it over HTTPS to enable phone notifications.</p>}{pushState === 'denied' && <p className="notification-help">Notifications are blocked in this phone’s settings. Allow Tanger Orders, then reopen the app.</p>}<button className={`notification-toggle ${pushState === 'enabled' ? 'is-enabled' : ''}`} disabled={pushBusy || pushState === 'unsupported' || pushState === 'denied'} onClick={() => void (pushState === 'enabled' ? turnOffPushNotifications() : turnOnPushNotifications())}>{pushState === 'enabled' ? <><BellSlash />Turn off on this phone</> : <><BellRinging />{pushBusy ? 'Connecting…' : 'Enable on this phone'}</>}</button></section>
      <section className="account-actions"><button onClick={() => void loadCloud()}><ArrowsClockwise />Refresh shared data</button><button className="sign-out" onClick={() => void supabase?.auth.signOut()}><SignOut />Sign out</button></section>
    </section>}

    </div></div></FeatureBoundary>}

    {tab === 'map' && <FeatureBoundary resetKey={tab}><section className="map-screen"><DeliveryMap orders={orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Canceled')} /><div className="map-heading"><h1>Map</h1><p>{orders.filter((order) => order.status !== 'Delivered' && order.status !== 'Canceled').length} active deliveries</p></div><div className="map-legend"><span><i className="delivery" />{orders.filter((order) => order.status === 'Out for delivery').length} Out for delivery</span><b>·</b><span><i className="confirmed" />{orders.filter((order) => order.status === 'Confirmed').length} Confirmed</span></div></section></FeatureBoundary>}

    <nav className="ledger-bottom-nav"><NavButton icon="orders" label="Orders" active={tab === 'orders' || tab === 'settings'} onClick={() => setTab('orders')} /><NavButton icon="inventory" label="Inventory" active={tab === 'inventory'} onClick={() => setTab('inventory')} /><NavButton icon="profit" label="Profit" active={tab === 'profit'} onClick={() => setTab('profit')} /><NavButton icon="employees" label="Employees" active={tab === 'employees'} onClick={() => { setSelectedEmployeeId(null); setTab('employees') }} /><NavButton icon="map" label="Map" active={tab === 'map'} onClick={() => setTab('map')} /></nav>
    {tab === 'orders' && <button className="ledger-fab mobile-only-fab" onClick={() => setShowOrder(true)}><Plus />New order</button>}
    {tab === 'inventory' && <button className="ledger-fab inventory-fab" onClick={() => setShowProduct(true)}><Plus />Product</button>}

    {showOrderCalendar && <DateRangeCalendar value={orderRange} onChange={setOrderRange} close={() => setShowOrderCalendar(false)} />}
    {showOrder && <Modal title="New order" close={() => setShowOrder(false)}><OrderForm products={products} members={members} confirmationEmployees={confirmationEmployees} onSubmit={addOrder} /></Modal>}
    {editingOrder && <Modal title="Edit order" close={() => setEditingOrder(null)}><OrderForm order={editingOrder} products={products} members={members} confirmationEmployees={confirmationEmployees} onSubmit={updateOrder} submitLabel="Save changes" /></Modal>}
    {showConfirmationTeam && <Modal title="Manage employees" close={() => setShowConfirmationTeam(false)}><div className="confirmation-team"><p className="team-intro">Choose whether each employee earns a fixed amount per confirmed order or per item quantity. Admin confirmations have no bonus.</p><form onSubmit={(event) => { event.preventDefault(); void addConfirmationEmployee(event.currentTarget) }} className="form"><label className="form-field"><span>Employee name</span><input required name="name" /></label><fieldset className="bonus-basis-field"><legend>Pay bonus by</legend><div className="bonus-basis-options"><label><input type="radio" name="bonusBasis" value="per_order" defaultChecked /><span><b>Per order</b><small>One bonus for each confirmed order</small></span></label><label><input type="radio" name="bonusBasis" value="per_item" /><span><b>Per item</b><small>Multiply the bonus by item quantity</small></span></label></div></fieldset><label className="form-field"><span>Bonus amount (DH)</span><input required name="bonus" type="number" min="0" step="1" defaultValue="5" /></label><button className="primary full">Add employee</button></form><div className="confirmation-team-list">{confirmationEmployees.map((employee) => <article key={employee.id}><div><b>{employee.name}</b><p>{money(employee.bonus)} per confirmed {employee.bonusBasis === 'per_item' ? 'item' : 'order'} · {employee.active ? 'Active' : 'Inactive'}</p></div><div><button onClick={() => { setShowConfirmationTeam(false); setEditingConfirmationEmployee(employee) }}>Edit</button><button onClick={() => void toggleConfirmationEmployee(employee)}>{employee.active ? 'Pause' : 'Activate'}</button></div></article>)}{!confirmationEmployees.length && <p className="empty-date-range">No confirmation employees yet.</p>}</div></div></Modal>}
    {editingConfirmationEmployee && <Modal title="Edit employee" close={() => setEditingConfirmationEmployee(null)}><form onSubmit={(event) => { event.preventDefault(); void editConfirmationEmployee(event.currentTarget) }} className="form employee-edit-form"><label className="form-field"><span>Employee name</span><input required name="name" defaultValue={editingConfirmationEmployee.name} autoFocus /></label><fieldset className="bonus-basis-field"><legend>Pay bonus by</legend><div className="bonus-basis-options"><label><input type="radio" name="bonusBasis" value="per_order" defaultChecked={editingConfirmationEmployee.bonusBasis === 'per_order'} /><span><b>Per order</b><small>One bonus for each confirmed order</small></span></label><label><input type="radio" name="bonusBasis" value="per_item" defaultChecked={editingConfirmationEmployee.bonusBasis === 'per_item'} /><span><b>Per item</b><small>Multiply the bonus by item quantity</small></span></label></div></fieldset><label className="form-field"><span>Bonus amount (DH)</span><input required name="bonus" type="number" min="0" step="1" defaultValue={editingConfirmationEmployee.bonus} /></label><button className="primary full">Save changes</button></form></Modal>}
    {showProduct && <Modal title="Add product" close={() => setShowProduct(false)}><form onSubmit={(event) => { event.preventDefault(); void addProduct(event.currentTarget) }} className="form"><label className="form-field"><span>Product name</span><input required name="name" /></label><div className="form-row"><label className="form-field"><span>Buying cost</span><input required name="cost" type="number" /></label><label className="form-field"><span>Selling price</span><input required name="price" type="number" /></label></div><div className="form-row"><label className="form-field"><span>Opening stock</span><input required name="stock" type="number" /></label><label className="form-field"><span>Low-stock warning</span><input name="lowStockAt" type="number" defaultValue="3" /></label></div><button className="primary full">Save product</button></form></Modal>}
    {editingProduct && <Modal title={`Edit ${editingProduct.components ? 'bundle' : 'product'}`} close={() => setEditingProduct(null)}><form onSubmit={(event) => { event.preventDefault(); void updateProduct(event.currentTarget) }} className="form"><label className="form-field"><span>Name</span><input required name="name" defaultValue={editingProduct.name} /></label>{!editingProduct.components && <><div className="form-row"><label className="form-field"><span>Stock</span><input required name="stock" type="number" min="0" step="1" defaultValue={editingProduct.stock} /></label><label className="form-field"><span>Active FIFO cost</span><input required name="cost" type="number" min="0" step="0.01" defaultValue={editingProduct.cost} /></label></div><label className="form-field"><span>Correction note <small>Optional</small></span><input name="correctionNote" placeholder="e.g. Restock quantity typo" /></label><p className="form-note">Corrections apply only to unsold stock. Delivered-order costs stay unchanged.</p></>}<div className="form-row"><label className="form-field"><span>Selling price</span><input required name="price" type="number" min="0" step="0.01" defaultValue={editingProduct.price} /></label>{!editingProduct.components && <label className="form-field"><span>Low-stock warning</span><input name="lowStockAt" type="number" min="0" defaultValue={editingProduct.lowStockAt} /></label>}</div><button className="primary full">Save changes</button></form></Modal>}
    {restockingProduct && <RestockModal product={restockingProduct} batches={inventoryBatches.filter((batch) => batch.productId === restockingProduct.id)} close={() => setRestockingProduct(null)} onSubmit={(quantity, unitCost) => restockProduct(restockingProduct, quantity, unitCost)} />}
    {showBundle && <Modal title="Create bundle" close={() => setShowBundle(false)}><form onSubmit={(event) => { event.preventDefault(); void addBundle(event.currentTarget) }} className="form"><label className="form-field"><span>Bundle name</span><input required name="name" /></label><label className="form-field"><span>Bundle selling price</span><input required name="price" type="number" /></label><p className="form-note">Products inside this bundle</p>{bundleLines.map((line, index) => <div className="bundle-line" key={index}><label className="form-field"><span>Product {index + 1}</span><select value={line.productId} onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, productId: event.target.value } : item))}><option value="">Choose product</option>{products.filter((product) => !product.components).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.stock} in stock)</option>)}</select></label><label className="form-field"><span>Quantity</span><input type="number" min="1" value={line.quantity} onChange={(event) => setBundleLines((all) => all.map((item, lineIndex) => lineIndex === index ? { ...item, quantity: Number(event.target.value) || 1 } : item))} /></label>{bundleLines.length > 2 && <button className="remove-line" type="button" aria-label={`Remove product ${index + 1}`} onClick={() => setBundleLines((all) => all.filter((_item, lineIndex) => lineIndex !== index))}><X /></button>}</div>)}<button className="add-line" type="button" onClick={() => setBundleLines((all) => [...all, { productId: '', quantity: 1 }])}><Plus />Add another product</button><button className="primary full">Save bundle</button></form></Modal>}
    {showRoutePlan && <Modal title="Delivery route" close={() => setShowRoutePlan(false)}><div className="route-plan">{routeBusy && <p>Finding the best delivery order from your current location…</p>}{routeError && <p className="route-error">{routeError}</p>}{!routeBusy && !routeError && plannedOrders.map((order, index) => <article key={order.id}><b>{index + 1}</b><div><strong>{order.client}</strong><span>{order.address}</span></div><a href={navigationUrl(order)} target="_blank"><NavigationArrow />Navigate</a></article>)}</div></Modal>}
    {showExitHint && <div className="exit-hint" role="status" aria-live="polite">Press back again to exit</div>}
  </main>
}

function RestockModal({ product, batches, close, onSubmit }: { product: Product; batches: InventoryBatch[]; close: () => void; onSubmit: (quantity: number, unitCost: number) => Promise<void> }) {
  const [quantity, setQuantity] = useState(1)
  const [unitCost, setUnitCost] = useState(product.cost)
  const [busy, setBusy] = useState(false)
  const queuedCost = product.stock > 0 && unitCost !== product.cost
  const recentBatches = [...batches].sort((first, second) => new Date(second.receivedAt).getTime() - new Date(first.receivedAt).getTime()).slice(0, 4)
  return <Modal title={`Restock ${product.name}`} close={close}>
    <form className="form restock-form" onSubmit={(event) => { event.preventDefault(); if (quantity <= 0 || unitCost < 0) return; setBusy(true); void onSubmit(quantity, unitCost).finally(() => setBusy(false)) }}>
      <section className="restock-summary"><div><span>Current stock</span><strong>{product.stock}</strong></div><i /><div><span>Active FIFO cost</span><strong>{money(product.cost)}</strong></div></section>
      <div className="form-row"><label className="form-field"><span>Quantity received</span><input required type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Math.max(0, Number(event.target.value)))} /></label><label className="form-field"><span>Buying cost per unit</span><input required type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(Math.max(0, Number(event.target.value)))} /></label></div>
      <section className={`fifo-preview ${queuedCost ? 'cost-queued' : ''}`}><ArrowsClockwise /><div><b>{product.stock + quantity} units after restock</b><p>{queuedCost ? `${product.stock} existing units will keep their earlier costs. The ${money(unitCost)} cost starts only after they are sold.` : product.stock > 0 ? `This batch joins the queue behind ${product.stock} existing units.` : `The ${money(unitCost)} cost becomes active immediately.`}</p></div><strong>{money(quantity * unitCost)}</strong></section>
      {recentBatches.length > 0 && <section className="batch-history"><header><span>Recent stock batches</span><small>Oldest costs are used first</small></header>{recentBatches.map((batch) => <article key={batch.id}><div><b>{batch.source === 'opening_balance' ? 'Opening stock' : batch.source === 'correction' ? 'Stock correction' : 'Restock'}</b><span>{shortDate(dateKey(batch.receivedAt))}</span></div><strong>{batch.remainingQuantity}/{batch.originalQuantity}</strong><em>@ {money(batch.unitCost)}</em></article>)}</section>}
      <button className="primary full" disabled={busy || quantity <= 0}>{busy ? 'Adding stock…' : `Add ${quantity} ${quantity === 1 ? 'unit' : 'units'}`}</button>
    </form>
  </Modal>
}

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
type Coordinates = { latitude: number; longitude: number }
type CurrentLocation = Coordinates & { accuracy: number }
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
    const response = await fetch(cloudflareApiUrl('/api/resolve-location'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationUrl }) })
    if (!response.ok) return { locationUrl }
    const data = await response.json() as LocationResolution
    const result = { locationUrl: data.locationUrl || locationUrl, coordinates: data.coordinates || mapCoordinates(data.locationUrl) || undefined }
    if (result.coordinates) localStorage.setItem(locationCacheKey(locationUrl), JSON.stringify(result))
    return result
  } catch { return { locationUrl } }
}
function distanceKm(first: Coordinates, second: Coordinates) { const radians = (value: number) => value * Math.PI / 180; const deltaLatitude = radians(second.latitude - first.latitude); const deltaLongitude = radians(second.longitude - first.longitude); const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(deltaLongitude / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) }

function PasswordRecoveryScreen({ onComplete }: { onComplete: () => void }) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [updated, setUpdated] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || saving) return
    const values = new FormData(event.currentTarget)
    const password = String(values.get('password') || '')
    const confirmation = String(values.get('password-confirmation') || '')
    if (password !== confirmation) { setMessage('The passwords do not match.'); return }
    setSaving(true)
    setMessage('')
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setMessage(error.message); return }
    clearPasswordRecoveryUrl()
    setUpdated(true)
  }

  if (updated) return <main className="gate recovery-gate recovery-success">
    <div className="recovery-icon"><CheckCircle weight="fill" /></div>
    <p className="eyebrow">ACCOUNT RECOVERY</p>
    <h1>Password updated</h1>
    <p>Your new password is ready. You can continue securely to Tanger Orders.</p>
    <button className="primary full" type="button" onClick={onComplete}>Continue to orders</button>
  </main>

  return <main className="gate recovery-gate">
    <div className="recovery-icon"><LockKey weight="duotone" /></div>
    <p className="eyebrow">ACCOUNT RECOVERY</p>
    <h1>Set a new password</h1>
    <p>Choose a password you have not used before. Your account is temporarily signed in only so this change can be completed.</p>
    <form className="form auth-form" onSubmit={submit}>
      <label className="form-field"><span>New password <small>6+ characters</small></span><input name="password" type="password" minLength={6} autoComplete="new-password" required autoFocus /></label>
      <label className="form-field"><span>Confirm new password</span><input name="password-confirmation" type="password" minLength={6} autoComplete="new-password" required /></label>
      <button className="primary full" disabled={saving}>{saving ? 'Updating password...' : 'Update password'}</button>
    </form>
    {message && <p className="message recovery-error" role="alert">{message}</p>}
  </main>
}

function RecoveryLinkError({ onBack }: { onBack: () => void }) {
  return <main className="gate recovery-gate">
    <div className="recovery-icon recovery-icon-error"><WarningCircle weight="duotone" /></div>
    <p className="eyebrow">ACCOUNT RECOVERY</p>
    <h1>Recovery link expired</h1>
    <p>This link is invalid or has already been used. Request a fresh recovery email, then open its newest link.</p>
    <button className="primary full" type="button" onClick={onBack}>Return to sign in</button>
  </main>
}

function AuthScreen() {
  const [signUp, setSignUp] = useState(false); const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    const values = new FormData(event.currentTarget); const email = String(values.get('email')); const password = String(values.get('password'))
    const result = signUp ? await supabase.auth.signUp({ email, password, options: { data: { display_name: String(values.get('name')) }, emailRedirectTo: authRedirectUrl() } }) : await supabase.auth.signInWithPassword({ email, password })
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

function AppBootScreen({ error, retry }: { error?: string; retry?: () => void }) {
  return <main className="gate app-boot" aria-live="polite"><img src="/icon-192.png" alt="" /><p className="eyebrow">TANGER ORDERS</p><h1>{error ? 'Could not open your workspace' : 'Opening your workspace…'}</h1><p>{error ? 'Your saved information is untouched. Check your connection and try again.' : 'Loading your shared orders and settings.'}</p>{error ? <button className="primary" onClick={retry}><ArrowsClockwise />Try again</button> : <span className="boot-loader" aria-hidden="true" />}{error && <small>{error}</small>}</main>
}

function DataLoading({ label }: { label: string }) {
  return <div className="data-loading" role="status"><span /><span /><span /><p>{label}…</p></div>
}

function DeliveryMap({ orders }: { orders: Order[] }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const fallbackLocation: Coordinates = { latitude: 35.7410429, longitude: -5.803754 };
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<'locating' | 'available' | 'denied' | 'unavailable'>('locating');
  const [resolvedOrders, setResolvedOrders] = useState<{ order: Order; coordinates: Coordinates }[]>([]);

  const acceptLocation = ({ coords }: DevicePosition) => {
    const location = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
    setCurrentLocation(location); setLocationStatus('available');
  };
  const rejectLocation = (error: unknown) => setLocationStatus(isLocationPermissionDenied(error) ? 'denied' : 'unavailable');
  const requestCurrentLocation = () => {
    setLocationStatus('locating');
    void getCurrentDevicePosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }).then(acceptLocation).catch(rejectLocation);
  };

  useEffect(() => {
    void getCurrentDevicePosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }).then(acceptLocation).catch(rejectLocation);
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
    const locationAnchor = currentLocation ?? fallbackLocation;
    const points = [...resolvedOrders].sort((a, b) => distanceKm(locationAnchor, a.coordinates) - distanceKm(locationAnchor, b.coordinates));

    map.current?.remove();
    map.current = L.map(element.current, { zoomControl: false }).setView([locationAnchor.latitude, locationAnchor.longitude], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    const layer = L.layerGroup().addTo(map.current);
    const markerIcon = new L.Icon({ iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
    if (currentLocation) {
      const currentIcon = L.divIcon({ className: 'current-location-marker', html: '<span><i></i></span>', iconSize: [30, 30], iconAnchor: [15, 15] });
      L.circle([currentLocation.latitude, currentLocation.longitude], { radius: Math.min(Math.max(currentLocation.accuracy, 20), 500), color: '#1679e8', weight: 1, fillColor: '#56a7ff', fillOpacity: .12, interactive: false }).addTo(layer);
      L.marker([currentLocation.latitude, currentLocation.longitude], { icon: currentIcon, zIndexOffset: 2000 }).bindPopup('<strong>Your current location</strong>').addTo(layer);
    }

    points.forEach(({ order, coordinates }, index) => {
      L.marker([coordinates.latitude, coordinates.longitude], { icon: markerIcon, zIndexOffset: 1000 })
        .bindPopup(`<strong>${index + 1}. ${order.client}</strong><br>${order.address}<br><a href="${navigationUrl(order)}" target="_blank">Open in Google Maps</a>`)
        .addTo(layer);
    });

    const bounds: [number, number][] = [...(currentLocation ? [[currentLocation.latitude, currentLocation.longitude] as [number, number]] : []), ...points.map(({ coordinates }): [number, number] => [coordinates.latitude, coordinates.longitude])];
    if (bounds.length > 1) map.current.fitBounds(L.latLngBounds(bounds), { padding: [34, 34], maxZoom: 14, animate: false });
    else if (bounds.length === 1) map.current.setView(bounds[0], 15, { animate: false });
    const invalidateTimer = window.setTimeout(() => map.current?.invalidateSize({ animate: false }), 100);
    return () => { window.clearTimeout(invalidateTimer); const currentMap = map.current; map.current = null; currentMap?.stop(); currentMap?.remove(); };
  }, [resolvedOrders, currentLocation]);

  const locationLabel = locationStatus === 'available' ? 'My location' : locationStatus === 'locating' ? 'Locating…' : locationStatus === 'denied' ? 'Allow location' : 'Locate me';
  return <><div ref={element} className="map-canvas" /><button type="button" className={`map-location ${locationStatus === 'locating' ? 'is-locating' : ''}`} aria-label={currentLocation ? 'Center map on my location' : 'Show my current location'} onClick={() => currentLocation ? map.current?.flyTo([currentLocation.latitude, currentLocation.longitude], 15, { animate: true, duration: .7 }) : requestCurrentLocation()}><NavigationArrow weight={currentLocation ? 'fill' : 'regular'} /><span>{locationLabel}</span></button>{!resolvedOrders.length && <p className="map-empty">Add Google Maps location links to orders to see them here.</p>}</>;
}
