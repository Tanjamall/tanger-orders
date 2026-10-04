import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './quiet-ledger.css'
import App from './App'
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

// Confirm a downloaded bundle as soon as its UI starts, so a failed launch rolls back.
if (Capacitor.isNativePlatform()) void CapacitorUpdater.notifyAppReady()

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
