import type { DateRange } from '../domain/orders'

type Preset = { id: string; label: string; range: DateRange }

export function DateRangePresets({ value, presets, onChange, onCustom, customOpen, label }: { value: DateRange; presets: Preset[]; onChange: (range: DateRange) => void; onCustom: () => void; customOpen: boolean; label: string }) {
  const active = presets.find(({ range }) => range.start === value.start && range.end === value.end)?.id
  return <div className="date-range-presets" role="group" aria-label={label}>
    {presets.map(({ id, label: title, range }) => <button key={id} type="button" className={active === id ? 'selected' : ''} aria-pressed={active === id} onClick={() => onChange(range)}>{title}</button>)}
    <button type="button" className={customOpen || !active ? 'selected' : ''} aria-pressed={!active} aria-haspopup="dialog" aria-expanded={customOpen} onClick={onCustom}>Custom</button>
  </div>
}
