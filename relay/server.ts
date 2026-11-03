// yapping relay — a tiny stand-in for the real p2p control plane.
//
//   bun relay/server.ts            # http://localhost:7788
//
// WebSocket  /ws?user=luqmaan&client=claude     snapshot, then events
// HTTP       GET  /api/snapshot?user=
//            GET  /api/events?user=&since=&wait=25   long-poll (for harness mods)
//            POST /api/action?user=                  {t:'send', chatId, text} ...
//            POST /api/reset
// Static     /  -> /mockups/ (the gallery), /mockups/*, /shared/*

import { createSim } from '../shared/sim.js'
import { join, normalize } from 'node:path'

const PORT = Number(process.env.YAP_PORT || 7788)
const ROOT = join(import.meta.dir, '..')

let sim = createSim()
let unsub = wire()
const sockets = new Set<any>()
const waiters = new Set<() => void>()

function wire() {
  return sim.on((ev) => {
    for (const ws of sockets) {
      const user = ws.data.user
      if (sim.since(user, ev.seq - 1).some((x: any) => x.seq === ev.seq)) ws.send(JSON.stringify(ev))
    }
    for (const w of waiters) w()
  })
}

setInterval(() => { if (sockets.size) sim.ambient() }, 45000)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' }

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url)
    const user = url.searchParams.get('user') || 'luqmaan'
    if (req.method === 'OPTIONS') return json({})

    if (url.pathname === '/ws') {
      const ok = srv.upgrade(req, { data: { user, client: url.searchParams.get('client') || 'web' } })
      return ok ? undefined : json({ error: 'upgrade failed' }, 400)
    }
    if (url.pathname === '/api/snapshot') return json(sim.snapshot(user))
    if (url.pathname === '/api/events') {
      const since = Number(url.searchParams.get('since') || 0)
      const wait = Math.min(Number(url.searchParams.get('wait') || 0), 25)
      let evs = sim.since(user, since)
      if (!evs.length && wait > 0) {
        await new Promise<void>((resolve) => {
          const done = () => { waiters.delete(done); clearTimeout(t); resolve() }
          const t = setTimeout(done, wait * 1000)
          waiters.add(done)
        })
        evs = sim.since(user, since)
      }
      return json({ seq: sim.seq, events: evs })
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const action = await req.json()
      return json(sim.handle(user, action))
    }
    if (url.pathname === '/api/presence' && req.method === 'POST') {
      const { status, client } = await req.json()
      status === 'online' ? sim.connect(user, client) : sim.disconnect(user, client)
      return json({ ok: true })
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      unsub(); sim = createSim(); unsub = wire()
      for (const ws of sockets) { sim.connect(ws.data.user, ws.data.client); ws.send(JSON.stringify({ type: 'snapshot', state: sim.snapshot(ws.data.user) })) }
      return json({ ok: true })
    }

    // static
    if (url.pathname === '/') return Response.redirect(`${url.origin}/mockups/`, 302)
    let path = url.pathname
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT)) return json({ error: 'nope' }, 403)
    const f = Bun.file(file)
    if (!(await f.exists())) return json({ error: 'not found' }, 404)
    const ext = file.slice(file.lastIndexOf('.'))
    return new Response(f, { headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' } })
  },
  websocket: {
    open(ws: any) {
      sockets.add(ws)
      sim.connect(ws.data.user, ws.data.client)
      ws.send(JSON.stringify({ type: 'snapshot', state: sim.snapshot(ws.data.user) }))
    },
    message(ws: any, raw) {
      try {
        const action = JSON.parse(String(raw))
        sim.handle(ws.data.user, action)
      } catch {}
    },
    close(ws: any) {
      sockets.delete(ws)
      sim.disconnect(ws.data.user, ws.data.client)
    },
  },
})

console.log(`🐱 yapping relay on http://localhost:${server.port}`)
