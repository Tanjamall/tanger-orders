import { eventDateKey, itemCost, orderActivityDate } from './orders'
import type { ConfirmationEmployee, DateRange } from './orders'
import type { Order, Product } from '../types'

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

export function buildAnalytics(orders: Order[], products: Product[], employees: ConfirmationEmployee[], range: DateRange | null): AnalyticsSnapshot {
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

    for (const item of order.items) {
      const product = products.find((entry) => entry.id === item.productId)
      const revenue = item.quantity * item.unitPrice
      const directCost = itemCost(item, products)
      const sharedCost = financials.revenue ? (financials.deliveryCost + financials.otherCost + financials.confirmationCost) * (revenue / financials.revenue) : 0
      const current = productMap.get(item.productId) ?? { id: item.productId, name: product?.name ?? 'Unknown product', units: 0, orders: 0, revenue: 0, cost: 0, profit: 0, margin: 0 }
      current.units += item.quantity
      current.orders += 1
      current.revenue += revenue
      current.cost += directCost + sharedCost
      current.profit += revenue - directCost - sharedCost
      productMap.set(item.productId, current)
    }
  }

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
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (preset === 'month') start.setDate(1)
  else start.setDate(start.getDate() - (preset === '30d' ? 29 : 89))
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { start: key(start), end: key(end) }
}
