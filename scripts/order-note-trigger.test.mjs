import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// Optional module path keeps the isolated PostgreSQL runtime out of app dependencies.
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')
const migration = await readFile(new URL('../supabase/migrations/20260905100316_add_order_note_notifications.sql', import.meta.url), 'utf8')

test('note trigger tracks real changes and protects actor, revision and claims', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create schema private;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.orders (id integer primary key, notes text, status text);
      insert into auth.users values ('00000000-0000-0000-0000-000000000001');
      set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
    `)
    await db.exec(migration)
    const row = async () => (await db.query('select * from orders where id = 1')).rows[0]
    await db.exec("insert into orders (id, notes) values (1, null)")
    assert.equal((await row()).notes_revision, null)
    await db.exec("update orders set notes = '' where id = 1")
    assert.equal((await row()).notes_revision, null)
    await db.exec("update orders set notes = 'Call first' where id = 1")
    const added = await row()
    assert.ok(added.notes_revision)
    assert.equal(added.notes_change_kind, 'added')
    assert.equal(added.notes_updated_by, '00000000-0000-0000-0000-000000000001')
    await db.exec("update orders set notes_revision = null, notes_updated_by = null, notes_notification_sent_at = now() where id = 1")
    assert.equal((await row()).notes_revision, added.notes_revision)
    assert.equal((await row()).notes_updated_by, added.notes_updated_by)
    assert.equal((await row()).notes_notification_sent_at, null)
    // The trusted notification service may claim a revision without changing it.
    await db.exec("set request.jwt.claim.sub = ''; update orders set notes_notification_sent_at = now() where id = 1")
    const claimed = await row()
    assert.ok(claimed.notes_notification_sent_at)
    await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; update orders set status = 'Delivered', notes_notification_sent_at = null where id = 1")
    assert.deepEqual((await row()).notes_notification_sent_at, claimed.notes_notification_sent_at)
    assert.equal((await row()).notes_revision, added.notes_revision)
    await db.exec("update orders set notes = 'Call at noon' where id = 1")
    const edited = await row()
    assert.notEqual(edited.notes_revision, added.notes_revision)
    assert.equal(edited.notes_change_kind, 'edited')
    assert.equal(edited.notes_notification_sent_at, null)
    await db.exec("update orders set notes = null where id = 1")
    assert.equal((await row()).notes_change_kind, 'removed')
    assert.notEqual((await row()).notes_revision, edited.notes_revision)
    await db.exec("insert into orders (id, notes, notes_revision) values (2, 'Initial note', gen_random_uuid())")
    assert.equal((await db.query('select notes_revision from orders where id = 2')).rows[0].notes_revision, null)
  } finally {
    await db.close()
  }
})
