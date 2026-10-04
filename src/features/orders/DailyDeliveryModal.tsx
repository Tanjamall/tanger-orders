import { useEffect, useState } from 'react'
import { Modal } from '../../components/ui'
import { buildAnalytics } from '../../domain/analytics'
import { eventDateKey, type ConfirmationEmployee } from '../../domain/orders'
import type { DailyDeliveryCost, Order, Product } from '../../types'
import './daily-delivery.css'

export function DailyDeliveryModal({ costs, orders, products, employees, ready, close, save }: {
  costs: DailyDeliveryCost[]; orders: Order[]; products: Product[]; employees: ConfirmationEmployee[]
  ready: boolean; close: () => void; save: (entry: DailyDeliveryCost) => Promise<void>
}) {
  const today = eventDateKey(new Date().toISOString())
  const [date, setDate] = useState(today)
  const saved = costs.find(entry => entry.date === date)
  const [amount, setAmount] = useState(String(saved?.amount ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setAmount(String(saved?.amount ?? '')); setError('') }, [date, saved?.amount])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [busy, close])
  const totals = buildAnalytics(orders, products, employees, { start: date, end: date }).totals
  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 9999999999.99
  const format = (number: number) => `${number.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`
  return <Modal title="End-of-day delivery cost" close={() => { if (!busy) close() }}>
    <form className="form daily-delivery-form" onSubmit={async event => {
      event.preventDefault()
      if (!valid || !ready || busy) return
      setBusy(true); setError('')
      try { await save({ date, amount: Math.round(value * 100) / 100 }); close() }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save. Please try again.') }
      finally { setBusy(false) }
    }}>
      <p>Record the shared delivery total for this day. It is deducted once from daily profit.</p>
      <label className="form-field"><span>Delivery date · Casablanca time</span><input autoFocus type="date" required value={date} max={today} disabled={busy} onChange={event => { if (event.target.value) setDate(event.target.value) }} /></label>
      <label className="form-field"><span>Total shared delivery cost (DH)</span><input type="number" required min="0" max="9999999999.99" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} disabled={busy || !ready} onChange={event => setAmount(event.target.value)} /></label>
      <small>{saved ? `Saved total: ${format(saved.amount)}. Saving replaces it; enter 0 to clear the cost.` : 'Enter the full daily total, not a cost per order.'}</small>
      <dl className="daily-delivery-summary" aria-live="polite">
        <div><dt>Delivered orders</dt><dd>{totals.orders}</dd></div>
        <div><dt>Average delivery / order</dt><dd>{totals.orders && valid ? format(value / totals.orders) : '—'}</dd></div>
        <div><dt>Profit after individual costs</dt><dd>{format(totals.profit)}</dd></div>
        <div><dt>Daily net profit</dt><dd>{format(totals.profit - (valid ? value : 0))}</dd></div>
      </dl>
      {!totals.orders && <p>No delivered orders on this date. The expense still reduces the day’s profit; an average becomes available when orders are delivered.</p>}
      <p className="form-note">The average is informational. Individual order costs are still deducted separately. Only enter delivery costs that are not already recorded on orders.</p>
      {!ready && <p role="status">Shared data is not ready. Close this form and use Retry if a refresh failed.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="primary full" disabled={busy || !ready || !valid}>{busy ? 'Saving…' : 'Save daily cost'}</button>
      {costs.length > 0 && <details><summary>Recorded days ({costs.length})</summary><div className="daily-delivery-history">{[...costs].sort((a, b) => b.date.localeCompare(a.date)).map(entry => <button type="button" key={entry.date} disabled={busy} onClick={() => setDate(entry.date)}><span>{entry.date}</span><strong>{format(entry.amount)}</strong></button>)}</div></details>}
    </form>
  </Modal>
}
