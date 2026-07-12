const headers = { 'Content-Type': 'application/json' }

export const onRequestPost: PagesFunction = async ({ request }) => {
  const { locationUrl } = await request.json() as { locationUrl?: string }
  if (!locationUrl) return Response.json({ error: 'Location link is required.' }, { status: 400, headers })
  let url: URL
  try { url = new URL(locationUrl) } catch { return Response.json({ error: 'Invalid location link.' }, { status: 400, headers }) }
  if (!/(^|\.)(maps\.app\.goo\.gl|goo\.gl|google\.com|maps\.google\.com)$/.test(url.hostname)) return Response.json({ error: 'Only Google Maps links are accepted.' }, { status: 400, headers })
  const response = await fetch(url.toString(), { redirect: 'follow' })
  const page = decodeURIComponent(await response.text())
  const coordinatePatterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center|destination|origin)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/,
    /\/place\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  ]
  let coordinates: { latitude: number; longitude: number } | undefined
  for (const pattern of coordinatePatterns) {
    const match = page.match(pattern) || response.url.match(pattern)
    if (!match) continue
    const first = Number(match[1]); const second = Number(match[2])
    const [latitude, longitude] = pattern.source.startsWith('!2d') ? [second, first] : [first, second]
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) { coordinates = { latitude, longitude }; break }
  }
  return Response.json({ locationUrl: response.url, coordinates }, { headers })
}
