import { useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { uid } from '../../domain/orders'
import { validateVariants } from '../../domain/variants'
import type { Product, ProductVariant } from '../../types'
import './variants.css'

type Props = { product?: Product; usedVariantIds?: string[]; inBundle?: boolean; onSubmit: (form: HTMLFormElement) => Promise<void> }
export function ProductForm({ product, usedVariantIds = [], inBundle = false, onSubmit }: Props) {
  const [enabled, setEnabled] = useState(Boolean(product?.variants?.length))
  const [variantName, setVariantName] = useState(product?.variantName || 'Color')
  const [variants, setVariants] = useState<ProductVariant[]>(product?.variants?.map(v => ({ ...v })) || [])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const bundled = Boolean(product?.components)
  const total = variants.reduce((sum,v) => sum + v.stock,0)
  const change = (id: string, field: 'label' | 'stock', value: string) => setVariants(all => all.map(v => v.id === id ? { ...v, [field]: field === 'stock' ? Number(value) : value } : v))
  return <form className="form" onSubmit={event => {
    event.preventDefault(); if (busy) return
    try { if (enabled) { validateVariants(variants); if (!variantName.trim()) throw new Error('Name the option, for example Color or Size.') } } catch (cause) { setError((cause as Error).message); return }
    setError(''); setBusy(true); void onSubmit(event.currentTarget).catch(cause => setError((cause as Error).message)).finally(() => setBusy(false))
  }}>
    <label className="form-field"><span>Product name</span><input required name="name" defaultValue={product?.name} /></label>
    <div className="form-row">{!bundled && <label className="form-field"><span>{product ? 'Active FIFO cost' : 'Buying cost'}</span><input required name="cost" type="number" min="0" step="0.01" defaultValue={product?.cost} /></label>}<label className="form-field"><span>Selling price</span><input required name="price" type="number" min="0" step="0.01" defaultValue={product?.price} /></label></div>
    {!bundled && <>
      <section className="product-variants-editor">
        <label className="variant-switch"><span><b>Product variants</b><small>Track stock separately for colors, sizes or styles.</small></span><input type="checkbox" checked={enabled} disabled={inBundle || usedVariantIds.length > 0} onChange={event => { setEnabled(event.target.checked); if (event.target.checked && !variants.length) setVariants([{ id: uid(), label: '', stock: product?.stock || 0 }, { id: uid(), label: '', stock: 0 }]) }} /></label>
        {inBundle && <p className="form-note">Remove this product from bundles before adding variants.</p>}
        {enabled && <>
          <label className="form-field"><span>Option name</span><input required name="variantName" maxLength={50} placeholder="Color, Size, Style…" value={variantName} onChange={event => setVariantName(event.target.value)} /></label>
          <div className="variant-row-labels"><span>{variantName || 'Variant'}</span><span>Stock</span></div>
          {variants.map((v,index) => <div className="variant-editor-row" key={v.id}>
            <input required maxLength={100} aria-label={'Variant ' + (index+1) + ' name'} placeholder={variantName.toLowerCase() === 'color' ? 'e.g. Black' : 'Option name'} value={v.label} onChange={event => change(v.id,'label',event.target.value)} />
            <input required aria-label={'Stock for ' + (v.label || 'variant ' + (index+1))} type="number" min="0" step="1" value={v.stock} onChange={event => change(v.id,'stock',event.target.value)} />
            <button type="button" className="variant-remove" aria-label={'Remove ' + (v.label || 'variant ' + (index+1))} title={usedVariantIds.includes(v.id) ? 'Used in orders. Keep with zero stock.' : v.stock > 0 ? 'Set stock to zero before removing this variant.' : 'Remove variant'} disabled={usedVariantIds.includes(v.id) || v.stock > 0 || variants.length === 1} onClick={() => setVariants(all => all.filter(row => row.id !== v.id))}><Trash /></button>
          </div>)}
          <button type="button" className="variant-add" disabled={variants.length >= 100} onClick={() => setVariants(all => [...all,{ id: uid(),label:'',stock:0 }])}><Plus />Add {variantName.toLowerCase() || 'variant'}</button>
          <p className="variant-total"><span>Total stock</span><strong>{total} units</strong></p>
          {product && !product.variants?.length && <p className="form-note">Distribute your {product.stock} existing units between these options. Keep the total the same unless you are correcting stock.</p>}
          <p className="form-note">All variants share this product’s buying cost and selling price.</p>
        </>}
      </section>
      <input type="hidden" name="variants" value={JSON.stringify(enabled ? variants : [])} />
      <div className="form-row">{enabled ? <input type="hidden" name="stock" value={total} /> : <label className="form-field"><span>{product ? 'Stock' : 'Opening stock'}</span><input required name="stock" type="number" min="0" step="1" defaultValue={product?.stock ?? 0} /></label>}<label className="form-field"><span>Low-stock warning</span><input name="lowStockAt" type="number" min="0" step="1" defaultValue={product?.lowStockAt ?? 3} /></label></div>
      {product && <><label className="form-field"><span>Correction note <small>Optional</small></span><input name="correctionNote" placeholder="e.g. Stock count correction" /></label><p className="form-note">Corrections apply to unsold stock. Delivered-order costs stay unchanged.</p></>}
    </>}
    {error && <p className="variant-form-error" role="alert">{error}</p>}
    <button className="primary full" disabled={busy}>{busy ? 'Saving…' : product ? 'Save changes' : 'Save product'}</button>
  </form>
}
