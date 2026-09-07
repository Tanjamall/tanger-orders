import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Run the actual domain selectors without adding a test framework to the app.
const source = await readFile(new URL('../src/domain/orders.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { carriedOrders, ordersForRange, orderActivityDate, eventDateKey, inDateRange, previousMonthRange } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const september = { start: '2026-09-01', end: '2026-09-30' }
const august = { start: '2026-08-01', end: '2026-08-31' }
const order = (id, status, createdAt, deliveredAt) => ({ id, status, createdAt, deliveredAt })

test('unfinished orders survive month rollover, including orders older than last month', () => {
  const orders = [order('old', 'Confirmed', '2026-08-31T12:00:00Z'), order('older', 'New', '2026-07-20T12:00:00Z'), order('current', 'New', '2026-09-04T12:00:00Z'), order('canceled', 'Canceled', '2026-08-31T12:00:00Z')]
  assert.deepEqual(carriedOrders(orders, september, september.start).map(o => o.id), ['old', 'older'])
  assert.deepEqual(ordersForRange(orders, september).map(o => o.id), ['current'])
  assert.deepEqual(carriedOrders(orders, august, september.start).map(o => o.id), ['older'])
})

test('a carried order moves into the delivery month without counting twice', () => {
  const completed = order('cross-month', 'Delivered', '2026-08-31T12:00:00Z', '2026-09-05T12:00:00Z')
  assert.equal(carriedOrders([completed], september, september.start).length, 0)
  assert.deepEqual(ordersForRange([completed], september), [completed])
  assert.equal(ordersForRange([completed], august).length, 0)
})

test('Friday creation and Saturday delivery group under Saturday', () => {
  const completed = order('example', 'Delivered', '2026-09-04T10:00:00Z', '2026-09-05T11:00:00Z')
  assert.equal(eventDateKey(orderActivityDate(completed)), '2026-09-05')
  assert.equal(ordersForRange([completed], { start: '2026-09-04', end: '2026-09-04' }).length, 0)
  assert.equal(ordersForRange([completed], { start: '2026-09-05', end: '2026-09-05' }).length, 1)
})

test('events use Casablanca dates near midnight and confirmation periods use confirmation time', () => {
  assert.equal(eventDateKey('2026-09-04T23:30:00Z'), '2026-09-05')
  assert.equal(eventDateKey('2026-09-04'), '2026-09-04')
  assert.equal(inDateRange(eventDateKey('2026-08-31T23:30:00Z'), september), true)
  assert.equal(inDateRange(eventDateKey('2026-08-31T23:30:00Z'), august), false)
})

test('previous month handles year rollover and leap years', () => {
  assert.deepEqual(previousMonthRange(new Date(2026, 0, 4)), { start: '2025-12-01', end: '2025-12-31' })
  assert.deepEqual(previousMonthRange(new Date(2024, 2, 4)), { start: '2024-02-01', end: '2024-02-29' })
})

test('legacy delivered orders retain a fallback and reopened orders use creation date', () => {
  const legacy = order('legacy', 'Delivered', '2026-08-20T12:00:00Z')
  assert.equal(ordersForRange([legacy], august).length, 1)
  const reopened = { ...legacy, status: 'Confirmed', deliveredAt: '2026-09-05T12:00:00Z' }
  assert.equal(eventDateKey(orderActivityDate(reopened)), '2026-08-20')
})
