const headers = { 'Content-Type': 'application/json' }
const plusCodeAlphabet = '23456789CFGHJMPQRVWX'
const tangierReference = { latitude: 35.7410429, longitude: -5.803754 }

function encodePlusCode(latitude: number, longitude: number) {
  let lat = latitude + 90; let lng = longitude + 180; let code = ''
  for (const resolution of [20, 1, 0.05, 0.0025, 0.000125]) {
    const latDigit = Math.floor(lat / resolution); const lngDigit = Math.floor(lng / resolution)
    code += plusCodeAlphabet[latDigit] + plusCodeAlphabet[lngDigit]
    lat -= latDigit * resolution; lng -= lngDigit * resolution
  }
  return `${code.slice(0, 8)}+${code.slice(8)}`
}

function decodeShortPlusCode(shortCode: string) {
  const missingDigits = 8 - shortCode.indexOf('+')
  if (missingDigits <= 0) return undefined
  const referencePrefix = encodePlusCode(tangierReference.latitude, tangierReference.longitude).replace('+', '').slice(0, missingDigits)
  const characters = (referencePrefix + shortCode).replace('+', '')
  let latitude = -90; let longitude = -180; let latitudeResolution = 20; let longitudeResolution = 20
  const pairResolutions = [20, 1, 0.05, 0.0025, 0.000125]
  for (let index = 0; index < Math.min(10, characters.length); index += 2) {
    latitudeResolution = pairResolutions[index / 2]; longitudeResolution = latitudeResolution
    latitude += plusCodeAlphabet.indexOf(characters[index]) * latitudeResolution
    if (index + 1 < characters.length) longitude += plusCodeAlphabet.indexOf(characters[index + 1]) * longitudeResolution
  }
  for (let index = 10; index < characters.length; index += 1) {
    latitudeResolution /= 5; longitudeResolution /= 4
    const value = plusCodeAlphabet.indexOf(characters[index])
    latitude += Math.floor(value / 4) * latitudeResolution; longitude += (value % 4) * longitudeResolution
  }
  const recoveredResolution = 20 ** (2 - missingDigits / 2)
  latitude += latitudeResolution / 2; longitude += longitudeResolution / 2
  if (tangierReference.latitude + recoveredResolution / 2 < latitude) latitude -= recoveredResolution
  if (tangierReference.latitude - recoveredResolution / 2 > latitude) latitude += recoveredResolution
  if (tangierReference.longitude + recoveredResolution / 2 < longitude) longitude -= recoveredResolution
  if (tangierReference.longitude - recoveredResolution / 2 > longitude) longitude += recoveredResolution
  return { latitude, longitude }
}

function safelyDecode(value: string) {
  let decoded = value
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next } catch { break }
  }
  return decoded
}

export const onRequestPost: PagesFunction = async ({ request }) => {
  const { locationUrl } = await request.json() as { locationUrl?: string }
  if (!locationUrl) return Response.json({ error: 'Location link is required.' }, { status: 400, headers })
  let url: URL
  try { url = new URL(locationUrl) } catch { return Response.json({ error: 'Invalid location link.' }, { status: 400, headers }) }
  if (!/(^|\.)(maps\.app\.goo\.gl|goo\.gl|google\.com|maps\.google\.com)$/.test(url.hostname)) return Response.json({ error: 'Only Google Maps links are accepted.' }, { status: 400, headers })
  const response = await fetch(url.toString(), { redirect: 'follow' })
  const rawPage = await response.text()
  const page = safelyDecode(rawPage)
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
  if (!coordinates) {
    const plusCode = `${page} ${safelyDecode(response.url)}`.match(/([23456789CFGHJMPQRVWX]{2,7}\+[23456789CFGHJMPQRVWX]{2,})/i)?.[1]?.toUpperCase()
    if (plusCode) coordinates = decodeShortPlusCode(plusCode)
  }
  return Response.json({ locationUrl: response.url, coordinates }, { headers })
}
