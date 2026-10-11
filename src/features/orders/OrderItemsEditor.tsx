import { useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { money, uid } from '../../domain/orders'
import type { Order, Product } from '../../types'
import type { OrderItemDraft } from '../../domain/variants'
import '../inventory/variants.css'
import './order-items.css'

type Line = OrderItemDraft & { key: string }
export function OrderItemsEditor({ order, products }: { order?: Order; products: Product[] }) {
  const [lines, setLines] = useState<Line[]>(() => order?.items.length
    ? order.items.map((item, index) => ({ key: uid(), productId: item.productId, variantId: item.variantId || '', quantity: String(item.quantity), price: String(item.unitPrice), previousIndex: index }))
    : [{ key: uid(), productId: products[0]?.id || '', variantId: '', quantity: '1', price: '' }])
  const change = (key: string, update: Partial<Line>) => setLines(all => all.map(line => line.key === key ? { ...line, ...update } : line))
  const available = (line: Line, variantId: string, stock: number) => {
    const returned = order?.status === 'Delivered' ? order.items.filter(item => item.productId === line.productId && (item.variantId || '') === variantId).reduce((sum, item) => sum + item.quantity, 0) : 0
    const other = lines.filter(item => item.key !== line.key && item.productId === line.productId && item.variantId === variantId).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    return Math.max(0, stock + returned - other)
  }
  const units = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (line.price.trim() ? Number(line.price) || 0 : products.find(p => p.id === line.productId)?.price || 0), 0)
  return <section className="order-items-editor" aria-label="Order items">
    <header><b>Order items</b><span>One line per color or product</span></header>
    <input type="hidden" name="orderItems" value={JSON.stringify(lines)} />
    {lines.map((line, index) => {
      const product = products.find(p => p.id === line.productId)
      const previous = line.previousIndex === undefined ? undefined : order?.items[line.previousIndex]
      const legacy = previous?.productId === line.productId && !previous.variantId
      const selectedStock = product?.variants?.length ? product.variants.find(v => v.id === line.variantId)?.stock : product?.stock
      return <fieldset className="order-item-line" key={line.key}>
        <legend>Item {index + 1}</legend>
        {lines.length > 1 && <button type="button" className="order-item-remove" aria-label={'Remove item ' + (index + 1)} onClick={() => setLines(all => all.filter(item => item.key !== line.key))}><Trash /></button>}
        <label className="form-field"><span>Product or bundle</span><select required value={line.productId} onChange={event => change(line.key, { productId: event.target.value, variantId: '', price: '' })}>
          {!product && <option value={line.productId}>{previous ? 'Archived product' : 'Choose a product'}</option>}
          {products.map(p => <option value={p.id} key={p.id}>{p.components ? 'Bundle: ' : ''}{p.name} · {money(p.price)}</option>)}
        </select></label>
        {Boolean(product?.variants?.length) && <fieldset className="order-variant-options"><legend>{product?.variantName || 'Variant'}</legend><div>
          {legacy && <label><input type="radio" name={'variant-' + line.key} value="" checked={!line.variantId} onChange={() => change(line.key, { variantId: '' })} /><span>Not recorded<small>Existing order</small></span></label>}
          {product!.variants!.map(v => <label key={v.id}><input type="radio" name={'variant-' + line.key} value={v.id} required={!legacy} checked={line.variantId === v.id} onChange={() => change(line.key, { variantId: v.id })} /><span><bdi>{v.label}</bdi><small>{available(line, v.id, v.stock)} available</small></span></label>)}
        </div></fieldset>}
        <div className="form-row"><label className="form-field"><span>Quantity</span><input required type="number" min="1" step="1" value={line.quantity} onChange={event => change(line.key, { quantity: event.target.value })} /></label><label className="form-field"><span>Unit price <small>Optional</small></span><input type="number" min="0" step="0.01" placeholder={String(product?.price ?? 0)} value={line.price} onChange={event => change(line.key, { price: event.target.value })} /></label></div>
        {product && !product.components && <p className="order-stock-note">{selectedStock === undefined ? 'Choose a ' + (product.variantName?.toLowerCase() || 'variant') + ' to see available stock.' : available(line, line.variantId, selectedStock) + ' units available for this line.'}</p>}
      </fieldset>
    })}
    <button type="button" className="order-add-item" disabled={lines.length >= 100 || !products.length} onClick={() => setLines(all => [...all, { key: uid(), productId: all.at(-1)?.productId || products[0]?.id || '', variantId: '', quantity: '1', price: '' }])}><Plus />Add another item</button>
    <div className="order-items-total" aria-live="polite"><span>{units} {units === 1 ? 'unit' : 'units'} total</span><strong>{money(total)}</strong></div>
    <p className="order-stock-note">Stock is deducted when delivered. Delivery and other expenses apply once to the whole order.</p>
  </section>
}
