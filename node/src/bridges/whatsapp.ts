// The WhatsApp bridge: the node's side of the `yap-wa` sidecar.
//
// yap-wa (node/bridges/whatsapp, Go + whatsmeow) links this Mac to the
// person's WhatsApp as a linked device. It runs here, on their Mac, and never
// on our server: WhatsApp messages stay on this machine. We talk to it with
// newline-delimited JSON over stdio:
//
//   node → sidecar  {id, cmd:'link'|'status'|'unlink'|'send'|'history'|'chats', …}
//   sidecar → node  {type:'result', id, ok, …} for each command (send answers {msgId, ts}), and events:
//                   ready, qr, connected, disconnected, logged_out, message, receipt, error
//
// The sidecar only runs once the person has asked to link, or when a session
// already exists (bridges/whatsapp/account.json, written when linking
// succeeds). If it dies we start it again, waiting longer each time.

import type { Subprocess } from 'bun'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writePrivate } from '../paths'
import type { Bridge, BridgedMessage, BridgedPerson, BridgeStatus } from './types'

export const WHATSAPP_WARNING =
  "WhatsApp doesn't allow third-party apps. Linking yapping as a device could get your account restricted. Use it on an account you're comfortable with."

export type WhatsAppOptions = {
  home: string
  // The full command to start the sidecar. Defaults to findSidecar().
  command?: string[]
  env?: Record<string, string>
  log?: (...a: unknown[]) => void
  backoffMs?: [number, number] // first and longest wait between restarts
  linkTimeoutMs?: number // how long `link` waits for the first QR code
  requestTimeoutMs?: number
  historyDays?: number // the first import: only chats and messages this recent…
  historyPerChat?: number // …and at most this many messages per chat
}

// Where yap-wa lives: $YAP_WA_BIN, or beside the running `yap` binary
// (~/.yapping/bin/yap-wa once installed, or dist/yap-wa-darwin-<arch>).
export function findSidecar(env = process.env): string[] | null {
  if (env.YAP_WA_BIN) return existsSync(env.YAP_WA_BIN) ? [env.YAP_WA_BIN] : null
  const dir = dirname(process.execPath)
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  for (const name of ['yap-wa', `yap-wa-darwin-${arch}`]) {
    const p = join(dir, name)
    if (existsSync(p)) return [p]
  }
  return null
}

const WA = 'wa:'
export const waChatId = (jid: string) => `${WA}${jid}`
const phoneOf = (jid: string) => (/^\d+@s\.whatsapp\.net$/.test(jid) ? `+${jid.split('@')[0]}` : '')

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
type Account = { name?: string; phone?: string; jid?: string; linkedAt?: number }

class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export class WhatsAppBridge implements Bridge {
  readonly network = 'whatsapp' as const
  private dir: string
  private accountFile: string
  private log: (...a: unknown[]) => void
  private command: string[]
  private backoff: [number, number]
  private wait: number
  private proc: Subprocess<'pipe', 'pipe', 'pipe'> | null = null
  private startedAt = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private wanted = false
  private stopping = false
  private nextId = 1
  private pending = new Map<number, Pending>()
  private qr: { qr: string; expiresAt: number } | null = null
  private qrWaiters = new Set<(r: { qr?: string; expiresAt?: number; error?: BridgeError; linked?: boolean }) => void>()
  private msgFns = new Set<(m: BridgedMessage) => void>()
  private statusFns = new Set<(s: BridgeStatus) => void>()
  private st: BridgeStatus
  private histCount = new Map<string, number>()
  readonly restarts = { count: 0 }

  constructor(private opts: WhatsAppOptions & { command: string[] }) {
    this.dir = join(opts.home, 'bridges', 'whatsapp')
    this.accountFile = join(this.dir, 'account.json')
    this.log = opts.log || (() => {})
    this.command = opts.command
    this.backoff = opts.backoffMs || [1000, 60_000]
    this.wait = this.backoff[0]
    const acct = this.readAccount()
    this.st = acct
      ? { network: 'whatsapp', status: 'linked', account: acct.phone ?? null, accountName: acct.name ?? null, connected: false }
      : { network: 'whatsapp', status: 'unlinked', account: null, accountName: null, connected: false, warning: WHATSAPP_WARNING }
  }

  // ── Session marker ──────────────────────────────────────────────────────
  private readAccount(): Account | null {
    try { return JSON.parse(readFileSync(this.accountFile, 'utf8')) } catch { return null }
  }
  private writeAccount(a: Account) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    writePrivate(this.accountFile, JSON.stringify({ ...a, linkedAt: this.readAccount()?.linkedAt ?? Date.now() }, null, 2))
  }
  private dropAccount() {
    rmSync(this.accountFile, { force: true })
  }
  private get hasSession() {
    return existsSync(this.accountFile)
  }

  // ── Status ──────────────────────────────────────────────────────────────
  current(): BridgeStatus {
    return { ...this.st }
  }

  private setStatus(patch: Partial<BridgeStatus>, force = false) {
    const prev = this.st
    const next: BridgeStatus = { ...prev, ...patch }
    next.warning = next.status === 'linked' ? undefined : WHATSAPP_WARNING
    if (next.status !== 'unlinked') delete next.reason
    this.st = next
    const changed = force || prev.status !== next.status || prev.account !== next.account || prev.accountName !== next.accountName
    if (!changed) return
    const out = this.current()
    for (const fn of this.statusFns) try { fn(out) } catch (e) { this.log('whatsapp status listener:', e) }
  }

  async status(): Promise<BridgeStatus> {
    return this.current()
  }

  onStatus(fn: (s: BridgeStatus) => void) {
    this.statusFns.add(fn)
    return () => { this.statusFns.delete(fn) }
  }

  onMessage(fn: (m: BridgedMessage) => void) {
    this.msgFns.add(fn)
    return () => { this.msgFns.delete(fn) }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  // Run the sidecar now only if there's a session to resume.
  start() {
    if (this.hasSession) {
      this.wanted = true
      this.ensureRunning()
    }
  }

  async stop() {
    this.stopping = true
    this.wanted = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    await this.killProc()
  }

  private ensureRunning() {
    if (this.proc || this.stopping) return
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    this.spawn()
  }

  private spawn() {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      YAP_HOME: this.opts.home,
      YAP_WA_HISTORY_DAYS: String(this.opts.historyDays ?? 30),
      YAP_WA_HISTORY_PER_CHAT: String(this.opts.historyPerChat ?? 50),
      ...(this.opts.env || {}),
    }
    let proc: Subprocess<'pipe', 'pipe', 'pipe'>
    try {
      proc = Bun.spawn(this.command, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env, onExit: (p, code, signal) => this.onExit(p, code, signal) })
    } catch (e) {
      this.log('whatsapp: could not start the sidecar:', (e as Error).message)
      this.scheduleRestart()
      return
    }
    this.proc = proc
    this.startedAt = Date.now()
    this.log(`whatsapp: sidecar started (pid ${proc.pid})`)
    void this.readLines(proc.stdout, (line) => this.onLine(line))
    void this.readLines(proc.stderr, (line) => this.log(`whatsapp: ${line.slice(0, 300)}`))
  }

  private async readLines(stream: ReadableStream<Uint8Array>, fn: (line: string) => void) {
    const dec = new TextDecoder()
    let buf = ''
    try {
      for await (const chunk of stream) {
        buf += dec.decode(chunk, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line) fn(line)
        }
      }
    } catch {}
  }

  private onExit(p: Subprocess, code: number | null, signal: number | string | null) {
    if (p !== this.proc) return
    this.proc = null
    this.log(`whatsapp: sidecar exited (${signal ? `signal ${signal}` : `code ${code}`})`)
    for (const [id, w] of this.pending) {
      clearTimeout(w.timer)
      w.reject(new BridgeError('bridge_restarting', 'The WhatsApp bridge stopped. Try again in a moment.'))
      this.pending.delete(id)
    }
    if (this.st.status === 'linking') {
      this.qr = null
      this.failLink(new BridgeError('link_interrupted', 'The WhatsApp bridge stopped while linking. Ask for a new code.'))
      this.setStatus({ status: 'unlinked' })
    }
    if (this.st.connected) this.setStatus({ connected: false })
    if (!this.stopping && this.wanted && this.hasSession) this.scheduleRestart()
  }

  private scheduleRestart() {
    if (this.stopping || this.restartTimer) return
    // A sidecar that ran a good while gets a fresh, short wait.
    if (Date.now() - this.startedAt > 60_000) this.wait = this.backoff[0]
    const ms = this.wait
    this.wait = Math.min(this.wait * 2, this.backoff[1])
    this.log(`whatsapp: restarting the sidecar in ${ms}ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping && this.wanted && !this.proc) {
        this.restarts.count++
        this.spawn()
      }
    }, ms)
  }

  private async killProc() {
    const p = this.proc
    if (!p) return
    this.proc = null
    try { p.stdin.end() } catch {}
    const exited = await Promise.race([p.exited.then(() => true), Bun.sleep(1500).then(() => false)])
    if (!exited) {
      p.kill('SIGTERM')
      const gone = await Promise.race([p.exited.then(() => true), Bun.sleep(1500).then(() => false)])
      if (!gone) p.kill('SIGKILL')
    }
    for (const [id, w] of this.pending) {
      clearTimeout(w.timer)
      w.reject(new BridgeError('bridge_stopped', 'The WhatsApp bridge stopped.'))
      this.pending.delete(id)
    }
  }

  // ── Talking to the sidecar ──────────────────────────────────────────────
  request(cmd: Record<string, unknown>, timeoutMs = this.opts.requestTimeoutMs ?? 30_000): Promise<any> {
    const p = this.proc
    if (!p) return Promise.reject(new BridgeError('bridge_down', "The WhatsApp bridge isn't running."))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeError('timeout', `WhatsApp didn't answer "${cmd.cmd}" in time.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        p.stdin.write(JSON.stringify({ id, ...cmd }) + '\n')
        p.stdin.flush()
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new BridgeError('bridge_down', (e as Error).message))
      }
    })
  }

  private onLine(line: string) {
    let ev: any
    try { ev = JSON.parse(line) } catch { return this.log('whatsapp: not JSON from sidecar:', line.slice(0, 120)) }
    switch (ev.type) {
      case 'result': {
        const w = this.pending.get(Number(ev.id))
        if (!w) return
        this.pending.delete(Number(ev.id))
        clearTimeout(w.timer)
        if (ev.ok) w.resolve(ev)
        else w.reject(new BridgeError(ev.code || 'whatsapp_error', ev.error || 'WhatsApp said no.'))
        return
      }
      case 'ready':
        if (!ev.linked && this.hasSession) {
          // The session is gone (deleted, or never finished): start over.
          this.dropAccount()
          this.setStatus({ status: 'unlinked', account: null, accountName: null, connected: false, reason: 'session_missing' })
        }
        return
      case 'qr': {
        this.qr = { qr: String(ev.code), expiresAt: Number(ev.expiresAt) || Date.now() + 20_000 }
        if (this.st.status !== 'linked') this.setStatus({ status: 'linking', error: null })
        for (const fn of this.qrWaiters) fn({ ...this.qr })
        this.qrWaiters.clear()
        return
      }
      case 'connected': {
        const a: Account = ev.account || {}
        this.writeAccount({ name: a.name || undefined, phone: a.phone, jid: a.jid })
        this.qr = null
        this.wait = this.backoff[0]
        this.setStatus({ status: 'linked', account: a.phone ?? null, accountName: a.name || null, connected: true, error: null })
        for (const fn of this.qrWaiters) fn({ linked: true })
        this.qrWaiters.clear()
        return
      }
      case 'disconnected':
        this.setStatus({ connected: false })
        return
      case 'logged_out':
        this.dropAccount()
        this.qr = null
        this.histCount.clear()
        this.wanted = false
        this.setStatus({ status: 'unlinked', account: null, accountName: null, connected: false, reason: ev.reason || 'logged_out' }, true)
        // Nothing to bridge any more; let the sidecar go until asked again
        // (`unlink` stops it itself once the sidecar has answered).
        if (ev.reason !== 'unlinked') void this.killProc()
        return
      case 'error': {
        const err = new BridgeError(String(ev.code || 'whatsapp_error'), String(ev.message || 'Something went wrong with WhatsApp.'))
        this.log(`whatsapp: ${err.code}: ${err.message}`)
        if (this.st.status === 'linking' && (['qr_timeout', 'pair_failed', 'connect_failed', 'link_failed'].includes(err.code) || err.code.startsWith('err-'))) {
          this.qr = null
          this.failLink(err)
          this.setStatus({ status: 'unlinked', error: { code: err.code, message: err.message } })
          if (!this.hasSession) {
            this.wanted = false
            void this.killProc()
          }
        } else {
          this.st = { ...this.st, error: { code: err.code, message: err.message } }
        }
        return
      }
      case 'message': {
        const m = this.toBridged(ev)
        if (!m) return
        for (const fn of this.msgFns) try { fn(m) } catch (e) { this.log('whatsapp message listener:', e) }
        return
      }
      case 'receipt':
        return // delivery/read ticks: not shown yet
    }
  }

  private failLink(err: BridgeError) {
    for (const fn of this.qrWaiters) fn({ error: err })
    this.qrWaiters.clear()
  }

  // A sidecar `message` event as a yapping BridgedMessage.
  private toBridged(ev: any): BridgedMessage | null {
    const jid = String(ev.jid || '')
    if (!jid || !ev.id || typeof ev.text !== 'string') return null
    const ts = Number(ev.ts) || Date.now()
    if (ev.history) {
      // Keep the first import small: recent chats, newest messages only.
      const days = this.opts.historyDays ?? 30
      const per = this.opts.historyPerChat ?? 50
      if (ts < Date.now() - days * 86400_000) return null
      const n = this.histCount.get(jid) || 0
      if (n >= per) return null
      this.histCount.set(jid, n + 1)
    }
    const isGroup = !!ev.isGroup
    const chatName = String(ev.chatName || phoneOf(jid) || 'WhatsApp')
    const fromJid = String(ev.from?.jid || '')
    const person = (j: string, name: string): BridgedPerson => ({ id: waChatId(j), name, handle: phoneOf(j) || undefined })
    const sender = !ev.fromMe ? (isGroup ? person(fromJid || jid, String(ev.from?.name || phoneOf(fromJid) || 'Someone')) : person(jid, chatName)) : undefined
    return {
      network: 'whatsapp',
      chat: {
        id: waChatId(jid),
        kind: isGroup ? 'group' : 'dm',
        title: chatName,
        members: isGroup ? (sender ? [sender] : []) : [person(jid, chatName)],
      },
      id: waChatId(String(ev.id)),
      from: sender ? sender.id : '',
      fromMe: !!ev.fromMe,
      ...(sender ? { sender } : {}),
      ts,
      text: ev.text,
      ...(ev.quoted?.id ? { replyTo: waChatId(String(ev.quoted.id)) } : {}),
      ...(ev.history ? { history: true } : {}),
    }
  }

  private waitForQr(ms: number) {
    return new Promise<{ qr?: string; expiresAt?: number; error?: BridgeError; linked?: boolean }>((resolve) => {
      const fn = (r: any) => { clearTimeout(t); resolve(r) }
      const t = setTimeout(() => { this.qrWaiters.delete(fn); resolve({ error: new BridgeError('timeout', "WhatsApp didn't send a code in time. Try again.") }) }, ms)
      this.qrWaiters.add(fn)
    })
  }

  // ── The Bridge contract ─────────────────────────────────────────────────
  async link() {
    if (this.st.status === 'linked') {
      this.wanted = true
      this.ensureRunning()
      return { status: 'linked', account: this.st.account ?? null, accountName: this.st.accountName ?? null }
    }
    // A code that's still good can be shown again.
    if (this.st.status === 'linking' && this.qr && this.qr.expiresAt - Date.now() > 3000 && this.proc) {
      return { status: 'linking', qr: this.qr.qr, expiresAt: this.qr.expiresAt, warning: WHATSAPP_WARNING }
    }
    this.stopping = false
    this.wanted = true
    this.ensureRunning()
    const waiter = this.waitForQr(this.opts.linkTimeoutMs ?? 25_000)
    try {
      const r = await this.request({ cmd: 'link' })
      if (r.status === 'linked') {
        this.failLink(new BridgeError('linked', 'already linked'))
        return { status: 'linked', account: r.account?.phone ?? this.st.account ?? null, accountName: r.account?.name ?? null }
      }
    } catch (e) {
      this.qrWaiters.clear()
      if (!this.hasSession) this.wanted = false
      throw e
    }
    const got = await waiter
    if (got.linked) return { status: 'linked', account: this.st.account ?? null, accountName: this.st.accountName ?? null }
    if (got.error || !got.qr) throw got.error || new BridgeError('no_code', "WhatsApp didn't send a code.")
    return { status: 'linking', qr: got.qr, expiresAt: got.expiresAt, warning: WHATSAPP_WARNING }
  }

  async unlink() {
    if (this.proc) {
      await this.request({ cmd: 'unlink' }, 20_000).catch((e) => this.log('whatsapp unlink:', e.message))
    }
    this.wanted = false
    await this.killProc()
    this.dropAccount()
    this.qr = null
    this.histCount.clear()
    this.setStatus({ status: 'unlinked', account: null, accountName: null, connected: false, reason: 'unlinked' }, this.st.status !== 'unlinked')
  }

  async send(chatId: string, text: string, opts: { replyTo?: string } = {}) {
    if (!chatId.startsWith(WA)) throw new BridgeError('bad_request', 'Not a WhatsApp chat.')
    if (this.st.status !== 'linked') throw new BridgeError('not_linked', "WhatsApp isn't linked on this Mac. Connect it from the + menu.")
    this.ensureRunning()
    const replyTo = opts.replyTo?.startsWith(WA) ? opts.replyTo.slice(WA.length) : undefined
    const r = await this.request({ cmd: 'send', jid: chatId.slice(WA.length), text, ...(replyTo ? { replyTo } : {}) })
    return { id: waChatId(String(r.msgId)), ts: Number(r.ts) || Date.now() }
  }

  // The sidecar's cache of a chat's recent messages, and its chat list.
  async history(chatId: string, limit = 50) {
    return (await this.request({ cmd: 'history', jid: chatId.replace(WA, ''), limit })).messages || []
  }
  async chats() {
    return (await this.request({ cmd: 'chats' })).chats || []
  }

  get pid() {
    return this.proc?.pid ?? null
  }
}

// The WhatsApp bridge, if its sidecar is installed on this Mac.
export function whatsappBridge(opts: WhatsAppOptions): WhatsAppBridge | null {
  const command = opts.command || findSidecar()
  if (!command) return null
  return new WhatsAppBridge({ ...opts, command })
}
