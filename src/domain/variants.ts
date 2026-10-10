import type { Order, OrderItem, Product, ProductVariant } from '../types'

export function validateVariants(variants: ProductVariant[]) {
  const labels = new Set<string>(), ids = new Set<string>()
  for (const variant of variants) {
    const label = variant.label.trim().toLocaleLowerCase()
    if (!label) throw new Error('Give every variant a name, such as Black or Red.')
    if (!variant.id || ids.has(variant.id) || labels.has(label)) throw new Error('Each variant needs a different name.')
    if (!Number.isInteger(variant.stock) || variant.stock < 0) throw new Error('Variant stock must be a whole number, zero or more.')
    labels.add(label); ids.add(variant.id)
  }
  return variants.map(variant => ({ ...variant, label: variant.label.trim() }))
}

export function variantsFromForm(values: FormData): ProductVariant[] {
  return validateVariants(JSON.parse(String(values.get('variants') || '[]')) as ProductVariant[])
}

export function orderItemName(item: OrderItem, products: Product[]) {
  const product = products.find(entry => entry.id === item.productId)
  const variant = item.variantLabel || product?.variants?.find(entry => entry.id === item.variantId)?.label
  return (product?.name ?? 'Product') + (variant ? ' · ' + variant : '')
}

export function formOrderItem(product: Product, values: FormData, previous?: OrderItem): OrderItem {
  const quantity = Number(values.get('quantity'))
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a whole number, greater than zero.')
  const variantId = String(values.get('variantId') || '')
  const variant = product.variants?.find(entry => entry.id === variantId)
  const legacy = previous?.productId === product.id && !previous.variantId && !variantId
  if (product.variants?.length && !variant && !legacy) throw new Error('Choose a ' + (product.variantName?.toLowerCase() || 'variant') + ' for ' + product.name + '.')
  if (variantId && !variant) throw new Error('This variant is no longer available. Refresh and choose another.')
  const rawPrice = String(values.get('price') || '').trim()
  const unitPrice = rawPrice ? Number(rawPrice) : product.price
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Price must be zero or more.')
  const sameVariant = previous?.productId === product.id && previous.variantId === variant?.id
  return { productId: product.id, quantity, unitPrice, ...(variant ? {
    variantId: variant.id,
    variantLabel: sameVariant ? previous?.variantLabel || variant.label : variant.label,
    variantName: sameVariant ? previous?.variantName || product.variantName : product.variantName,
  } : {}) }
}

export function variantStockTransition(products: Product[], previous: Order | undefined, next: Order) {
  const result = products.map(product => ({ ...product, variants: product.variants?.map(variant => ({ ...variant })) }))
  for (const [order, direction] of [[previous, 1], [next, -1]] as const) {
    if (order?.status !== 'Delivered') continue
    for (const item of order.items) {
      const product = result.find(entry => entry.id === item.productId)
      if (!product?.variants?.length) continue
      let variant = product.variants.find(entry => entry.id === item.variantId)
      if (!variant && direction === 1 && !item.variantId) {
        variant = product.variants.find(entry => entry.id === 'legacy')
        if (!variant) { variant = { id: 'legacy', label: 'Unspecified (older orders)', stock: 0 }; product.variants.push(variant) }
      }
      if (!variant) throw new Error('Edit this order and choose a variant for ' + product.name + ' before marking it delivered.')
      if (direction === -1 && variant.stock < item.quantity) throw new Error('Not enough ' + variant.label + ' stock for ' + product.name + '.')
      variant.stock += direction * item.quantity; product.stock += direction * item.quantity
    }
  }
  return result
}
