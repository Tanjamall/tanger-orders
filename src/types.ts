export type Status = 'New' | 'Confirmed' | 'Out for delivery' | 'Delivered' | 'Canceled'
export type PaymentStatus = 'Pay on delivery' | 'Paid' | 'Unpaid'

export type ProductVariant = { id: string; label: string; stock: number }

export type Product = {
  id: string
  name: string
  cost: number
  price: number
  stock: number
  lowStockAt: number
  components?: { productId: string; quantity: number }[]
  variantName?: string
  variants?: ProductVariant[]
}

export type InventoryBatch = {
  id: string
  productId: string
  unitCost: number
  originalQuantity: number
  remainingQuantity: number
  receivedAt: string
  source: 'opening_balance' | 'restock' | 'legacy_delivery' | 'correction'
}

export type OrderItem = { productId: string; quantity: number; unitPrice: number; costTotal?: number; variantId?: string; variantLabel?: string; variantName?: string }
export type Order = {
  id: string
  client: string
  phone: string
  address: string
  locationUrl?: string
  items: OrderItem[]
  status: Status
  paymentStatus: PaymentStatus
  assignedTo: string
  deliveryCharge: number
  otherExpense: number
  createdAt: string
  deliveredAt?: string
  confirmationEmployeeId?: string
  confirmationBonus?: number
  confirmedAt?: string
  notes?: string
}
export type DailyDeliveryCost = { date: string; amount: number }
