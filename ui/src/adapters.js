// One adapter interface, three backends.
//
//   const yap = await connect()
//   yap.kind                       'mcp-app' | 'local' | 'demo'
//   yap.state                      normalised snapshot (see store.js)
//   yap.subscribe((state, ev) => …) → unsubscribe
//   yap.call(method, params)       node RPC: send, react, mark_read, set_sees,
//                                  approve, dismiss, bridge, typing, …
//   yap.host                       { agent, theme, displayMode, availableDisplayModes,
//                                    containerDimensions, styles, platform }
//   yap.onHost(fn)                 host context changed
//   yap.requestDisplayMode(mode)   → the mode the host actually set, or null
//   yap.supports(feature)          'typing' | 'fullscreen'
//
// Pick: inside an MCP host → mcp-app; window.__YAP__ → local; else demo.
//
// connect({ onWaiting }) keeps retrying the first load while yapping is
// signed out or unreachable, calling onWaiting(err, { openLink }) each time,
// so a sign-in finishing elsewhere just makes the sidebar appear.
import { createStore, unwrap } from './store.js'

const params = new URLSearchParams(location.search)

// The host names the agent: Claude, ChatGPT, Codex.
export function agentFrom(name = '') {
  const n = String(name).toLowerCase()
  if (/codex/.test(n)) return 'codex'
  if (/chatgpt|openai/.test(n)) return 'chatgpt'
  if (/claude|anthropic/.test(n)) return 'claude'
  if (/opencode/.test(n)) return 'opencode'
  if (/\bpi\b/.test(n)) return 'pi'
  return null
}

// Signed out, or the node can't be reached right now: worth waiting for.
export function waitable(e) {
  return ['not_signed_in', 'offline', 'starting'].includes(e?.code) || /not signed in|offline|asleep|didn.t answer|can.t reach/i.test(String(e?.message || ''))
}
async function firstLoad(load, onWaiting, extra = {}) {
  for (;;) {
    try {
      return await load()
    } catch (e) {
      if (!onWaiting || !waitable(e)) throw e
      onWaiting(e, extra)
      await new Promise((r) => setTimeout(r, e.code === 'not_signed_in' ? 2500 : 4000))
    }
  }
}

function base(kind, store, extra = {}) {
  const hostSubs = new Set()
  const api = {
    kind,
    get state() { return store.state },
    subscribe: store.subscribe,
    host: { agent: 'claude', theme: undefined, displayMode: undefined, availableDisplayModes: [] },
    onHost(fn) { hostSubs.add(fn); return () => hostSubs.delete(fn) },
    setHost(patch) { Object.assign(api.host, patch); for (const fn of hostSubs) fn(api.host) },
    async requestDisplayMode() { return null },
    supports: () => false,
    ...extra,
  }
  return api
}

// ───────────────────────── demo: shared/sim.js in the page ─────────────────────────
export async function connectDemo({ onWaiting } = {}) {
  const { createSim } = await import('../../shared/sim.js')
  const store = createStore()
  const agent = agentFrom(params.get('agent')) || 'claude'
  const user = params.get('user') || 'luqmaan'
  const sim = createSim({ speed: Number(params.get('speed')) || 1 })
  sim.connect(user, agent === 'chatgpt' ? 'codex' : agent)

  // ?signedout=1 / ?offline=1: the waiting screens (signs in after ?in= seconds).
  const waitFor = params.get('signedout') ? 'not_signed_in' : params.get('offline') ? 'offline' : null
  if (waitFor) {
    const until = Date.now() + (Number(params.get('in')) || 3600) * 1000
    await firstLoad(async () => {
      if (Date.now() < until) {
        unwrap({ error: waitFor === 'offline'
          ? { code: 'offline', message: "Can't reach yapping on this Mac." }
          : { code: 'not_signed_in', message: 'Not signed in yet — open https://yap.luqmaan.dev/link?code=WXYZ-1234 to link this Mac to yapping.', data: { url: 'https://yap.luqmaan.dev/link?code=WXYZ-1234', userCode: 'WXYZ-1234' } } })
      }
    }, onWaiting)
  }

  // ?fresh=1: a new account. Contacts exist, no chats yet; a DM appears once
  // you start one (create_chat), like on a real node.
  const fresh = params.get('fresh') === '1'
  const shown = new Set()
  const snap = () => {
    const s = sim.snapshot(user)
    if (!fresh) return s
    const chats = s.chats.filter((c) => shown.has(c.id))
    const ids = new Set(chats.map((c) => c.id))
    const keep = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => ids.has(v?.chatId ?? k)))
    return { ...s, chats, messages: keep(s.messages), assists: keep(s.assists) }
  }
  store.set(snap())
  sim.on((ev) => {
    if (!sim.since(user, ev.seq - 1).some((x) => x.seq === ev.seq)) return
    if (fresh && ev.chatId && !shown.has(ev.chatId)) return
    store.apply(JSON.parse(JSON.stringify(ev)))
  })
  // DMs with people the sim has no chat with yet: kept here.
  const extra = {}
  function dmWith(other) {
    const s = sim.snapshot(user)
    let c = extra[other] || (fresh ? null : s.chats.find((x) => x.kind === 'dm' && x.transport === 'yap' && x.members.includes(other)))
    if (!c) {
      const u = s.users[other]
      if (!u || u.bridge) unwrap({ error: { code: 'bad_request', message: 'No such person.' } })
      c = extra[other] = { id: `new-dm-${other}`, kind: 'dm', title: u.name, transport: 'yap', members: [user, other], sees: { [user]: false }, unread: {} }
    }
    if (!shown.has(c.id)) {
      shown.add(c.id)
      store.apply({ type: 'chat_update', chatId: c.id, chat: JSON.parse(JSON.stringify(c)) })
      for (const m of s.messages[c.id] || []) store.apply({ type: 'message', chatId: c.id, message: { ...m } })
    }
    return c
  }
  const sendExtra = (c, p) => {
    const message = { id: `m-${Math.random().toString(36).slice(2)}`, chatId: c.id, from: user, kind: 'text', text: p.text, ts: Date.now(), reactions: {}, ...(p.replyTo ? { replyTo: p.replyTo } : {}) }
    store.apply({ type: 'message', chatId: c.id, message })
    return { ok: true, message }
  }
  if (params.get('ambient') !== '0' && !params.get('demo')) setInterval(() => sim.ambient(), 45000)

  // A pretend WhatsApp bridge: hands out a QR, then links a while later.
  const bridges = { whatsapp: { status: 'unlinked' }, slack: { status: 'unlinked' } }
  const bridgeEv = (network, patch) => {
    Object.assign(bridges[network], patch)
    store.apply({ type: 'bridge', network, ...bridges[network] })
  }
  const chatOf = (id) => sim.snapshot(user).assists[id]?.chatId
  const ok = (r) => unwrap(r && r.error ? { error: r.error } : { result: r })

  async function call(method, p = {}) {
    await new Promise((r) => setTimeout(r, 0))
    switch (method) {
      case 'state': return snap()
      case 'sync': return { seq: sim.seq, events: sim.since(user, p.since || 0).filter((e) => !fresh || !e.chatId || shown.has(e.chatId)) }
      case 'create_chat': {
        const others = (p.members || []).filter((x) => x !== user)
        if (others.length !== 1) unwrap({ error: { code: 'not_supported', message: 'The demo only does one-to-one chats.' } })
        return { chat: JSON.parse(JSON.stringify(dmWith(others[0]))) }
      }
      case 'contacts': return Object.values(sim.snapshot(user).users).filter((u) => u.id !== user)
      case 'invite': return { code: 'demo', url: 'https://yap.luqmaan.dev/i/demo' }
      case 'send': {
        // A chat id, or a person's id (the node starts the DM then).
        const ex = Object.values(extra).find((x) => x.id === p.chat)
        if (ex) return sendExtra(ex, p)
        if (sim.snapshot(user).users[p.chat]) {
          const c = dmWith(p.chat)
          if (extra[p.chat]) return sendExtra(c, p)
          p = { ...p, chat: c.id }
        }
        return ok(sim.handle(user, { t: 'send', chatId: p.chat, text: p.text, replyTo: p.replyTo, client: agent }))
      }
      case 'react': return ok(sim.handle(user, { t: 'react', chatId: p.chat, msgId: p.msgId, emoji: p.emoji }))
      case 'mark_read': return ok(sim.handle(user, { t: 'read', chatId: p.chat }))
      case 'typing': return ok(sim.handle(user, { t: 'typing', chatId: p.chat }))
      case 'set_sees': return ok(sim.handle(user, { t: 'set_sees', chatId: p.chat, on: p.on }))
      case 'approve': return ok(sim.handle(user, { t: 'approve', chatId: chatOf(p.id), assistId: p.id }))
      case 'dismiss': return ok(sim.handle(user, { t: 'dismiss', chatId: chatOf(p.id), assistId: p.id }))
      case 'bridge': {
        const net = p.network || 'whatsapp'
        if (p.op === 'status') return { network: net, ...bridges[net] }
        if (p.op === 'unlink') { bridgeEv(net, { status: 'unlinked', account: undefined }); return { ok: true } }
        if (p.op === 'link') {
          if (net !== 'whatsapp' || params.get('bridge') === 'none') unwrap({ error: { code: 'not_set_up', message: `${net === 'slack' ? 'Slack' : 'WhatsApp'} linking isn't set up on this Mac yet.` } })
          bridgeEv(net, { status: 'linking' })
          if (params.get('bridge') !== 'wait') setTimeout(() => bridgeEv(net, { status: 'linked', account: '+44 7700 900456' }), 20000)
          return { qr: `2@demo${Math.random().toString(36).slice(2)}Yh3uVQ1+kq9pCw==,dXJvYmF0YQ8xUW1F0TzXk5w4cAg=,Rk3k1x0B2s9aWZp0Hk2Yj4lM5n8=,v1`, expiresAt: Date.now() + 60000 }
        }
        return bridges
      }
      default: unwrap({ error: { code: 'unknown_method', message: `Unknown method ${method}` } })
    }
  }
  const api = base('demo', store, { call, sim, supports: (f) => f === 'typing' })
  api.host.agent = agent
  return api
}

// ───────────────────────── local: the node on this Mac ─────────────────────────
export async function connectLocal(cfg, { onWaiting } = {}) {
  const store = createStore()
  const root = cfg.base || ''
  const headers = { 'content-type': 'application/json', 'x-yap-token': cfg.token || '' }
  async function call(method, p = {}) {
    let res
    try {
      res = await fetch(`${root}/rpc`, { method: 'POST', headers, body: JSON.stringify({ method, params: p }) })
    } catch {
      unwrap({ error: { code: 'offline', message: "Can't reach yapping on this Mac." } })
    }
    const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
    return unwrap(res.ok ? body : { error: body?.error || { message: `HTTP ${res.status}` } })
  }
  store.set(await firstLoad(() => call('state'), onWaiting))

  let syncing = false
  async function catchUp() {
    if (syncing) return
    syncing = true
    try {
      const r = await call('sync', { since: store.state.seq })
      if (r.reset || r.state) store.set(r.state || (await call('state')))
      else for (const ev of r.events || []) store.apply(ev)
    } catch {}
    syncing = false
  }
  function listen() {
    const es = new EventSource(`${root}/events?token=${encodeURIComponent(cfg.token || '')}`)
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        if (ev.seq && ev.seq > store.state.seq + 1) catchUp()
        else store.apply(ev)
      } catch {}
    }
    es.onopen = () => catchUp()
    return es
  }
  listen()
  const api = base('local', store, { call, supports: (f) => f === 'typing' })
  api.host.agent = agentFrom(cfg.agent) || 'claude'
  return api
}

// ───────────────────────── mcp-app: inside claude.ai, ChatGPT, Codex ─────────────────────────
export async function connectMcp({ timeout = 2500, onWaiting } = {}) {
  const { App, applyHostStyleVariables, applyHostFonts } = await import('@modelcontextprotocol/ext-apps')
  const store = createStore()
  const app = new App({ name: 'yapping', version: '0.1.0' }, {}, { autoResize: true })
  let api
  const applyCtx = (ctx = {}) => {
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
    const patch = {}
    for (const k of ['theme', 'displayMode', 'availableDisplayModes', 'containerDimensions', 'platform', 'styles', 'safeAreaInsets', 'deviceCapabilities']) if (k in ctx) patch[k] = ctx[k]
    if (ctx.styles?.variables) patch.hostVars = true
    api?.setHost(patch)
  }
  app.onhostcontextchanged = (ctx) => applyCtx(ctx)
  app.ontoolresult = () => {} // the tool that mounted us (yap_inbox); we load our own snapshot
  app.onteardown = async () => ({})

  await Promise.race([app.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('no host')), timeout))])

  async function call(method, p = {}) {
    const r = await app.callServerTool({ name: `yap_${method === 'send' ? 'send_own' : method}`, arguments: p })
    const text = r?.content?.find?.((c) => c.type === 'text')?.text
    if (r?.isError) unwrap({ error: { message: text || 'Something went wrong', ...(r.structuredContent?.error && typeof r.structuredContent.error === 'object' ? r.structuredContent.error : {}) } })
    let v = r?.structuredContent
    if (v === undefined && text) { try { v = JSON.parse(text) } catch { v = { value: text } } }
    v = unwrap(v)
    if (v && typeof v === 'object' && Object.keys(v).length === 1 && Array.isArray(v.items)) return v.items
    return v
  }

  const first = await firstLoad(() => call('sync', { since: 0 }), onWaiting, { openLink: (url) => app.openLink({ url }) })
  store.set(first.state || first)

  // yap_sync every 2s works on every host. Mutations sync straight away.
  let busy = false
  async function sync() {
    if (busy || !store.state) return
    busy = true
    try {
      const r = await call('sync', { since: store.state.seq })
      if (r.state) store.set(r.state)
      else if (r.reset) store.set((await call('sync', { since: 0 })).state)
      else for (const ev of r.events || []) store.apply(ev)
      if (api.offline) { api.offline = null; store.emit({ type: 'online' }) }
    } catch (e) {
      api.offline = e.message
      store.emit({ type: 'offline', message: e.message })
    }
    busy = false
  }
  setInterval(sync, 2000)

  const hostName = app.getHostVersion?.()?.name || ''
  api = base('mcp-app', store, {
    app,
    call: async (method, p) => {
      if (method === 'typing') return null // not exposed to chat hosts
      const r = await call(method, p)
      if (method !== 'bridge' || p?.op !== 'status') setTimeout(sync, 150)
      return r
    },
    async requestDisplayMode(mode) {
      const ctx = app.getHostContext() || {}
      if (ctx.availableDisplayModes && !ctx.availableDisplayModes.includes(mode)) return null
      try { return (await app.requestDisplayMode({ mode })).mode } catch { return null }
    },
    openLink: (url) => app.openLink({ url }),
    supports: (f) => f === 'fullscreen' && (app.getHostContext()?.availableDisplayModes || []).includes('fullscreen'),
  })
  api.host.agent = agentFrom(params.get('agent')) || agentFrom(hostName) || agentFrom(app.getHostContext()?.userAgent) || 'claude'
  api.host.hostName = hostName
  applyCtx(app.getHostContext() || {})
  return api
}

// ───────────────────────── pick ─────────────────────────
export async function connect(opts = {}) {
  const force = params.get('adapter') || window.__YAP_ADAPTER__
  if (force === 'demo') return connectDemo(opts)
  if (force === 'local' || (!force && window.__YAP__)) return connectLocal(window.__YAP__ || {}, opts)
  if (force === 'mcp-app' || (!force && window.parent !== window)) {
    try {
      return await connectMcp(opts)
    } catch (e) {
      if (force === 'mcp-app') throw e
      console.warn('[yapping] no MCP host answered, using the demo', e)
    }
  }
  return connectDemo(opts)
}
