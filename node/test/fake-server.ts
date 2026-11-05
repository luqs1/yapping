// A tiny stand-in for the yapping server, following docs/protocol.md, so the
// node can be tested without the real one. Everyone it knows is everyone
// else's contact. It records every frame it relays, so tests can check it
// never saw a word of plaintext.

import type { ServerWebSocket } from 'bun'

type User = { id: string; name: string; email: string; avatar: null }
type Device = { deviceId: string; userId: string; boxPub: string; signPub: string; name: string; token: string; lastSeen: number | null }
type Item = { t: 'env'; id: string; from: string; env: Record<string, unknown> }

export function fakeServer() {
  const users = new Map<string, User>()
  const devices = new Map<string, Device>()
  const pending = new Map<string, { user: User; name: string; boxPub: string; signPub: string; polls: number; manual: boolean; approved: boolean }>()
  const mailbox = new Map<string, Item[]>()
  const sockets = new Map<string, ServerWebSocket<{ deviceId: string }>>()
  const rpcs = new Map<string, (r: any) => void>()
  const frames: string[] = [] // everything nodes sent us over the socket
  const logins: { user: User; manual: boolean }[] = [] // who the next `yap login`s sign in as
  let n = 0

  const byToken = (req: Request) => {
    const h = req.headers.get('authorization') || ''
    const tok = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url).searchParams.get('token')
    return [...devices.values()].find((d) => d.token === tok)
  }
  const pub = ({ deviceId, boxPub, signPub, name, lastSeen }: Device) => ({ deviceId, boxPub, signPub, name, lastSeen })
  const online = (userId: string) => [...sockets.keys()].some((id) => devices.get(id)?.userId === userId)
  const json = (d: unknown, status = 200) => Response.json(d, { status })

  function presence(userId: string) {
    for (const [id, ws] of sockets) if (devices.get(id)!.userId !== userId) ws.send(JSON.stringify({ t: 'presence', userId, online: online(userId) }))
  }

  const server: ReturnType<typeof Bun.serve> = Bun.serve<{ deviceId: string }>({
    port: 0,
    async fetch(req, srv): Promise<Response | undefined> {
      const url = new URL(req.url)
      const p = url.pathname
      if (p === '/ws/node') {
        const d = byToken(req)
        if (!d) return new Response('unauthorized', { status: 401 })
        return srv.upgrade(req, { data: { deviceId: d.deviceId } }) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      if (req.method === 'POST' && p === '/api/device/start') {
        const b = await req.json()
        const next = logins.shift()
        if (!next) return json({ error: 'no login expected' }, 500)
        const { user, manual } = next
        const deviceCode = `dc${++n}`
        pending.set(deviceCode, { user, name: b.name, boxPub: b.boxPub, signPub: b.signPub, polls: 0, manual, approved: false })
        return json({ deviceCode, userCode: 'ABCD-1234', verifyUrl: `${server.url}verify/${deviceCode}`, interval: 1 })
      }
      if (req.method === 'POST' && p === '/api/device/poll') {
        const { deviceCode } = await req.json()
        const pe = pending.get(deviceCode)
        if (!pe) return json({ error: 'invalid_grant' }, 400)
        // The first poll is "still waiting", like a person reading the page.
        // (A `manual` login waits until the test clicks "Link this Mac".)
        if (pe.polls++ === 0 || (pe.manual && !pe.approved)) return json({ error: 'authorization_pending' }, 428)
        pending.delete(deviceCode)
        users.set(pe.user.id, pe.user)
        const d: Device = { deviceId: `dev${++n}`, userId: pe.user.id, boxPub: pe.boxPub, signPub: pe.signPub, name: pe.name, token: `tok${n}${Math.random().toString(36).slice(2)}`, lastSeen: null }
        devices.set(d.deviceId, d)
        return json({ deviceToken: d.token, deviceId: d.deviceId, user: pe.user })
      }
      const d = byToken(req)
      if (!d) return json({ error: 'unauthorized' }, 401)
      if (p === '/api/me') return json({ user: users.get(d.userId), devices: [...devices.values()].filter((x) => x.userId === d.userId).map(pub) })
      if (p === '/api/contacts') return json([...users.values()].filter((u) => u.id !== d.userId).map((user) => ({ user, relationship: {} })))
      const m = p.match(/^\/api\/users\/([^/]+)\/devices$/)
      if (m) return json([...devices.values()].filter((x) => x.userId === decodeURIComponent(m[1])).map(pub))
      if (req.method === 'POST' && p === '/api/invites') return json({ code: 'inv1', url: `${server.url}i/inv1` })
      return json({ error: 'not found' }, 404)
    },
    websocket: {
      open(ws) {
        const id = ws.data.deviceId
        sockets.set(id, ws)
        devices.get(id)!.lastSeen = Date.now()
        for (const u of users.values()) if (u.id !== devices.get(id)!.userId) ws.send(JSON.stringify({ t: 'presence', userId: u.id, online: online(u.id) }))
        presence(devices.get(id)!.userId)
        // Drain the mailbox: everything still unacked.
        for (const item of mailbox.get(id) || []) ws.send(JSON.stringify(item))
      },
      message(ws, raw) {
        const text = String(raw)
        frames.push(text)
        const f = JSON.parse(text)
        const me = ws.data.deviceId
        if (f.t === 'ping') return void ws.send('{"t":"pong"}')
        if (f.t === 'ack') {
          mailbox.set(me, (mailbox.get(me) || []).filter((x) => x.id !== f.id))
          return
        }
        if (f.t === 'env') {
          for (const to of f.to) {
            if (!devices.has(to)) continue
            const item: Item = { t: 'env', id: `mb${++n}`, from: me, env: { ...f.env, from: me } }
            mailbox.set(to, [...(mailbox.get(to) || []), item])
            sockets.get(to)?.send(JSON.stringify(item))
          }
          return
        }
        if (f.t === 'rpc_result') rpcs.get(f.id)?.(f)
      },
      close(ws) {
        sockets.delete(ws.data.deviceId)
        presence(devices.get(ws.data.deviceId)!.userId)
      },
    },
  })

  return {
    url: server.url.origin,
    frames,
    mailbox,
    devices,
    // The next `yap login` signs in as this person.
    // `manual`: wait for approve() instead of approving on the second poll.
    expectLogin(u: { id: string; name: string; email?: string }, opts: { manual?: boolean } = {}) {
      logins.push({ user: { id: u.id, name: u.name, email: u.email || `${u.id}@example.com`, avatar: null }, manual: !!opts.manual })
    },
    // The person clicks "Link this Mac" on every sign-in page that's open.
    approveAll() {
      for (const pe of pending.values()) pe.approved = true
    },
    get pendingLogins() {
      return pending.size
    },
    isOnline: (deviceId: string) => sockets.has(deviceId),
    // The gateway: call a node's RPC over its socket, as /mcp would.
    rpc(deviceId: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
      const id = `rpc${++n}`
      const ws = sockets.get(deviceId)
      if (!ws) return Promise.reject(new Error('node offline'))
      return new Promise((resolve) => {
        rpcs.set(id, resolve)
        ws.send(JSON.stringify({ t: 'rpc', id, method, params, via: { client: 'test', harness: 'claude' } }))
      })
    },
    stop: () => server.stop(true),
  }
}

export type FakeServer = ReturnType<typeof fakeServer>
