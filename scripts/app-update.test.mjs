import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onRequestPost } from '../functions/api/app-update.ts'

const release = { version: '1.5.1', minNativeBuild: 8, url: 'https://tanger-orders.pages.dev/updates/tanger-orders-web-1.5.1.zip', checksum: 'checksum' }
const env = { ASSETS: { fetch: async () => Response.json(release) } }
const request = (info) => new Request('https://tanger-orders.pages.dev/api/app-update', { method: 'POST', body: JSON.stringify({ app_id: 'com.tanjamall.tangerorders', platform: 'android', version_code: 8, version_build: '1.5.0', version_name: 'builtin', ...info }) })

test('offers a newer compatible web bundle to the installed APK', async () => {
  const response = await onRequestPost({ request: request({}), env })
  assert.deepEqual(await response.json(), { version: release.version, url: release.url, checksum: release.checksum })
})

test('does not offer older or incompatible bundles', async () => {
  for (const info of [{ version_code: 7 }, { version_name: '1.5.1' }, { version_name: '1.5.2' }, { version_build: '1.6.0' }]) {
    const response = await onRequestPost({ request: request(info), env })
    assert.equal((await response.json()).message, 'Up to date')
  }
})
