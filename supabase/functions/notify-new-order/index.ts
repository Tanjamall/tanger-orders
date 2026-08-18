import { createClient } from '@supabase/supabase-js'
// @deno-types="@types/web-push"
import webpush from 'web-push'

type PushSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

function firstConfiguredKey(environmentName: string) {
  const value = Deno.env.get(environmentName)
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Record<string, string>
    return Object.values(parsed).find((key) => typeof key === 'string')
  } catch {
    return value
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')
    ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    ?? firstConfiguredKey('SUPABASE_PUBLISHABLE_KEYS')
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    ?? Deno.env.get('SUPABASE_SECRET_KEY')
    ?? firstConfiguredKey('SUPABASE_SECRET_KEYS')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const authorization = request.headers.get('Authorization')

  if (!supabaseUrl || !publishableKey || !secretKey || !vapidPrivateKey) {
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
  try {
    const body = await request.json() as { orderId?: string }
    orderId = body.orderId?.trim() ?? ''
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (!orderId) return json({ error: 'orderId is required' }, 400)

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: order, error: orderError } = await admin.from('orders')
    .select('id, workspace_id, client_name, items, created_by, notification_sent_at')
    .eq('id', orderId)
    .eq('created_by', userData.user.id)
    .maybeSingle()

  if (orderError) {
    console.error('Could not read order', orderError)
    return json({ error: 'Could not read order' }, 500)
  }
  if (!order) return json({ error: 'Order not found or not created by this admin' }, 404)
  if (order.notification_sent_at) return json({ sent: 0, alreadySent: true })

  const { data: claimedOrder, error: claimError } = await admin.from('orders')
    .update({ notification_sent_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('notification_sent_at', null)
    .select('id')
    .maybeSingle()

  if (claimError) {
    console.error('Could not claim notification', claimError)
    return json({ error: 'Could not prepare notifications' }, 500)
  }
  if (!claimedOrder) return json({ sent: 0, alreadySent: true })

  const { data: subscriptions, error: subscriptionError } = await admin.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('workspace_id', order.workspace_id)
    .neq('user_id', userData.user.id)

  if (subscriptionError) {
    console.error('Could not load subscriptions', subscriptionError)
    return json({ error: 'Could not load notification devices' }, 500)
  }
  if (!subscriptions?.length) return json({ sent: 0 })

  const total = Array.isArray(order.items)
    ? order.items.reduce((sum: number, item: { quantity?: number; unitPrice?: number }) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0)
    : 0
  const payload = JSON.stringify({
    title: 'New order added',
    body: `${order.client_name} · ${Math.round(total)} DH`,
    orderId: order.id,
  })

  webpush.setVapidDetails(
    'mailto:notifications@tanjamall.com',
    'BLLTRrDIs-P208BFMaFTlmpWmNvKMK46pTI3O0efzqplHMZZi2di7eK1kUDATMI6lULIeC2ZuxHPMIOclBoZJTM',
    vapidPrivateKey,
  )

  const expiredIds: string[] = []
  const results = await Promise.allSettled((subscriptions as PushSubscriptionRow[]).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 300, urgency: 'high' })
      return true
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 0
      if (statusCode === 404 || statusCode === 410) expiredIds.push(subscription.id)
      console.error('Push delivery failed', { subscriptionId: subscription.id, statusCode })
      throw error
    }
  }))

  if (expiredIds.length) {
    const { error } = await admin.from('push_subscriptions').delete().in('id', expiredIds)
    if (error) console.error('Could not remove expired subscriptions', error)
  }

  const sent = results.filter((result) => result.status === 'fulfilled').length
  return json({ sent, failed: results.length - sent })
})
