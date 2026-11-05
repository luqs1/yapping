// The local API on 127.0.0.1:7790, for things on this Mac: the sidebar
// page, the Claude Code mod, `yap mcp`, the Codex hooks.
//
//   POST /rpc     {method, params} → {result} | {error:{message, code}}
//   GET  /events  SSE stream of UI events (each `data:` is one event, with seq)
//   GET  /        the sidebar (ui/dist/sidebar.html) with the token injected
//   GET  /health  {ok, version}; no token needed
//
// Everything except /health and / needs the secret from ~/.yapping/local-token,
// in the `x-yap-token` header (or `?token=` for EventSource, which can't set
// headers). Requests must name 127.0.0.1 or localhost as Host, which stops a
// web page from reaching us by DNS rebinding.

import { existsSync, readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { RpcError, VERSION, type YapNode } from './node'
import { homeId, localPort, saveApiPort } from './paths'

// `node` may be a getter, so the port can be claimed before the node starts
// (the port is the lock that keeps two nodes off one YAP_HOME).
export type ApiOpts = { node: YapNode | (() => YapNode | null); token: string; port: number; home: string; log?: (...a: unknown[]) => void }

// Where the built sidebar might be: $YAP_UI, YAP_HOME/ui, beside the binary
// (…/server/yap → …/ui/sidebar.html, as in the .mcpb), or in the repo.
export function sidebarPath(home: string): string | undefined {
  const candidates = [
    process.env.YAP_UI,
    join(dirname(process.execPath), '..', 'ui', 'sidebar.html'),
    join(home, 'ui', 'sidebar.html'),
    resolve(import.meta.dir, '..', '..', 'ui', 'dist', 'sidebar.html'),
  ]
  return candidates.find((p) => p && existsSync(p)) as string | undefined
}

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>yapping</title>
<body style="font:15px/1.5 system-ui;margin:3rem;color:#333">
<h1 style="font-weight:600">yapping is running</h1>
<p>The sidebar isn't built on this Mac yet. Your node is up and holding your messages.</p></body>`

export function startApi(o: ApiOpts) {
  const { token } = o
  const getNode = typeof o.node === 'function' ? o.node : () => o.node as YapNode
  const log = o.log || (() => {})
  const enc = new TextEncoder()
  const tokenBytes = enc.encode(token)

  const okToken = (t: string | null | undefined) => {
    if (!t) return false
    const b = enc.encode(t)
    return b.length === tokenBytes.length && timingSafeEqual(b, tokenBytes)
  }
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: o.port,
    idleTimeout: 0, // SSE streams stay open
    async fetch(req) {
      const url = new URL(req.url)
      const host = (req.headers.get('host') || '').replace(/:\d+$/, '')
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return new Response('wrong host', { status: 421 })

      const node = getNode()
      if (!node) return json({ app: 'yapping', home: homeId(o.home), ok: false, error: { code: 'starting', message: 'yapping is starting.' } }, 503)
      if (url.pathname === '/health') return json({ app: 'yapping', home: homeId(o.home), ok: true, version: VERSION, connected: node.connected, signedIn: !!node.config.user })

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/sidebar')) {
        const path = sidebarPath(o.home)
        let html = path ? readFileSync(path, 'utf8') : PLACEHOLDER
        // The page talks back to us with this token (same origin, so base is '').
        const boot = `<script>window.__YAP__=${JSON.stringify({ token, agent: node.config.agent || process.env.YAP_AGENT || 'claude', base: '' }).replace(/</g, '\\u003c')}</script>`
        html = html.includes('</head>') ? html.replace('</head>', `${boot}</head>`) : boot + html
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
      }

      const given = req.headers.get('x-yap-token') || url.searchParams.get('token')
      if (!okToken(given)) return json({ error: { code: 'unauthorized', message: 'Missing or wrong x-yap-token.' } }, 401)

      if (req.method === 'POST' && url.pathname === '/rpc') {
        let body: any
        try { body = await req.json() } catch { return json({ error: { code: 'bad_request', message: 'Body must be JSON {method, params}.' } }, 400) }
        try {
          return json({ result: await node.call(body?.method, body?.params || {}) })
        } catch (e) {
          const err = e as RpcError
          if (!(e instanceof RpcError)) log('rpc', body?.method, 'failed:', e)
          return json({ error: { code: err.code || 'internal', message: err.message, ...(err.data ? { data: err.data } : {}) } }, e instanceof RpcError ? 400 : 500)
        }
      }

      if (req.method === 'GET' && url.pathname === '/events') return sse(node, url, req.signal)

      return json({ error: { code: 'not_found', message: 'Not here.' } }, 404)
    },
  })

  // Server-sent events: optional replay from ?since=, then live events.
  function sse(node: YapNode, url: URL, signal: AbortSignal) {
    const since = Number(url.searchParams.get('since') || 0)
    let unsub = () => {}
    let ping: ReturnType<typeof setInterval>
    const body = new ReadableStream({
      start(ctrl) {
        const send = (ev: unknown) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)) } catch {} }
        ctrl.enqueue(enc.encode(': yapping\n\n'))
        if (since > 0) (node.call('sync', { since }) as Promise<any>).then((x) => x.events.forEach(send)).catch(() => {})
        unsub = node.subscribe(send)
        ping = setInterval(() => { try { ctrl.enqueue(enc.encode(': ping\n\n')) } catch {} }, 15000)
        signal.addEventListener('abort', () => { unsub(); clearInterval(ping); try { ctrl.close() } catch {} })
      },
      cancel() { unsub(); clearInterval(ping) },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' } })
  }

  return { server, port: server.port, stop: () => server.stop(true) }
}

// Take the local API's port: 7790 (or YAP_PORT), else the next free one of
// ten. If a yapping node already answers on one of them, don't start a
// second: say where it is instead. The port we got goes in api.json.
export async function claimApi(o: Omit<ApiOpts, 'port'>): Promise<{ api: ReturnType<typeof startApi> } | { running: string }> {
  const first = localPort()
  let last: unknown
  for (let port = first; port < first + 10; port++) {
    try {
      const api = startApi({ ...o, port })
      saveApiPort(o.home, api.port!)
      return { api }
    } catch (e) {
      last = e
      // Someone has it. Another yapping node (maybe still starting)?
      for (let i = 0; i < 20; i++) {
        const body: any = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json()).catch(() => null)
        if (body?.app !== 'yapping' || body.home !== homeId(o.home)) break
        if (body.ok) return { running: `http://127.0.0.1:${port}` }
        await Bun.sleep(250)
      }
    }
  }
  throw last
}
