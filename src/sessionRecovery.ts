export function isExpiredJwt(error: unknown) {
  return !!error && typeof error === 'object' && 'message' in error && /jwt.*expired|token.*expired/i.test(String(error.message))
}

// Only use for reads: a write must never be replayed automatically.
export function createSessionReadRecovery(refresh: () => Promise<void>) {
  let pending: Promise<void> | undefined
  return async function recover<T>(read: () => Promise<T>): Promise<T> {
    try { return await read() } catch (error) {
      if (!isExpiredJwt(error)) throw error
      if (!pending) pending = refresh().finally(() => { pending = undefined })
      await pending
      return read()
    }
  }
}
