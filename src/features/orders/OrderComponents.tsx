import { OrderItemsEditor } from './OrderItemsEditor'
import { orderItemName } from '../../domain/variants'
import { whatsappNumber } from '../../domain/orders'
import {
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  ClipboardText,
  MapPin,
  NoteBlank,
  PencilSimple,
  Tag,
  Trash,
  Truck,
  User,
  UserCheck,
  X,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { people } from '../../data'
import { eventDateKey, shortDate, money, navigationUrl, paymentStatuses, statuses, type ConfirmationEmployee } from '../../domain/orders'
import type { Order, Product, Status } from '../../types'

type Member = { id: string; display_name: string | null }

type OrderFormProps = {
  order?: Order
  products: Product[]
  members: Member[]
  confirmationEmployees: ConfirmationEmployee[]
  defaultDeliveryCharge?: number
  onSubmit: (form: HTMLFormElement) => Promise<void>
  submitLabel?: string
}

export function OrderForm({ order, products, members, confirmationEmployees, defaultDeliveryCharge = 0, onSubmit, submitLabel = 'Save order' }: OrderFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<Status>(order?.status || 'New')
  const assignees = members.length
    ? members.map((member) => ({ value: member.id, label: member.display_name || 'Team member' }))
    : people.map((person) => ({ value: person, label: person }))

  return <form onSubmit={(event) => { event.preventDefault(); if (submitting) return; setSubmitting(true); setError(''); void onSubmit(event.currentTarget).catch(cause => setError((cause as Error).message)).finally(() => setSubmitting(false)) }} className="form">
    <div className="form-row"><label className="form-field"><span>Customer name</span><input required name="client" defaultValue={order?.client} /></label>
    <label className="form-field"><span>WhatsApp number</span><input required name="phone" defaultValue={order?.phone} /></label></div>
    <div className="form-row"><label className="form-field"><span>Address</span><input required name="address" defaultValue={order?.address} /></label>
    <label className="form-field"><span>Maps link <small>Optional</small></span><input name="locationUrl" type="url" defaultValue={order?.locationUrl} /></label></div>
    <OrderItemsEditor order={order} products={products} status={selectedStatus} />
    <div className="form-row"><label className="form-field"><span>Delivery person</span><select name="assignedTo" defaultValue={order?.assignedTo}>{assignees.map((person) => <option value={person.value} key={person.value}>{person.label}</option>)}</select></label><label className="form-field"><span>Delivery expense</span><input name="deliveryCharge" type="number" min="0" step="0.01" defaultValue={order?.deliveryCharge ?? defaultDeliveryCharge} /></label></div>
    <div className="form-row"><label className="form-field"><span>Order status</span><select name="status" value={selectedStatus} onChange={event => setSelectedStatus(event.target.value as Status)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label className="form-field"><span>Payment status</span><select name="paymentStatus" defaultValue={order?.paymentStatus || 'Pay on delivery'}>{paymentStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
    <div className="form-row"><label className="form-field"><span>Confirmed by</span><select name="confirmationEmployeeId" defaultValue={order?.confirmationEmployeeId || ''}><option value="">Admin (no bonus)</option>{confirmationEmployees.filter((employee) => employee.active || employee.id === order?.confirmationEmployeeId).map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {money(employee.bonus)} per {employee.bonusBasis === 'per_item' ? 'item' : 'order'}</option>)}</select></label>
    <label className="form-field"><span>Other expense <small>Optional</small></span><input name="otherExpense" type="number" defaultValue={order?.otherExpense} /></label></div>
    <label className="form-field"><span>Note</span><textarea name="notes" defaultValue={order?.notes} /></label>
    {error && <p className="variant-form-error" role="alert">{error}</p>}
    <button className="primary full" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
  </form>
}

type OrderCardProps = {
  order: Order
  highlighted?: boolean
  products: Product[]
  members: Member[]
  confirmationEmployees: ConfirmationEmployee[]
  onStatus: (id: string, status: Status) => void
  onEdit: (order: Order) => void
  onDelete: (order: Order) => void
}

export function OrderCard({ order, highlighted = false, products, members, confirmationEmployees, onStatus, onEdit, onDelete }: OrderCardProps) {
  const lines = order.items.map((item) => `${orderItemName(item, products)} ×${item.quantity}`).join(', ')
  const assignee = members.find((member) => member.id === order.assignedTo)?.display_name || order.assignedTo || 'Unassigned'
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const confirmer = confirmationEmployees.find((employee) => employee.id === order.confirmationEmployeeId)
  const tone = order.status.toLowerCase().replaceAll(' ', '-')
  const deleteDisabled = order.status === 'Delivered'
  const deleteLabel = deleteDisabled ? 'Delivered orders cannot be deleted because their stock cannot be restored' : `Delete order for ${order.client}`

  return <article className={`order-row tone-${tone} ${highlighted ? 'push-highlight' : ''}`}>
    <span className="status-rail"><i /></span>
    <div className="order-primary">
      <div className="order-heading"><div><h3>{order.client}</h3><a href={`https://wa.me/${whatsappNumber(order.phone)}`} target="_blank" rel="noreferrer">{order.phone}</a></div><div className="row-actions"><label className={`status-control tone-${tone}`}><OrderStatusIcon status={order.status} /><select aria-label="Order status" value={order.status} onChange={(event) => void onStatus(order.id, event.target.value as Status)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select><CaretDown /></label><button aria-label={`Edit ${order.client}`} onClick={() => onEdit(order)}><PencilSimple /></button><button className="danger-icon" aria-label={deleteLabel} title={deleteLabel} disabled={deleteDisabled} onClick={() => onDelete(order)}><Trash /></button></div></div>
      <div className="address-line">{order.locationUrl?.trim() ? <a href={navigationUrl(order)} target="_blank" rel="noreferrer"><span>{order.address}</span><ArrowSquareOut /><span className="map-mini"><MapPin /></span></a> : <span>{order.address}</span>}</div>
      <p className="product-line">{lines}</p>
      {order.notes?.trim() && <p className="note-line"><NoteBlank /><span><b>Note:</b> {order.notes}</span></p>}
      <div className="order-meta"><span><Tag />{money(total)}</span><span><User />{assignee}</span>{confirmer && <span><UserCheck />Confirmed by {confirmer.name}</span>}</div>
      <div className="order-date-meta"><span>Created {shortDate(eventDateKey(order.createdAt))}</span>{order.status === 'Delivered' && <span>{order.deliveredAt ? `Delivered ${shortDate(eventDateKey(order.deliveredAt))}` : 'Delivery date unavailable'}</span>}</div>
    </div>
  </article>
}

function OrderStatusIcon({ status }: { status: Status }) {
  if (status === 'Out for delivery') return <Truck />
  if (status === 'Delivered' || status === 'Confirmed') return <CheckCircle />
  if (status === 'Canceled') return <X />
  return <ClipboardText />
}
