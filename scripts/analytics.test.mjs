import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
const ordersSource = await readFile(new URL('../src/domain/orders.ts', import.meta.url), 'utf8')
const ordersCompiled = ts.transpileModule(ordersSource, { compilerOptions }).outputText
const ordersUrl = `data:text/javascript;base64,${Buffer.from(ordersCompiled).toString('base64')}`
const analyticsSource = await readFile(new URL('../src/domain/analytics.ts', import.meta.url), 'utf8')
const analyticsCompiled = ts.transpileModule(analyticsSource, { compilerOptions }).outputText.replace("from './orders'", `from '${ordersUrl}'`)
const { analyticsRange, buildAnalytics } = await import(`data:text/javascript;base64,${Buffer.from(analyticsCompiled).toString('base64')}`)

const products = [
  { id: 'p1', name: 'Blender', cost: 40, price: 100, stock: 3, lowStockAt: 1 },
  { id: 'p2', name: 'Storage', cost: 30, price: 100, stock: 5, lowStockAt: 1 },
]
const employees = [{ id: 'e1', name: 'Amina', bonus: 5, bonusBasis: 'per_order', active: true }]
const base = { phone: '', address: '', paymentStatus: 'Paid', assignedTo: '', notes: '' }
const orders = [
  { ...base, id: 'o1', client: 'First', status: 'Delivered', createdAt: '2026-08-31T12:00:00Z', deliveredAt: '2026-09-05T12:00:00Z', items: [{ productId: 'p1', quantity: 2, unitPrice: 100, costTotal: 80 }], deliveryCharge: 20, otherExpense: 10, confirmationEmployeeId: 'e1', confirmationBonus: 5 },
  { ...base, id: 'o2', client: 'Second', status: 'Delivered', createdAt: '2026-09-05T12:00:00Z', deliveredAt: '2026-09-06T12:00:00Z', items: [{ productId: 'p2', quantity: 1, unitPrice: 100, costTotal: 30 }], deliveryCharge: 10, otherExpense: 0 },
  { ...base, id: 'o3', client: 'Canceled', status: 'Canceled', createdAt: '2026-09-06T12:00:00Z', items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }], deliveryCharge: 20, otherExpense: 0 },
  { ...base, id: 'o4', client: 'Pending', status: 'Confirmed', createdAt: '2026-09-07T12:00:00Z', items: [{ productId: 'p2', quantity: 1, unitPrice: 100 }], deliveryCharge: 10, otherExpense: 0 },
]

test('analysis includes every material cost and uses delivery dates', () => {
  const result = buildAnalytics(orders, products, employees, { start: '2026-09-01', end: '2026-09-30' })
  assert.deepEqual(result.totals, { revenue: 300, productCost: 110, deliveryCost: 30, otherCost: 10, confirmationCost: 5, totalCost: 155, profit: 145, margin: 145 / 3, orders: 2, units: 3, averageOrder: 150 })
  assert.equal(result.products[0].name, 'Blender')
  assert.equal(result.products[0].profit, 85)
  assert.equal(result.bestDay.key, '2026-09-05')
  assert.equal(result.bestMonth.key, '2026-09')
})

test('fulfillment separates delivered, canceled, and pending orders', () => {
  const result = buildAnalytics(orders, products, employees, null)
  assert.equal(result.completedOrders, 3)
  assert.equal(result.canceledOrders, 1)
  assert.equal(result.pendingOrders, 1)
  assert.ok(Math.abs(result.fulfillmentRate - (200 / 3)) < 1e-10)
})

test('analysis ranges are inclusive and anchored to the local calendar', () => {
  const now = new Date(2026, 8, 8, 10, 0, 0)
  assert.deepEqual(analyticsRange('month', now), { start: '2026-09-01', end: '2026-09-08' })
  assert.deepEqual(analyticsRange('30d', now), { start: '2026-08-10', end: '2026-09-08' })
  assert.equal(analyticsRange('all', now), null)
})
