import { cloudflareApiUrl } from '../nativePlatform'

export type Coordinates = { latitude: number; longitude: number }

type LocationResolution = { locationUrl?: string; coordinates?: Coordinates }

export function mapCoordinates(locationUrl?: string): Coordinates | null {
  if (!locationUrl) return null
  const source = decodeURIComponent(locationUrl)
  const patterns: { expression: RegExp; reverse?: boolean }[] = [
    { expression: /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /[?&](?:q|query|ll|destination|origin)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/ },
    { expression: /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/, reverse: true },
    { expression: /\/place\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
    { expression: /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/ },
  ]
  for (const { expression, reverse } of patterns) {
    const match = source.match(expression)
    if (!match) continue
    const [latitude, longitude] = reverse ? [Number(match[2]), Number(match[1])] : [Number(match[1]), Number(match[2])]
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude }
  }
  return null
}

function locationCacheKey(locationUrl: string) {
  return `tanger-location:v2:${locationUrl}`
}

export async function resolveLocation(locationUrl?: string): Promise<LocationResolution> {
  const directCoordinates = mapCoordinates(locationUrl)
  if (!locationUrl || directCoordinates) return { locationUrl, coordinates: directCoordinates ?? undefined }
  try {
    const cached = localStorage.getItem(locationCacheKey(locationUrl))
    if (cached) {
      const result = JSON.parse(cached) as LocationResolution
      if (result.coordinates) return result
    }
  } catch { /* A blocked storage area should not prevent location lookup. */ }
  try {
    const response = await fetch(cloudflareApiUrl('/api/resolve-location'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationUrl }) })
    if (!response.ok) return { locationUrl }
    const data = await response.json() as LocationResolution
    const result = { locationUrl: data.locationUrl || locationUrl, coordinates: data.coordinates || mapCoordinates(data.locationUrl) || undefined }
    if (result.coordinates) localStorage.setItem(locationCacheKey(locationUrl), JSON.stringify(result))
    return result
  } catch {
    return { locationUrl }
  }
}

export function distanceKm(first: Coordinates, second: Coordinates) {
  const radians = (value: number) => value * Math.PI / 180
  const deltaLatitude = radians(second.latitude - first.latitude)
  const deltaLongitude = radians(second.longitude - first.longitude)
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(deltaLongitude / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
