import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import { dateKey, longDate, monthEndKey, monthLabel, normalizedRange, previousMonthRange, rangeLabel, type DateRange } from '../domain/orders'

export function DateRangeCalendar({ value, onChange, close, done = close, scope = 'orders' }: { value: DateRange; onChange: (range: DateRange) => void; close: () => void; done?: () => void; scope?: 'orders' | 'profit' | 'analysis' }) {
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(`${value.start}T12:00:00`); return new Date(date.getFullYear(), date.getMonth(), 1) })
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const dragAnchor = useRef<string | null>(null)
  const dragMoved = useRef(false)
  const continuingSelection = useRef(false)
  const today = dateKey(new Date())
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
  const calendarStart = new Date(monthStart); calendarStart.setDate(calendarStart.getDate() - ((calendarStart.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_item, index) => { const day = new Date(calendarStart); day.setDate(calendarStart.getDate() + index); return day })
  const selectTo = (anchor: string, target: string) => onChange(normalizedRange(anchor, target))
  const chooseWithKeyboard = (key: string) => {
    if (selectionAnchor) { selectTo(selectionAnchor, key); setSelectionAnchor(null) }
    else { onChange({ start: key, end: key }); setSelectionAnchor(key) }
  }
  const startDrag = (key: string, pointerId: number) => {
    const anchor = selectionAnchor ?? key
    dragAnchor.current = anchor; dragMoved.current = false; continuingSelection.current = Boolean(selectionAnchor)
    if (selectionAnchor) selectTo(selectionAnchor, key); else onChange({ start: key, end: key })
    grid.current?.setPointerCapture(pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragAnchor.current) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-date]')
    const key = target?.dataset.date
    if (!key) return
    if (key !== dragAnchor.current) dragMoved.current = true
    selectTo(dragAnchor.current, key)
  }
  const endDrag = () => {
    if (!dragAnchor.current) return
    if (dragMoved.current || continuingSelection.current) setSelectionAnchor(null); else setSelectionAnchor(dragAnchor.current)
    dragAnchor.current = null
  }
  const resetToMonth = () => {
    const now = new Date(); const range = { start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: scope === 'orders' ? monthEndKey(now) : dateKey(now) }
    onChange(range); setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectionAnchor(null)
  }
  return createPortal(<div className="range-calendar-scrim" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="range-calendar" role="dialog" aria-modal="true" aria-label={`Choose ${scope} date range`}>
      <header><div><span>{scope === 'profit' ? 'Profit range' : scope === 'analysis' ? 'Analysis range' : 'Order range'}</span><strong>{rangeLabel(value)}</strong></div><button type="button" onClick={close} aria-label="Close calendar"><X /></button></header>
      <div className="quick-range"><button type="button" onClick={resetToMonth}>This month</button><button type="button" onClick={() => { const range = previousMonthRange(); onChange(range); setVisibleMonth(new Date(`${range.start}T12:00:00`)); setSelectionAnchor(null) }}>Last month</button></div>
      <div className="calendar-month-nav"><button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} aria-label="Previous month"><CaretLeft /></button><h2>{monthLabel(dateKey(visibleMonth))}</h2><button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} aria-label="Next month"><CaretRight /></button></div>
      <p className="calendar-hint">Press and swipe across dates, or tap a start and end date.</p>
      <div className="calendar-weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid" ref={grid} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        {days.map((day) => { const key = dateKey(day); const inMonth = day.getMonth() === visibleMonth.getMonth(); const inRange = key >= value.start && key <= value.end; const edge = key === value.start || key === value.end
          return <button key={key} type="button" data-date={key} className={`${inMonth ? '' : 'outside'} ${inRange ? 'in-range' : ''} ${edge ? 'range-edge' : ''} ${key === today ? 'today' : ''}`} aria-label={longDate(key)} aria-pressed={inRange} onPointerDown={(event) => { event.preventDefault(); startDrag(key, event.pointerId) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseWithKeyboard(key) } }}><span>{day.getDate()}</span></button> })}
      </div>
      <footer><button type="button" className="calendar-reset" onClick={resetToMonth}>This month</button><button type="button" className="calendar-done" onClick={done}>Show {scope === 'profit' ? 'profit' : scope === 'analysis' ? 'analysis' : 'orders'}</button></footer>
    </section>
  </div>, document.body)
}
