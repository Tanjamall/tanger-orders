type Page<T> = { data: T[] | null; error: unknown; count: number | null }

// Count is required so a server-side response cap cannot silently truncate history.
// Callers use a stable unique ordering and commit state only after all pages succeed.
export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>, pageSize = 500): Promise<T[]> {
  const rows: T[] = []
  let total: number | null = null
  while (total === null || rows.length < total) {
    const result = await fetchPage(rows.length, rows.length + pageSize - 1)
    if (result.error) throw result.error
    if (result.count === null) throw new Error('Could not verify the full record count. Please retry.')
    if (total !== null && total !== result.count) throw new Error('History changed while loading. Please retry.')
    total = result.count
    const page = result.data ?? []
    if (!page.length) {
      if (rows.length < total) throw new Error('History changed while loading. Please retry.')
      break
    }
    rows.push(...page)
  }
  return rows
}
