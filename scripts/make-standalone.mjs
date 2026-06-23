import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const output = join(root, 'voxel-strike-standalone.html')
let html = readFileSync(join(dist, 'index.html'), 'utf8')

const scriptMatch = html.match(/<script\s+type="module"(?:\s+crossorigin)?\s+src="([^"]+)"\s*><\/script>/)
const styleMatch = html.match(/<link\s+rel="stylesheet"(?:\s+crossorigin)?\s+href="([^"]+)"\s*\/?>/)

if (!scriptMatch || !styleMatch) {
  throw new Error('Could not locate the generated JavaScript and CSS assets in dist/index.html.')
}

const resolveAsset = (url) => join(dist, url.replace(/^\.\//, '').replace(/^\//, ''))
const script = readFileSync(resolveAsset(scriptMatch[1]), 'utf8').replaceAll('</script', '<\\/script')
const style = readFileSync(resolveAsset(styleMatch[1]), 'utf8').replaceAll('</style', '<\\/style')
const favicon = readFileSync(join(dist, 'favicon.svg')).toString('base64')

html = html
  .replace(scriptMatch[0], () => `<script type="module">\n${script}\n</script>`)
  .replace(styleMatch[0], () => `<style>\n${style}\n</style>`)
  .replace(/<link\s+rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/svg+xml;base64,${favicon}" type="image/svg+xml" />`)

writeFileSync(output, html)
console.log(`Standalone build written to ${output}`)
