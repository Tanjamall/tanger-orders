import type { Order, Product } from './types'

export const people = ['Saeed', 'Partner']

export const initialProducts: Product[] = [
  { id: 'p1', name: 'Mini blender', cost: 78, price: 149, stock: 14, lowStockAt: 4 },
  { id: 'p2', name: 'Storage box', cost: 26, price: 59, stock: 22, lowStockAt: 5 },
  { id: 'p3', name: 'LED strip 5m', cost: 31, price: 79, stock: 8, lowStockAt: 3 },
  { id: 'b1', name: 'Home Starter Bundle', cost: 0, price: 189, stock: 0, lowStockAt: 0, components: [{ productId: 'p2', quantity: 2 }, { productId: 'p3', quantity: 1 }] },
]

export const initialOrders: Order[] = [
  { id: 'o1', client: 'Meryem El Amrani', phone: '06 12 34 56 78', address: 'Iberia, Tanger', locationUrl: 'https://www.google.com/maps/search/?api=1&query=35.7877,-5.8231', items: [{ productId: 'p1', quantity: 1, unitPrice: 149 }], status: 'Out for delivery', paymentStatus: 'Pay on delivery', assignedTo: 'Saeed', deliveryCharge: 0, otherExpense: 0, notes: 'Call before delivery — blue door.', confirmationEmployeeId: 'demo-amina', confirmationBonus: 5, confirmedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
  { id: 'o2', client: 'Youssef', phone: '06 98 11 22 33', address: 'المرشان، طنجة', locationUrl: 'https://www.google.com/maps/search/?api=1&query=35.7909,-5.8307', items: [{ productId: 'b1', quantity: 1, unitPrice: 189 }], status: 'Confirmed', paymentStatus: 'Pay on delivery', assignedTo: 'Partner', deliveryCharge: 0, otherExpense: 0, confirmedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
  { id: 'o3', client: 'Salma B.', phone: '07 01 22 88 44', address: 'Malabata, Tanger', items: [{ productId: 'p2', quantity: 2, unitPrice: 59, costTotal: 52 }], status: 'Delivered', paymentStatus: 'Paid', assignedTo: 'Saeed', deliveryCharge: 0, otherExpense: 12, createdAt: new Date(Date.now() - 86400000).toISOString(), deliveredAt: new Date().toISOString() },
]
