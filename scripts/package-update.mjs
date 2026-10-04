import { spawnSync } from 'node:child_process'
import { readFileSync, renameSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const name = `tanger-orders-web-${version}`
const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@capgo/cli/dist/index.js'), 'bundle', 'zip', 'com.tanjamall.tangerorders', '--path', resolve(root, 'dist'), '--bundle', version, '--name', name, '--json'], { cwd: root, encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Could not package the update bundle')
const match = result.stdout.match(/\{\s*"bundle"[\s\S]*?\}/)
if (!match) throw new Error(`Could not read bundle checksum: ${result.stdout}`)
const { checksum } = JSON.parse(match[0])
const output = resolve(root, 'dist/updates')
mkdirSync(output, { recursive: true })
renameSync(resolve(root, name), resolve(output, `${name}.zip`))
writeFileSync(resolve(output, 'web.json'), JSON.stringify({ version, minNativeBuild: 8, url: `https://tanger-orders.pages.dev/updates/${name}.zip`, checksum }, null, 2))
console.log(`Packaged web update ${version} (${checksum})`)
