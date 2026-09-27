import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
const ordersSource = await readFile(new URL('../src/domain/orders.ts', import.meta.url), 'utf8')
const ordersCompiled = ts.transpileModule(ordersSource, { compilerOptions }).outputText
const ordersUrl = `data:text/javascript;base64,${Buffer.from(ordersCompiled).toString('base64')}`
const analyticsSource = await readFile(new URL('../src/domain/analytics.ts', import.meta.url), 'utf8')
const analyticsCompiled = ts.transpileModule(analyticsSource, { compilerOptions }).outputText.replace("from './orders'", `from '${ordersUrl}'`)
const { analyticsRange, buildAnalytics, buildBusinessAnalytics, previousAnalyticsRange, calendarSeries, analyticsChange, analyticsCsv } = await import(`data:text/javascript;base64,${Buffer.from(analyticsCompiled).toString('base64')}`)

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

const { productHistory } = await import(`data:text/javascript;base64,${Buffer.from(analyticsCompiled).toString('base64')}`)
const { normalizePhone, whatsappNumber } = await import(ordersUrl)
test('Moroccan mobile numbers normalize without changing international numbers', () => {
  assert.equal(normalizePhone('06 12 34 56 78'), '+212612345678')
  assert.equal(normalizePhone('0700000000'), '+212700000000')
  assert.equal(whatsappNumber('0600000000'), '212600000000')
  assert.equal(whatsappNumber('+212612345678'), '212612345678')
  assert.equal(whatsappNumber('00212612345678'), '212612345678')
  assert.equal(normalizePhone('+33612345678'), '+33612345678')
  assert.equal(normalizePhone('0612'), '0612')
})
test('product history combines receipts and sales, with inclusive date filters', () => {
  const batches = [{ id: 'b1', productId: 'p1', unitCost: 40, originalQuantity: 10, remainingQuantity: 8, receivedAt: '2026-09-01T12:00:00Z', source: 'restock' }]
  const history = productHistory('p1', orders, products, employees, batches, null)
  assert.equal(history.length, 3)
  assert.equal(history.find(e => e.label === 'Sale').profit, 85)
  assert.equal(history.find(e => e.label === 'Restock').amount, 400)
  assert.equal(history.find(e => e.label === 'Canceled').profit, undefined)
  const filtered = productHistory('p1', orders, products, employees, batches, { start: '2026-09-05', end: '2026-09-05' })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].label, 'Sale')
  assert.equal(buildAnalytics(orders, products, employees, { start: '2026-09-05', end: '2026-09-05' }).totals.profit, 85)
})

test('previous ranges preserve inclusive calendar length across months and leap years', () => {
  assert.deepEqual(previousAnalyticsRange({ start: '2024-03-01', end: '2024-03-02' }), { start: '2024-02-28', end: '2024-02-29' })
  assert.deepEqual(previousAnalyticsRange({ start: '2026-01-01', end: '2026-01-01' }), { start: '2025-12-31', end: '2025-12-31' })
  assert.equal(previousAnalyticsRange(null), null)
  assert.equal(analyticsChange(200, 0), 'No baseline')
  assert.equal(analyticsChange(-50, -100), '+50.0%')
  assert.equal(analyticsChange(0, 0), 'No change')
})

test('time series includes zero days and all-time monthly endpoints', () => {
  const day = { key: '2026-09-02', label: '2 Sep', revenue: 100, profit: -20, orders: 1 }
  const series = calendarSeries([day], { start: '2026-09-01', end: '2026-09-03' }, 'days')
  assert.equal(series.length, 3)
  assert.equal(series[0].revenue, 0)
  assert.equal(series[1].profit, -20)
  assert.equal(series[2].orders, 0)
  const month = { ...day, key: '2026-09' }
  assert.deepEqual(calendarSeries([month], null, 'months'), [month])
  assert.equal(calendarSeries([{ ...month, key: '2025-12' }, { ...month, key: '2026-02' }], null, 'months').length, 3)
  assert.deepEqual(calendarSeries([], null, 'months'), [])
})

test('product profit reconciles for free orders and duplicate product lines count as one order', () => {
  const free = { ...orders[0], items: [{ productId: 'p1', quantity: 1, unitPrice: 0, costTotal: 40 }, { productId: 'p1', quantity: 2, unitPrice: 0, costTotal: 80 }, { productId: 'p2', quantity: 1, unitPrice: 0, costTotal: 30 }] }
  const result = buildAnalytics([free], products, employees, null)
  assert.equal(result.products.reduce((sum, p) => sum + p.profit, 0), result.totals.profit)
  assert.equal(result.products.find(p => p.id === 'p1').orders, 1)
  assert.equal(productHistory('p1', [free], products, employees, [], null)[0].profit, result.products.find(p => p.id === 'p1').profit)
})

test('customer matching normalizes phones and never uses deliveries after the selected period', () => {
  const records = [
    { ...orders[0], id: 'prior', phone: '06 12 34 56 78', deliveredAt: '2026-08-10T12:00:00Z' },
    { ...orders[1], id: 'repeat', phone: '+212612345678' },
    { ...orders[1], id: 'new', phone: '0700000000' },
    { ...orders[1], id: 'future', phone: '0700000000', deliveredAt: '2026-10-01T12:00:00Z' },
    { ...orders[1], id: 'missing', phone: '' },
    { ...orders[1], id: 'invalid', phone: '0612' },
  ]
  const result = buildBusinessAnalytics(records, products, employees, [], { start: '2026-09-01', end: '2026-09-30' })
  assert.equal(result.buyers.length, 2)
  assert.equal(result.repeatBuyers, 1)
  assert.equal(result.missingPhones, 2)
})

test('delivery cohort, unpaid revenue, and current backlog use their stated date bases', () => {
  const records = [...orders, { ...orders[3], id: 'old-open', createdAt: '2026-07-01T12:00:00Z' }].map(o => o.id === 'o1' ? { ...o, paymentStatus: 'Pay on delivery' } : o)
  const result = buildBusinessAnalytics(records, products, employees, [], { start: '2026-09-01', end: '2026-09-30' }, new Date('2026-09-10T12:00:00Z'))
  assert.equal(result.cohortOrders, 3) // August-created delivery is excluded from this cohort only.
  assert.equal(result.successRate, 50)
  assert.equal(result.paid, 100)
  assert.equal(result.unpaid, 200)
  assert.equal(result.pipeline, 2)
  assert.equal(result.pipelineValue, 200)
  assert.equal(result.aging, 1)
  assert.equal(result.averageDeliveryDays, 3)
})

test('inventory avoids bundle valuation double-counting and includes component demand', () => {
  const catalog = [...products, { id: 'bundle', name: 'Bundle', cost: 0, price: 250, stock: 99, lowStockAt: 1, components: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }] }]
  const sold = { ...orders[1], items: [{ productId: 'bundle', quantity: 1, unitPrice: 250 }] }
  const batches = [{ id: 'r1', productId: 'p1', originalQuantity: 4, remainingQuantity: 2, unitCost: 40, receivedAt: '2026-09-02T12:00:00Z', source: 'restock' }, { id: 'opening', productId: 'p1', originalQuantity: 3, remainingQuantity: 3, unitCost: 40, receivedAt: '2026-09-02T12:00:00Z', source: 'opening_balance' }]
  const result = buildBusinessAnalytics([sold], catalog, employees, batches, { start: '2026-09-01', end: '2026-09-30' }, new Date('2026-09-10T12:00:00Z'))
  assert.equal(result.stockValue, 270)
  assert.equal(result.inventory.find(p => p.id === 'bundle').stock, 1)
  assert.equal(result.inventory.find(p => p.id === 'p1').units, 2)
  assert.equal(result.inventory.find(p => p.id === 'p1').cover, 45)
  assert.equal(result.restockSpend, 160)
  assert.equal(result.restockUnits, 4)
  assert.equal(result.lowStock, 1)
})

test('empty business report has no invented rates, buyers, or delivery durations', () => {
  const result = buildBusinessAnalytics([], products, [], [], null)
  assert.equal(result.successRate, null)
  assert.equal(result.averageDeliveryDays, null)
  assert.equal(result.repeatBuyers, 0)
  assert.equal(result.unpaid, 0)
  assert.ok(result.inventory.every(p => p.cover === null))
})

test('CSV preserves numbers, quotes user strings and neutralizes formula prefixes', () => {
  const csv = analyticsCsv([['=SUM(A1)', 'a,"b"', -20], [' @malicious', 'مرحبا', 1.23]])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"\'=SUM(A1)"'))
  assert.ok(csv.includes('"a,""b"""'))
  assert.ok(csv.includes('"-20"'))
  assert.ok(csv.includes('"\' @malicious"'))
})

const paginationSource = await readFile(new URL('../src/domain/pagination.ts', import.meta.url), 'utf8')
const paginationCompiled = ts.transpileModule(paginationSource, { compilerOptions }).outputText
const { readAllPages } = await import(`data:text/javascript;base64,${Buffer.from(paginationCompiled).toString('base64')}`)
test('paginated reads include more than 1000 records even when server caps each page', async () => {
  const records = Array.from({ length: 1251 }, (_, id) => ({ id }))
  const rows = await readAllPages(async (from, to) => ({ data: records.slice(from, Math.min(to + 1, from + 300)), error: null, count: records.length }))
  assert.deepEqual(rows, records)
})
test('pagination rejects failed or incomplete history rather than publishing partial totals', async () => {
  await assert.rejects(readAllPages(async () => ({ data: null, error: new Error('offline'), count: null })), /offline/)
  await assert.rejects(readAllPages(async () => ({ data: [], error: null, count: 100 })), /History changed/)
  await assert.rejects(readAllPages(async () => ({ data: [], error: null, count: null })), /record count/)
  const empty = await readAllPages(async () => ({ data: [], error: null, count: 0 }))
  assert.deepEqual(empty, [])
})

test('Supabase page queries retain workspace filtering, unique ordering and exact totals', async () => {
  const records = Array.from({ length: 1107 }, (_, index) => ({ id: String(index).padStart(4, '0'), workspace_id: 'test-workspace' }))
  let queries = 0
  const client = createClient('https://analytics-test.invalid', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      queries++
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('workspace_id'), 'eq.test-workspace')
      assert.equal(url.searchParams.get('order'), 'id.asc')
      assert.ok(new Headers(init.headers).get('prefer').includes('count=exact'))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const size = Number(url.searchParams.get('limit'))
      const page = records.slice(offset, offset + size)
      return new Response(JSON.stringify(page), { status: 206, headers: { 'content-type': 'application/json', 'content-range': `${offset}-${offset + page.length - 1}/${records.length}` } })
    } },
  })
  const rows = await readAllPages((from, to) => client.from('orders').select('*', { count: 'exact' }).eq('workspace_id', 'test-workspace').order('id').range(from, to))
  assert.equal(queries, 3)
  assert.deepEqual(rows, records)
})

test('analytics presets follow Casablanca at midnight and changing page counts fail closed', async () => {
  assert.deepEqual(analyticsRange('month', new Date('2026-08-31T23:30:00Z')), { start: '2026-09-01', end: '2026-09-01' })
  let calls = 0
  await assert.rejects(readAllPages(async () => ({ data: [{ id: calls++ }], error: null, count: calls === 1 ? 3 : 4 })), /History changed/)
})
