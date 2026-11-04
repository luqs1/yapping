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

export type ApiOpts = { node: YapNode; token: string; port: number; home: string; log?: (...a: unknown[]) => void }

// Where the built sidebar might be: next to the binary, in YAP_HOME, or in the repo.
function sidebarPath(home: string): string | undefined {
  const candidates = [
    process.env.YAP_UI,
    join(home, 'ui', 'sidebar.html'),
    join(dirname(process.execPath), '..', 'ui', 'sidebar.html'),
    resolve(import.meta.dir, '..', '..', 'ui', 'dist', 'sidebar.html'),
  ]
  return candidates.find((p) => p && existsSync(p)) as string | undefined
}

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>yapping</title>
<body style="font:15px/1.5 system-ui;margin:3rem;color:#333">
<h1 style="font-weight:600">yapping is running</h1>
<p>The sidebar isn't built on this Mac yet. Your node is up and holding your messages.</p></body>`

export function startApi(o: ApiOpts) {
  const { node, token } = o
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

      if (url.pathname === '/health') return json({ ok: true, version: VERSION, connected: node.connected })

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
          return json({ error: { code: err.code || 'internal', message: err.message } }, e instanceof RpcError ? 400 : 500)
        }
      }

      if (req.method === 'GET' && url.pathname === '/events') return sse(url, req.signal)

      return json({ error: { code: 'not_found', message: 'Not here.' } }, 404)
    },
  })

  // Server-sent events: optional replay from ?since=, then live events.
  function sse(url: URL, signal: AbortSignal) {
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
