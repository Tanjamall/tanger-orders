import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY = 'BLLTRrDIs-P208BFMaFTlmpWmNvKMK46pTI3O0efzqplHMZZi2di7eK1kUDATMI6lULIeC2ZuxHPMIOclBoZJTM'

export type PushNotificationState = 'unsupported' | 'prompt' | 'denied' | 'disabled' | 'enabled'

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  return bytes.buffer
}

export function supportsPushNotifications() {
  return window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export async function getPushNotificationState(): Promise<PushNotificationState> {
  if (!supportsPushNotifications()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) return 'enabled'
  return Notification.permission === 'default' ? 'prompt' : 'disabled'
}

export async function enablePushNotifications(workspaceId: string, userId: string) {
  if (!supabase || !supportsPushNotifications()) throw new Error('Push notifications are not supported on this device.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked. Allow them in your phone settings, then try again.'
      : 'Notification permission was not granted.')
  }

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(VAPID_PUBLIC_KEY),
    })
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('This phone returned an incomplete notification subscription.')
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    workspace_id: workspaceId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint,workspace_id' })

  if (error) throw error
}

export async function disablePushNotifications() {
  if (!supabase || !supportsPushNotifications()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  if (error) throw error
  await subscription.unsubscribe()
}
