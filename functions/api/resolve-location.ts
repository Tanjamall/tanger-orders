const headers = { 'Content-Type': 'application/json' }

export const onRequestPost: PagesFunction = async ({ request }) => {
  const { locationUrl } = await request.json() as { locationUrl?: string }
  if (!locationUrl) return Response.json({ error: 'Location link is required.' }, { status: 400, headers })
  let url: URL
  try { url = new URL(locationUrl) } catch { return Response.json({ error: 'Invalid location link.' }, { status: 400, headers }) }
  if (!/(^|\.)maps\.app\.goo\.gl$|(^|\.)google\.com$|(^|\.)maps\.google\.com$/.test(url.hostname)) return Response.json({ error: 'Only Google Maps links are accepted.' }, { status: 400, headers })
  const response = await fetch(url.toString(), { redirect: 'follow' })
  return Response.json({ locationUrl: response.url }, { headers })
}
