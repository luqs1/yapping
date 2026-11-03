// yapping × pi — a Discord-shaped chat, drawn in cells as a pi extension.
// People text people. pi (this harness's agent) only ever shows up as a
// tiny chibi of its mark, hanging under the message it is dealing with.

import { connect, helpers as H } from '../../shared/yap-client.js'

const P = new URLSearchParams(location.search)
const $ = (id) => document.getElementById(id)
const put = (id, html) => { const el = $(id); if (el && el._html !== html) { el._html = html; el.innerHTML = html } }
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches

const yap = await connect({ user: 'luqmaan', client: 'pi' })
let S = null
const MINE = 'pi' // this mockup runs inside pi: my agent is pi, whatever users[me].agent says
const settledAt = {} // assist id -> when it reached done/dismissed

const ui = {
  open: P.get('yap') !== '0',
  server: null,
  chatId: P.get('chat') || 'dm-finn',
  last: {},
  profile: null,
  observe: P.get('observe') === '1' ? 'latest' : null,
  members: P.get('members') !== '0',
  sel: null,
  focusAssist: null,
  replyTo: null,
  slash: { open: false, idx: 0 },
  sw: null,
  voice: null,
  toasts: [],
  autoApprove: P.get('approve') === '1',
}

const HNAME = { claude: 'Claude Code', opencode: 'opencode', pi: 'pi', codex: 'Codex', mobile: 'yapping mobile' }
const SERVERS = [
  { id: 'home', name: 'Direct Messages', tip: 'Direct Messages' },
  { id: 'fall26', name: 'fall26', tip: 'fall26 · EF cohort', ic: 'f26', col: '#F47B67' },
]
const QUICK = ['😂', '👍', '🔥', '❤️']
const CMDS = [
  { c: 'shrug', arg: 'message', d: 'Appends ¯\\_(ツ)_/¯ to your message.' },
  { c: 'me', arg: 'action', d: 'Sends your message as an action, in italics.' },
  { c: 'invite', arg: '', d: 'Invite this person to yapping (bridged chats only).' },
  { c: 'pi', arg: 'on|off', d: 'Let pi see this chat, or not.' },
]
const HUDDLE = ['finn', 'maya']

// ── helpers ─────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const EMO = /(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)/gu
const emo = (s) => esc(s).replace(EMO, '<i class="e">$1</i>')
const fmt = (s) => emo(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^\*(.+)\*$/, '<em>$1</em>')
const U = (id) => S.users[id] || { id, name: id, color: '#949ba4' }
const me = () => S.me
const chatById = (id) => S.chats.find((c) => c.id === id)
const msgsOf = (id) => S.messages[id] || []
const unreadOf = (c) => c?.unread?.[me()] || 0
const isBridged = (c) => c && c.transport !== 'yap'
const canSee = (c) => H.canSee(S, c)
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 }
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const m = (x) => Math.max(0, Math.min(255, Math.round(x * (1 + f)))); return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})` }
const phase = (ms) => `animation-delay:-${Date.now() % ms}ms`
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
function stamp(ts) {
  const t = H.time(ts)
  if (sameDay(ts, Date.now())) return `Today at ${t}`
  if (sameDay(ts, Date.now() - 86400000)) return `Yesterday at ${t}`
  return `${new Date(ts).toLocaleDateString('en-GB')} ${t}`
}
const dayLabel = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const statusOf = (u) => (u.bridge ? 'bridged' : u.status === 'online' ? 'online' : 'idle')
const STATCOL = { online: '#23a55a', idle: '#f0b232', bridged: '#80848e' }
const statChar = (u) => { const s = statusOf(u); return `<span class="stat" style="color:${STATCOL[s]}">${s === 'idle' ? '◐' : s === 'bridged' ? '○' : '●'}</span>` }
const dot = (u) => statChar(u).replace('class="stat"', 'class="sdot"')
const netName = (t) => S.bridges[t]?.name || t
const agentLabel = (a) => (a.owner === me() ? 'pi' : `${U(a.owner).name}'s ${S.harnesses[a.harness]?.name || 'agent'}`)
const harnessOf = (a) => (a.owner === me() ? MINE : a.harness)

// ── people avatars (cells) ──────────────────────────────────────────
function bigAv(u, stat = true) {
  const c = u.color || '#949ba4', ink = lum(c) > 0.55 ? '#1b1c1f' : '#ffffff'
  return `<span class="av hum"><span class="blk" style="background:${c};color:${ink}">${esc(u.name[0])}</span>${stat ? statChar(u) : ''}</span>`
}
function smallAv(u) {
  const c = u.color, ink = lum(c) > 0.55 ? '#1b1c1f' : '#fff'
  return `<span class="sav"><span style="background:${c}"> </span><span style="background:${c};color:${ink};font-weight:800">${esc(u.name[0])}</span><span style="background:${c}"> </span></span>`
}

// ── the chibi, drawn in cells ───────────────────────────────────────
// 3 columns × 2 rows: eyes on top, the harness's mouth below.
const CHIBI = {
  pi: { bg: '#5B6CF0', eye: '#ffffff', mouth: 'π', mc: '#ffffff' },
  opencode: { bg: '#1A1A1A', eye: '#ffffff', mouth: '▬', mc: '#F5A742', ring: true },
  claude: { bg: '#D97757', eye: '#3D1F12', mouth: '‿', mc: '#3D1F12' },
  codex: { bg: '#10A37F', eye: '#0B3B2E', mouth: '◡', mc: '#0B3B2E', inner: '#E8F7F1' },
}
function cellChibi(harness, state, opts = {}) {
  const k = CHIBI[harness] || CHIBI.pi
  const eyes = state === 'done' ? ['^', '^'] : state === 'sleeping' ? ['-', '-'] : ['•', '•']
  const eyeBg = k.inner || k.bg
  const anim = RM ? '' : state === 'talking' ? 'talk' : state === 'ready' ? 'hop' : state === 'sleeping' ? '' : 'bob'
  const scan = state === 'reading' || state === 'working' || state === 'waiting'
  const extra = state === 'ready' ? '<span class="cx bang">!</span>' : state === 'talking' && !opts.offset ? '<span class="cx talkdots"><i>·</i><i>·</i><i>·</i></span>' : state === 'sleeping' ? '<span class="cx zz">z</span>' : ''
  const delay = anim ? `style="${phase(anim === 'talk' ? 360 : 1400)}${opts.offset ? `;animation-direction:reverse` : ''}"` : ''
  return `<span class="cc ${state} ${k.ring ? 'ring' : ''}" ${opts.act ? `data-act="observe" data-id="${opts.act}"` : ''} title="${esc(opts.title || '')}"><span class="cb ${anim}" ${delay}>` +
    `<span class="cr" style="background:${k.bg}"><span class="eyes ${scan ? 'scan' : ''}" style="background:${eyeBg};color:${k.eye};${scan ? phase(1400) : ''}">${eyes[0]} ${eyes[1]}</span></span>` +
    `<span class="cr" style="background:${k.bg};color:${k.mc}"><span class="mouth">${k.mouth}</span></span>` +
    `</span>${extra}</span>`
}
const miniChibi = (harness, state = 'idle') => { const k = CHIBI[harness] || CHIBI.pi; return `<span class="mc" style="background:${k.bg};color:${k.inner ? k.mc : k.eye}">${state === 'done' ? '^^' : state === 'sleeping' ? '--' : '••'}</span>` }

// ── servers & channels ──────────────────────────────────────────────
function chatsIn(sid) {
  if (sid === 'home') return S.chats.filter((c) => c.kind === 'dm').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (H.lastMessage(S, b.id)?.ts || 0) - (H.lastMessage(S, a.id)?.ts || 0))
  return S.chats.filter((c) => c.kind === 'group')
}
const serverFor = (id) => (chatById(id)?.kind === 'group' ? 'fall26' : 'home')
const chanName = (c) => (c.id === 'grp-cohort' ? 'general' : c.kind === 'dm' ? H.chatTitle(S, c).toLowerCase() : c.title)
const serverUnread = (sid) => chatsIn(sid).reduce((n, c) => n + unreadOf(c), 0)
const pendingIn = (chatId) => H.pending(S, chatId).filter((a) => a.owner === me())

function openChat(id, server) {
  if (!chatById(id)) return
  ui.chatId = id
  ui.server = server || serverFor(id)
  ui.last[ui.server] = id
  ui.sel = null; ui.replyTo = null; ui.profile = null; ui.focusAssist = null
  if (ui.observe !== 'latest') ui.observe = null
  closeSlash()
  if (unreadOf(chatById(id))) yap.send({ t: 'read', chatId: id })
  stick = true
  render()
  $('input')?.focus()
}
function openServer(sid) {
  const list = chatsIn(sid)
  const target = ui.last[sid] && list.some((c) => c.id === ui.last[sid]) ? ui.last[sid] : list[0]?.id
  ui.server = sid
  if (target) openChat(target, sid)
  else render()
}

// ── render ──────────────────────────────────────────────────────────
let stick = true
let raf = 0
const render = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() }) }

function draw() {
  if (!S) return
  document.body.classList.toggle('yap-open', ui.open)
  drawFooter()
  if (!ui.open) { drawPiFull(); return }
  const chat = chatById(ui.chatId) || S.chats[0]
  ui.chatId = chat.id
  drawTitle(); drawRail(); drawSide(chat); drawHeader(chat); drawNotice(chat); drawMsgs(chat); drawComposer(chat); drawRight(chat); drawOverlay(); drawTyping(); drawToasts(); drawExt()
}

function drawTitle() {
  const live = yap.mode === 'live'
  put('ytitle', `<span class="logo">yapping</span><span>  π extension</span><button class="mid sbox" data-act="switcher">⌕ Search yapping                ctrl+k</button><span class="${live ? 'live' : 'off'}">${live ? '● live' : '○ offline'}</span>`)
}

function drawRail() {
  const html = []
  for (const s of SERVERS) {
    const on = ui.server === s.id
    const n = serverUnread(s.id)
    const ic = s.id === 'home'
      ? `<span class="ic"><span>y<b>a</b>p</span></span>`
      : `<span class="ic" style="${on ? `background:${s.col};color:#fff` : `color:${s.col}`}">${s.ic}</span>`
    html.push(`<div class="srv ${s.id === 'home' ? 'home' : ''} ${on ? 'on' : ''} ${n && !on ? 'unread' : ''}" data-act="server" data-id="${s.id}"><span class="pill"></span>${ic}${n ? `<span class="badge">${n}</span>` : ''}<span class="tip">${emo(s.tip)}</span></div>`)
    if (s.id === 'home') html.push('<div class="sepr"></div>')
  }
  html.push('<div class="srv add" data-act="switcher"><span class="ic">⌕</span><span class="tip">Quick switcher · ctrl+k</span></div>')
  put('rail', html.join(''))
}

function assistBadge(chatId) {
  if (!canSee(chatById(chatId))) return ''
  if (pendingIn(chatId).length) return `<span class="abadge ready" title="pi has something for you">π!</span>`
  if (H.busy(S, chatId).some((a) => a.owner === me())) return `<span class="abadge busy" title="pi is on it">π…</span>`
  return ''
}

function drawSide(chat) {
  let head, body = ''
  if (ui.server === 'home') {
    head = `<div class="side-h search"><button data-act="switcher">Find a conversation</button></div>`
    body += `<div class="cat-h">DIRECT MESSAGES<span class="plus">+</span></div>`
    for (const c of chatsIn('home')) {
      const o = H.otherPerson(S, c)
      const n = unreadOf(c)
      const on = c.id === ui.chatId
      const typing = H.isTyping(S, c.id).length
      const sub = typing ? '<span style="color:#dbdee1">typing…</span>' : o.bridge ? `<span class="src">${esc(netName(c.transport))}</span>` : o.harness ? `in ${esc(HNAME[o.harness])}` : esc(o.handle || '')
      body += `<div class="dm ${on ? 'on' : ''} ${n && !on ? 'unread' : ''}" data-act="chat" data-id="${c.id}">${bigAv(o)}<span class="n">${esc(o.name)}${c.pinned ? ' <span class="m" title="pinned">⚲</span>' : ''}</span><span class="end">${assistBadge(c.id)}${n && !on ? `<span class="badge">${n}</span>` : ''}</span><span class="s">${sub}</span></div>`
    }
  } else {
    head = `<div class="side-h">fall26<span class="chev">⌄</span></div>`
    body += `<div class="banner"><div class="bl"></div><div class="bl b">fall26 · EF cohort</div><div class="bl">demo day in 11 days</div><div class="bl"></div></div>`
    body += `<div class="events"><i class="e">📅</i> 1 Event · BoG due Thu</div>`
    body += `<div class="cat-h">⌄ TEXT CHANNELS<span class="plus">+</span></div>`
    for (const c of chatsIn('fall26')) {
      const n = unreadOf(c), on = c.id === ui.chatId
      body += `<div class="ch ${on ? 'on' : ''} ${n && !on ? 'unread' : ''}" data-act="chat" data-id="${c.id}"><span class="hash">#</span><span class="nm">${esc(chanName(c))}</span><span class="end">${assistBadge(c.id)}${n && !on ? `<span class="badge">${n}</span>` : ''}</span></div>`
    }
    body += `<div class="ch locked" title="read-only"><span class="hash">#</span><span class="nm">board-of-goals</span><span class="end m">🔒</span></div>`
    body += `<div class="cat-h">⌄ VOICE CHANNELS</div>`
    const inIt = ui.voice === 'fall26'
    const who = [...HUDDLE, ...(inIt ? [me()] : [])]
    body += `<div class="ch ${inIt ? 'on' : ''}" data-act="voice" data-id="fall26"><span class="hash"><i class="e">🔊</i></span><span class="nm">huddle</span><span class="end m">${who.length}</span></div>`
    body += who.map((id) => `<div class="vmember ${id === me() ? 'me' : ''}">${smallAv(U(id))}<span>${esc(U(id).name)}</span></div>`).join('')
  }
  const live = yap.mode === 'live'
  const meU = U(me())
  const vc = ui.voice ? `<div class="vc"><span class="t">▮▮▮ Voice Connected</span><span class="s">huddle / fall26</span><button data-act="leave" title="Disconnect">✕</button></div>` : ''
  put('side', `${head}<div class="side-b">${body}</div>${vc}<div class="livebar ${live ? 'on' : 'off'}">${live ? '<span class="dot">●</span> LIVE  relay localhost:7788' : '○ OFFLINE  world runs in-page'}</div>
  <div class="me-panel">${bigAv(meU)}<div><div class="n">${esc(meU.name)}</div><div class="s"><span style="color:#7c8cf8">π</span> in pi</div></div><div class="mtools"><span title="mute">◉</span><span title="deafen">◎</span><span title="settings">⚙</span></div></div>`)
}

function seesToggle(chat) {
  const on = canSee(chat)
  return `<button class="sees ${on ? 'on' : ''}" data-act="sees" title="${on ? 'pi reads this chat and may offer to help' : 'pi cannot read this chat'} (alt+s)"><span class="bx">[${on ? 'x' : ' '}]</span> <span class="pi">π</span> ${on ? 'pi can see this chat' : "pi can't see this chat"}</button>`
}

function drawHeader(chat) {
  let h, icons
  if (chat.kind === 'dm') {
    const o = H.otherPerson(S, chat)
    const where = o.bridge ? `via ${esc(netName(chat.transport))}` : `in ${esc(HNAME[o.harness] || 'yapping')}`
    h = `<span class="hash">@</span><span class="t">${esc(o.name)}</span>${dot(o)}<span class="topic">${where} · ${esc(o.handle || '')}</span>`
    icons = `<button title="call">☏</button><button title="pinned"><i class="e">📌</i></button><button data-act="members" class="${ui.members ? 'on' : ''}" title="profile (alt+p)"><i class="e">👤</i></button>`
  } else {
    h = `<span class="hash">#</span><span class="t">${esc(chanName(chat))}</span><span class="divv">│</span><span class="topic">the cohort, the deadlines, the memes</span>`
    icons = `<button title="notifications"><i class="e">🔔</i></button><button title="pinned"><i class="e">📌</i></button><button data-act="members" class="${ui.members ? 'on' : ''}" title="member list (alt+p)"><i class="e">👥</i></button>`
  }
  put('chat-h', `${h}${seesToggle(chat)}<span class="icons">${icons}</span><button class="search" data-act="switcher"><span>Search</span><span>⌕</span></button>`)
}

function drawNotice(chat) {
  put('notice', isBridged(chat)
    ? `<div class="quiet"><span class="src">${esc(netName(chat.transport))}</span><span class="txt">${esc(S.bridges[chat.transport]?.note || '')}</span><button data-act="invite">Invite to yapping</button></div>`
    : '')
}

function welcome(chat) {
  if (chat.kind === 'dm') {
    const o = H.otherPerson(S, chat)
    return `<div class="welcome"><div class="big">${bigAv(o, false)}<div><h1><span class="x2">${esc(o.name)}</span></h1><p>${esc(o.handle || '')}</p></div></div><p style="margin-top:var(--lh)">This is the beginning of your direct message history with <b style="color:#dbdee1">${esc(o.name)}</b>.${isBridged(chat) ? ` Bridged from ${esc(netName(chat.transport))}.` : ''}</p></div>`
  }
  const nm = chanName(chat)
  return `<div class="welcome"><div class="big"><span class="box">╭───╮\n│ # │\n╰───╯</span><div><h1><span class="x2">Welcome to #${esc(nm)}!</span></h1><p>This is the start of the #${esc(nm)} channel. ${chat.members.length} people.</p></div></div></div>`
}

function drawMsgs(chat) {
  const el = $('msgs')
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  const list = msgsOf(chat.id)
  const byId = Object.fromEntries(list.map((m) => [m.id, m]))
  let html = welcome(chat)
  let prev = null, lastTs = 0
  for (const m of list) {
    if (!lastTs || !sameDay(lastTs, m.ts)) { html += `<div class="daysep">${esc(dayLabel(m.ts))}</div>`; prev = null }
    lastTs = m.ts
    if (m.kind === 'system') { html += `<div class="sysline" data-mid="${m.id}"><span>→</span> ${emo(m.text)} <span class="ts">${H.time(m.ts)}</span></div>`; prev = null; continue }
    const a = canSee(chat) ? H.assistFor(S, m.id) : null
    const assistHtml = a && a.owner === me() ? assistRow(a) : ''
    html += msgHTML(m, prev, byId) + reactions(m) + assistHtml + '</div></div>'
    prev = assistHtml ? null : m
  }
  el.innerHTML = html
  if (stick || atBottom) el.scrollTop = el.scrollHeight
  stick = false
  if (ui.sel) el.querySelector(`[data-mid="${ui.sel}"]`)?.scrollIntoView({ block: 'nearest' })
}

function msgHTML(m, prev, byId) {
  const u = U(m.from)
  const ref = m.replyTo && byId[m.replyTo]
  const grouped = prev && !ref && prev.from === m.from && m.ts - prev.ts < 7 * 60000 && m.kind === 'text' && prev.kind === 'text'
  let h = `<div class="msg ${grouped ? '' : 'first'} ${ui.sel === m.id ? 'sel' : ''} ${ref ? 'has-ref' : ''}" data-mid="${m.id}">`
  h += `<div class="tools">${QUICK.map((e, i) => `<button data-act="react" data-id="${m.id}" data-emoji="${e}" title="react (${i + 1})"><i class="e">${e}</i></button>`).join('')}<button data-act="reply" data-id="${m.id}" title="reply (r)">↩</button></div>`
  h += `<div class="gut">${grouped ? `<span class="tm">${H.time(m.ts)}</span>` : bigAv(u)}</div><div class="body">`
  if (ref) { const ru = U(ref.from); h += `<div class="reply-ref" data-act="jump" data-id="${ref.id}"><span class="curve">╭──</span>${smallAv(ru)}<span class="rn" style="color:${ru.color}">${esc(ru.name)}</span><span class="rt">${emo(ref.text || ref.attachment?.title || '')}</span></div>` }
  if (!grouped) h += `<div class="head"><span class="name" style="color:${u.color}" data-act="profile" data-id="${u.id}">${esc(u.name)}</span><span class="ts">${stamp(m.ts)}</span>${m.via && m.via !== 'yap' && m.from !== me() ? `<span class="srcv">${esc(netName(m.via))}</span>` : ''}</div>`
  if (m.kind === 'attachment') h += attachment(m)
  else h += `<div class="text">${fmt(m.text)}</div>`
  return h
}

function attachment(m) {
  const a = m.attachment || {}
  const by = m.assistedBy ? `<div class="sentwith">sent with ${m.from === me() ? 'pi' : esc(S.harnesses[m.assistedBy]?.name || m.assistedBy)}</div>` : ''
  if (a.type === 'file') return `<div class="att"><span class="ficon">▐▀▀▙\n▐▄▄▟</span><div><div class="fn">${esc(a.title)}</div><div class="fs">${esc(a.subtitle || '')}</div></div><span class="dl">⇩</span></div>${by}`
  if (a.type === 'event') return `<div class="embed event"><div class="ti">📅 ${esc(a.title)}</div><div class="ds">${esc(a.subtitle || '')}</div><div class="btns"><button class="btn" data-act="noop">Add to calendar</button></div></div>${by}`
  const host = (a.url || '').replace(/^https?:\/\//, '')
  return `<div class="embed link">${host && !(a.subtitle || '').includes(host) ? `<div class="host">${esc(host)}</div>` : ''}<div class="ti">${esc(a.title)}</div><div class="ds">${esc(a.subtitle || '')}</div></div>${by}`
}

function reactions(m) {
  const r = Object.entries(m.reactions || {}).filter(([, l]) => l.length)
  if (!r.length) return ''
  return `<div class="reacts">${r.map(([e, l]) => `<button class="rx ${l.includes(me()) ? 'mine' : ''}" data-act="react" data-id="${m.id}" data-emoji="${esc(e)}" title="${esc(l.map((id) => U(id).name).join(', '))}"><span class="br">[</span><i class="e">${e}</i> ${l.length}<span class="br">]</span></button>`).join('')}<button class="rx add" data-act="react" data-id="${m.id}" data-emoji="👍"><span class="br">[</span>+☺<span class="br">]</span></button></div>`
}

const SETTLE_MS = 6000
function assistRow(a) {
  const st = a.state
  if (st === 'done' || st === 'dismissed') {
    const age = Date.now() - (settledAt[a.id] || 0)
    if (age > SETTLE_MS) return a.log?.length ? `<div class="assist idle" data-act="observe" data-id="${a.id}" title="what pi did (o)">${miniChibi(MINE, 'done')} <span>${esc(a.line)}</span></div>` : ''
  }
  const chibiState = st === 'dismissed' ? 'done' : st
  const pair = a.agents.length > 1 && st === 'talking'
  const chibis = pair
    ? `${cellChibi(MINE, 'talking', { act: a.id, title: 'pi' })}<span class="link">⇄</span>${cellChibi(a.agents[1].harness, 'talking', { act: a.id, offset: 1, title: agentLabel(a.agents[1]) })}`
    : cellChibi(MINE, chibiState === 'waiting' || chibiState === 'working' ? 'reading' : chibiState, { act: a.id, title: 'pi' })
  const who = pair ? `<b>pi</b> and <b>${esc(agentLabel(a.agents[1]))}</b> are talking` : st === 'reading' ? '<b>pi</b> is reading' : st === 'waiting' ? '<b>pi</b> is waiting' : st === 'working' ? '<b>pi</b> is working' : st === 'ready' ? '<b>pi</b>' : '<b>pi</b>'
  const focus = ui.focusAssist === a.id ? 'focus' : ''
  if (st === 'ready' && a.proposal) {
    return `<div class="assist ready ${focus}">${chibis}<div class="say"><div class="l1">${who} <span class="prop">${esc(a.proposal.label)}</span></div><div class="l2"><span class="det">${esc(a.proposal.detail || '')}</span></div><div class="l2"><button class="kbtn pri" data-act="approve" data-id="${a.id}"><span class="k">[y]</span> ${esc(a.proposal.action || 'Send')}</button><button class="kbtn" data-act="dismiss" data-id="${a.id}"><span class="k">[n]</span> Not now</button><button class="obs" data-act="observe" data-id="${a.id}">o log</button></div></div></div>`
  }
  const dots = ['reading', 'waiting', 'talking', 'working'].includes(st) ? '<span class="dots"><i>.</i><i>.</i><i>.</i></span>' : ''
  const line = st === 'done' || st === 'dismissed' ? `<span class="okline">${st === 'done' ? '<span class="ok">✓</span> ' : ''}${esc(a.line)}</span>` : `${who}${dots} <span class="lbl">${esc(a.line === 'Reading' || pair ? '' : a.line)}</span>`
  return `<div class="assist ${st} ${focus}">${chibis}<div class="say"><div class="l1">${line}</div><div class="l2"><button class="obs" data-act="observe" data-id="${a.id}">o observe${a.log?.length ? ` · ${a.log.length}` : ''}</button></div></div></div>`
}

function drawComposer(chat) {
  const input = $('input')
  input.placeholder = chat.kind === 'dm' ? `Message @${H.chatTitle(S, chat)}${isBridged(chat) ? ` (via ${netName(chat.transport)})` : ''}` : `Message #${chanName(chat)}`
  const r = ui.replyTo && msgsOf(chat.id).find((m) => m.id === ui.replyTo)
  put('replybar', r ? `<div class="replybar">Replying to&nbsp;<b style="color:${U(r.from).color}">${esc(U(r.from).name)}</b><button data-act="unreply">✕</button></div>` : '')
  $('slash').innerHTML = ui.slash.open ? slashHTML() : ''
}
function slashMatches() {
  const q = $('input').value.slice(1).split(' ')[0].toLowerCase()
  return CMDS.filter((c) => c.c.startsWith(q))
}
function slashHTML() {
  const list = slashMatches()
  if (!list.length) return ''
  ui.slash.idx = Math.min(ui.slash.idx, list.length - 1)
  const q = $('input').value.split(' ')[0]
  return `<div class="slash"><div class="sh">COMMANDS MATCHING ${esc(q.toUpperCase())}<span class="r">↑↓ select · tab complete · enter run · esc</span></div>${list.map((c, i) => `<div class="row ${i === ui.slash.idx ? 'on' : ''}" data-act="cmd" data-i="${i}"><span class="slg">/</span><span class="c">/${c.c} ${c.arg ? `<i>${c.arg}</i>` : ''}</span><span class="d">${esc(c.d)}</span><span class="src">built-in</span></div>`).join('')}</div>`
}

function drawTyping() {
  const el = $('typing')
  if (!el || !S) return
  if (ui.sel) { el.innerHTML = '<span style="color:#949ba4">↑↓ move · 1-4 react · r reply · p profile · o observe pi · esc done</span>'; return }
  if (ui.focusAssist) { el.innerHTML = '<span style="color:#949ba4">y send · n not now · o observe · tab next · esc back to message box</span>'; return }
  const who = H.isTyping(S, ui.chatId).map((id) => U(id).name)
  const pend = pendingIn(ui.chatId).length
  el.innerHTML = who.length ? `<span class="dots"><i>•</i><i>•</i><i>•</i></span><b>${esc(who.join(', '))}</b> ${who.length > 1 ? 'are' : 'is'} typing…` : pend ? '<span style="color:#949ba4"><span style="color:#7c8cf8">π</span> has something for you · <b style="color:#dbdee1">tab</b> to review</span>' : ''
}

function drawRight(chat) {
  $('app').classList.toggle('nomembers', !ui.members)
  if (!ui.members) { put('right', ''); return }
  if (chat.kind === 'dm') { put('right', profileHTML(H.otherPerson(S, chat).id, chat)); return }
  const row = (id) => {
    const u = U(id)
    return `<div class="mem ${statusOf(u) === 'online' ? '' : 'idle'}" data-act="profile" data-id="${id}">${bigAv(u)}<span class="n" style="color:${u.color}">${esc(u.name)}${id === me() ? ' <span class="m">(you)</span>' : ''}</span><span class="s">${u.bridge ? `on ${esc(netName(u.bridge))}` : `Playing <b>${esc(HNAME[u.harness] || 'yapping')}</b>`}</span></div>`
  }
  const online = chat.members.filter((id) => statusOf(U(id)) === 'online'), away = chat.members.filter((id) => statusOf(U(id)) !== 'online')
  put('right', `<div class="members"><div class="cat-h">ONLINE — ${online.length}</div>${online.map(row).join('')}<div class="cat-h">AWAY — ${away.length}</div>${away.map(row).join('')}</div>`)
}

function warmBar(w) {
  const N = 18, whole = Math.round(w * N)
  return `<div class="warm"><span class="fill">${'█'.repeat(whole)}</span><span class="rest">${'░'.repeat(N - whole)}</span> <span class="pct">${Math.round(w * 100)}%</span></div>`
}
let freshFact = null
function profileHTML(uid, chat) {
  const u = U(uid)
  const dm = chat?.kind === 'dm' ? chat : S.chats.find((c) => c.kind === 'dm' && c.members.includes(uid))
  let sects = ''
  if (!u.bridge && u.harness) sects += `<div class="sect"><div class="sl">PLAYING</div><div class="activity-card"><span class="big">${esc((S.harnesses[u.harness]?.name || '?')[0])}</span><div><div class="a1">${esc(HNAME[u.harness])}</div><div class="a2">${u.status === 'online' ? 'online now' : 'idle · last seen recently'}</div></div></div></div>`
  if (u.bridge) sects += `<div class="sect"><div class="sl">ON</div><div class="about">${esc(netName(u.bridge))} · bridged</div></div>`
  if (uid !== me() && dm) {
    const ins = S.insights[dm.id]
    if (canSee(dm) && ins) {
      const nf = freshFact && freshFact.chatId === dm.id && Date.now() - freshFact.at < 4000 ? freshFact.text : null
      sects += `<div class="sect knows"><div class="sl"><span class="pi">π</span> WHAT PI KNOWS ABOUT YOU TWO</div><div class="about">${emo(ins.relation)}</div><div class="roles">${ins.vibe.map((v, i) => `<span class="role"><i style="color:${['#5865f2', '#23a55a', '#f0b232', '#eb459e'][i % 4]}">●</i> ${emo(v)}</span>`).join('')}</div><ul class="notes">${ins.facts.map((f) => `<li class="${nf === f ? 'new' : ''}">${emo(f)}</li>`).join('')}</ul><div class="sl" style="margin-top:calc(var(--lh)*.5)">WARMTH</div>${warmBar(ins.warmth)}</div>`
    } else if (!canSee(dm)) {
      sects += `<div class="sect knows off"><div class="sl">${miniChibi(MINE, 'sleeping')} PI CAN'T SEE THIS CHAT</div><div class="about m">Nothing is read, nothing is learned.</div><button class="lnk" data-act="sees" data-id="${dm.id}">Let pi see it</button></div>`
    }
  }
  sects += `<div class="sect"><div class="sl">MEMBER SINCE</div><div class="about">${u.bridge ? `bridged · ${esc(netName(u.bridge))}` : 'yapping · Fall26 cohort'}</div></div>`
  return `<div class="profile"><div class="bn" style="background:linear-gradient(120deg, ${u.color}, ${shade(u.color, -0.45)})"></div><span class="pav">${bigAv(u)}</span><div class="inner"><div class="pname">${esc(u.name)}</div><div class="phandle">${esc(u.handle || '')}</div>${sects}</div></div>`
}

function latestAssist() {
  const mine = Object.values(S.assists).filter((a) => a.owner === me())
  const here = mine.filter((a) => a.chatId === ui.chatId)
  return (here.length ? here : mine).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0]
}
function observeHTML() {
  const a = ui.observe === 'latest' ? latestAssist() : S.assists[ui.observe]
  if (!a) return ''
  const chat = chatById(a.chatId)
  const msg = msgsOf(a.chatId).find((m) => m.id === a.msgId)
  const peer = a.agents[1]
  const rows = (a.log || []).map((l) => {
    const mine = l.who === 'mine'
    const name = mine ? 'pi' : peer ? agentLabel(peer) : 'them'
    const col = mine ? '#7c8cf8' : peer?.harness === 'opencode' ? '#F5A742' : '#dbdee1'
    return `<div class="ob"><span class="t">${H.time(l.at)}</span>${miniChibi(mine ? MINE : peer?.harness || 'pi')}<span class="w" style="color:${col}">${esc(name)}</span><span class="x">${emo(l.text)}</span></div>`
  }).join('')
  const stLine = a.state === 'ready' ? `ready · ${esc(a.proposal?.label || a.line)}` : `${esc(a.state)} · ${esc(a.line)}`
  return `<div class="observe ${ui.members ? "" : "wide"}" data-pop="1"><div class="otop"><span>─ </span><span class="pi">π</span> observe <span class="m">· ${esc(H.chatTitle(S, chat))}</span><span class="fill"></span><button data-act="closeobs">esc ✕</button></div>
  <div class="obody"><div class="quote">${msg ? `<span class="m">on</span> ${smallAv(U(msg.from))} <b style="color:${U(msg.from).color}">${esc(U(msg.from).name)}</b> <span class="q">${emo(msg.text || msg.attachment?.title || '')}</span>` : ''}</div>
  <div class="chibis">${cellChibi(MINE, a.state === 'dismissed' ? 'done' : a.state)}${peer ? `<span class="link">⇄</span>${cellChibi(peer.harness, a.state === 'talking' ? 'talking' : 'idle', { offset: 1 })}` : ''}<div class="st"><div>${stLine}</div><div class="m">${peer ? `pi ⇄ ${esc(agentLabel(peer))}` : 'pi alone (no agent on the other side)'}</div></div></div>
  <div class="log">${rows || '<div class="m">Nothing said yet. pi only looked.</div>'}</div>
  ${a.state === 'ready' ? `<div class="btns"><button class="kbtn pri" data-act="approve" data-id="${a.id}"><span class="k">[y]</span> ${esc(a.proposal?.action || 'Send')}</button><button class="kbtn" data-act="dismiss" data-id="${a.id}"><span class="k">[n]</span> Not now</button></div>` : ''}
  <div class="ofoot m">Only you see this. Agent talk never lands in the chat.</div></div></div>`
}

function drawOverlay() {
  let html = ''
  if (ui.profile) html += `<div class="popout" style="${ui.profile.style}" data-pop="1">${profileHTML(ui.profile.id, null)}</div>`
  if (ui.observe) html += observeHTML()
  if (ui.sw) {
    const res = switcherResults()
    ui.sw.idx = Math.min(ui.sw.idx, Math.max(0, res.length - 1))
    html += `<div class="scrim" data-act="closesw"><div class="switcher" data-pop="1"><div class="sh">Where would you like to go?</div><input id="swin" value="${esc(ui.sw.q)}" placeholder="Search conversations" autocomplete="off"><div class="res">${res.map((r, i) => `<div class="r ${i === ui.sw.idx ? 'on' : ''}" data-act="swgo" data-id="${r.c.id}">${r.icon}<span>${esc(r.label)}</span>${r.badge}<span class="sv">${esc(r.server)}</span></div>`).join('')}</div><div class="tip"><b>PROTIP:</b> start with @ for people, # for channels · ↑↓ enter</div></div></div>`
  }
  const hadFocus = document.activeElement?.id === 'swin'
  put('overlay', html)
  if (ui.sw) { const i = $('swin'); if (!hadFocus) i.focus() }
}
function switcherResults() {
  const raw = ui.sw?.q || ''
  const q = raw.toLowerCase().replace(/^[@#]/, '')
  return S.chats.map((c) => {
    const dm = c.kind === 'dm', o = dm && H.otherPerson(S, c)
    return { c, dm, label: dm ? o.name : chanName(c), icon: dm ? smallAv(o) : '<span class="m"> # </span>', server: dm ? (isBridged(c) ? netName(c.transport) : 'Direct Messages') : 'fall26', badge: unreadOf(c) ? `<span class="badge">${unreadOf(c)}</span>` : '' }
  }).filter((r) => (!q || r.label.toLowerCase().includes(q)) && (raw[0] !== '@' || r.dm) && (raw[0] !== '#' || !r.dm))
}

function drawToasts() { put('toasts', ui.toasts.map((t) => `<div class="toast"><div class="tt">${t.title}</div><div class="tb">${t.body}</div></div>`).join('')) }
function toast(title, body, ms = 4500) {
  const t = { title, body }
  ui.toasts = [...ui.toasts.slice(-2), t]
  setTimeout(() => { ui.toasts = ui.toasts.filter((x) => x !== t); render() }, ms)
  render()
}

// ── pi chrome ───────────────────────────────────────────────────────
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinI = 0
const tokens = { up: 18.4, down: 4.2, r: 61.3, cost: 0.031, ctx: 6.1 }
function drawStrip() {
  $('pistrip').innerHTML = `<div class="row u"> wire the relay reconnect backoff into yap-client, then run the relay tests</div>
<div class="row t"><b>bash</b> bun test relay/ <span class="pi-ok">✓ 14 pass</span> 0 fail · 212ms   <span style="color:#666">(ctrl+o to expand)</span></div>
<div class="row w"><span class="spin" id="spin">${SPIN[spinI]}</span> Working... <span style="color:#666">esc to interrupt</span></div>`
}
function drawExt() {
  const k = (a, b) => `<span class="k">${a}</span> ${b}`
  const s = '<span class="sep">│</span>'
  put('extline', `<span><span style="color:#c9cdfb;font-weight:700">yapping</span> ${s} ${k('ctrl+y', 'hide')} ${s} ${k('ctrl+k', 'jump')} ${s} ${k('alt+↑↓', 'channel')} ${s} ${k('↑', 'select msg')} ${s} ${k('tab', 'review pi')} ${s} ${k('o', 'observe')} ${s} ${k('alt+s', 'pi sees chat')}</span><span class="r">${yap.mode === 'live' ? '<span class="live">● relay</span>' : '<span class="off">○ in-page</span>'}  npm:pi-yapping</span>`)
}
function yapStatus() {
  const n = S.chats.reduce((a, c) => a + unreadOf(c), 0)
  const pend = H.pending(S).filter((a) => a.owner === me()).length
  const busy = H.busy(S).filter((a) => a.owner === me()).length
  return `<span class="st-yap">${n} unread${pend ? ` · <span style="color:#f0c674">π ${pend} for you</span>` : busy ? ' · π on it' : ''}</span>`
}
function drawFooter() {
  $('pifoot').innerHTML = `<div class="row"><span>~/repos/yapping (main)</span><span class="r">${yapStatus()}</span></div><div class="row"><span>↑${tokens.up.toFixed(1)}k ↓${tokens.down.toFixed(1)}k R${tokens.r.toFixed(1)}k $${tokens.cost.toFixed(3)} (sub) ${tokens.ctx.toFixed(1)}%/262k (auto)</span><span class="r">(fireworks) kimi-k2.5 • medium</span></div>`
}
let piInputVal = ''
let piAc = 0
const PI_CMDS = [['yap', 'open yapping (pi-yapping)'], ['model', 'select model'], ['tree', 'session tree'], ['compact', 'compact context']]
function drawPiFull() {
  const el = $('pifull')
  if (!el.dataset.built) {
    el.dataset.built = '1'
    el.innerHTML = `<div class="scroll">
<div class="row"><span class="acc b">pi</span> <span class="dim">v0.71.2</span></div>
<div class="row"><span class="key">escape</span> to interrupt · <span class="key">ctrl+c</span> to clear · <span class="key">ctrl+o</span> expand tools · <span class="key">/</span> for commands · <span class="key">ctrl+y</span> yapping</div>
<div class="gap"></div>
<div class="row hd">[Context]</div><div class="row dim">  ~/.pi/agent/AGENTS.md</div><div class="row dim">  ~/repos/yapping/SPEC.md</div>
<div class="gap"></div>
<div class="row hd">[Extensions]</div><div class="row">  user</div><div class="row"><span style="color:#81a2be">    npm:pi-yapping</span></div><div class="row dim">      index.ts · registers /yap, ctrl+y, footer status</div>
<div class="gap"></div>
<div class="ubox"><div class="row"> the relay drops everyone when bun --watch restarts it. make clients survive that</div></div>
<div class="gap"></div>
<div class="row">Clients flip to <span class="acc">disconnected</span> and never retry. I'll add jittered backoff in <span class="acc">yap-client.js</span> and re-request a snapshot on reconnect.</div>
<div class="gap"></div>
<div class="ubox"><div class="row"> wire the relay reconnect backoff into yap-client, then run the relay tests</div></div>
<div class="gap"></div>
<div class="tool"><div class="row"><span class="tn">edit</span> <span class="tp">~/repos/yapping/shared/yap-client.js</span></div><div class="row del">- ws.onclose = () => { if (api.mode === 'live') { api.mode = 'disconnected' } }</div><div class="row add">+ ws.onclose = () => reconnect(backoff.next())   // 0.5s → 8s, jittered</div></div>
<div class="gap"></div>
<div class="tool"><div class="row"><span class="tn">bash</span> <span class="tp">bun test relay/</span></div><div class="row out"> <span class="add">✓</span> 14 pass  0 fail  212ms</div></div>
<div class="gap"></div>
<div class="row">Reconnect now backs off from 0.5s to 8s with jitter; the relay tests pass. Want me to add a test that kills the relay mid-session?</div>
</div>
<div class="widget" id="piwidget"></div>
<div class="editor"><input id="pi-input" autocomplete="off" spellcheck="false"></div><div class="pi-ac" id="piac"></div>`
    $('pi-input').addEventListener('input', () => { piInputVal = $('pi-input').value; piAc = 0; drawPiAc() })
  }
  const n = S.chats.reduce((a, c) => a + unreadOf(c), 0)
  const p = H.pending(S).filter((a) => a.owner === me())[0]
  $('piwidget').innerHTML = `<span class="yp">yapping</span> ${n} unread${p ? ` · <span style="color:#7c8cf8">π</span> ${esc(H.chatTitle(S, chatById(p.chatId)))}: ${esc(p.proposal?.label || '')}` : ''} · <span class="kb">ctrl+y</span> or <span class="kb">/yap</span> to open`
  drawPiAc()
  if (document.activeElement?.id !== 'pi-input') $('pi-input').focus()
}
function drawPiAc() {
  const el = $('piac')
  if (!el) return
  if (!piInputVal.startsWith('/')) { el.innerHTML = ''; return }
  const list = PI_CMDS.filter(([c]) => c.startsWith(piInputVal.slice(1)))
  el.innerHTML = list.map(([c, d], i) => `<div class="r ${i === piAc ? 'on' : ''}">/${c}  <span style="color:#666">${d}</span></div>`).join('')
}
function setOpen(v) {
  ui.open = v
  stick = true
  if (v) { piInputVal = ''; if ($('pi-input')) $('pi-input').value = '' }
  draw()
  if (v) $('input')?.focus()
  else { document.activeElement?.blur(); $('pi-input')?.focus() }
}

// ── actions ─────────────────────────────────────────────────────────
let lastTyping = 0
function sendText(text) {
  const t = text.trim()
  if (!t) return
  if (t.startsWith('/')) return runCommand(t)
  yap.send({ t: 'send', chatId: ui.chatId, text: t, replyTo: ui.replyTo || undefined })
  ui.replyTo = null
  stick = true
}
function runCommand(t) {
  const [cmd, ...rest] = t.slice(1).split(' ')
  const arg = rest.join(' ').trim()
  const chat = chatById(ui.chatId)
  closeSlash()
  if (cmd === 'shrug') sendText(`${arg} ¯\\_(ツ)_/¯`.trim())
  else if (cmd === 'me') arg && sendText(`*${arg}*`)
  else if (cmd === 'invite') { if (isBridged(chat)) invite(); else toast('Already on yapping', `${esc(H.chatTitle(S, chat))} is already here.`) }
  else if (cmd === 'pi') setSees(chat, arg ? arg !== 'off' : !canSee(chat))
  else toast('Unknown command', esc(t))
}
function invite() { const chat = chatById(ui.chatId); if (isBridged(chat)) { yap.send({ t: 'invite_p2p', chatId: chat.id }); stick = true } }
function setSees(chat, on) { yap.send({ t: 'set_sees', chatId: chat.id, on }) }
function closeSlash() { ui.slash.open = false; ui.slash.idx = 0 }
const react = (id, emoji) => yap.send({ t: 'react', chatId: ui.chatId, msgId: id, emoji })
function approve(id) { const a = S.assists[id]; if (a) { yap.send({ t: 'approve', chatId: a.chatId, assistId: id }); ui.focusAssist = null; stick = true } }
function dismiss(id) { const a = S.assists[id]; if (a) { yap.send({ t: 'dismiss', chatId: a.chatId, assistId: id }); ui.focusAssist = null } }

document.addEventListener('click', (e) => {
  const pop = e.target.closest('[data-pop]')
  const a = e.target.closest('[data-act]')
  if (ui.profile && !pop && !(a && a.dataset.act === 'profile')) { ui.profile = null; render() }
  if (!a) return
  const { act, id } = a.dataset
  switch (act) {
    case 'server': openServer(id); break
    case 'chat': openChat(id); break
    case 'voice': ui.voice = ui.voice ? null : id; render(); break
    case 'leave': ui.voice = null; render(); break
    case 'react': react(id, a.dataset.emoji); break
    case 'reply': ui.replyTo = id; render(); $('input').focus(); break
    case 'unreply': ui.replyTo = null; render(); break
    case 'profile': {
      const r = $('yap').getBoundingClientRect()
      const fromRight = !!a.closest('.right')
      const y = Math.max(18, Math.min(e.clientY - r.top - 40, r.height - 480))
      ui.profile = ui.profile?.id === id ? null : { id, style: fromRight ? `right:33ch;top:${y}px` : `left:${Math.min(e.clientX - r.left + 16, r.width - 420)}px;top:${y}px` }
      render(); break
    }
    case 'members': ui.members = !ui.members; render(); break
    case 'jump': { const el = document.querySelector(`[data-mid="${id}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') } break }
    case 'sees': setSees(id ? chatById(id) : chatById(ui.chatId), !canSee(id ? chatById(id) : chatById(ui.chatId))); break
    case 'invite': invite(); break
    case 'approve': approve(id); break
    case 'dismiss': dismiss(id); break
    case 'observe': ui.observe = id; render(); break
    case 'closeobs': ui.observe = null; render(); break
    case 'slash': $('input').value = '/'; ui.slash.open = true; render(); $('input').focus(); break
    case 'cmd': pickCmd(+a.dataset.i, true); break
    case 'switcher': ui.sw = { q: '', idx: 0 }; render(); break
    case 'closesw': if (!e.target.closest('.switcher')) { ui.sw = null; render() } break
    case 'swgo': ui.sw = null; openChat(id); break
    case 'emoji': $('input').value += '😂'; $('input').focus(); break
    case 'plus': toast('Upload', 'Drop a file here; it goes straight to them.'); break
  }
})

function pickCmd(i, run) {
  const c = slashMatches()[i]
  if (!c) return
  const input = $('input')
  const rest = input.value.split(' ').slice(1).join(' ')
  if (run && (!c.arg || rest || c.c === 'pi')) { input.value = ''; runCommand(`/${c.c} ${rest}`); render(); return }
  input.value = `/${c.c} `
  ui.slash.open = false
  render()
  input.focus()
}

$('input').addEventListener('input', () => {
  const v = $('input').value
  ui.slash.open = v.startsWith('/') && !v.includes(' ')
  $('slash').innerHTML = ui.slash.open ? slashHTML() : ''
  if (v && !v.startsWith('/') && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); yap.send({ t: 'typing', chatId: ui.chatId }) }
})
$('input').addEventListener('keydown', (e) => {
  const input = $('input')
  if (ui.slash.open && slashMatches().length) {
    const n = slashMatches().length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ui.slash.idx = (ui.slash.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; $('slash').innerHTML = slashHTML(); return }
    if (e.key === 'Tab') { e.preventDefault(); pickCmd(ui.slash.idx, false); return }
    if (e.key === 'Enter') { e.preventDefault(); pickCmd(ui.slash.idx, true); return }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); $('slash').innerHTML = ''; return }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = input.value; input.value = ''; closeSlash(); sendText(v); render(); return }
  if (e.key === 'Tab' && !input.value && pendingIn(ui.chatId).length) { e.preventDefault(); ui.focusAssist = pendingIn(ui.chatId).at(-1).id; input.blur(); render(); return }
  if (e.key === 'ArrowUp' && !input.value && !e.altKey) { e.preventDefault(); ui.sel = msgsOf(ui.chatId).filter((m) => m.kind !== 'system').at(-1)?.id || null; input.blur(); render() }
})

document.addEventListener('keydown', (e) => {
  const k = e.key
  if (e.ctrlKey && (k === 'y' || k === 'Y')) { e.preventDefault(); setOpen(!ui.open); return }
  if (!ui.open) {
    if (document.activeElement?.id === 'pi-input') {
      const list = piInputVal.startsWith('/') ? PI_CMDS.filter(([c]) => c.startsWith(piInputVal.slice(1))) : []
      if (list.length && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); piAc = (piAc + (k === 'ArrowDown' ? 1 : list.length - 1)) % list.length; drawPiAc() }
      if (k === 'Tab' && list.length) { e.preventDefault(); $('pi-input').value = piInputVal = `/${list[piAc][0]}`; drawPiAc() }
      if (k === 'Enter') {
        e.preventDefault()
        if ((list.length ? `/${list[piAc][0]}` : piInputVal).trim() === '/yap') setOpen(true)
        else { $('pi-input').value = piInputVal = ''; drawPiAc() }
      }
    }
    return
  }
  if (ui.sw) {
    const res = switcherResults()
    if (k === 'Escape') { ui.sw = null; render(); return }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); ui.sw.idx = (ui.sw.idx + (k === 'ArrowDown' ? 1 : res.length - 1)) % Math.max(1, res.length); render(); return }
    if (k === 'Enter') { e.preventDefault(); const r = res[ui.sw.idx]; ui.sw = null; if (r) openChat(r.c.id); return }
    return
  }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') { e.preventDefault(); ui.sw = { q: '', idx: 0 }; render(); return }
  if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    e.preventDefault()
    if (e.ctrlKey || e.shiftKey) openServer(ui.server === 'home' ? 'fall26' : 'home')
    else { const list = chatsIn(ui.server); const i = list.findIndex((c) => c.id === ui.chatId); const n = list[(i + (k === 'ArrowDown' ? 1 : list.length - 1)) % list.length]; if (n) openChat(n.id, ui.server) }
    return
  }
  if (e.altKey && /^Digit[12]$/.test(e.code)) { e.preventDefault(); openServer(SERVERS[+e.code.slice(5) - 1].id); return }
  if (e.altKey && e.code === 'KeyS') { e.preventDefault(); const c = chatById(ui.chatId); setSees(c, !canSee(c)); return }
  if (e.altKey && e.code === 'KeyP') { e.preventDefault(); ui.members = !ui.members; render(); return }
  if (e.altKey && (e.code === 'KeyY' || e.code === 'KeyN')) { const p = pendingIn(ui.chatId).at(-1); if (p) { e.preventDefault(); e.code === 'KeyY' ? approve(p.id) : dismiss(p.id) } return }
  if (k === 'Escape') {
    if (ui.observe) { ui.observe = null; render(); return }
    if (ui.profile) { ui.profile = null; render(); return }
    if (ui.sel || ui.focusAssist) { ui.sel = null; ui.focusAssist = null; render(); $('input').focus(); return }
    if (ui.replyTo) { ui.replyTo = null; render(); return }
    setOpen(false); return
  }
  const inInput = document.activeElement?.tagName === 'INPUT'
  if (ui.focusAssist && !inInput) {
    if (k === 'y') { approve(ui.focusAssist); render(); $('input').focus(); return }
    if (k === 'n') { dismiss(ui.focusAssist); render(); $('input').focus(); return }
    if (k === 'o') { ui.observe = ui.focusAssist; render(); return }
    if (k === 'Tab') { e.preventDefault(); const l = pendingIn(ui.chatId); const i = l.findIndex((x) => x.id === ui.focusAssist); ui.focusAssist = l[(i + 1) % l.length]?.id; render(); return }
  }
  if (!ui.sel && !ui.focusAssist && k === 'ArrowUp' && !inInput && !e.altKey) { e.preventDefault(); ui.sel = msgsOf(ui.chatId).filter((m) => m.kind !== 'system').at(-1)?.id || null; render(); return }
  if (ui.sel && !inInput) {
    const list = msgsOf(ui.chatId).filter((m) => m.kind !== 'system')
    const i = list.findIndex((m) => m.id === ui.sel)
    const m = list[i]
    if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); ui.sel = list[Math.max(0, i - 1)]?.id; render(); return }
    if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); if (i >= list.length - 1) { ui.sel = null; render(); $('input').focus() } else { ui.sel = list[i + 1].id; render() } return }
    if (/^[1-4]$/.test(k) && m) { react(m.id, QUICK[+k - 1]); return }
    if (k === 'r' && m) { e.preventDefault(); ui.replyTo = m.id; ui.sel = null; render(); $('input').focus(); return }
    if (k === 'p' && m) { ui.profile = { id: m.from, style: 'left:40ch;top:72px' }; render(); return }
    if (k === 'o' && m) { const a = H.assistFor(S, m.id); if (a) { ui.observe = a.id; render() } return }
  }
  if (!ui.observe && k === 'o' && !inInput && !ui.sel) { const a = latestAssist(); if (a) { ui.observe = a.id; render() } return }
  if (!inInput && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { ui.sel = null; ui.focusAssist = null; $('input').focus() }
})
document.addEventListener('input', (e) => { if (e.target.id === 'swin') { ui.sw.q = e.target.value; ui.sw.idx = 0; drawOverlay() } })

// ── events ──────────────────────────────────────────────────────────
let first = true
yap.subscribe((state, ev) => {
  S = state
  if (first) {
    first = false
    ui.server = serverFor(ui.chatId)
    ui.last[ui.server] = ui.chatId
    for (const a of Object.values(S.assists)) if (['done', 'dismissed'].includes(a.state)) settledAt[a.id] = 0
  }
  if (ev) onEvent(ev)
  render()
})

function onEvent(ev) {
  if (ev.type === 'message') {
    const m = ev.message
    if (ev.chatId === ui.chatId && ui.open && m.from !== me()) setTimeout(() => yap.send({ t: 'read', chatId: ev.chatId }), 300)
    if (ev.chatId === ui.chatId && (m.from === me() || m.kind === 'system')) stick = true
  }
  if (ev.type === 'assist') {
    const a = ev.assist
    if (['done', 'dismissed'].includes(a.state) && !settledAt[a.id]) { settledAt[a.id] = Date.now(); setTimeout(render, SETTLE_MS + 50) }
    if (a.chatId === ui.chatId) stick = true
    if (a.state === 'ready' && a.chatId !== ui.chatId && a.owner === me()) toast(`<span style="color:#7c8cf8">π</span> ${esc(H.chatTitle(S, chatById(a.chatId)))}`, esc(a.proposal?.label || ''))
    if (a.state === 'ready' && ui.autoApprove && a.chatId === ui.chatId) setTimeout(() => approve(a.id), 700)
  }
  if (ev.type === 'insight') freshFact = { chatId: ev.chatId, text: ev.insight.facts?.[0], at: Date.now() }
}

// ── demo drivers ────────────────────────────────────────────────────
const demo = P.get('demo')
const DEMO = { demo: ['dm-finn', 'hey can you take a look at my demo?'], schedule: ['dm-finn', 'can we grab 30 min thursday?'] }
if (DEMO[demo]) {
  if (!P.get('chat')) openChat(DEMO[demo][0])
  setTimeout(() => { sendText(DEMO[demo][1]); render() }, 600)
} else if (demo === 'theo') {
  if (!P.get('chat')) openChat('br-theo')
  if (ui.autoApprove) setTimeout(() => { const p = pendingIn('br-theo')[0]; if (p) approve(p.id) }, 900)
} else if (demo === 'bridge') {
  if (!P.get('chat')) openChat('br-mum')
  setTimeout(invite, 900)
}
if (P.get('profile')) setTimeout(() => { ui.profile = { id: P.get('profile'), style: 'right:33ch;top:36px' }; render() }, 50)
if (P.get('slash')) setTimeout(() => { $('input').value = '/'; ui.slash.open = true; render() }, 50)
if (P.get('switcher')) setTimeout(() => { ui.sw = { q: '', idx: 0 }; render() }, 50)
if (P.get('review')) setTimeout(() => { ui.focusAssist = pendingIn(ui.chatId).at(-1)?.id || null; render() }, 80)

drawStrip()
setTimeout(() => ui.open && !ui.sw && $('input').focus(), 60)
setInterval(() => { spinI = (spinI + 1) % SPIN.length; const s = $('spin'); if (s) s.textContent = SPIN[spinI] }, 90)
setInterval(() => { tokens.up += 0.1 + Math.random() * 0.3; tokens.down += Math.random() * 0.08; tokens.cost += 0.0004; tokens.ctx += 0.02; if (S) drawFooter() }, 2500)
setInterval(drawTyping, 800)
setInterval(() => { const tb = $('tb-right'); if (tb) tb.textContent = `ghostty — ${Math.floor(innerWidth / 7.8)}×${Math.floor((innerHeight - 50) / 18)}` }, 2000)
render()
