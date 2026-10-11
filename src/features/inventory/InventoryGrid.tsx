import { matchesInventorySearch } from '../../domain/search'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ArrowCounterClockwise, ArrowsClockwise, DotsThree, PencilSimple, Stack, Trash } from '@phosphor-icons/react'
import { bundleStock, money, productCost } from '../../domain/orders'
import type { Product } from '../../types'
import './inventory-grid.css'

type Props = { query?: string; products: Product[]; onRestock: (product: Product) => void; onEdit: (product: Product) => void; onDelete: (product: Product) => void; onArchive: (product: Product) => void }
type Menu = { product: Product; left: number; top: number; trigger: HTMLButtonElement }

export function InventoryGrid({ query = '', products, onRestock, onEdit, onDelete, onArchive }: Props) {
  const [showArchived, setShowArchived] = useState(false)
  const visible = products.filter(product => Boolean(product.archived) === showArchived && matchesInventorySearch(product.name, product.variants?.map(v => v.label) || [], query))
  const [menu, setMenu] = useState<Menu | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const close = (restoreFocus = false) => { if (restoreFocus) menu?.trigger.focus(); setMenu(null) }
  useEffect(() => {
    if (!menu) return
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !menu.trigger.contains(event.target as Node)) setMenu(null) }
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { menu.trigger.focus(); setMenu(null) } }
    const resize = () => setMenu(null)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('scroll', scroll, true); document.removeEventListener('keydown', escape); window.removeEventListener('resize', resize) }
  }, [menu])
  const open = (product: Product, trigger: HTMLButtonElement) => {
    if (menu?.product.id === product.id) { close(); return }
    const rect = trigger.getBoundingClientRect()
    const height = product.components || product.archived ? 148 : 192
    setMenu({ product, trigger, left: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)), top: rect.bottom + height + 8 > window.innerHeight - 70 ? Math.max(8, rect.top - height - 4) : rect.bottom + 4 })
  }
  const act = (action: (product: Product) => void) => { if (!menu) return; const product = menu.product; close(true); action(product) }
  const portalRoot = grid.current?.closest('.app-shell')
  return <div className="inventory-catalog" ref={grid}>
    <div className="inventory-sections" aria-label="Inventory sections"><button aria-pressed={!showArchived} onClick={() => { close(); setShowArchived(false) }}>Active <small>{products.filter(p => !p.archived).length}</small></button><button aria-pressed={showArchived} onClick={() => { close(); setShowArchived(true) }}>Archived <small>{products.filter(p => p.archived).length}</small></button></div>
    <div className="inventory-grid">
    {visible.map(product => {
      const stock = product.components ? bundleStock(product, products) : product.stock
      const low = !product.components && stock <= product.lowStockAt
      return <article className={'inventory-tile' + (low ? ' low-stock' : '')} key={product.id}>
        <header><h3><bdi>{product.name}</bdi></h3><button className="inventory-menu-trigger" aria-label={'Actions for ' + product.name} aria-haspopup="menu" aria-expanded={menu?.product.id === product.id} onClick={event => open(product, event.currentTarget)}><DotsThree weight="bold" /></button></header>
        {product.components && <span className="inventory-bundle-label"><Stack />Bundle · {product.components.length} products</span>}
        <dl className="inventory-prices"><div><dt>Sell</dt><dd>{money(product.price)}</dd></div><div><dt>Cost</dt><dd>{money(product.components ? productCost(product, products) : product.cost)}</dd></div></dl>
        <div className="inventory-tile-stock"><strong>{stock}</strong><span>{stock === 0 ? 'Out of stock' : low ? 'Low stock' : product.components ? 'bundles available' : 'in stock'}</span></div>
        {Boolean(product.variants?.length) && <details className="inventory-tile-variants"><summary>{product.variants!.length} {(product.variantName || 'Variant').toLowerCase()} options</summary><div>{product.variants!.map(v => <span key={v.id}><bdi>{v.label}</bdi><b>{v.stock}</b></span>)}</div></details>}
      </article>
    })}
    </div>
    {!visible.length && <p className="inventory-empty">{query.trim() ? 'No matching products.' : showArchived ? 'No archived products.' : 'No active products. Add a product or restore one from Archived.'}</p>}
    {menu && portalRoot && createPortal(<div className="inventory-action-menu" ref={panel} role="menu" aria-label={'Actions for ' + menu.product.name} style={{ left: menu.left, top: menu.top }} onKeyDown={event => {
      if (event.key === 'Tab') { close(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = [...panel.current!.querySelectorAll<HTMLButtonElement>('button')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
      {!menu.product.components && !menu.product.archived && <button role="menuitem" onClick={() => act(onRestock)}><ArrowsClockwise />Restock</button>}
      <button role="menuitem" onClick={() => act(onEdit)}><PencilSimple />Edit</button>
      <button role="menuitem" onClick={() => act(onArchive)}>{menu.product.archived ? <ArrowCounterClockwise /> : <Archive />}{menu.product.archived ? 'Restore' : 'Archive'}</button>
      <button role="menuitem" className="inventory-menu-delete" onClick={() => act(onDelete)}><Trash />Delete</button>
    </div>, portalRoot)}
  </div>
}
