interface Env { GOOGLE_ROUTES_API_KEY: string; SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string }
type Stop = { id: string; address: string; locationUrl?: string }
const cors = { 'Content-Type': 'application/json' }

function waypoint(stop: Stop) {
  const source = decodeURIComponent(stop.locationUrl || '')
  const match = source.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || source.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  return match ? { location: { latLng: { latitude: Number(match[1]), longitude: Number(match[2]) } } } : { address: stop.address }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return Response.json({ error: 'Sign in is required.' }, { status: 401, headers: cors })
  const user = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization } })
  if (!user.ok) return Response.json({ error: 'Your login has expired. Please sign in again.' }, { status: 401, headers: cors })
  const body = await request.json() as { origin?: { latitude: number; longitude: number }; orders?: Stop[] }
  if (!body.origin || !Array.isArray(body.orders) || body.orders.length < 1 || body.orders.length > 25) return Response.json({ error: 'Choose between 1 and 25 deliveries.' }, { status: 400, headers: cors })
  const origin = { location: { latLng: body.origin } }
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex' },
    body: JSON.stringify({ origin, destination: origin, intermediates: body.orders.map(waypoint), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', optimizeWaypointOrder: true }),
  })
  if (!response.ok) return Response.json({ error: 'Google could not plan this route. Check the location links and Routes API settings.' }, { status: 502, headers: cors })
  const data = await response.json() as { routes?: { optimizedIntermediateWaypointIndex?: number[] }[] }
  const indexes = data.routes?.[0]?.optimizedIntermediateWaypointIndex ?? body.orders.map((_, index) => index)
  return Response.json({ orderIds: indexes.map((index) => body.orders![index].id) }, { headers: cors })
}
