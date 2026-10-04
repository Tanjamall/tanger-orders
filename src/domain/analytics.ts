import { eventDateKey, itemCost, orderActivityDate, whatsappNumber, bundleStock, productCost } from './orders'
import type { ConfirmationEmployee, DateRange } from './orders'
import type { DailyDeliveryCost, InventoryBatch, Order, Product } from '../types'

export type AnalyticsPreset = 'month' | '30d' | '90d' | 'all'

export type FinancialTotals = {
  revenue: number
  productCost: number
  deliveryCost: number
  otherCost: number
  confirmationCost: number
  totalCost: number
  profit: number
  margin: number
  orders: number
  units: number
  averageOrder: number
}

export type RankedProduct = {
  id: string
  name: string
  units: number
  orders: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

export type PeriodPoint = { key: string; label: string; revenue: number; profit: number; orders: number }

export type AnalyticsSnapshot = {
  totals: FinancialTotals
  products: RankedProduct[]
  days: PeriodPoint[]
  months: PeriodPoint[]
  weekdays: PeriodPoint[]
  bestDay?: PeriodPoint
  bestMonth?: PeriodPoint
  bestWeekday?: PeriodPoint
  completedOrders: number
  canceledOrders: number
  pendingOrders: number
  fulfillmentRate: number
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function localDate(key: string) {
  return new Date(`${key}T12:00:00`)
}

function rangeContains(date: string, range: DateRange | null) {
  return !range || (date >= range.start && date <= range.end)
}

function confirmationCost(order: Order, employees: ConfirmationEmployee[]) {
  if (!order.confirmationEmployeeId) return 0
  if (typeof order.confirmationBonus === 'number') return order.confirmationBonus
  const employee = employees.find((entry) => entry.id === order.confirmationEmployeeId)
  if (!employee) return 0
  const multiplier = employee.bonusBasis === 'per_item'
    ? order.items.reduce((sum, item) => sum + item.quantity, 0)
    : 1
  return employee.bonus * multiplier
}

function orderFinancials(order: Order, products: Product[], employees: ConfirmationEmployee[]) {
  const revenue = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const productCost = order.items.reduce((sum, item) => sum + itemCost(item, products), 0)
  const deliveryCost = order.deliveryCharge || 0
  const otherCost = order.otherExpense || 0
  const employeeCost = confirmationCost(order, employees)
  const totalCost = productCost + deliveryCost + otherCost + employeeCost
  return { revenue, productCost, deliveryCost, otherCost, confirmationCost: employeeCost, totalCost, profit: revenue - totalCost }
}

function emptyTotals(): FinancialTotals {
  return { revenue: 0, productCost: 0, deliveryCost: 0, otherCost: 0, confirmationCost: 0, totalCost: 0, profit: 0, margin: 0, orders: 0, units: 0, averageOrder: 0 }
}

function addPoint(map: Map<string, PeriodPoint>, key: string, label: string, revenue: number, profit: number) {
  const current = map.get(key) ?? { key, label, revenue: 0, profit: 0, orders: 0 }
  current.revenue += revenue
  current.profit += profit
  current.orders += 1
  map.set(key, current)
}

export function buildAnalytics(orders: Order[], products: Product[], employees: ConfirmationEmployee[], range: DateRange | null, dailyCosts: DailyDeliveryCost[] = []): AnalyticsSnapshot {
  const relevantOrders = orders.filter((order) => rangeContains(eventDateKey(orderActivityDate(order)), range))
  const delivered = relevantOrders.filter((order) => order.status === 'Delivered')
  const totals = delivered.reduce((sum, order) => {
    const financials = orderFinancials(order, products, employees)
    sum.revenue += financials.revenue
    sum.productCost += financials.productCost
    sum.deliveryCost += financials.deliveryCost
    sum.otherCost += financials.otherCost
    sum.confirmationCost += financials.confirmationCost
    sum.totalCost += financials.totalCost
    sum.profit += financials.profit
    sum.orders += 1
    sum.units += order.items.reduce((count, item) => count + item.quantity, 0)
    return sum
  }, emptyTotals())
  totals.margin = totals.revenue ? (totals.profit / totals.revenue) * 100 : 0
  totals.averageOrder = totals.orders ? totals.revenue / totals.orders : 0

  const productMap = new Map<string, RankedProduct>()
  const dayMap = new Map<string, PeriodPoint>()
  const monthMap = new Map<string, PeriodPoint>()
  const weekdayMap = new Map<string, PeriodPoint>()

  for (const order of delivered) {
    const financials = orderFinancials(order, products, employees)
    const date = eventDateKey(orderActivityDate(order))
    const day = localDate(date)
    const month = date.slice(0, 7)
    const weekday = String(day.getDay())
    addPoint(dayMap, date, day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), financials.revenue, financials.profit)
    addPoint(monthMap, month, day.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), financials.revenue, financials.profit)
    addPoint(weekdayMap, weekday, weekdayNames[day.getDay()], financials.revenue, financials.profit)

    const countedProducts = new Set<string>()
    const orderUnits = order.items.reduce((sum, item) => sum + item.quantity, 0)
    for (const item of order.items) {
      const product = products.find((entry) => entry.id === item.productId)
      const revenue = item.quantity * item.unitPrice
      const directCost = itemCost(item, products)
      const weight = financials.revenue ? revenue / financials.revenue : orderUnits ? item.quantity / orderUnits : 0
      const sharedCost = (financials.deliveryCost + financials.otherCost + financials.confirmationCost) * weight
      const current = productMap.get(item.productId) ?? { id: item.productId, name: product?.name ?? 'Unknown product', units: 0, orders: 0, revenue: 0, cost: 0, profit: 0, margin: 0 }
      current.units += item.quantity
      if (!countedProducts.has(item.productId)) current.orders += 1
      countedProducts.add(item.productId)
      current.revenue += revenue
      current.cost += directCost + sharedCost
      current.profit += revenue - directCost - sharedCost
      productMap.set(item.productId, current)
    }
  }

  // Shared delivery is a dated business expense, never allocated to products.
  for (const expense of dailyCosts.filter(entry => rangeContains(entry.date, range))) {
    totals.deliveryCost += expense.amount
    totals.totalCost += expense.amount
    totals.profit -= expense.amount
    const day = localDate(expense.date)
    const points: [Map<string, PeriodPoint>, string, string][] = [
      [dayMap, expense.date, day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })],
      [monthMap, expense.date.slice(0, 7), day.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })],
      [weekdayMap, String(day.getDay()), weekdayNames[day.getDay()]],
    ]
    for (const [map, key, label] of points) {
      const point = map.get(key) ?? { key, label, revenue: 0, profit: 0, orders: 0 }
      point.profit -= expense.amount
      map.set(key, point)
    }
  }
  totals.margin = totals.revenue ? totals.profit / totals.revenue * 100 : 0
  const productsRanked = [...productMap.values()].map((product) => ({ ...product, margin: product.revenue ? (product.profit / product.revenue) * 100 : 0 })).sort((a, b) => b.profit - a.profit)
  const days = [...dayMap.values()].sort((a, b) => a.key.localeCompare(b.key))
  const months = [...monthMap.values()].sort((a, b) => a.key.localeCompare(b.key))
  const weekdays = [...weekdayMap.values()].sort((a, b) => Number(a.key) - Number(b.key))
  const best = (points: PeriodPoint[]) => points.length ? [...points].sort((a, b) => b.profit - a.profit)[0] : undefined
  const canceledOrders = relevantOrders.filter((order) => order.status === 'Canceled').length
  const completedOrders = delivered.length + canceledOrders

  return {
    totals,
    products: productsRanked,
    days,
    months,
    weekdays,
    bestDay: best(days),
    bestMonth: best(months),
    bestWeekday: best(weekdays),
    completedOrders,
    canceledOrders,
    pendingOrders: relevantOrders.length - completedOrders,
    fulfillmentRate: completedOrders ? (delivered.length / completedOrders) * 100 : 0,
  }
}

export function analyticsRange(preset: AnalyticsPreset, now = new Date()): DateRange | null {
  if (preset === 'all') return null
  const end = eventDateKey(now.toISOString())
  const start = preset === 'month' ? end.slice(0, 7) + '-01' : shiftAnalyticsDate(end, preset === '30d' ? -29 : -89)
  return { start, end }
}

export type ProductEvent = { id: string; date: string; label: string; detail: string; quantity: number; amount: number; profit?: number }

export function productHistory(productId: string, orders: Order[], products: Product[], employees: ConfirmationEmployee[], batches: InventoryBatch[], range: DateRange | null): ProductEvent[] {
  const events: ProductEvent[] = []
  for (const order of orders) {
    const items = order.items.filter((item) => item.productId === productId)
    if (!items.length) continue
    const date = orderActivityDate(order)
    if (!rangeContains(eventDateKey(date), range)) continue
    const financials = orderFinancials(order, products, employees)
    const revenue = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const cost = items.reduce((sum, item) => sum + itemCost(item, products), 0)
    const units = order.items.reduce((sum, item) => sum + item.quantity, 0)
    const weight = financials.revenue ? revenue / financials.revenue : units ? items.reduce((sum, item) => sum + item.quantity, 0) / units : 0
    const shared = (financials.deliveryCost + financials.otherCost + financials.confirmationCost) * weight
    events.push({ id: `order-${order.id}`, date, label: order.status === 'Delivered' ? 'Sale' : order.status, detail: order.client, quantity: items.reduce((sum, item) => sum + item.quantity, 0), amount: revenue, profit: order.status === 'Delivered' ? revenue - cost - shared : undefined })
  }
  for (const batch of batches) {
    if (batch.productId !== productId || !rangeContains(eventDateKey(batch.receivedAt), range)) continue
    const labels = { restock: 'Restock', opening_balance: 'Opening stock', correction: 'Stock correction', legacy_delivery: 'Legacy cost record' }
    events.push({ id: `batch-${batch.id}`, date: batch.receivedAt, label: labels[batch.source], detail: `${batch.unitCost} DH / unit`, quantity: batch.originalQuantity, amount: batch.originalQuantity * batch.unitCost })
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}

// Calendar arithmetic is UTC-based; event dates are already Casablanca date keys.
const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86400000
export const shiftAnalyticsDate = (key: string, days: number) => new Date((dayNumber(key) + days) * 86400000).toISOString().slice(0, 10)
export function previousAnalyticsRange(range: DateRange | null): DateRange | null {
  if (!range) return null
  return { start: shiftAnalyticsDate(range.start, -(dayNumber(range.end) - dayNumber(range.start) + 1)), end: shiftAnalyticsDate(range.start, -1) }
}

export function previousCalendarMonthToDateRange(range: DateRange | null): DateRange | null {
  if (!range) return null
  const [year, month, day] = range.end.split('-').map(Number)
  const previousMonth = new Date(Date.UTC(year, month - 2, 1))
  const previousMonthEndDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
  const start = `${previousMonth.getUTCFullYear()}-${String(previousMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
  const end = `${start.slice(0, 7)}-${String(Math.min(day, previousMonthEndDay)).padStart(2, '0')}`
  return { start, end }
}

export function analyticsChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'No change' : 'No baseline'
  const change = (current - previous) / Math.abs(previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
}

export function calendarSeries(points: PeriodPoint[], range: DateRange | null, grouping: 'days' | 'months'): PeriodPoint[] {
  const start = range?.start ?? (points[0]?.key.length === 7 ? points[0].key + '-01' : points[0]?.key)
  const last = points.at(-1)?.key
  const end = range?.end ?? (last?.length === 7 ? last + '-31' : last)
  if (!start || !end) return []
  const byKey = new Map(points.map(point => [point.key, point]))
  const result: PeriodPoint[] = []
  let key = grouping === 'months' ? start.slice(0, 7) + '-01' : start
  while (key <= end) {
    const id = grouping === 'months' ? key.slice(0, 7) : key
    const date = localDate(key)
    result.push(byKey.get(id) ?? { key: id, label: date.toLocaleDateString('en-GB', grouping === 'months' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }), revenue: 0, profit: 0, orders: 0 })
    if (grouping === 'months') key = new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 1)).toISOString().slice(0, 10)
    else key = shiftAnalyticsDate(key, 1)
  }
  return result
}

export function buildBusinessAnalytics(orders: Order[], products: Product[], employees: ConfirmationEmployee[], batches: InventoryBatch[], range: DateRange | null, now = new Date()) {
  const today = eventDateKey(now.toISOString())
  const revenueOf = (order: Order) => order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const delivered = orders.filter(order => order.status === 'Delivered' && rangeContains(eventDateKey(orderActivityDate(order)), range))
  const cohort = orders.filter(order => rangeContains(eventDateKey(order.createdAt), range))
  const pipeline = orders.filter(order => order.status !== 'Delivered' && order.status !== 'Canceled')
  const statuses = (['New', 'Confirmed', 'Out for delivery', 'Delivered', 'Canceled'] as const).map(status => ({ status, count: cohort.filter(order => order.status === status).length }))
  const closed = cohort.filter(order => order.status === 'Delivered' || order.status === 'Canceled')
  const canceled = closed.filter(order => order.status === 'Canceled').length
  const elapsed = delivered.filter(order => order.deliveredAt && new Date(order.deliveredAt).getTime() >= new Date(order.createdAt).getTime()).map(order => (new Date(order.deliveredAt!).getTime() - new Date(order.createdAt).getTime()) / 86400000)
  const phoneKey = (order: Order) => { const value = whatsappNumber(order.phone); return value.length >= 9 && value.length <= 15 ? value : null }
  const history = new Map<string, number>()
  for (const order of orders) {
    if (order.status !== 'Delivered' || eventDateKey(orderActivityDate(order)) > (range?.end ?? today)) continue
    const key = phoneKey(order)
    if (key) history.set(key, (history.get(key) ?? 0) + 1)
  }
  const customers = new Map<string, { name: string; orders: number; revenue: number; profit: number; repeat: boolean }>()
  for (const order of delivered) {
    const key = phoneKey(order)
    if (!key) continue
    const row = customers.get(key) ?? { name: order.client, orders: 0, revenue: 0, profit: 0, repeat: (history.get(key) ?? 0) > 1 }
    row.orders++; row.revenue += revenueOf(order); row.profit += orderFinancials(order, products, employees).profit
    customers.set(key, row)
  }
  const buyers = [...customers.values()].sort((a, b) => b.revenue - a.revenue)
  const recent = orders.filter(order => order.status === 'Delivered' && rangeContains(eventDateKey(orderActivityDate(order)), { start: shiftAnalyticsDate(today, -29), end: today }))
  // Demand includes bundle components; stock value never counts the same physical units twice.
  const demand = new Map<string, number>()
  function addDemand(id: string, quantity: number, visited = new Set<string>()) {
    if (visited.has(id)) return
    const product = products.find(entry => entry.id === id)
    demand.set(id, (demand.get(id) ?? 0) + quantity)
    for (const part of product?.components ?? []) addDemand(part.productId, quantity * part.quantity, new Set([...visited, id]))
  }
  for (const order of recent) for (const item of order.items) addDemand(item.productId, item.quantity)
  const inventory = products.map(product => {
    const stock = bundleStock(product, products)
    const units = demand.get(product.id) ?? 0
    return { id: product.id, name: product.name, bundle: !!product.components?.length, stock, units, cover: units ? stock / (units / 30) : null, low: stock <= product.lowStockAt, value: product.components?.length ? 0 : stock * productCost(product, products) }
  }).sort((a, b) => Number(b.low) - Number(a.low) || (a.cover ?? Infinity) - (b.cover ?? Infinity) || a.name.localeCompare(b.name))
  const restocks = batches.filter(batch => batch.source === 'restock' && rangeContains(eventDateKey(batch.receivedAt), range))
  return {
    statuses, cohortOrders: cohort.length, closedOrders: closed.length, canceled,
    successRate: closed.length ? (closed.length - canceled) / closed.length * 100 : null,
    averageDeliveryDays: elapsed.length ? elapsed.reduce((a, b) => a + b, 0) / elapsed.length : null,
    deliverySamples: elapsed.length,
    paid: delivered.filter(order => order.paymentStatus === 'Paid').reduce((sum, order) => sum + revenueOf(order), 0),
    unpaid: delivered.filter(order => order.paymentStatus !== 'Paid').reduce((sum, order) => sum + revenueOf(order), 0),
    unpaidOrders: delivered.filter(order => order.paymentStatus !== 'Paid').length,
    pipeline: pipeline.length, pipelineValue: pipeline.reduce((sum, order) => sum + revenueOf(order), 0),
    aging: pipeline.filter(order => dayNumber(today) - dayNumber(eventDateKey(order.createdAt)) >= 7).length,
    buyers, repeatBuyers: buyers.filter(buyer => buyer.repeat).length,
    missingPhones: delivered.filter(order => !phoneKey(order)).length,
    missingDeliveryDates: delivered.filter(order => !order.deliveredAt).length,
    estimatedCostOrders: delivered.filter(order => order.items.some(item => typeof item.costTotal !== 'number')).length,
    inventory, stockValue: inventory.reduce((sum, product) => sum + product.value, 0),
    lowStock: inventory.filter(product => product.low).length,
    idleStock: inventory.filter(product => !product.bundle && product.stock > 0 && product.units === 0).length,
    restockSpend: restocks.reduce((sum, batch) => sum + batch.originalQuantity * batch.unitCost, 0),
    restockUnits: restocks.reduce((sum, batch) => sum + batch.originalQuantity, 0),
  }
}

export function analyticsCsv(rows: (string | number)[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    // Keep spreadsheet programs from evaluating user-controlled names as formulas.
    const text = typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : String(value)
    return '"' + text.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n')
}
