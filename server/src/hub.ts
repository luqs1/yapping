// The hub: every node's WebSocket, /ws/node.
//
// It does three jobs and never sees a message's content:
//   presence  who has a node online, told to their contacts;
//   relay     sealed envelopes from one device to others. Every envelope
//             goes into the mailbox first and is pushed if the recipient is
//             online; the recipient's ack deletes it. So an envelope survives
//             a dropped socket and waits (up to 30 days) for a sleeping Mac;
//   gateway   a chat host called /mcp as this user, so ask their most
//             recently active node and wait for its answer.
//
// Frames are JSON (docs/protocol.md):
//   node → server  {t:'env', to:[deviceId…], env:{from, nonce, box}}
//                  {t:'ack', id}  {t:'rpc_result', id, result | error}  {t:'ping'}
//   server → node  {t:'env', id, from, env}  {t:'presence', userId, online}
//                  {t:'rpc', id, method, params, via}  {t:'contact_added', user}
//                  {t:'error', code, message}  {t:'pong'}

import type { ServerWebSocket } from 'bun'
import type { Config } from './config'
import type { DB } from './db'
import { contactIds, getUser, publicUser } from './users'
import { DAY, id, now } from './util'

export type NodeSocketData = { deviceId: string; userId: string }
type Socket = ServerWebSocket<NodeSocketData>
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: Timer; deviceId: string }

export const MAILBOX_TTL = 30 * DAY
export const MAX_FRAME = 1024 * 1024
export const OFFLINE = 'Your yapping node is offline. Is your Mac asleep?'

export class GatewayError extends Error {}

export class Hub {
  private sockets = new Map<string, { ws: Socket; userId: string; lastActive: number }>()
  private pending = new Map<string, Pending>()

  constructor(private cfg: Config, private db: DB) {}

  // ---- lifecycle -----------------------------------------------------------

  open(ws: Socket) {
    const { deviceId, userId } = ws.data
    const wasOnline = this.online(userId)
    const old = this.sockets.get(deviceId)
    if (old) old.ws.close(4000, 'replaced by a newer connection')
    this.sockets.set(deviceId, { ws, userId, lastActive: now() })
    this.touch(deviceId)

    // Tell my contacts I'm here, and tell me who of them is.
    if (!wasOnline) this.fanPresence(userId, true)
    for (const c of contactIds(this.db, userId)) send(ws, { t: 'presence', userId: c, online: this.online(c) })

    // Then everything that waited for this device.
    const rows = this.db.query<{ id: string; from_device: string; env: string }, [string, number]>(
      'SELECT id, from_device, env FROM mailbox WHERE to_device = ? AND expires_at > ? ORDER BY created_at',
    ).all(deviceId, now())
    for (const r of rows) send(ws, { t: 'env', id: r.id, from: r.from_device, env: JSON.parse(r.env) })
  }

  close(ws: Socket) {
    const { deviceId, userId } = ws.data
    if (this.sockets.get(deviceId)?.ws !== ws) return // already replaced
    this.sockets.delete(deviceId)
    this.touch(deviceId)
    for (const [rid, p] of this.pending) if (p.deviceId === deviceId) {
      this.pending.delete(rid)
      clearTimeout(p.timer)
      p.reject(new GatewayError(OFFLINE))
    }
    if (!this.online(userId)) this.fanPresence(userId, false)
  }

  message(ws: Socket, raw: string | Buffer) {
    const { deviceId, userId } = ws.data
    const entry = this.sockets.get(deviceId)
    if (entry?.ws === ws) entry.lastActive = now()
    if (raw.length > MAX_FRAME) return send(ws, { t: 'error', code: 'too_large', message: 'Frame over 1 MB' })
    let f: any
    try { f = JSON.parse(String(raw)) } catch { return send(ws, { t: 'error', code: 'bad_frame', message: 'Not JSON' }) }
    switch (f?.t) {
      case 'env': return this.relay(ws, deviceId, userId, f)
      case 'ack':
        if (typeof f.id === 'string') this.db.query('DELETE FROM mailbox WHERE id = ? AND to_device = ?').run(f.id, deviceId)
        return
      case 'rpc_result': {
        const p = this.pending.get(f.id)
        if (!p || p.deviceId !== deviceId) return
        this.pending.delete(f.id)
        clearTimeout(p.timer)
        if (f.error !== undefined && f.error !== null) p.reject(new GatewayError(typeof f.error === 'string' ? f.error : f.error?.message || 'The node returned an error'))
        else p.resolve(f.result)
        return
      }
      case 'ping': return send(ws, { t: 'pong' })
      default: return send(ws, { t: 'error', code: 'unknown_frame', message: `Unknown frame ${JSON.stringify(f?.t)}` })
    }
  }

  // ---- relay ---------------------------------------------------------------

  private relay(ws: Socket, fromDevice: string, fromUser: string, f: any) {
    const to: unknown[] = Array.isArray(f.to) ? f.to.slice(0, 512) : []
    const env = f.env
    if (!to.length || !env || typeof env.nonce !== 'string' || typeof env.box !== 'string')
      return send(ws, { t: 'error', code: 'bad_frame', message: 'env needs to:[deviceId] and env:{nonce, box}' })

    // Only to my own devices or my contacts' devices.
    const allowed = new Set([fromUser, ...contactIds(this.db, fromUser)])
    const owner = this.db.query<{ user_id: string }, [string]>('SELECT user_id FROM devices WHERE id = ?')
    const refused: string[] = []
    const sealed = { from: fromDevice, nonce: env.nonce, box: env.box } // `from` is always the socket's device
    const json = JSON.stringify(sealed)
    const ins = this.db.query('INSERT INTO mailbox (id, to_device, from_device, env, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const d of to) {
      const row = typeof d === 'string' ? owner.get(d) : null
      if (!row || !allowed.has(row.user_id) || d === fromDevice) { refused.push(String(d)); continue }
      const mid = id()
      ins.run(mid, d as string, fromDevice, json, now(), now() + MAILBOX_TTL)
      const target = this.sockets.get(d as string)
      if (target) send(target.ws, { t: 'env', id: mid, from: fromDevice, env: sealed })
    }
    if (refused.length) send(ws, { t: 'error', code: 'not_allowed', message: 'Not your device or a contact\'s', to: refused })
  }

  // ---- presence ------------------------------------------------------------

  online(userId: string) {
    for (const s of this.sockets.values()) if (s.userId === userId) return true
    return false
  }

  private fanPresence(userId: string, online: boolean) {
    for (const c of contactIds(this.db, userId)) this.toUser(c, { t: 'presence', userId, online })
  }

  private toUser(userId: string, frame: unknown) {
    for (const s of this.sockets.values()) if (s.userId === userId) send(s.ws, frame)
  }

  // Two people just became contacts: introduce them to each other's nodes.
  contactAdded(a: string, b: string) {
    for (const [me, other] of [[a, b], [b, a]]) {
      const u = getUser(this.db, other)
      if (!u) continue
      this.toUser(me, { t: 'contact_added', user: publicUser(u) })
      this.toUser(me, { t: 'presence', userId: other, online: this.online(other) })
    }
  }

  // A device was removed: hang up on it.
  drop(deviceId: string) {
    this.sockets.get(deviceId)?.ws.close(4001, 'device removed')
  }

  // ---- gateway -------------------------------------------------------------

  // Call a method on the user's most recently active online node.
  rpc(userId: string, method: string, params: unknown, via?: { client?: string; harness?: string }): Promise<unknown> {
    let best: { ws: Socket; lastActive: number; deviceId: string } | null = null
    for (const [deviceId, s] of this.sockets)
      if (s.userId === userId && (!best || s.lastActive > best.lastActive)) best = { ws: s.ws, lastActive: s.lastActive, deviceId }
    if (!best) return Promise.reject(new GatewayError(OFFLINE))
    const rid = id()
    const target = best
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid)
        reject(new GatewayError('Your yapping node didn\'t answer in time. Is your Mac asleep?'))
      }, this.cfg.rpcTimeoutMs)
      this.pending.set(rid, { resolve, reject, timer, deviceId: target.deviceId })
      send(target.ws, { t: 'rpc', id: rid, method, params: params ?? {}, ...(via ? { via } : {}) })
    })
  }

  private touch(deviceId: string) {
    this.db.query('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), deviceId)
  }

  isConnected(deviceId: string) { return this.sockets.has(deviceId) }
}

function send(ws: Socket, frame: unknown) {
  try { ws.send(JSON.stringify(frame)) } catch {}
}
