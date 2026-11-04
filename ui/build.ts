// Builds the sidebar into single self-contained HTML files (MCP App resources
// must be one document): inlines the bundled JS and the CSS.
//   dist/sidebar.html  picks its adapter: MCP host → mcp-app, window.__YAP__ → local, else demo
//   dist/dev.html      always the demo adapter (shared/sim.js in the page)
import { mkdir } from 'node:fs/promises'

const dir = import.meta.dir
const out = await Bun.build({
  entrypoints: [`${dir}/src/main.js`],
  target: 'browser',
  format: 'esm',
  minify: true,
  splitting: false,
})
if (!out.success) {
  for (const l of out.logs) console.error(l)
  process.exit(1)
}
const js = (await out.outputs[0].text()).replace(/<\/script/gi, '<\\/script')
const css = await Bun.file(`${dir}/src/style.css`).text()
const tpl = await Bun.file(`${dir}/src/index.html`).text()
const page = (head = '') =>
  tpl
    .replace('<!--YAP_HEAD-->', head)
    .replace('/*YAP_CSS*/', () => css)
    .replace('/*YAP_JS*/', () => js)

await mkdir(`${dir}/dist`, { recursive: true })
await Bun.write(`${dir}/dist/sidebar.html`, page())
await Bun.write(`${dir}/dist/dev.html`, page('<script>window.__YAP_ADAPTER__="demo"</script>'))
const kb = (s: string) => `${(new TextEncoder().encode(s).length / 1024).toFixed(0)} KB`
console.log(`dist/sidebar.html ${kb(page())}  dist/dev.html ${kb(page('x'))}`)
