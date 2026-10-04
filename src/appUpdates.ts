import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'

type AndroidRelease = { versionCode: number; versionName: string; url: string }
type UpdateState = { status: 'checking' | 'ready' | 'available' | 'error'; installedVersion?: string; release?: AndroidRelease; message?: string }
const installer = registerPlugin<{ install(options: { url: string }): Promise<void> }>('AppInstaller')

export function useAppUpdates() {
  const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const [state, setState] = useState<UpdateState>({ status: 'checking' })
  const [installing, setInstalling] = useState(false)

  const check = useCallback(async () => {
    if (!native) return
    setState((current) => ({ ...current, status: 'checking', message: undefined }))
    try {
      const [installed, response] = await Promise.all([
        CapacitorApp.getInfo(),
        fetch('https://tanger-orders.pages.dev/updates/android.json', { cache: 'no-store' }),
      ])
      if (!response.ok) throw new Error('Could not check for updates.')
      const release = await response.json() as AndroidRelease
      if (!Number.isInteger(release.versionCode) || !/^https:\/\/github\.com\/Tanjamall\/tanger-orders\/releases\/download\//.test(release.url)) throw new Error('Invalid update information.')
      setState({ status: release.versionCode > Number(installed.build) ? 'available' : 'ready', installedVersion: installed.version, release })
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Could not check for updates.' }))
    }
  }, [native])

  useEffect(() => {
    if (!native) return
    void check()
    let listener: { remove(): Promise<void> } | undefined
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void check() }).then((value) => { listener = value })
    return () => { void listener?.remove() }
  }, [check, native])

  const install = async () => {
    if (!state.release) return
    setInstalling(true)
    try { await installer.install({ url: state.release.url }) }
    catch (error) { setState((current) => ({ ...current, message: error instanceof Error ? error.message : 'Could not install the update.' })) }
    finally { setInstalling(false) }
  }

  return { native, state, installing, check, install }
}
