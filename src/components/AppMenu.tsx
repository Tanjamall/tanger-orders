import { useEffect, useRef, useState } from 'react'
import { GearSix, List, MapPin, Moon, Path, Sun, UsersThree, X } from '@phosphor-icons/react'
import type { AppTab } from '../domain/orders'

type AppMenuProps = {
  dark: boolean
  onNavigate: (tab: AppTab) => void
  onPlanRoute: () => void
  onToggleTheme: () => void
}

export function AppMenu({ dark, onNavigate, onPlanRoute, onToggleTheme }: AppMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismissWithEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [open])

  const navigate = (tab: AppTab) => {
    setOpen(false)
    onNavigate(tab)
  }

  return <div className="app-menu" ref={root}>
    <button className={`square-action menu-trigger ${open ? 'is-active' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>{open ? <X /> : <List />}</button>
    {open && <div className="app-menu-popover" role="menu">
      <button role="menuitem" onClick={() => navigate('employees')}><UsersThree /><span><b>Employees</b><small>Confirmation work and bonuses</small></span></button>
      <button role="menuitem" onClick={() => navigate('map')}><MapPin /><span><b>Delivery map</b><small>See active deliveries</small></span></button>
      <button role="menuitem" onClick={() => { setOpen(false); onPlanRoute() }}><Path /><span><b>Plan route</b><small>Order stops from your location</small></span></button>
      <button role="menuitem" onClick={() => navigate('settings')}><GearSix /><span><b>Settings</b><small>Workspace and notifications</small></span></button>
      <button role="menuitem" onClick={() => { setOpen(false); onToggleTheme() }}>{dark ? <Sun /> : <Moon />}<span><b>{dark ? 'Light mode' : 'Dark mode'}</b><small>Change the app appearance</small></span></button>
    </div>}
  </div>
}
