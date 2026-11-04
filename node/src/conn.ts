// The node's one line to the server: wss …/ws/node.
//
// It reconnects forever with backoff (1s, 2s, 4s… up to 30s, with jitter),
// re-reading the config each time so a `yap login` in another process is
// picked up without restarting the daemon. Frames are JSON; what they mean
// is node.ts's business.

import { loadConfig } from './paths'
import { wsUrl } from './server-api'

export type Frame = Record<string, any>

export type ConnOpts = {
  home: string
  onOpen: () => void | Promise<void>
  onFrame: (f: Frame) => void
  onClose: () => void
  log?: (...a: unknown[]) => void
  maxBackoff?: number
}

export function createConnection(o: ConnOpts) {
  const log = o.log || (() => {})
  const maxBackoff = o.maxBackoff ?? 30000
  let ws: WebSocket | null = null
  let open = false
  let stopped = false
  let backoff = 1000
  let timer: ReturnType<typeof setTimeout> | null = null
  // A ping every 25s keeps Cloudflare's tunnel from idling the socket out.
  let pinger: ReturnType<typeof setInterval> | null = null

  function later(ms: number) {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(dial, ms + Math.floor(Math.random() * Math.min(ms / 4, 1000)))
  }

  function dial() {
    timer = null
    if (stopped || ws) return
    const cfg = loadConfig(o.home)
    // Not signed in yet: look again shortly (yap login writes the config).
    if (!cfg.deviceToken) return later(2000)
    const url = `${wsUrl(cfg.server)}?token=${encodeURIComponent(cfg.deviceToken)}`
    let sock: WebSocket
    try {
      // Bun's WebSocket takes headers; the token also rides in the query for proxies that strip them.
      sock = new (WebSocket as any)(url, { headers: { authorization: `Bearer ${cfg.deviceToken}` } })
    } catch (e) {
      log('ws: dial failed', e)
      return retry()
    }
    ws = sock
    sock.onopen = async () => {
      open = true
      backoff = 1000
      log('ws: connected to', cfg.server)
      pinger = setInterval(() => { try { sock.send('{"t":"ping"}') } catch {} }, 25000)
      try { await o.onOpen() } catch (e) { log('ws: onOpen failed', e) }
    }
    sock.onmessage = (e) => {
      let f: Frame
      try { f = JSON.parse(String(e.data)) } catch { return }
      o.onFrame(f)
    }
    sock.onerror = () => {} // a close always follows
    sock.onclose = (e) => {
      const was = open
      open = false
      if (pinger) clearInterval(pinger)
      pinger = null
      ws = null
      if (was) o.onClose()
      log(`ws: closed (${e.code}${e.reason ? ' ' + e.reason : ''})`)
      retry()
    }
  }

  function retry() {
    ws = null
    later(backoff)
    backoff = Math.min(backoff * 2, maxBackoff)
  }

  return {
    start() { stopped = false; dial() },
    // Send a frame now if we can. False means "not connected, queue it".
    send(f: Frame): boolean {
      if (!ws || !open) return false
      try { ws.send(JSON.stringify(f)); return true } catch { return false }
    },
    get connected() { return open },
    // Drop the line and dial again straight away (after login, say).
    kick() { backoff = 1000; if (ws) ws.close(); else later(0) },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      if (pinger) clearInterval(pinger)
      timer = pinger = null
      if (ws) try { ws.close() } catch {}
      ws = null
      open = false
    },
  }
}

export type Connection = ReturnType<typeof createConnection>
