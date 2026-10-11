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
  if (product.archived && previous?.productId !== product.id) throw new Error('This product is archived. Restore it before adding it to a new order.')
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

export type OrderItemDraft = { productId: string; variantId: string; quantity: string; price: string; previousIndex?: number }

export function formOrderItems(products: Product[], values: FormData, previousItems: OrderItem[] = []): OrderItem[] {
  const lines = JSON.parse(String(values.get('orderItems') || '[]')) as OrderItemDraft[]
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new Error('Add between 1 and 100 items to this order.')
  const seen = new Set<number>()
  return lines.map((line, index) => {
    const previousIndex = line.previousIndex
    if (previousIndex !== undefined && (!Number.isInteger(previousIndex) || previousIndex < 0 || previousIndex >= previousItems.length || seen.has(previousIndex))) throw new Error('An order item changed unexpectedly. Close and reopen this form.')
    if (previousIndex !== undefined) seen.add(previousIndex)
    const previous = previousIndex === undefined ? undefined : previousItems[previousIndex]
    const product = products.find(p => p.id === line.productId)
    if (!product) {
      if (previous?.productId === line.productId && (previous.variantId || '') === line.variantId && previous.quantity === Number(line.quantity) && previous.unitPrice === Number(line.price)) return { ...previous }
      throw new Error('Choose an available product for item ' + (index + 1) + '.')
    }
    const itemValues = new FormData()
    itemValues.set('quantity', line.quantity); itemValues.set('variantId', line.variantId); itemValues.set('price', line.price)
    try { return formOrderItem(product, itemValues, previous) } catch (cause) { throw new Error('Item ' + (index + 1) + ': ' + (cause as Error).message) }
  })
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

export function validateOrderVariantStock(products: Product[], items: OrderItem[], previous?: Order, nextStatus: Order['status'] = 'New') {
  const groups = new Map<string, { product: Product; variantId: string; quantity: number }>()
  for (const item of items) {
    const product = products.find(p => p.id === item.productId)
    if (!product?.variants?.length || !item.variantId) continue
    const key = product.id + ':' + item.variantId
    const group = groups.get(key) || { product, variantId: item.variantId, quantity: 0 }
    group.quantity += item.quantity; groups.set(key, group)
  }
  for (const { product, variantId, quantity } of groups.values()) {
    const variant = product.variants!.find(v => v.id === variantId)
    if (!variant) throw new Error('This variant is no longer available for ' + product.name + '.')
    const previousQuantity = previous?.items.filter(item => item.productId === product.id && item.variantId === variantId).reduce((sum, item) => sum + item.quantity, 0) || 0
    if (previous && nextStatus !== 'Delivered' && quantity <= previousQuantity) continue
    const available = variant.stock + (previous?.status === 'Delivered' ? previousQuantity : 0)
    if (quantity > available) throw new Error(product.name + ' · ' + variant.label + ': ' + (available ? 'Only ' + available + ' left. Reduce the quantity or choose another variant.' : 'Out of stock. Choose another variant.'))
  }
}
