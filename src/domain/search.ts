export function inventorySearchText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/g, '').replace(/ى/g, 'ي').toLocaleLowerCase().trim()
}
export function matchesInventorySearch(name: string, variants: string[], query: string) {
  const text = inventorySearchText([name, ...variants].join(' '))
  return inventorySearchText(query).split(/\s+/).every(word => text.includes(word))
}
