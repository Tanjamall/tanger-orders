export type Status = 'New' | 'Confirmed' | 'Preparing' | 'Out for delivery' | 'Delivered' | 'Cancelled'
export type PaymentStatus = 'Pay on delivery' | 'Paid' | 'Unpaid'

export type Product = {
  id: string
  name: string
  cost: number
  price: number
  stock: number
  lowStockAt: number
  components?: { productId: string; quantity: number }[]
}

export type OrderItem = { productId: string; quantity: number; unitPrice: number }
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
  notes?: string
}
