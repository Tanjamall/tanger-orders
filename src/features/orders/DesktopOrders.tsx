import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowSquareOut,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartBar,
  CheckCircle,
  ClipboardText,
  Cube,
  GearSix,
  MagnifyingGlass,
  MapPin,
  Moon,
  NoteBlank,
  Pause,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  Sun,
  Tag,
  Trash,
  Truck,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import {
  dateKey,
  money,
  navigationUrl,
  orderFilters,
  shortDate,
  statuses,
  type AppTab,
  type ConfirmationEmployee,
} from '../../domain/orders'
import type { Order, Product, Status } from '../../types'

type Member = { id: string; display_name: string | null }

type DesktopSidebarProps = {
  tab: AppTab
  setTab: (tab: AppTab) => void
  displayName: string
  dark: boolean
  toggleTheme: () => void
}

const sidebarItems: { value: AppTab; label: string; icon: ReactNode }[] = [
  { value: 'orders', label: 'Orders', icon: <ClipboardText /> },
  { value: 'inventory', label: 'Inventory', icon: <Cube /> },
  { value: 'profit', label: 'Profit', icon: <ChartBar /> },
  { value: 'employees', label: 'Employees', icon: <UsersThree /> },
  { value: 'map', label: 'Map', icon: <MapPin /> },
  { value: 'settings', label: 'Settings', icon: <GearSix /> },
]

export function DesktopSidebar({ tab, setTab, displayName, dark, toggleTheme }: DesktopSidebarProps) {
  return <aside className="desktop-sidebar" aria-label="Main navigation">
    <header>
      <span className="desktop-brand-mark" aria-hidden="true">T</span>
      <div className="desktop-brand-copy"><strong>Tanger</strong><span>Operations ledger</span></div>
    </header>
    <nav>{sidebarItems.map((item) => <button key={item.value} title={item.label} className={tab === item.value ? 'active' : ''} onClick={() => setTab(item.value)}>{item.icon}<span>{item.label}</span></button>)}</nav>
    <div className="desktop-sidebar-account">
      <span className="desktop-avatar">{displayName.slice(0, 1).toUpperCase()}</span>
      <div><b>{displayName}</b><small>Manager · Tanger</small></div>
      <button aria-label={dark ? 'Use light mode' : 'Use dark mode'} onClick={toggleTheme}>{dark ? <Sun /> : <Moon />}</button>
    </div>
  </aside>
}

type DesktopOrdersViewProps = {
  orders: Order[]
  rangeOrders: Order[]
  deliveredCount: number
  rangeProfit: number
  rangeLabelText: string
  products: Product[]
  members: Member[]
  confirmationEmployees: ConfirmationEmployee[]
  query: string
  setQuery: (value: string) => void
  statusFilter: Status | 'All'
  setStatusFilter: (value: Status | 'All') => void
  openCalendar: () => void
  newOrder: () => void
  planRoute: () => void
  onStatus: (id: string, status: Status) => void
  onEdit: (order: Order) => void
  onDelete: (order: Order) => void
}

export function DesktopOrdersView({ orders, rangeOrders, deliveredCount, rangeProfit, rangeLabelText, products, members, confirmationEmployees, query, setQuery, statusFilter, setStatusFilter, openCalendar, newOrder, planRoute, onStatus, onEdit, onDelete }: DesktopOrdersViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const selected = orders.find((order) => order.id === selectedId) || orders[0] || null
  const pendingCount = rangeOrders.filter((order) => order.status !== 'Delivered' && order.status !== 'Canceled').length
  const pageSize = 8
  const pageCount = Math.max(1, Math.ceil(orders.length / pageSize))
  const pagedOrders = orders.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id) }, [selected?.id, selectedId])
  useEffect(() => { setPage(1) }, [query, statusFilter, rangeOrders.length])

  return <section className="desktop-orders-view" aria-label="Orders desktop workspace">
    <header className="desktop-orders-header">
      <div><h1>Orders</h1><button type="button" onClick={openCalendar}><CalendarBlank />{rangeLabelText}<CaretDown /></button></div>
      <label className="desktop-search"><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders, customers, products…" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X /></button>}</label>
      <button className="desktop-new-order" onClick={newOrder}><Plus />New order</button>
      <button className="desktop-icon-button" aria-label="Plan delivery route" title="Plan delivery route" onClick={planRoute}><SlidersHorizontal /></button>
    </header>

    <section className="desktop-summary" aria-label="Order summary">
      <div><i><Tag /></i><span>Net profit<small>From {deliveredCount} delivered {deliveredCount === 1 ? 'order' : 'orders'}</small></span><strong>{money(rangeProfit)}</strong></div>
      <div><i><CheckCircle /></i><span>Delivered<small>This period</small></span><strong>{deliveredCount}</strong></div>
      <div><i><Pause /></i><span>Pending<small>Need attention</small></span><strong>{pendingCount}</strong></div>
      <div><i><CalendarBlank /></i><span>As of</span><strong>{rangeLabelText}</strong></div>
    </section>

    <div className="desktop-orders-body">
      <section className="desktop-order-list">
        <div className="desktop-filter-row" aria-label="Filter orders by status">{orderFilters.map((filter) => <button key={filter.value} className={statusFilter === filter.value ? 'active' : ''} onClick={() => setStatusFilter(filter.value)}>{filter.label}</button>)}</div>
        <div className="desktop-table-head"><span>Customer</span><span>Products</span><span>Status</span><span>Payment</span><span>Assignee</span><span>Total</span><span>Actions</span></div>
        <div className="desktop-table-rows">
          {pagedOrders.map((order) => <DesktopOrderRow key={order.id} order={order} selected={selected?.id === order.id} products={products} members={members} onSelect={setSelectedId} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} />)}
          {!orders.length && <DesktopEmptyState />}
        </div>
        {orders.length > 0 && <footer className="desktop-pagination"><span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, orders.length)} of {orders.length} orders</span><div><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><CaretLeft /></button><b>{page}</b><span>of {pageCount}</span><button aria-label="Next page" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><CaretRight /></button></div></footer>}
      </section>
      <aside className="desktop-order-detail" aria-label="Selected order details">{selected ? <DesktopOrderDetail order={selected} products={products} members={members} confirmationEmployees={confirmationEmployees} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} /> : <div className="desktop-detail-empty"><ClipboardText /><b>Select an order</b><span>Order details will appear here.</span></div>}</aside>
    </div>
  </section>
}

type DesktopOrderRowProps = {
  order: Order
  selected: boolean
  products: Product[]
  members: Member[]
  onSelect: (id: string) => void
  onStatus: (id: string, status: Status) => void
  onEdit: (order: Order) => void
  onDelete: (order: Order) => void
}

function DesktopOrderRow({ order, selected, products, members, onSelect, onStatus, onEdit, onDelete }: DesktopOrderRowProps) {
  const productLines = order.items.map((item) => `${products.find((product) => product.id === item.productId)?.name ?? 'Product'} ×${item.quantity}`).join(', ')
  const productCodes = order.items.map((item) => products.find((product) => product.id === item.productId)?.id.toUpperCase() ?? item.productId.toUpperCase()).join(' · ')
  const assignee = members.find((member) => member.id === order.assignedTo)?.display_name || order.assignedTo || 'Unassigned'
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const deleteDisabled = order.status === 'Delivered'
  const deleteLabel = deleteDisabled ? 'Delivered orders cannot be deleted because their stock cannot be restored' : `Delete order for ${order.client}`

  return <article className={`desktop-order-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(order.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(order.id) }} tabIndex={0}>
    <div className="desktop-customer"><span className="desktop-customer-avatar">{order.client.slice(0, 1).toUpperCase()}</span><div><b>{order.client}</b><span>{order.phone}</span><small>{order.address}</small></div></div>
    <span className="desktop-product-copy" title={productLines}><b>{productLines}</b><small>SKU: {productCodes}</small></span>
    <StatusSelector order={order} onStatus={onStatus} stopPropagation />
    <span className={`desktop-payment payment-${order.paymentStatus.toLowerCase().replaceAll(' ', '-')}`}>{order.paymentStatus}</span>
    <span className="desktop-assignee"><i>{assignee.slice(0, 1).toUpperCase()}</i>{assignee}</span>
    <strong className="desktop-total">{money(total)}</strong>
    <span className="desktop-row-actions"><button aria-label={`Edit ${order.client}`} onClick={(event) => { event.stopPropagation(); onEdit(order) }}><PencilSimple /></button><button className="danger-icon" aria-label={deleteLabel} title={deleteLabel} disabled={deleteDisabled} onClick={(event) => { event.stopPropagation(); onDelete(order) }}><Trash /></button></span>
  </article>
}

type DesktopOrderDetailProps = Pick<DesktopOrdersViewProps, 'products' | 'members' | 'confirmationEmployees' | 'onStatus' | 'onEdit' | 'onDelete'> & { order: Order }

function DesktopOrderDetail({ order, products, members, confirmationEmployees, onStatus, onEdit, onDelete }: DesktopOrderDetailProps) {
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const assignee = members.find((member) => member.id === order.assignedTo)?.display_name || order.assignedTo || 'Unassigned'
  const confirmer = confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId)?.name || 'Admin'
  const deleteDisabled = order.status === 'Delivered'
  const deleteLabel = deleteDisabled ? 'Delivered orders cannot be deleted because their stock cannot be restored' : `Delete order for ${order.client}`

  return <div className="desktop-detail-inner">
    <header><div><span>Order</span><b>#{order.id.slice(0, 8).toUpperCase()}</b></div><StatusSelector order={order} onStatus={onStatus} detail /></header>
    <section className="desktop-detail-customer"><span>Customer</span><h2>{order.client}</h2><a href={`https://wa.me/${order.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{order.phone}<ArrowSquareOut /></a></section>
    <section className="desktop-detail-block"><span>Delivery address</span><p>{order.address}</p>{order.locationUrl?.trim() && <a href={navigationUrl(order)} target="_blank" rel="noreferrer"><MapPin />Open in maps<ArrowSquareOut /></a>}</section>
    <section className="desktop-detail-block"><span>Products</span>{order.items.map((item) => <div className="desktop-detail-line" key={`${order.id}-${item.productId}`}><p>{products.find((product) => product.id === item.productId)?.name ?? 'Product'} <small>×{item.quantity}</small></p><b>{money(item.quantity * item.unitPrice)}</b></div>)}<div className="desktop-detail-line detail-total"><p>Total</p><b>{money(total)}</b></div></section>
    <section className="desktop-detail-grid"><div><span>Payment</span><b>{order.paymentStatus}</b></div><div><span>Assignee</span><b>{assignee}</b></div><div><span>Confirmed by</span><b>{confirmer}</b></div><div><span>Created</span><b>{shortDate(dateKey(order.createdAt))}</b></div></section>
    {order.notes?.trim() && <section className="desktop-detail-note"><NoteBlank /><div><span>Note</span><p>{order.notes}</p></div></section>}
    <footer><button className="desktop-edit-order" onClick={() => onEdit(order)}><PencilSimple />Edit order</button><button className="desktop-delete-order" disabled={deleteDisabled} title={deleteLabel} onClick={() => onDelete(order)}><Trash />{deleteDisabled ? 'Delivered · cannot delete' : 'Delete order'}</button>{deleteDisabled && <small>Stock has already left inventory and cannot be restored.</small>}</footer>
  </div>
}

function StatusSelector({ order, onStatus, stopPropagation = false, detail = false }: { order: Order; onStatus: (id: string, status: Status) => void; stopPropagation?: boolean; detail?: boolean }) {
  const tone = order.status.toLowerCase().replaceAll(' ', '-')
  return <label className={`desktop-status-pill ${detail ? 'detail-status' : ''} tone-${tone}`} onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}>
    <StatusIcon status={order.status} />
    <select aria-label={`Status for ${order.client}`} value={order.status} onChange={(event) => void onStatus(order.id, event.target.value as Status)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
    <CaretDown />
  </label>
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'Out for delivery') return <Truck />
  if (status === 'Delivered' || status === 'Confirmed') return <CheckCircle />
  if (status === 'Canceled') return <X />
  return <ClipboardText />
}

function DesktopEmptyState() {
  return <div className="empty-state"><span><ClipboardText /></span><b>No matching orders</b><p>Try another date range, status, or search.</p></div>
}
