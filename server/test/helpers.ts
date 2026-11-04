// Test helpers: a real server on a random port in dev mode, users made
// through /dev/login, Macs linked through the real device-code flow, and
// fake nodes that speak the /ws/node protocol.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { startServer, type Running } from '../src/app'

export type TestServer = Running & { dataDir: string; close: () => Promise<void> }

export function testServer(over: Record<string, string> = {}): TestServer {
  const dataDir = mkdtempSync(join(tmpdir(), 'yap-test-'))
  const running = startServer({ YAP_DEV: '1', PORT: '0', YAP_DATA: dataDir, YAP_UI_DIST: join(dataDir, 'none.html'), ...over }, { port: 0 })
  return {
    ...running, dataDir,
    async close() { await running.stop(); rmSync(dataDir, { recursive: true, force: true }) },
  }
}

// Sign in through /dev/login; returns the Cookie header to send.
export async function login(base: string, email: string, opts: { name?: string; domain?: string } = {}) {
  const q = new URLSearchParams({ email, ...(opts.name ? { name: opts.name } : {}), ...(opts.domain ? { domain: opts.domain } : {}) })
  const res = await fetch(`${base}/dev/login?${q}`)
  if (!res.ok) throw new Error(`dev login failed: ${res.status}`)
  const setCookie = res.headers.get('set-cookie')!
  const { user } = (await res.json()) as any
  return { cookie: setCookie.split(';')[0], user }
}

export const key = () => randomBytes(32).toString('base64')

// Link a Mac the way `yap login` does: start, approve in the browser, poll.
export async function linkDevice(base: string, cookie: string, name = 'Test Mac') {
  const start = (await (await fetch(`${base}/api/device/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, boxPub: key(), signPub: key() }),
  })).json()) as any
  const userCode = new URL(start.verifyUrl).searchParams.get('code')!
  const ok = await fetch(`${base}/link`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams({ code: userCode, decision: 'approve' }),
  })
  if (!ok.ok) throw new Error(`approve failed: ${ok.status}`)
  const poll = await fetch(`${base}/api/device/poll`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: start.deviceCode }),
  })
  return (await poll.json()) as { deviceToken: string; deviceId: string; user: { id: string } }
}

// A pretend node: a WebSocket that remembers every frame and lets a test
// wait for the one it wants.
export class FakeNode {
  ws!: WebSocket
  frames: any[] = []
  private waiters: { pred: (f: any) => boolean; resolve: (f: any) => void }[] = []
  onRpc?: (f: any) => unknown

  static async connect(base: string, token: string, onRpc?: (f: any) => unknown) {
    const n = new FakeNode()
    n.onRpc = onRpc
    n.ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/node`, { headers: { authorization: `Bearer ${token}` } } as any)
    n.ws.onmessage = (e) => {
      const f = JSON.parse(String(e.data))
      if (f.t === 'rpc' && n.onRpc) {
        new Promise((r) => r(n.onRpc!(f))).then(
          (result) => n.send({ t: 'rpc_result', id: f.id, result }),
          (error) => n.send({ t: 'rpc_result', id: f.id, error: String(error?.message || error) }),
        )
      }
      n.frames.push(f)
      for (const w of [...n.waiters]) if (w.pred(f)) { n.waiters.splice(n.waiters.indexOf(w), 1); w.resolve(f) }
    }
    await new Promise<void>((res, rej) => { n.ws.onopen = () => res(); n.ws.onerror = () => rej(new Error('ws error')) })
    return n
  }

  send(f: unknown) { this.ws.send(JSON.stringify(f)) }

  next(pred: (f: any) => boolean, ms = 2000): Promise<any> {
    const seen = this.frames.find(pred)
    if (seen) { this.frames.splice(this.frames.indexOf(seen), 1); return Promise.resolve(seen) }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for a frame')), ms)
      this.waiters.push({ pred: (f) => { if (!pred(f)) return false; clearTimeout(t); this.frames.splice(this.frames.indexOf(f), 1); return true }, resolve })
    })
  }

  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return
    await new Promise<void>((res) => { this.ws.onclose = () => res(); this.ws.close() })
  }
}

// Make two signed-in users contacts through an invite.
export async function befriend(base: string, a: { cookie: string }, b: { cookie: string }) {
  const inv = (await (await fetch(`${base}/api/invites`, { method: 'POST', headers: { cookie: a.cookie, origin: base } })).json()) as any
  const res = await fetch(`${base}/api/invites/${inv.code}/accept`, { method: 'POST', headers: { cookie: b.cookie, origin: base } })
  if (!res.ok) throw new Error(`accept failed: ${res.status}`)
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

// Read a JSON-RPC answer whether it came back as JSON or as an SSE stream.
export async function rpcBody(res: Response): Promise<any> {
  const text = await res.text()
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
    return datas.find((d) => 'result' in d || 'error' in d)
  }
  return JSON.parse(text)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
