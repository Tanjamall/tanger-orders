import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY = 'BLLTRrDIs-P208BFMaFTlmpWmNvKMK46pTI3O0efzqplHMZZi2di7eK1kUDATMI6lULIeC2ZuxHPMIOclBoZJTM'

export type PushNotificationState = 'unsupported' | 'prompt' | 'denied' | 'disabled' | 'enabled'

const nativeTokenKey = 'tanger-orders:android-push-token'
const pendingOrderKey = 'tanger-orders:pending-push-order'
const nativeActionEvent = 'tanger-orders:open-push-order'
let nativeListenersReady: Promise<void> | null = null
let nativeContext: { workspaceId: string; userId: string } | null = null
let registrationWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

async function saveNativeToken(token: string) {
  if (!supabase || !nativeContext) throw new Error('Sign in and choose a workspace before enabling notifications.')
  const { error } = await supabase.from('android_push_devices').upsert({
    user_id: nativeContext.userId,
    workspace_id: nativeContext.workspaceId,
    device_token: token,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'device_token,workspace_id' })
  if (error) throw error
  localStorage.setItem(nativeTokenKey, token)
}

async function ensureNativeListeners() {
  if (!isNativeAndroid()) return
  if (nativeListenersReady) return nativeListenersReady
  nativeListenersReady = (async () => {
    await PushNotifications.addListener('registration', async ({ value }) => {
      try {
        await saveNativeToken(value)
        registrationWaiter?.resolve()
      } catch (error) {
        registrationWaiter?.reject(error instanceof Error ? error : new Error('Could not save this phone.'))
      } finally {
        registrationWaiter = null
      }
    })
    await PushNotifications.addListener('registrationError', ({ error }) => {
      registrationWaiter?.reject(new Error(error || 'Android notification registration failed.'))
      registrationWaiter = null
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const orderId = typeof notification.data?.orderId === 'string' ? notification.data.orderId : ''
      if (!orderId) return
      localStorage.setItem(pendingOrderKey, orderId)
      window.dispatchEvent(new CustomEvent(nativeActionEvent, { detail: { orderId } }))
    })
    await PushNotifications.createChannel({
      id: 'order-updates',
      name: 'New orders',
      description: 'Alerts when another admin adds an order',
      importance: 4,
      vibration: true,
    })
  })()
  return nativeListenersReady
}

export async function initializePushNotifications() {
  await ensureNativeListeners()
}

export function consumePendingPushOrderId() {
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('orderId')
  const stored = localStorage.getItem(pendingOrderKey)
  const orderId = fromUrl || stored
  if (fromUrl) {
    url.searchParams.delete('orderId')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }
  if (stored) localStorage.removeItem(pendingOrderKey)
  return orderId
}

export function listenForPushNotificationOrders(handler: (orderId: string) => void) {
  const listener = (event: Event) => {
    const orderId = (event as CustomEvent<{ orderId?: string }>).detail?.orderId
    if (orderId) {
      localStorage.removeItem(pendingOrderKey)
      handler(orderId)
    }
  }
  window.addEventListener(nativeActionEvent, listener)
  return () => window.removeEventListener(nativeActionEvent, listener)
}

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  return bytes.buffer
}

export function supportsPushNotifications() {
  if (isNativeAndroid()) return true
  return window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export async function getPushNotificationState(): Promise<PushNotificationState> {
  if (isNativeAndroid()) {
    await ensureNativeListeners()
    const permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'denied') return 'denied'
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') return 'prompt'
    return localStorage.getItem(nativeTokenKey) ? 'enabled' : 'disabled'
  }
  if (!supportsPushNotifications()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) return 'enabled'
  return Notification.permission === 'default' ? 'prompt' : 'disabled'
}

export async function enablePushNotifications(workspaceId: string, userId: string) {
  if (!supabase || !supportsPushNotifications()) throw new Error('Push notifications are not supported on this device.')

  if (isNativeAndroid()) {
    nativeContext = { workspaceId, userId }
    await ensureNativeListeners()
    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission.receive !== 'granted') {
      throw new Error('Notifications are blocked. Allow Tanger Orders in your phone settings, then try again.')
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        registrationWaiter = null
        reject(new Error('Android notification registration timed out. Check your connection and try again.'))
      }, 20_000)
      registrationWaiter = {
        resolve: () => { window.clearTimeout(timeout); resolve() },
        reject: (error) => { window.clearTimeout(timeout); reject(error) },
      }
      void PushNotifications.register().catch((error) => {
        window.clearTimeout(timeout)
        registrationWaiter = null
        reject(error instanceof Error ? error : new Error('Android notification registration failed.'))
      })
    })
    return
  }

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
  if (isNativeAndroid()) {
    const token = localStorage.getItem(nativeTokenKey)
    if (token) {
      const { error } = await supabase.from('android_push_devices').delete().eq('device_token', token)
      if (error) throw error
    }
    await PushNotifications.unregister()
    localStorage.removeItem(nativeTokenKey)
    nativeContext = null
    return
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  if (error) throw error
  await subscription.unsubscribe()
}
