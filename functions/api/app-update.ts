interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
function isNewerVersion(latest: string, installed: string) {
  const parse = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null
  const next = parse(latest)
  const current = parse(installed)
  if (!next || !current) return false
  return next.some((part, index) => part > current[index] && next.slice(0, index).every((earlier, prior) => earlier === current[prior]))
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let info: { app_id?: string; platform?: string; version_build?: string; version_code?: string | number; version_name?: string }
  try { info = await request.json() } catch { return Response.json({ message: 'Invalid update request' }, { status: 400, headers }) }
  if (info.app_id !== 'com.tanjamall.tangerorders' || info.platform !== 'android') return Response.json({ message: 'No compatible update' }, { headers })
  const asset = await env.ASSETS.fetch(new Request(new URL('/updates/web.json', request.url)))
  if (!asset.ok) return Response.json({ message: 'No update published' }, { headers })
  const release = await asset.json() as { version: string; minNativeBuild: number; url: string; checksum: string }
  const installedVersion = info.version_name === 'builtin' ? info.version_build : info.version_name
  if (Number(info.version_code) < release.minNativeBuild || !isNewerVersion(release.version, installedVersion ?? '')) return Response.json({ message: 'Up to date' }, { headers })
  return Response.json({ version: release.version, url: release.url, checksum: release.checksum }, { headers })
}
