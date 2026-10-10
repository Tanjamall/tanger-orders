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
  const [productId, setProductId] = useState(order?.items[0]?.productId || products[0]?.id || '')
  const [variantId, setVariantId] = useState(order?.items[0]?.variantId || '')
  const [error, setError] = useState('')
  const product = products.find(entry => entry.id === productId)
  const legacy = order?.items[0]?.productId === productId && !order.items[0].variantId
  const available = (id: string, stock: number) => stock + (order?.status === 'Delivered' && order.items[0]?.productId === productId && order.items[0]?.variantId === id ? order.items[0].quantity : 0)
  const assignees = members.length
    ? members.map((member) => ({ value: member.id, label: member.display_name || 'Team member' }))
    : people.map((person) => ({ value: person, label: person }))

  return <form onSubmit={(event) => { event.preventDefault(); if (submitting) return; setSubmitting(true); setError(''); void onSubmit(event.currentTarget).catch(cause => setError((cause as Error).message)).finally(() => setSubmitting(false)) }} className="form">
    <label className="form-field"><span>Customer name</span><input required name="client" defaultValue={order?.client} /></label>
    <label className="form-field"><span>WhatsApp number</span><input required name="phone" defaultValue={order?.phone} /></label>
    <label className="form-field"><span>Address <small>Arabic or English</small></span><input required name="address" defaultValue={order?.address} /></label>
    <label className="form-field"><span>Google Maps link <small>Optional</small></span><input name="locationUrl" type="url" defaultValue={order?.locationUrl} /></label>
    <label className="form-field"><span>Product or bundle</span><select required name="product" value={productId} onChange={event => { setProductId(event.target.value); setVariantId('') }}>{products.map((product) => <option value={product.id} key={product.id}>{product.components ? 'Bundle: ' : ''}{product.name} — {money(product.price)}</option>)}</select></label>
    {Boolean(product?.variants?.length) && <fieldset className="order-variant-options"><legend>{product?.variantName || 'Variant'}</legend><div>{legacy && <label><input type="radio" name="variantId" value="" checked={!variantId} onChange={() => setVariantId('')} /><span>Not recorded<small>Existing order</small></span></label>}{product!.variants!.map(v => <label key={v.id}><input type="radio" name="variantId" value={v.id} required={!legacy} checked={variantId === v.id} onChange={() => setVariantId(v.id)} /><span><bdi>{v.label}</bdi><small>{available(v.id,v.stock)} in stock</small></span></label>)}</div></fieldset>}
    {product && <p className="order-stock-note">{variantId ? available(variantId,product.variants?.find(v => v.id === variantId)?.stock || 0) : product.stock} units available{product.variants?.length && !variantId ? ' across all variants' : ''}. Stock is deducted when delivered.</p>}
    <div className="form-row"><label className="form-field"><span>Quantity</span><input required name="quantity" type="number" min="1" step="1" defaultValue={order?.items[0]?.quantity || 1} /></label><label className="form-field"><span>Custom price <small>Optional</small></span><input key={productId} name="price" type="number" min="0" step="0.01" placeholder={String(product?.price ?? 0)} defaultValue={order?.items[0]?.productId === productId ? order.items[0]?.unitPrice : undefined} /></label></div>
    <div className="form-row"><label className="form-field"><span>Delivery person</span><select name="assignedTo" defaultValue={order?.assignedTo}>{assignees.map((person) => <option value={person.value} key={person.value}>{person.label}</option>)}</select></label><label className="form-field"><span>Delivery expense</span><input name="deliveryCharge" type="number" min="0" step="0.01" defaultValue={order?.deliveryCharge ?? defaultDeliveryCharge} /></label></div>
    <div className="form-row"><label className="form-field"><span>Order status</span><select name="status" defaultValue={order?.status || 'New'}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label className="form-field"><span>Payment status</span><select name="paymentStatus" defaultValue={order?.paymentStatus || 'Pay on delivery'}>{paymentStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
    <label className="form-field"><span>Confirmed by</span><select name="confirmationEmployeeId" defaultValue={order?.confirmationEmployeeId || ''}><option value="">Admin (no bonus)</option>{confirmationEmployees.filter((employee) => employee.active || employee.id === order?.confirmationEmployeeId).map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {money(employee.bonus)} per {employee.bonusBasis === 'per_item' ? 'item' : 'order'}</option>)}</select></label>
    <label className="form-field"><span>Other expense <small>Optional</small></span><input name="otherExpense" type="number" defaultValue={order?.otherExpense} /></label>
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
