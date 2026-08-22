import { createClient } from '@supabase/supabase-js'
// @deno-types="@types/web-push"
import webpush from 'web-push'

type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string }
type AndroidDeviceRow = { id: string; device_token: string }
type FirebaseServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function firstConfiguredKey(environmentName: string) {
  const value = Deno.env.get(environmentName)
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Record<string, string>
    return Object.values(parsed).find((key) => typeof key === 'string')
  } catch { return value }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function privateKeyBytes(pem: string) {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function firebaseServiceAccount() {
  const configured = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
  if (!configured) return null
  try {
    const account = JSON.parse(configured) as Partial<FirebaseServiceAccount>
    if (!account.project_id || !account.client_email || !account.private_key) return null
    return account as FirebaseServiceAccount
  } catch { return null }
}

async function firebaseAccessToken(account: FirebaseServiceAccount) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: account.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claims}`
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`
  const response = await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const result = await response.json() as { access_token?: string; error_description?: string }
  if (!response.ok || !result.access_token) throw new Error(result.error_description || 'Could not authorize Firebase messaging')
  return result.access_token
}

async function sendAndroidNotification(account: FirebaseServiceAccount, accessToken: string, device: AndroidDeviceRow, title: string, body: string, orderId: string) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: device.device_token,
        notification: { title, body },
        data: { orderId },
        android: { priority: 'high', notification: { channel_id: 'order-updates', tag: `order-${orderId}` } },
      },
    }),
  })
  if (response.ok) return { sent: true, expired: false }
  const result = await response.json().catch(() => ({})) as { error?: { status?: string } }
  const expired = response.status === 404 || result.error?.status === 'UNREGISTERED'
  console.error('FCM delivery failed', { deviceId: device.id, status: response.status, code: result.error?.status })
  return { sent: false, expired }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? firstConfiguredKey('SUPABASE_PUBLISHABLE_KEYS')
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? firstConfiguredKey('SUPABASE_SECRET_KEYS')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error('Push sender is missing required environment variables')
    return json({ error: 'Notification service is not configured' }, 503)
  }
  if (!authorization) return json({ error: 'Sign in required' }, 401)

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Invalid session' }, 401)

  let orderId = ''
  try { orderId = ((await request.json()) as { orderId?: string }).orderId?.trim() ?? '' }
  catch { return json({ error: 'Invalid request body' }, 400) }
  if (!orderId) return json({ error: 'orderId is required' }, 400)

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: order, error: orderError } = await admin.from('orders')
    .select('id, workspace_id, client_name, items, created_by, notification_sent_at')
    .eq('id', orderId).eq('created_by', userData.user.id).maybeSingle()
  if (orderError) { console.error('Could not read order', orderError); return json({ error: 'Could not read order' }, 500) }
  if (!order) return json({ error: 'Order not found or not created by this admin' }, 404)
  if (order.notification_sent_at) return json({ sent: 0, alreadySent: true })

  const { data: claimedOrder, error: claimError } = await admin.from('orders')
    .update({ notification_sent_at: new Date().toISOString() }).eq('id', order.id).is('notification_sent_at', null).select('id').maybeSingle()
  if (claimError) { console.error('Could not claim notification', claimError); return json({ error: 'Could not prepare notifications' }, 500) }
  if (!claimedOrder) return json({ sent: 0, alreadySent: true })

  const [webResult, androidResult] = await Promise.all([
    admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('workspace_id', order.workspace_id).neq('user_id', userData.user.id),
    admin.from('android_push_devices').select('id, device_token').eq('workspace_id', order.workspace_id).neq('user_id', userData.user.id),
  ])
  if (webResult.error || androidResult.error) {
    console.error('Could not load subscriptions', webResult.error || androidResult.error)
    return json({ error: 'Could not load notification devices' }, 500)
  }

  const total = Array.isArray(order.items)
    ? order.items.reduce((sum: number, item: { quantity?: number; unitPrice?: number }) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0)
    : 0
  const title = 'New order added'
  const body = `${order.client_name} · ${Math.round(total)} DH`
  const payload = JSON.stringify({ title, body, orderId: order.id })

  const webSubscriptions = (webResult.data ?? []) as PushSubscriptionRow[]
  const expiredWebIds: string[] = []
  let webDeliveries: PromiseSettledResult<void>[] = []
  if (webSubscriptions.length && vapidPrivateKey) {
    webpush.setVapidDetails('mailto:notifications@tanjamall.com', 'BLLTRrDIs-P208BFMaFTlmpWmNvKMK46pTI3O0efzqplHMZZi2di7eK1kUDATMI6lULIeC2ZuxHPMIOclBoZJTM', vapidPrivateKey)
    webDeliveries = await Promise.allSettled(webSubscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 300, urgency: 'high' })
      } catch (error) {
        const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode: unknown }).statusCode) : 0
        if (statusCode === 404 || statusCode === 410) expiredWebIds.push(subscription.id)
        console.error('Web Push delivery failed', { subscriptionId: subscription.id, statusCode })
        throw error
      }
    }))
  } else if (webSubscriptions.length) {
    console.error('Web Push subscriptions exist but VAPID_PRIVATE_KEY is not configured')
  }

  const androidDevices = (androidResult.data ?? []) as AndroidDeviceRow[]
  const account = firebaseServiceAccount()
  const expiredAndroidIds: string[] = []
  let androidSent = 0
  let androidFailed = 0
  if (androidDevices.length && account) {
    try {
      const accessToken = await firebaseAccessToken(account)
      const deliveries = await Promise.all(androidDevices.map((device) => sendAndroidNotification(account, accessToken, device, title, body, order.id)))
      androidSent = deliveries.filter((delivery) => delivery.sent).length
      androidFailed = deliveries.length - androidSent
      deliveries.forEach((delivery, index) => { if (delivery.expired) expiredAndroidIds.push(androidDevices[index].id) })
    } catch (error) {
      androidFailed = androidDevices.length
      console.error('Could not authorize Firebase delivery', error)
    }
  } else if (androidDevices.length) {
    androidFailed = androidDevices.length
    console.error('Android devices exist but FIREBASE_SERVICE_ACCOUNT is not configured')
  }

  await Promise.all([
    expiredWebIds.length ? admin.from('push_subscriptions').delete().in('id', expiredWebIds) : Promise.resolve(),
    expiredAndroidIds.length ? admin.from('android_push_devices').delete().in('id', expiredAndroidIds) : Promise.resolve(),
  ])

  const webSent = webDeliveries.filter((result) => result.status === 'fulfilled').length
  const sent = webSent + androidSent
  const failed = webSubscriptions.length - webSent + androidFailed
  return json({ sent, failed, webSent, androidSent, androidConfigured: Boolean(account) })
})
