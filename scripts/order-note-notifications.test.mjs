import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = (await readFile(new URL('../supabase/functions/notify-new-order/index.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

function setup(overrides = {}, { visible = true, race = false } = {}) {
  const order = { id: 'order-1', workspace_id: 'workspace-1', client_name: 'Customer', notes: 'Call at noon', notes_revision: 'revision-1', notes_updated_by: 'actor', notes_change_kind: 'added', notes_notification_sent_at: null, created_by: 'actor', notification_sent_at: null, delivered_by: 'actor', delivery_notification_sent_at: null, status: 'Delivered', items: [] , ...overrides }
  const sent = []
  const deviceFilters = []
  function client(isUser) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'actor', email: 'actor@example.com' } } }) },
      from(table) {
        let update
        const filters = []
        const query = {
          select() { return query },
          update(values) { update = values; return query },
          eq(key, value) { filters.push([key, value]); return query },
          neq(key, value) { deviceFilters.push([table, key, value]); return query },
          is(key, value) { filters.push([key, value]); return query },
          in() { return query },
          maybeSingle() { return Promise.resolve(result()) },
          then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
        }
        function result() {
          if (table === 'orders') {
            if (isUser) return { data: visible ? { id: order.id } : null }
            if (update) {
              if (race) order.notes_revision = 'newer-revision'
              if (!filters.every(([key, value]) => order[key] === value)) return { data: null }
              Object.assign(order, update)
            }
            return { data: { ...order } }
          }
          if (table === 'profiles') return { data: { display_name: 'Saeed' } }
          if (table === 'push_subscriptions') return { data: [{ id: 'device-1', endpoint: 'https://push.example', p256dh: 'key', auth: 'auth' }] }
          return { data: [] }
        }
        return query
      },
    }
  }
  let handler
  let count = 0
  vm.runInNewContext(compiled, {
    Deno: { env: { get: (key) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'secret', VAPID_PRIVATE_KEY: 'vapid' })[key] }, serve(fn) { handler = fn } },
    createClient: () => client(count++ % 2 === 0),
    webpush: { setVapidDetails() {}, async sendNotification(_subscription, payload) { sent.push(JSON.parse(payload)) } },
    Response, TextEncoder, console,
  })
  async function send(event = 'notes', notesRevision = 'revision-1') {
    const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, event, notesRevision }) }))
    return { status: response.status, body: await response.json() }
  }
  return { send, sent, order, deviceFilters }
}

test('added note sends its actor, preview and order link to other workspace devices', async () => {
  const app = setup()
  assert.equal((await app.send()).body.sent, 1)
  assert.deepEqual(app.sent[0], { title: 'Saeed added an order note', body: 'Customer · Call at noon', orderId: 'order-1', event: 'notes' })
  assert.deepEqual(app.deviceFilters, [['push_subscriptions', 'user_id', 'actor'], ['android_push_devices', 'user_id', 'actor']])
})

test('duplicate requests do not resend, and later revisions can notify again', async () => {
  const app = setup()
  await app.send()
  assert.equal((await app.send()).body.alreadySent, true)
  Object.assign(app.order, { notes_revision: 'revision-2', notes_change_kind: 'edited', notes_notification_sent_at: null })
  assert.equal((await app.send('notes', 'revision-2')).body.sent, 1)
  assert.equal(app.sent.length, 2)
  assert.equal(app.sent[1].title, 'Saeed edited an order note')
})

test('stale revisions and edits racing with the claim cannot send stale notes', async () => {
  const stale = setup()
  assert.equal((await stale.send('notes', 'old-revision')).status, 409)
  assert.equal(stale.sent.length, 0)
  const raced = setup({}, { race: true })
  await raced.send()
  assert.equal(raced.sent.length, 0)
})

test('only the editor with current order access can send the note alert', async () => {
  const other = setup({ notes_updated_by: 'another-user' })
  assert.equal((await other.send()).status, 404)
  const removedMember = setup({}, { visible: false })
  assert.equal((await removedMember.send()).status, 403)
  assert.equal(other.sent.length + removedMember.sent.length, 0)
})

test('cleared notes have explicit notification text', async () => {
  const app = setup({ notes: '', notes_change_kind: 'removed' })
  await app.send()
  assert.equal(app.sent[0].title, 'Saeed removed an order note')
  assert.equal(app.sent[0].body, 'Customer · Note removed')
})

test('creation includes the note and delivery keeps its existing alert', async () => {
  const app = setup()
  await app.send('created')
  await app.send('delivered')
  assert.equal(app.sent[0].title, 'Saeed added a new order')
  assert.match(app.sent[0].body, /Note: Call at noon/)
  assert.equal(app.sent[1].title, 'Saeed delivered an order')
})

test('note requests require a revision', async () => {
  const app = setup()
  assert.equal((await app.send('notes', '')).status, 400)
  assert.equal(app.sent.length, 0)
})
