import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ArrowLeft, ChartBar, ClipboardText, Cube, MapPin, Moon, Sun, UsersThree, Warning as WarningTriangle, X } from '@phosphor-icons/react'

export function PageHeader({ title, subtitle, dark, toggleTheme, actions, back }: { title: string; subtitle: string; dark?: boolean; toggleTheme?: () => void; actions?: ReactNode; back?: () => void }) {
  return <header className="ledger-header">
    <div className="ledger-title-wrap">{back && <button className="back-icon" aria-label="Go back" onClick={back}><ArrowLeft /></button>}<div><h1>{title}</h1><p>{subtitle}</p></div></div>
    <div className="header-actions">{typeof dark === 'boolean' && toggleTheme && <button className="square-action theme-toggle" aria-label={dark ? 'Use light mode' : 'Use dark mode'} onClick={toggleTheme}>{dark ? <Moon weight="fill" /> : <Sun />}</button>}{actions}</div>
  </header>
}

export function NavButton({ icon, label, active, onClick }: { icon: 'orders' | 'inventory' | 'profit' | 'employees' | 'map'; label: string; active: boolean; onClick: () => void }) {
  const icons = { orders: <ClipboardText />, inventory: <Cube />, profit: <ChartBar />, employees: <UsersThree />, map: <MapPin /> }
  return <button className={active ? 'active' : ''} onClick={onClick}>{icons[icon]}<span>{label}</span></button>
}

export function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="profit-metric"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></div>
}

export function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className="empty-state"><span>{icon}</span><b>{title}</b><p>{copy}</p></div>
}

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={close}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button aria-label="Close" onClick={close}><X /></button></div>{children}</section></div>
}

export class FeatureBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tanger Orders screen error:', error, info)
  }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <section className="feature-fallback" role="alert"><WarningTriangle /><h2>This screen had a problem</h2><p>The rest of Tanger Orders is still running. Try this screen again.</p><button className="primary" onClick={() => this.setState({ failed: false })}>Try again</button></section>
  }
}
