import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Geolocation, type PositionOptions } from '@capacitor/geolocation'
import { supabase } from './supabase'

const webAppOrigin = (import.meta.env.VITE_PUBLIC_APP_URL || 'https://tanger-orders.pages.dev').replace(/\/$/, '')

export const nativeAuthRedirectUrl = 'com.tanjamall.tangerorders://auth/callback'

export function authRedirectUrl() {
  return Capacitor.isNativePlatform() ? nativeAuthRedirectUrl : window.location.origin
}

export function cloudflareApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return Capacitor.isNativePlatform() ? `${webAppOrigin}${normalizedPath}` : normalizedPath
}

type AuthLinkResult = { type?: string; error?: string }

async function consumeNativeAuthUrl(url: string): Promise<AuthLinkResult> {
  if (!supabase) return { error: 'Supabase is not configured.' }
  const parsed = new URL(url)
  const query = new URLSearchParams(parsed.search)
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''))
  const value = (key: string) => query.get(key) || hash.get(key)
  const error = value('error_description') || value('error')
  if (error) return { error: error.replace(/\+/g, ' ') }

  const code = value('code')
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code)
    return { type: value('type') || undefined, error: result.error?.message }
  }

  const accessToken = value('access_token')
  const refreshToken = value('refresh_token')
  if (!accessToken || !refreshToken) return { type: value('type') || undefined, error: 'The authentication link is incomplete or has expired.' }
  const result = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  return { type: value('type') || undefined, error: result.error?.message }
}

export async function listenForNativeAuthLinks(onResult: (result: AuthLinkResult) => void) {
  if (!Capacitor.isNativePlatform() || !supabase) return () => undefined
  const handleUrl = async (url: string) => {
    try { onResult(await consumeNativeAuthUrl(url)) }
    catch (error) { onResult({ error: error instanceof Error ? error.message : 'Could not open the authentication link.' }) }
  }
  const launch = await CapacitorApp.getLaunchUrl()
  if (launch?.url) await handleUrl(launch.url)
  const listener = await CapacitorApp.addListener('appUrlOpen', ({ url }) => { void handleUrl(url) })
  return () => { void listener.remove() }
}

export async function listenForNativeBackButton(onBack: () => boolean, onExitHint: () => void) {
  if (!Capacitor.isNativePlatform()) return () => undefined
  let lastHomeBackAt = 0
  const listener = await CapacitorApp.addListener('backButton', () => {
    if (onBack()) {
      lastHomeBackAt = 0
      return
    }

    const now = Date.now()
    if (now - lastHomeBackAt <= 2000) {
      void CapacitorApp.exitApp()
      return
    }

    lastHomeBackAt = now
    onExitHint()
  })
  return () => { void listener.remove() }
}

export type DevicePosition = {
  coords: { latitude: number; longitude: number; accuracy: number }
}

type LocationError = Error & { code?: number }

function locationError(message: string, code: number): LocationError {
  return Object.assign(new Error(message), { code })
}

export function isLocationPermissionDenied(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as LocationError).code === 1
}

export async function getCurrentDevicePosition(options: PositionOptions = {}): Promise<DevicePosition> {
  if (Capacitor.isNativePlatform()) {
    let permission = await Geolocation.checkPermissions()
    if (permission.location !== 'granted') permission = await Geolocation.requestPermissions({ permissions: ['location'] })
    if (permission.location !== 'granted') throw locationError('Location permission was denied.', 1)
    return Geolocation.getCurrentPosition(options)
  }
  if (!navigator.geolocation) throw locationError('Location is not available on this device.', 2)
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options))
}
