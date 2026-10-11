import { useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { money, uid } from '../../domain/orders'
import type { Order, Product } from '../../types'
import type { OrderItemDraft } from '../../domain/variants'
import './order-items.css'

type Line = OrderItemDraft & { key: string }
export function OrderItemsEditor({ order, products }: { order?: Order; products: Product[] }) {
  const [lines, setLines] = useState<Line[]>(() => order?.items.length
    ? order.items.map((item, index) => ({ key: uid(), productId: item.productId, variantId: item.variantId || '', quantity: String(item.quantity), price: String(item.unitPrice), previousIndex: index }))
    : [{ key: uid(), productId: products.find(p => !p.archived)?.id || '', variantId: '', quantity: '1', price: '' }])
  const change = (key: string, update: Partial<Line>) => setLines(all => all.map(line => line.key === key ? { ...line, ...update } : line))
  const available = (line: Line, variantId: string, stock: number) => {
    const returned = order?.status === 'Delivered' ? order.items.filter(item => item.productId === line.productId && (item.variantId || '') === variantId).reduce((sum, item) => sum + item.quantity, 0) : 0
    const other = lines.filter(item => item.key !== line.key && item.productId === line.productId && item.variantId === variantId).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    return Math.max(0, stock + returned - other)
  }
  const units = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (line.price.trim() ? Number(line.price) || 0 : products.find(p => p.id === line.productId)?.price || 0), 0)
  return <section className="order-items-editor" aria-label="Order items">
    <header><b>Order items</b></header>
    <input type="hidden" name="orderItems" value={JSON.stringify(lines)} />
    {lines.map((line, index) => {
      const product = products.find(p => p.id === line.productId)
      const previous = line.previousIndex === undefined ? undefined : order?.items[line.previousIndex]
      const legacy = previous?.productId === line.productId && !previous.variantId
      return <fieldset className="order-item-line" key={line.key}>
        <legend>Item {index + 1}</legend>
        <div className="order-item-product">
          <label className="form-field"><span>Product</span><select required value={line.productId} onChange={event => change(line.key, { productId: event.target.value, variantId: '', price: '' })}>
            {!product && <option value={line.productId}>{previous ? 'Archived product' : 'Choose a product'}</option>}
            {products.filter(p => !p.archived || p.id === previous?.productId).map(p => <option value={p.id} key={p.id}>{p.components ? 'Bundle: ' : ''}{p.name}{p.archived ? ' (archived)' : ''} · {money(p.price)}</option>)}
          </select></label>
          {lines.length > 1 && <button type="button" className="order-item-remove" aria-label={'Remove item ' + (index + 1)} onClick={() => setLines(all => all.filter(item => item.key !== line.key))}><Trash /></button>}
        </div>
        <div className={'order-item-details' + (product?.variants?.length ? ' has-variants' : '')}>
          {Boolean(product?.variants?.length) && <label className="form-field"><span>{product?.variantName || 'Variant'}</span><select required={!legacy} value={line.variantId} onChange={event => change(line.key, { variantId: event.target.value })}>
            <option value="" disabled={!legacy}>{legacy ? 'Not recorded' : 'Choose'}</option>
            {product!.variants!.map(v => <option key={v.id} value={v.id}>{v.label} · {available(line, v.id, v.stock)} left</option>)}
          </select></label>}
          <label className="form-field"><span>Qty</span><input aria-label={'Quantity for item ' + (index + 1)} required type="number" min="1" step="1" value={line.quantity} onChange={event => change(line.key, { quantity: event.target.value })} /></label>
          <label className="form-field"><span>Unit price (DH)</span><input type="number" min="0" step="0.01" placeholder={String(product?.price ?? 0)} value={line.price} onChange={event => change(line.key, { price: event.target.value })} /></label>
        </div>
      </fieldset>
    })}
    <div className="order-items-footer"><button type="button" className="order-add-item" disabled={lines.length >= 100 || !products.some(p => !p.archived)} onClick={() => setLines(all => [...all, { key: uid(), productId: products.find(p => !p.archived && p.id === all.at(-1)?.productId)?.id || products.find(p => !p.archived)?.id || '', variantId: '', quantity: '1', price: '' }])}><Plus />Add item</button>
    <div className="order-items-total" aria-live="polite"><span>{units} {units === 1 ? 'unit' : 'units'}</span><strong>{money(total)}</strong></div>
    </div>
  </section>
}
