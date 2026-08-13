import type { InventoryBatch, Order, PaymentStatus, Product, Status } from '../types'

export type AppTab = 'orders' | 'inventory' | 'profit' | 'employees' | 'map' | 'settings'
export type ConfirmationEmployee = { id: string; name: string; bonus: number; active: boolean }
export type DateRange = { start: string; end: string }

export const statuses: Status[] = ['New', 'Confirmed', 'Out for delivery', 'Delivered', 'Canceled']
export const orderFilters: { label: string; value: Status | 'All' }[] = [
  { label: 'All', value: 'All' },
  ...statuses.map((status) => ({ label: status, value: status })),
]
export const paymentStatuses: PaymentStatus[] = ['Pay on delivery', 'Paid', 'Unpaid']

export const money = (value: number) => `${Math.round(value)} DH`
export const uid = () => crypto.randomUUID()
export const isConfirmedOrder = (status: Status) => ['Confirmed', 'Out for delivery', 'Delivered'].includes(status)
export const normalizeStatus = (status: string): Status => status === 'Preparing' ? 'Confirmed' : status === 'Cancelled' ? 'Canceled' : status as Status

export const dateKey = (value: Date | string) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const monthStartKey = () => {
  const today = new Date()
  return dateKey(new Date(today.getFullYear(), today.getMonth(), 1))
}
export const monthEndKey = (value = new Date()) => dateKey(new Date(value.getFullYear(), value.getMonth() + 1, 0))
export const dateStamp = (key: string) => {
  const [year, month, day] = key.split('-')
  return `${day}/${month}/${year}`
}
export const longDate = (key: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00`))
export const shortDate = (key: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${key}T12:00:00`))
export const monthLabel = (key: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${key}T12:00:00`))

export const normalizedRange = (first: string, second: string): DateRange => first <= second ? { start: first, end: second } : { start: second, end: first }
export const rangeLabel = ({ start, end }: DateRange) => {
  const startDate = new Date(`${start}T12:00:00`)
  const endDate = new Date(`${end}T12:00:00`)
  if (start === end) return shortDate(start)
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) return `${startDate.getDate()}–${shortDate(end)}`
  return `${shortDate(start)} – ${shortDate(end)}`
}
export const isWholeMonth = ({ start, end }: DateRange) => {
  const startDate = new Date(`${start}T12:00:00`)
  return startDate.getDate() === 1 && end === monthEndKey(startDate)
}

export function productCost(product: Product, all: Product[]): number {
  if (!product.components) return product.cost
  return product.components.reduce((sum, component) => {
    const child = all.find((item) => item.id === component.productId)
    return sum + (child ? productCost(child, all) * component.quantity : 0)
  }, 0)
}

export function bundleStock(product: Product, all: Product[]) {
  if (!product.components?.length) return product.stock
  return Math.min(...product.components.map((component) => {
    const child = all.find((item) => item.id === component.productId)
    return child ? Math.floor(child.stock / component.quantity) : 0
  }))
}

export function itemCost(item: Order['items'][number], all: Product[]) {
  if (typeof item.costTotal === 'number') return item.costTotal
  const product = all.find((candidate) => candidate.id === item.productId)
  return product ? productCost(product, all) * item.quantity : 0
}

export function openingBatches(products: Product[]): InventoryBatch[] {
  return products.filter((product) => !product.components && product.stock > 0).map((product, index) => ({
    id: `demo-opening-${index}-${product.id}`,
    productId: product.id,
    unitCost: product.cost,
    originalQuantity: product.stock,
    remainingQuantity: product.stock,
    receivedAt: new Date(0).toISOString(),
    source: 'opening_balance',
  }))
}

export function navigationUrl(order: Order) {
  return order.locationUrl || `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}&travelmode=driving&dir_action=navigate`
}
