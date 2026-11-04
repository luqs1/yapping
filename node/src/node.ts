// The yapping node: one person's messages, on their own Mac.
//
// It keeps the chat world in SQLite in the same shapes shared/sim.js uses
// (users, chats with `sees` and `unread`, messages, assists), and emits the
// same UI events (message, message_update, assist, chat_update, presence…)
// stamped with a `seq`, so a sidebar folds them in with sim.js's applyEvent.
//
// Messages travel as *wire events* (docs/protocol.md):
//   {v:0, kind:'message'|'reaction'|'read'|'typing', chat:{id,kind,members,title?},
//    id, from, ts, text?, attachment?, emoji?, msgId?, assistedBy?, sig}
// signed with this device's Ed25519 key and boxed separately to every device
// of every member, our own other devices included, so they stay in step.
// The server relays the boxes and never sees a word.
//
// Every RPC (state, sync, inbox, read, send, propose, approve…) lives in
// `methods` below. The local HTTP API, the server's gateway and `yap mcp` all
// call the same functions.

import { randomUUID } from 'node:crypto'
import { BRIDGES, HARNESSES } from '../../shared/sim.js'
import { createBridges, NETWORKS, notSetUp } from './bridges'
import { createConnection, type Frame } from './conn'
import { loadKeys, open as openEnv, publicKeys, seal, signEvent, verifyEvent, type Envelope } from './crypto'
import { loadConfig, saveConfig, type Config, type User } from './paths'
import { serverApi, type ServerDevice } from './server-api'
import { openStore, type Device, type Json } from './store'

export const VERSION = '0.1.0'

// An RPC failure with a code the UI and MCP can show as-is.
export class RpcError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export type WireEvent = {
  v: 0
  kind: 'message' | 'reaction' | 'read' | 'typing'
  chat: { id: string; kind: 'dm' | 'group'; members: string[]; title?: string }
  id: string
  from: string
  ts: number
  text?: string
  attachment?: Json
  emoji?: string
  off?: boolean // reaction removed (our addition: makes reactions idempotent)
  msgId?: string
  replyTo?: string // (our addition: threads replies)
  assistedBy?: string
  sig?: string
}

export type NodeOpts = {
  home: string
  agent?: string // this person's harness: claude, codex, opencode, pi
  log?: (...a: unknown[]) => void
  readingMs?: number // how long a `reading` glance lasts before it settles
  deviceTtlMs?: number // how long a contact's device list is trusted
}

// DM ids are stable on both ends: dm:<sorted user ids joined by ','>.
export const dmId = (a: string, b: string) => `dm:${[a, b].sort().join(',')}`

// People get a steady colour from their id, like the mockups.
const PALETTE = ['#E8590C', '#1C7ED6', '#2F9E44', '#AE3EC9', '#0B7285', '#C2255C', '#5F3DC4', '#E67700', '#087F5B', '#364FC7']
const colorFor = (id: string) => PALETTE[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]

const ACTIVE = ['reading', 'waiting', 'talking', 'working', 'ready']
const PAYLOAD_KINDS = ['text', 'link', 'file', 'event']

export async function startNode(opts: NodeOpts) {
  const home = opts.home
  const log = opts.log || (() => {})
  const readingMs = opts.readingMs ?? 2400
  const deviceTtl = opts.deviceTtlMs ?? 5 * 60_000
  const keys = loadKeys(home)
  const store = openStore(home)
  const bridges = createBridges()
  const listeners = new Set<(ev: Json) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let cfg: Config = loadConfig(home)
  let stopped = false

  const agent = () => opts.agent || cfg.agent || process.env.YAP_AGENT || 'claude'
  const me = () => cfg.user?.id
  const needMe = () => {
    const id = me()
    if (!id) throw new RpcError('not_signed_in', 'This node is not signed in yet. Run `yap login`.')
    return id
  }
  const api = () => serverApi(cfg.server, cfg.deviceToken)
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => { timers.delete(t); if (!stopped) fn() }, ms)
    timers.add(t)
  }

  // ── Events ────────────────────────────────────────────────────────────
  // Durable UI events get a seq (for `sync`); transient ones (typing) don't.
  function emit(ev: Json, durable = true): Json {
    const out = durable ? store.addEvent({ ...ev, at: Date.now() }) : { ...ev, at: Date.now() }
    for (const fn of listeners) try { fn(out) } catch {}
    return out
  }

  // ── People ────────────────────────────────────────────────────────────
  // A user in sim.js's shape: {id, name, handle, color, agent, harness, status, bridge}.
  function toUser(u: User, prev?: Json): Json {
    const mine = u.id === me()
    return {
      id: u.id,
      name: u.name || u.email || 'Someone',
      handle: u.email || prev?.handle || '',
      email: u.email,
      avatar: u.avatar ?? null,
      color: prev?.color || colorFor(u.id),
      agent: mine ? agent() : prev?.agent ?? null,
      harness: mine ? agent() : prev?.harness ?? null,
      status: mine ? (conn.connected ? 'online' : 'away') : prev?.status || 'away',
      bridge: null,
      clients: prev?.clients || [],
    }
  }

  // Insert or refresh a person; tells the UI when something it shows changed.
  function upsertUser(u: User) {
    const prev = store.user(u.id)
    const next = toUser(u, prev)
    if (prev && prev.name === next.name && prev.handle === next.handle && prev.avatar === next.avatar && prev.agent === next.agent) return prev
    store.putUser(next)
    emit({ type: 'user', user: next })
    return next
  }

  function ensureMe() {
    if (cfg.user) upsertUser(cfg.user)
  }

  function setPresence(userId: string, status: 'online' | 'away') {
    const u = store.user(userId)
    if (!u || u.status === status) return
    u.status = status
    store.putUser(u)
    emit({ type: 'presence', user: userId, status, harness: u.harness, clients: u.clients || [] })
  }

  async function refreshContacts() {
    const list = await api().contacts()
    for (const c of list) if (c?.user?.id) upsertUser(c.user)
    return list
  }

  // ── Devices (who gets a copy) ─────────────────────────────────────────
  const toDevices = (userId: string, list: ServerDevice[]): Device[] =>
    list.filter((d) => d.deviceId && d.boxPub && d.signPub).map((d) => ({ deviceId: d.deviceId, userId, boxPub: d.boxPub, signPub: d.signPub, name: d.name }))

  async function refreshMyDevices() {
    const res = await api().me()
    if (res.user) {
      cfg.user = { ...cfg.user, ...res.user }
      ensureMe()
    }
    const mine = toDevices(res.user.id, res.devices || [])
    store.setDevices(res.user.id, mine)
    // Learn our own device id if login didn't hand it over.
    if (!cfg.deviceId) {
      const { boxPub } = publicKeys(keys)
      const self = mine.find((d) => d.boxPub === boxPub)
      if (self) {
        cfg.deviceId = self.deviceId
        saveConfig(home, cfg)
      }
    }
    return mine
  }

  // A member's devices, cached for a few minutes.
  async function devicesFor(userId: string, fresh = false): Promise<Device[]> {
    const cached = store.devicesOf(userId)
    if (!fresh && cached.length && Date.now() - store.devicesFetchedAt(userId) < deviceTtl) return cached
    try {
      if (userId === me()) return await refreshMyDevices()
      const list = toDevices(userId, await api().devices(userId))
      store.setDevices(userId, list)
      return list
    } catch (e) {
      log(`devices for ${userId}: ${(e as Error).message}`)
      return cached
    }
  }

  // Who sent this envelope? Unknown devices make us refresh everyone once.
  async function deviceById(deviceId: string): Promise<Device | undefined> {
    const hit = store.device(deviceId)
    if (hit) return hit
    await refreshMyDevices().catch(() => {})
    if (store.device(deviceId)) return store.device(deviceId)
    const contacts = await refreshContacts().catch(() => [])
    for (const c of contacts) {
      await devicesFor(c.user.id, true)
      if (store.device(deviceId)) break
    }
    return store.device(deviceId)
  }

  // ── Chats ─────────────────────────────────────────────────────────────
  function newChat(ref: WireEvent['chat']): Json {
    const myId = needMe()
    const other = ref.kind === 'dm' ? store.user(ref.members.find((x) => x !== myId) || '') : null
    return {
      id: ref.id,
      kind: ref.kind,
      title: ref.kind === 'dm' ? other?.name || ref.title || 'Chat' : ref.title || 'Group',
      transport: 'yap',
      members: [...ref.members],
      pinned: false,
      unread: { [myId]: 0 },
      // Agents see nothing until their owner says so (SPEC: opt-in, per chat).
      sees: { [myId]: false },
    }
  }

  const chatRef = (c: Json): WireEvent['chat'] => ({ id: c.id, kind: c.kind, members: c.members, ...(c.kind === 'group' && c.title ? { title: c.title } : {}) })

  function saveChat(c: Json, lastTs = 0, announce = true) {
    store.putChat(c, lastTs)
    if (announce) emit({ type: 'chat_update', chatId: c.id, chat: c })
  }

  // Find a chat from what a person or an agent typed: an id, a dm: id, a
  // contact's id or email, or a title/name ("Finn").
  function resolveChat(q: unknown, create = false): Json {
    const myId = needMe()
    const key = String(q ?? '').trim()
    if (!key) throw new RpcError('bad_request', 'Which chat? Pass `chat`.')
    const hit = store.chat(key)
    if (hit) return hit
    const users = store.users().filter((u) => u.id !== myId)
    let other: Json | undefined
    if (key.startsWith('dm:')) {
      const ids = key.slice(3).split(',')
      if (ids.length === 2 && ids.includes(myId) && dmId(ids[0], ids[1]) === key) other = store.user(ids.find((x) => x !== myId) || myId) || { id: ids.find((x) => x !== myId) }
    } else {
      const lower = key.toLowerCase()
      other = users.find((u) => u.id === key || u.email?.toLowerCase() === lower)
      if (!other) {
        const byTitle = store.chats().filter((c) => c.title?.toLowerCase() === lower)
        if (byTitle.length === 1) return byTitle[0]
        const byName = users.filter((u) => u.name?.toLowerCase() === lower)
        if (byName.length === 1) other = byName[0]
      }
    }
    if (!other) throw new RpcError('no_chat', `No chat or contact called "${key}".`)
    const id = dmId(myId, other.id)
    const existing = store.chat(id)
    if (existing) return existing
    if (!create) throw new RpcError('no_chat', `You haven't talked to ${other.name || other.id} yet.`)
    const chat = newChat({ id, kind: 'dm', members: [myId, other.id].sort() })
    saveChat(chat, Date.now())
    return chat
  }

  // ── Messages ──────────────────────────────────────────────────────────
  // A wire 'message' event as a sim.js message.
  const toMessage = (ev: WireEvent, chat: Json): Json => ({
    id: ev.id,
    chatId: chat.id,
    from: ev.from,
    kind: ev.attachment ? 'attachment' : 'text',
    text: ev.text || '',
    ts: ev.ts,
    via: chat.transport,
    reactions: {},
    ...(ev.replyTo ? { replyTo: ev.replyTo } : {}),
    ...(ev.attachment ? { attachment: ev.attachment } : {}),
    ...(ev.assistedBy ? { assistedBy: ev.assistedBy } : {}),
  })

  // Fold one wire event into the store. Used for what arrives and for what
  // we send ourselves, so every device ends up with the same history.
  function apply(ev: WireEvent): boolean {
    const myId = needMe()
    const ref = ev.chat
    if (!ref || !Array.isArray(ref.members) || !ref.members.includes(myId) || !ref.members.includes(ev.from)) return false
    if (ref.kind === 'dm' && (ref.members.length !== 2 || ref.id !== dmId(ref.members[0], ref.members[1]))) return false
    let chat = store.chat(ref.id)
    if (!chat) {
      if (ev.kind !== 'message') return false // nothing to react to yet
      chat = newChat(ref)
      saveChat(chat, ev.ts)
    } else if (chat.kind === 'group' && chat.members.includes(ev.from) && (ref.title !== chat.title || ref.members.join() !== chat.members.join())) {
      // Group members may rename it or change who's in it.
      chat = { ...chat, title: ref.title || chat.title, members: [...ref.members] }
      saveChat(chat)
    }

    switch (ev.kind) {
      case 'message': {
        if (store.message(ev.id)) return true // redelivered
        const m = toMessage(ev, chat)
        store.putMessage(m)
        if (ev.from !== myId) chat.unread = { ...chat.unread, [myId]: (chat.unread?.[myId] || 0) + 1 }
        // sim.js's applyEvent bumps unread itself on 'message', so no chat_update here.
        saveChat(chat, ev.ts, false)
        emit({ type: 'message', chatId: chat.id, message: m })
        return true
      }
      case 'reaction': {
        const m = ev.msgId && store.message(ev.msgId)
        if (!m || m.chatId !== chat.id || !ev.emoji) return false
        const list: string[] = m.reactions[ev.emoji] || []
        const has = list.includes(ev.from)
        if (ev.off ? !has : has) return true // already so
        m.reactions = { ...m.reactions, [ev.emoji]: ev.off ? list.filter((x) => x !== ev.from) : [...list, ev.from] }
        if (!m.reactions[ev.emoji].length) delete m.reactions[ev.emoji]
        store.putMessage(m)
        emit({ type: 'message_update', chatId: chat.id, message: m })
        return true
      }
      case 'read': {
        // Our own other device read it: clear the count here too.
        if (ev.from === myId && chat.unread?.[myId]) {
          chat.unread = { ...chat.unread, [myId]: 0 }
          saveChat(chat)
        }
        return true
      }
      case 'typing': {
        if (ev.from !== myId && Date.now() - ev.ts < 10_000) emit({ type: 'typing', chatId: chat.id, user: ev.from, until: Date.now() + 3000 }, false)
        return true
      }
    }
    return false
  }

  // ── Sending: outbox → fan-out → server ────────────────────────────────
  // Our events wait in the outbox until the server has them, so a message
  // written on a plane goes out when the Mac reconnects.
  let flushing: Promise<void> | null = null

  function enqueue(ev: WireEvent) {
    store.queueFrame({ ev: signEvent(ev as any, keys) })
    void flush()
  }

  function flush(): Promise<void> {
    if (!conn.connected || !cfg.deviceId) return Promise.resolve()
    if (flushing) return flushing.then(() => flush())
    const run = (async () => {
      await null // so `flushing` is set before the body can finish
      for (const { id, frame } of store.outbox()) {
        if (!conn.connected) return
        if (!(await fanout(frame.ev))) return
        store.dropFrame(id)
      }
    })()
    flushing = run.finally(() => { flushing = null })
    return flushing
  }

  // One box per device of every member (and our other devices).
  async function fanout(ev: WireEvent): Promise<boolean> {
    const deviceId = cfg.deviceId!
    for (const userId of ev.chat.members) {
      const devices = await devicesFor(userId)
      for (const d of devices) {
        if (d.deviceId === deviceId) continue
        const env = seal(ev, deviceId, d.boxPub, keys)
        if (!conn.send({ t: 'env', to: [d.deviceId], env })) return false
      }
    }
    return true
  }

  // A new event from us: apply it here, then send it everywhere.
  function originate(chat: Json, body: Partial<WireEvent>): WireEvent {
    const ev = { v: 0, chat: chatRef(chat), id: randomUUID(), from: needMe(), ts: Date.now(), ...body } as WireEvent
    apply(ev)
    enqueue(ev)
    return ev
  }

  // ── Receiving ─────────────────────────────────────────────────────────
  // 'applied' and 'rejected' are both acked; a throw (network trouble while
  // looking up the sender) leaves the item in the mailbox for next time.
  async function receive(f: Frame): Promise<'applied' | 'rejected'> {
    const env = f.env as Envelope
    const fromDevice = String(f.from || env?.from || '')
    if (!env?.box || !env?.nonce || !fromDevice) return 'rejected'
    const dev = await deviceById(fromDevice)
    if (!dev) return 'rejected'
    const ev = openEnv(env, dev.boxPub, keys) as WireEvent | null
    if (!ev) return 'rejected'
    if (!verifyEvent(ev as any, dev.signPub) || ev.from !== dev.userId) {
      log(`dropped an event from ${fromDevice}: bad signature or sender`)
      return 'rejected'
    }
    // A stranger in a group? Learn their name before showing them.
    if (!store.user(ev.from)) await refreshContacts().catch(() => {})
    return apply(ev) ? 'applied' : 'rejected'
  }

  // Frames are handled one at a time, in order.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = (fn: () => Promise<unknown>) => (queue = queue.then(fn).catch((e) => log('frame failed:', e)))

  function onFrame(f: Frame) {
    switch (f.t) {
      case 'env':
        serial(async () => {
          const r = await receive(f)
          if (r === 'rejected') log('rejected envelope', f.id)
          conn.send({ t: 'ack', id: f.id })
        })
        break
      case 'presence':
        serial(async () => {
          if (!store.user(f.userId)) await refreshContacts().catch(() => {})
          setPresence(f.userId, f.online ? 'online' : 'away')
        })
        break
      case 'contact_added':
        if (f.user?.id) upsertUser(f.user)
        break
      case 'rpc':
        // The gateway: a chat host called /mcp as this person.
        void call(f.method, { ...(f.params || {}), ...(f.via?.harness && !f.params?.harness ? { harness: f.via.harness } : {}) }).then(
          (result) => conn.send({ t: 'rpc_result', id: f.id, result }),
          (e: Error) => conn.send({ t: 'rpc_result', id: f.id, error: e.message, code: (e as RpcError).code }),
        )
        break
      case 'error':
        log('server error:', f.code, f.message || '', f.to || '')
        break
    }
  }

  const conn = createConnection({
    home,
    log,
    onOpen: async () => {
      await serial(async () => {
        cfg = loadConfig(home)
        ensureMe()
        await refreshMyDevices().catch((e) => log('me:', e.message))
        await refreshContacts().catch((e) => log('contacts:', e.message))
        if (me()) setPresence(me()!, 'online')
        await flush()
      })
    },
    onFrame,
    onClose: () => { if (me()) setPresence(me()!, 'away') },
  })

  // ── Assists (the agent's visible life) ────────────────────────────────
  function putAssist(a: Json) {
    store.putAssist(a)
    emit({ type: 'assist', chatId: a.chatId, assist: a })
    return a
  }

  const harnessOf = (p: Json) => (typeof p?.harness === 'string' && p.harness ? p.harness : agent())

  // ── Bridges ───────────────────────────────────────────────────────────
  function bridgesState() {
    const out: Json = {}
    for (const [k, v] of Object.entries(BRIDGES)) out[k] = { ...v }
    for (const n of NETWORKS) out[n] = { ...(out[n] || { name: n }), status: 'unlinked' }
    return out
  }

  // ── RPC methods ───────────────────────────────────────────────────────
  const methods: Record<string, (p: Json) => unknown> = {
    // Everything the sidebar needs to draw itself (sim.js snapshot shape).
    state() {
      const myId = needMe()
      const chats = store.chats()
      const ids = new Set(chats.map((c) => c.id))
      const weekAgo = Date.now() - 7 * 86400_000
      return {
        seq: store.seq(),
        me: myId,
        users: Object.fromEntries(store.users().map((u) => [u.id, u])),
        bridges: bridgesState(),
        harnesses: HARNESSES,
        chats,
        messages: Object.fromEntries(chats.map((c) => [c.id, store.messages(c.id, 200)])),
        assists: Object.fromEntries(store.assists().filter((a) => ids.has(a.chatId) && (a.state === 'ready' || a.startedAt > weekAgo)).map((a) => [a.id, a])),
        insights: {},
        node: { version: VERSION, connected: conn.connected, server: cfg.server, deviceId: cfg.deviceId ?? null },
      }
    },

    // UI events after `since`. `reset` means "too far behind, reload state".
    sync(p) {
      needMe()
      const since = Number(p.since) || 0
      const first = store.firstSeq()
      const events = store.events(since)
      return { seq: store.seq(), events, ...(since > 0 && first > since + 1 ? { reset: true } : {}) }
    },

    // What an agent sees first: chats, unread, pending proposals. Chats the
    // agent can't see show only that they exist.
    inbox() {
      const myId = needMe()
      const chats = store.chats().map((c) => {
        const sees = !!c.sees?.[myId]
        const last = store.messages(c.id, 1)[0]
        const pending = store.assists().filter((a) => a.chatId === c.id && a.state === 'ready').map((a) => ({ id: a.id, label: a.proposal?.label, action: a.proposal?.action }))
        return {
          chat: c.id,
          title: c.title,
          kind: c.kind,
          transport: c.transport,
          unread: c.unread?.[myId] || 0,
          sees,
          ...(sees
            ? { last: last ? { from: store.user(last.from)?.name || last.from, text: last.text || last.attachment?.title || '', ts: last.ts } : null, pending }
            : { note: "You can't see this chat. Its owner hasn't switched it on." }),
        }
      })
      chats.sort((a, b) => b.unread - a.unread)
      return { me: { id: myId, name: store.user(myId)?.name }, chats }
    },

    // Read a chat, if its owner lets the agent see it. The chibi glances at
    // the newest message while it does.
    read(p) {
      const myId = needMe()
      const chat = resolveChat(p.chat)
      if (!chat.sees?.[myId]) throw new RpcError('sees_off', `You can't see "${chat.title}". Its owner can switch it on in the yapping sidebar.`)
      const limit = Math.max(1, Math.min(Number(p.limit) || 30, 200))
      const msgs = store.messages(chat.id, limit)
      const newest = msgs[msgs.length - 1]
      if (newest) {
        const busy = store.assistsFor(newest.id).some((a) => ACTIVE.includes(a.state))
        if (!busy) {
          const a = putAssist({ id: `a_${randomUUID()}`, chatId: chat.id, msgId: newest.id, owner: myId, agents: [{ owner: myId, harness: harnessOf(p) }], state: 'reading', line: 'Reading', log: [], startedAt: Date.now() })
          later(() => {
            const cur = store.assist(a.id)
            if (cur?.state === 'reading') putAssist({ ...cur, state: 'done', line: 'Read it' })
          }, readingMs)
        }
      }
      const name = (id: string) => store.user(id)?.name || id
      return {
        chat: { id: chat.id, title: chat.title, kind: chat.kind, transport: chat.transport, members: chat.members.map(name) },
        messages: msgs.map((m) => ({
          id: m.id,
          from: m.from === myId ? `${name(m.from)} (you)` : name(m.from),
          text: m.text,
          ts: m.ts,
          time: new Date(m.ts).toISOString(),
          ...(m.attachment ? { attachment: m.attachment } : {}),
          ...(m.replyTo ? { replyTo: m.replyTo } : {}),
          ...(Object.keys(m.reactions || {}).length ? { reactions: m.reactions } : {}),
          ...(m.assistedBy ? { assistedBy: m.assistedBy } : {}),
        })),
      }
    },

    // The owner's own words, over our network or the chat's bridge.
    async send(p) {
      const chat = resolveChat(p.chat, true)
      const text = String(p.text ?? '').slice(0, 4000)
      if (!text.trim()) throw new RpcError('bad_request', 'Nothing to send.')
      if (chat.transport !== 'yap') {
        const b = bridges.get(chat.transport)
        if (!b) throw new RpcError('not_set_up', notSetUp(chat.transport).message)
        await b.send(chat.id, text, { replyTo: p.replyTo })
      }
      const ev = originate(chat, { kind: 'message', text, ...(p.replyTo ? { replyTo: String(p.replyTo) } : {}) })
      markRead(chat, false)
      return { ok: true, message: store.message(ev.id) }
    },

    // The agent holds something ready for its owner: an assist in `ready`.
    propose(p) {
      const myId = needMe()
      const chat = resolveChat(p.chat)
      if (!chat.sees?.[myId]) throw new RpcError('sees_off', `You can't see "${chat.title}", so you can't propose anything there.`)
      const payload = p.payload || {}
      if (!PAYLOAD_KINDS.includes(payload.kind)) throw new RpcError('bad_request', `payload.kind must be one of ${PAYLOAD_KINDS.join(', ')}.`)
      if (payload.kind === 'text' ? !String(payload.text || '').trim() : !payload.title) throw new RpcError('bad_request', payload.kind === 'text' ? 'payload.text is required.' : 'payload.title is required.')
      if (!p.label) throw new RpcError('bad_request', 'label is required: one line the owner reads, like "Send Finn the demo link?"')
      const msgId = p.msgId ? String(p.msgId) : store.messages(chat.id, 1)[0]?.id
      if (p.msgId && store.message(msgId!)?.chatId !== chat.id) throw new RpcError('bad_request', 'msgId is not in that chat.')
      const proposal = { label: String(p.label), ...(p.detail ? { detail: String(p.detail) } : {}), action: String(p.action || 'Send'), payload }
      const a = putAssist({ id: `a_${randomUUID()}`, chatId: chat.id, msgId: msgId ?? null, owner: myId, agents: [{ owner: myId, harness: harnessOf(p) }], state: 'ready', line: proposal.label, proposal, log: [], startedAt: Date.now() })
      return { id: a.id, state: a.state }
    },

    // The owner said yes: the payload goes out as their message.
    approve(p) {
      const myId = needMe()
      const a = store.assist(String(p.id ?? p.assistId ?? ''))
      if (!a || a.owner !== myId || a.state !== 'ready') throw new RpcError('not_ready', 'Nothing to approve there.')
      const chat = store.chat(a.chatId)
      if (!chat) throw new RpcError('no_chat', 'That chat is gone.')
      const pl = a.proposal.payload
      const body: Partial<WireEvent> =
        pl.kind === 'text'
          ? { text: String(pl.text) }
          : { text: '', attachment: { type: pl.kind, title: String(pl.title), ...(pl.subtitle ? { subtitle: String(pl.subtitle) } : {}), ...(pl.url ? { url: String(pl.url) } : {}), ...(pl.when ? { when: pl.when } : {}) } }
      if (chat.transport !== 'yap' && !bridges.get(chat.transport)) throw new RpcError('not_set_up', notSetUp(chat.transport).message)
      const ev = originate(chat, { kind: 'message', ...body, assistedBy: a.agents?.[0]?.harness || agent() })
      putAssist({ ...a, state: 'done', line: 'Sent', proposal: undefined, sentMsgId: ev.id })
      return { ok: true, message: store.message(ev.id) }
    },

    dismiss(p) {
      const a = store.assist(String(p.id ?? p.assistId ?? ''))
      if (!a || a.owner !== needMe()) throw new RpcError('no_assist', 'No such proposal.')
      putAssist({ ...a, state: 'dismissed', line: 'Left it', proposal: undefined })
      return { ok: true }
    },

    // Whether this person's agent may see a chat. Private to this person.
    set_sees(p) {
      const myId = needMe()
      const chat = resolveChat(p.chat)
      chat.sees = { ...chat.sees, [myId]: !!p.on }
      saveChat(chat)
      return { ok: true, sees: !!p.on }
    },

    react(p) {
      const myId = needMe()
      const chat = resolveChat(p.chat)
      const m = store.message(String(p.msgId))
      if (!m || m.chatId !== chat.id) throw new RpcError('bad_request', 'No such message in that chat.')
      const emoji = String(p.emoji || '')
      if (!emoji) throw new RpcError('bad_request', 'Which emoji?')
      const off = (m.reactions[emoji] || []).includes(myId)
      originate(chat, { kind: 'reaction', msgId: m.id, emoji, ...(off ? { off: true } : {}) })
      return { ok: true, on: !off }
    },

    mark_read(p) {
      markRead(resolveChat(p.chat), true)
      return { ok: true }
    },

    // Typing dots for the others. Dropped when offline: stale dots help nobody.
    typing(p) {
      const chat = resolveChat(p.chat)
      if (chat.transport === 'yap' && conn.connected) enqueue({ v: 0, kind: 'typing', chat: chatRef(chat), id: randomUUID(), from: needMe(), ts: Date.now() })
      return { ok: true }
    },

    // A new group (or a DM, with one other member).
    create_chat(p) {
      const myId = needMe()
      const members = [...new Set([myId, ...((p.members as string[]) || []).map(String)])]
      if (members.length < 2) throw new RpcError('bad_request', 'Who with? Pass `members`.')
      if (members.length === 2 && !p.title) return { chat: resolveChat(members.find((x) => x !== myId), true) }
      const chat = newChat({ id: randomUUID(), kind: 'group', members, title: String(p.title || 'Group') })
      saveChat(chat, Date.now())
      return { chat }
    },

    async contacts() {
      if (cfg.deviceToken) await refreshContacts().catch(() => {})
      const myId = needMe()
      return store.users().filter((u) => u.id !== myId)
    },

    async invite() {
      needMe()
      return api().invite()
    },

    async bridge(p) {
      const network = String(p.network || 'whatsapp')
      const b = bridges.get(network as any)
      const op = String(p.op || 'status')
      if (!b) {
        if (op === 'status') return { network, status: 'unlinked', ...notSetUp(network) }
        throw new RpcError('not_set_up', notSetUp(network).message)
      }
      if (op === 'status') return b.status()
      if (op === 'link') return b.link()
      if (op === 'unlink') return b.unlink().then(() => ({ ok: true }))
      throw new RpcError('bad_request', 'op must be status, link or unlink.')
    },

    // For `yap status`.
    status() {
      return { version: VERSION, signedIn: !!me(), user: cfg.user ?? null, deviceId: cfg.deviceId ?? null, server: cfg.server, connected: conn.connected, seq: store.seq(), outbox: store.outbox().length }
    },
  }

  function markRead(chat: Json, tell: boolean) {
    const myId = needMe()
    const had = chat.unread?.[myId] || 0
    if (had) {
      chat.unread = { ...chat.unread, [myId]: 0 }
      saveChat(chat)
    }
    // Tell our other devices (and the others, as a read receipt).
    if (tell && chat.transport === 'yap') {
      const last = store.messages(chat.id, 1)[0]
      enqueue({ v: 0, kind: 'read', chat: chatRef(chat), id: randomUUID(), from: myId, ts: Date.now(), ...(last ? { msgId: last.id } : {}) })
    }
  }

  // One way in for every caller. `yap_inbox` and `inbox` are the same thing.
  async function call(method: string, params: Json = {}): Promise<unknown> {
    const name = String(method || '').replace(/^yap_/, '')
    const fn = Object.hasOwn(methods, name) ? methods[name] : undefined
    if (!fn) throw new RpcError('unknown_method', `Unknown method "${method}".`)
    return await fn(params || {})
  }

  ensureMe()
  conn.start()

  return {
    call,
    methods: Object.keys(methods),
    store,
    keys,
    get config() { return cfg },
    get connected() { return conn.connected },
    // Re-read config.json (after `yap login`) and reconnect.
    reload() { cfg = loadConfig(home); ensureMe(); conn.kick() },
    flush,
    subscribe(fn: (ev: Json) => void) { listeners.add(fn); return () => listeners.delete(fn) },
    async stop() {
      stopped = true
      conn.stop()
      for (const t of timers) clearTimeout(t)
      await queue.catch(() => {})
      store.close()
    },
  }
}

export type YapNode = Awaited<ReturnType<typeof startNode>>
