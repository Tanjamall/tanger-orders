import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/sessionRecovery.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { createSessionReadRecovery } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const expired = { message: 'JWT expired', code: 'PGRST301' }

test('expired workspace reads share one refresh and recover', async () => {
  let refreshes = 0, reads = 0, renewed = false
  const recover = createSessionReadRecovery(async () => { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); renewed = true })
  const read = async () => { reads++; if (!renewed) throw expired; return 'workspace' }
  assert.deepEqual(await Promise.all([recover(read), recover(read)]), ['workspace', 'workspace'])
  assert.equal(refreshes, 1)
  assert.equal(reads, 4)
})
test('network failures do not refresh or replay', async () => {
  let refreshes = 0
  const recover = createSessionReadRecovery(async () => { refreshes++ })
  await assert.rejects(recover(async () => { throw new Error('Offline') }), /Offline/)
  assert.equal(refreshes, 0)
})
test('an expired JWT after refresh stops after one retry', async () => {
  let reads = 0, refreshes = 0
  const recover = createSessionReadRecovery(async () => { refreshes++ })
  await assert.rejects(recover(async () => { reads++; throw expired }))
  assert.equal(reads, 2)
  assert.equal(refreshes, 1)
})
test('failed refresh can be retried later without discarding saved data', async () => {
  let attempts = 0
  const recover = createSessionReadRecovery(async () => { if (++attempts === 1) throw new Error('Offline') })
  await assert.rejects(recover(async () => { throw expired }), /Offline/)
  let reads = 0
  assert.equal(await recover(async () => { if (++reads === 1) throw expired; return 'saved orders' }), 'saved orders')
  assert.equal(attempts, 2)
})
