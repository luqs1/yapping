// yapping × opencode — a messaging side panel drawn in PostHog's art style.
// People text people; your opencode agent only appears as a chibi under the
// message it is handling, and only in chats you let it see.
import { connect, helpers } from '../../shared/yap-client.js'
import { ocChibi, agentMark } from './art.js'

const P = new URLSearchParams(location.search)
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const H = (el) => ({ set h(v) { if (el.__h !== v) { el.__h = v; el.innerHTML = v } } })
const HERE = 'opencode' // the harness this sidebar lives in

const ui = {
  chat: P.get('chat') || 'dm-finn',
  theme: P.get('theme') === 'dark' ? 'dark' : 'light',
  search: '',
  replyTo: null,
  observe: null, // assist id
  profile: false,
  settledAt: {}, // assist id -> when it reached done/dismissed
  seen: new Set(),
  toasted: new Set(),
}

const yap = await connect({ user: P.get('user') || 'luqmaan', client: HERE })
let S = yap.state
const LOADED = Date.now()

// ─────────────────────────────── helpers
const U = (id) => S.users[id] || { name: id }
const chatById = (id) => S.chats.find((c) => c.id === id)
const title = (c) => helpers.chatTitle(S, c)
const unread = (c) => (c.id === ui.chat ? 0 : c.unread?.[S.me] || 0)
const sees = (c) => helpers.canSee(S, c)
// In this sidebar the user's own agent is opencode, whatever the sim says.
const harnessOf = (owner) => (owner === S.me ? HERE : U(owner).agent)
const agentLabel = (owner) => (owner === S.me ? 'your opencode' : `${U(owner).name}’s ${S.harnesses[U(owner).agent]?.name || 'agent'}`)
const mark = (owner, state, size = 30, turn = 0) => agentMark(harnessOf(owner), state, { size, turn, badge: owner === S.me ? null : { letter: U(owner).name?.[0] || '?', color: U(owner).color } })
const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const fixLine = (t) => String(t || '').replace(/\bClaude\b/g, 'opencode')

function avatar(u, size = 30) {
  return `<span class="av" style="--s:${size}px;--c:${u?.color || '#888'}">${esc(initials(u?.name))}</span>`
}
function chatAvatar(c, size = 34) {
  if (c.kind === 'group') {
    const ppl = c.members.filter((id) => id !== S.me).slice(0, 2).map(U)
    return `<span class="av grp" style="--s:${size}px">${ppl.map((u) => `<i style="--c:${u.color}">${esc(initials(u.name)[0])}</i>`).join('')}</span>`
  }
  return avatar(helpers.otherPerson(S, c), size)
}
function preview(c) {
  const m = helpers.lastMessage(S, c.id)
  if (!m) return ''
  const who = m.from === S.me ? 'You: ' : c.kind === 'group' && m.from !== 'system' ? `${U(m.from).name}: ` : ''
  if (m.kind === 'attachment') return `${who}${{ link: '🔗', file: '📄', event: '📅' }[m.attachment?.type] || '📎'} ${m.attachment?.title}`
  return who + m.text
}
function source(c) {
  return c.transport !== 'yap' ? S.bridges[c.transport]?.name : ''
}

// ─────────────────────────────── shell
const root = $('#yap')
root.dataset.theme = ui.theme
root.innerHTML = `
  <div class="ph-top">
    <b class="ph-word">yapping</b>
    <label class="ph-search"><svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg><input id="yap-search" placeholder="Search"><kbd>/</kbd></label>
    <button class="ph-icon" id="yap-theme" title="Toggle theme"></button>
    <button class="ph-icon" title="New message"><svg viewBox="0 0 20 20"><path d="M4 16h3l8.5-8.5-3-3L4 13z"/></svg></button>
  </div>
  <div class="ph-body">
    <nav class="ph-list" id="yap-list"></nav>
    <section class="ph-thread">
      <header class="ph-thead" id="yap-head"></header>
      <div class="ph-bridge" id="yap-bridge"></div>
      <div class="ph-msgs" id="yap-msgs"></div>
      <div class="ph-typing" id="yap-typing"></div>
      <form class="ph-compose" id="yap-form">
        <div class="ph-replyband" id="yap-reply"></div>
        <div class="ph-inputrow">
          <button type="button" class="ph-icon flat" title="Attach"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg></button>
          <input id="yap-input" autocomplete="off">
          <button type="submit" class="btn3d" id="yap-send"><span>Send</span></button>
        </div>
      </form>
      <div class="ph-pop" id="yap-pop" hidden></div>
    </section>
  </div>
  <footer class="ph-status" id="yap-status"></footer>`

// ─────────────────────────────── chat list
function renderList() {
  const q = ui.search.toLowerCase()
  const last = (c) => helpers.lastMessage(S, c.id)?.ts || 0
  const list = S.chats.filter((c) => !q || title(c).toLowerCase().includes(q)).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || last(b) - last(a))
  H($('#yap-list')).h = list.map((c) => {
    const n = unread(c)
    const typers = helpers.isTyping(S, c.id)
    const pend = sees(c) && helpers.pending(S, c.id).length
    const m = helpers.lastMessage(S, c.id)
    return `<button class="ph-row ${c.id === ui.chat ? 'active' : ''} ${n ? 'unread' : ''}" data-chat="${c.id}">
      ${chatAvatar(c)}
      <span class="ph-row-main">
        <span class="ph-row-top"><b>${esc(title(c))}</b>${c.pinned ? '<svg class="pin" viewBox="0 0 20 20"><path d="M7 3h6l-1 5 3 3H5l3-3zM10 11v6"/></svg>' : ''}<span class="ago">${m ? helpers.ago(m.ts) : ''}</span></span>
        <span class="ph-row-sub">${typers.length ? `<i class="typing-t">typing…</i>` : esc(preview(c))}</span>
        ${source(c) ? `<span class="src">${esc(source(c))}</span>` : ''}
      </span>
      ${pend ? `<span class="row-mark" title="opencode has something ready">${ocChibi('ready', { size: 16 })}</span>` : n ? `<span class="badge">${n}</span>` : ''}
    </button>`
  }).join('') || `<p class="ph-none">No chats match “${esc(ui.search)}”.</p>`
}

// ─────────────────────────────── header + bridge line
function renderHead() {
  const c = chatById(ui.chat)
  if (!c) return
  const other = c.kind === 'dm' ? helpers.otherPerson(S, c) : null
  const typers = helpers.isTyping(S, c.id)
  const on = sees(c)
  const sub = typers.length
    ? `<span class="typing-t">${esc(U(typers[0]).name)} is typing…</span>`
    : other
      ? other.bridge ? `<span class="pres">${esc(other.handle)} · ${esc(S.bridges[c.transport]?.name)}</span>` : !other.harness ? `<span class="pres on"><i></i>on yapping</span>` : `<span class="pres ${other.status === 'online' ? 'on' : ''}"><i></i>${other.status === 'online' ? `in ${esc(S.harnesses[other.harness]?.name || other.harness)}` : `last in ${esc(S.harnesses[other.harness]?.name || other.harness)}`}</span>`
      : `<span class="pres">${c.members.map((id) => id === S.me ? 'You' : U(id).name).join(', ')}</span>`
  H($('#yap-head')).h = `
    <button class="ph-who" data-profile>${chatAvatar(c, 36)}<span class="ph-th-main"><h2>${esc(title(c))}</h2><span class="ph-th-sub">${sub}</span></span></button>
    <button class="sees ${on ? 'on' : ''}" data-sees="${on ? 0 : 1}" title="${on ? 'opencode can read this chat. Click to turn off.' : 'opencode can’t read this chat. Click to let it.'}">
      <span class="sees-mark">${ocChibi(on ? 'idle' : 'sleeping', { size: 20 })}</span>
      <span class="sees-t">opencode <span class="long">${on ? 'can' : 'can’t'} see this chat</span><span class="short">${on ? 'sees this' : 'can’t see'}</span></span>
      <span class="tog ${on ? 'on' : ''}"><i></i></span>
    </button>`
  const b = c.transport !== 'yap' ? S.bridges[c.transport] : null
  H($('#yap-bridge')).h = b ? `<span>${esc(b.note)}</span><button class="link" data-invite="${c.id}">Invite to yapping</button>` : ''
  $('#yap-bridge').hidden = !b
}

// ─────────────────────────────── messages (keyed, so chibis don't restart)
const cache = new Map()
function renderMsgs() {
  const box = $('#yap-msgs')
  const c = chatById(ui.chat)
  if (!c) return
  const all = S.messages[c.id] || []
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90
  const blocks = []
  let prev = null
  let day = ''
  for (const m of all) {
    const d = new Date(m.ts).toDateString()
    if (d !== day) {
      day = d
      blocks.push(['day-' + d, `<div class="day"><span>${d === new Date().toDateString() ? 'Today' : new Date(m.ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>`, 0])
      prev = null
    }
    const grouped = prev && prev.from === m.from && m.kind !== 'system' && prev.kind !== 'system' && m.ts - prev.ts < 5 * 60000
    blocks.push([m.id, msgHTML(m, c, grouped), m.ts])
    prev = m
  }
  const keep = new Set()
  let cur = box.firstElementChild
  for (const [key, html, ts] of blocks) {
    keep.add(key)
    let ent = cache.get(key)
    if (!ent || ent.html !== html) {
      const tpl = document.createElement('template')
      tpl.innerHTML = html.trim()
      const el = tpl.content.firstElementChild
      if (ent?.el?.parentNode) { if (cur === ent.el) cur = el; ent.el.replaceWith(el) }
      if (!ui.seen.has(key)) { ui.seen.add(key); if (ts > LOADED) el.classList.add('enter') }
      ent = { html, el }
      cache.set(key, ent)
    }
    if (cur !== ent.el) box.insertBefore(ent.el, cur)
    cur = ent.el.nextElementSibling
  }
  for (const [key, ent] of cache) if (!keep.has(key)) { ent.el.remove(); cache.delete(key) }
  if (atBottom || ui.forceBottom) { box.scrollTop = box.scrollHeight; ui.forceBottom = false }
}

function msgHTML(m, c, grouped) {
  if (m.kind === 'system') return `<div class="sys">${esc(m.text)}</div>`
  const mine = m.from === S.me
  const u = U(m.from)
  const reactions = Object.entries(m.reactions || {})
  const reply = m.replyTo && (S.messages[c.id] || []).find((x) => x.id === m.replyTo)
  const body = m.kind === 'attachment' ? attachmentHTML(m) : `<div class="bubble">${reply ? `<span class="quote"><b>${esc(reply.from === S.me ? 'You' : U(reply.from).name)}</b>${esc(reply.text || reply.attachment?.title)}</span>` : ''}${esc(m.text)}</div>`
  const assist = sees(c) ? helpers.assistFor(S, m.id) : null
  return `<div class="msg ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}" data-msg="${m.id}">
    ${!mine && c.kind === 'group' ? `<div class="msg-av">${grouped ? '' : avatar(u, 26)}</div>` : ''}
    <div class="msg-col">
      ${!mine && c.kind === 'group' && !grouped ? `<div class="msg-name" style="--c:${u.color}">${esc(u.name)}</div>` : ''}
      <div class="msg-line">${body}<time>${helpers.time(m.ts)}</time></div>
      ${reactions.length ? `<div class="reacts">${reactions.map(([e, who]) => `<button class="react ${who.includes(S.me) ? 'me' : ''}" data-react="${e}" data-mid="${m.id}" title="${who.map((w) => w === S.me ? 'You' : U(w).name).join(', ')}">${e}<b>${who.length}</b></button>`).join('')}</div>` : ''}
      ${assist ? assistHTML(assist) : ''}
    </div>
    <div class="hover-bar">${['👍', '❤️', '😂', '🔥'].map((e) => `<button data-react="${e}" data-mid="${m.id}">${e}</button>`).join('')}<button data-reply="${m.id}" title="Reply"><svg viewBox="0 0 20 20"><path d="M8 5L3 10l5 5M3 10h9a5 5 0 0 1 5 5"/></svg></button></div>
  </div>`
}

function attachmentHTML(m) {
  const a = m.attachment || {}
  const icon = { link: '<svg viewBox="0 0 20 20"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L4.7 11.1a3 3 0 0 0 4.2 4.2l1-1"/></svg>', file: '<span class="pdf">PDF</span>', event: '' }[a.type]
  const ev = a.type === 'event' ? (() => { const d = new Date(m.ts); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7)); return `<span class="cal"><i>THU</i><b>${d.getDate()}</b></span>` })() : ''
  const by = m.assistedBy ? `<span class="sentwith">${m.from === S.me ? ocChibi('idle', { size: 12 }) : ''}sent with ${esc(m.from === S.me ? 'opencode' : S.harnesses[m.assistedBy]?.name || m.assistedBy)}</span>` : ''
  return `<div class="att t-${a.type}"><span class="att-ic">${ev || icon}</span><span class="att-main"><b>${esc(a.title)}</b><small>${esc(a.subtitle)}</small>${by}</span>${a.type === 'link' ? '<span class="att-go">↗</span>' : a.type === 'file' ? '<span class="att-go">↓</span>' : ''}</div>`
}

function assistHTML(a) {
  const st = a.state
  const settled = st === 'done' || st === 'dismissed'
  if (settled && !ui.settledAt[a.id]) ui.settledAt[a.id] = a.startedAt > LOADED ? Date.now() : 0
  const faded = settled && Date.now() - ui.settledAt[a.id] > 6000
  const owners = a.agents.map((x) => x.owner)
  const chibis = st === 'talking'
    ? owners.map((o, i) => mark(o, 'talking', 30, i)).join('')
    : mark(owners[0], faded ? 'idle' : st === 'dismissed' ? 'done' : st, faded ? 18 : 30)
  if (faded) return `<div class="assist faded" data-observe="${a.id}" title="${esc(fixLine(a.line))}">${chibis}</div>`
  const proposal = st === 'ready' && a.proposal ? `
    <div class="proposal">
      <div class="p-label">${esc(fixLine(a.proposal.label))}</div>
      ${a.proposal.detail ? `<div class="p-detail">${esc(a.proposal.detail)}</div>` : ''}
      <div class="p-acts"><button class="btn3d sm" data-approve="${a.id}"><span>${esc(a.proposal.action || 'Send')}</span></button><button class="link muted" data-dismiss="${a.id}">Not now</button></div>
    </div>` : ''
  return `<div class="assist ${st}">
    <button class="chibis" data-observe="${a.id}" title="See what opencode is doing">${chibis}</button>
    ${proposal || `<button class="a-line" data-observe="${a.id}">${esc(fixLine(st === 'reading' ? 'Reading' : a.line))}${['reading', 'talking', 'working'].includes(st) ? '<span class="ell"><i></i><i></i><i></i></span>' : ''}</button>`}
  </div>`
}

// ─────────────────────────────── observation popover
function renderPop() {
  const pop = $('#yap-pop')
  const a = ui.observe && S.assists[ui.observe]
  pop.hidden = !a && !ui.profile
  if (ui.profile) return renderProfile(pop)
  if (!a) return
  const t0 = a.startedAt
  const verb = { reading: 'Reading', waiting: 'Waiting', talking: 'Coordinating', working: 'Working', ready: 'Needs you', done: 'Done', dismissed: 'Left it' }[a.state]
  const trig = (S.messages[a.chatId] || []).find((m) => m.id === a.msgId)
  H(pop).h = `
    <div class="pop-h">${a.agents.map((x) => mark(x.owner, a.state === 'talking' ? 'talking' : a.state === 'ready' ? 'ready' : 'idle', 26)).join('')}
      <div><b>What opencode is doing</b><small><span class="st ${a.state}">${verb}</span> · ${a.agents.map((x) => agentLabel(x.owner)).join(' + ')}</small></div>
      <button class="x" data-close-pop>×</button></div>
    ${trig ? `<div class="pop-trig">on <q>${esc(trig.text || trig.attachment?.title)}</q></div>` : ''}
    <ol class="pop-log">
      <li class="mine"><time>0:00</time><span class="who">${mark(S.me, 'reading', 16)}</span><span><b>Your opencode</b> noticed the message</span></li>
      ${(a.log || []).map((l) => {
        const owner = l.who === 'mine' ? S.me : a.agents.find((x) => x.owner !== S.me)?.owner || S.me
        const dt = Math.max(0, (l.at || t0) - t0)
        return `<li class="${l.who}"><time>${Math.floor(dt / 60000)}:${String(Math.floor((dt % 60000) / 1000)).padStart(2, '0')}</time><span class="who">${mark(owner, 'idle', 16)}</span><span><b>${esc(owner === S.me ? 'Your opencode' : agentLabel(owner).replace(/^./, (c) => c.toUpperCase()))}</b>${esc(fixLine(l.text))}</span></li>`
      }).join('')}
      <li class="now"><time>now</time><span class="who">${mark(a.agents[0].owner, a.state === 'dismissed' ? 'done' : a.state, 16)}</span><span>${esc(fixLine(a.line))}</span></li>
    </ol>
    <p class="pop-foot">Agents talk to each other here, never in your chat. Nothing is sent until you press Send.</p>`
}
function renderProfile(pop) {
  const c = chatById(ui.chat)
  const other = c.kind === 'dm' ? helpers.otherPerson(S, c) : null
  const ins = sees(c) ? S.insights[c.id] : null
  H(pop).h = `
    <div class="pop-h">${chatAvatar(c, 34)}<div><b>${esc(title(c))}</b><small>${esc(other ? other.handle : `${c.members.length} people`)}${source(c) ? ` · ${esc(source(c))}` : ''}</small></div><button class="x" data-close-pop>×</button></div>
    ${ins ? `<div class="knows"><div class="k-h">${ocChibi('idle', { size: 18 })}What opencode knows about you two</div>
      <p class="rel">${esc(ins.relation)}</p>
      <div class="vibe">${ins.vibe.map((v) => `<span>${esc(v)}</span>`).join('')}</div>
      <ul>${ins.facts.map((f) => `<li>${esc(fixLine(f))}</li>`).join('')}</ul>
      <div class="warm"><span>Warmth</span><span class="bar"><i style="width:${Math.round(ins.warmth * 100)}%"></i></span><b>${Math.round(ins.warmth * 100)}</b></div></div>`
    : `<div class="knows off">${ocChibi('sleeping', { size: 22 })}<p>opencode can’t see this chat, so it knows nothing about it.</p></div>`}`
}

// ─────────────────────────────── composer, status, chrome
function renderCompose() {
  const c = chatById(ui.chat)
  if (!c) return
  $('#yap-input').placeholder = `Message ${title(c)}${source(c) ? ` on ${source(c)}` : ''}`
  const r = ui.replyTo && (S.messages[c.id] || []).find((m) => m.id === ui.replyTo)
  H($('#yap-reply')).h = r ? `<span class="rb-bar"></span><span class="rb-main"><b>Replying to ${esc(r.from === S.me ? 'yourself' : U(r.from).name)}</b><span>${esc(r.text || r.attachment?.title)}</span></span><button type="button" class="x" data-cancel-reply>×</button>` : ''
  $('#yap-reply').hidden = !r
  const typers = helpers.isTyping(S, c.id)
  H($('#yap-typing')).h = typers.length ? `<span class="dots"><i></i><i></i><i></i></span>${typers.map((t) => esc(U(t).name)).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing` : ''
}
function renderChrome() {
  const total = S.chats.reduce((n, c) => n + unread(c), 0)
  const pend = S.chats.filter(sees).reduce((n, c) => n + helpers.pending(S, c.id).filter((a) => a.chatId !== ui.chat).length, 0)
  H($('#yap-tab-n')).h = total ? String(total) : ''
  H($('#yap-pill')).h = `<svg viewBox="0 0 20 20"><path d="M4 5h12v8H9l-4 3v-3H4z"/></svg>${total ? `<b>${total}</b>` : ''}${pend ? '<i class="pend" title="opencode has something ready"></i>' : ''}`
  H($('#yap-theme')).h = ui.theme === 'dark' ? '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/></svg>' : '<svg viewBox="0 0 20 20"><path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z"/></svg>'
  const busy = helpers.busy(S).filter((a) => sees(chatById(a.chatId) || {})).length
  H($('#yap-status')).h = `<span class="conn ${yap.mode}"><i></i>${yap.mode === 'live' ? 'connected · peer-to-peer' : yap.mode === 'disconnected' ? 'reconnecting…' : 'offline · local'}</span><span class="sp"></span>${busy ? `<span>${ocChibi('reading', { size: 14 })}opencode is on ${busy} message${busy > 1 ? 's' : ''}</span>` : `<span class="dim">${S.chats.filter(sees).length} of ${S.chats.length} chats visible to opencode</span>`}`
}

// opencode's own toast (ui/src/components/toast.css)
function ocToast(a) {
  const c = chatById(a.chatId)
  const el = document.createElement('div')
  el.className = 'oc-toast'
  el.innerHTML = `<span class="ic">${ocChibi('ready', { size: 18 })}</span><div><b>yapping · ${esc(title(c))}</b><p>${esc(fixLine(a.proposal?.label || a.line))}</p></div><button data-chat="${c.id}">Open</button>`
  $('#oc-toasts').appendChild(el)
  setTimeout(() => el.classList.add('out'), 5200)
  setTimeout(() => el.remove(), 5600)
}

// ─────────────────────────────── render + events
function render() {
  renderList(); renderHead(); renderMsgs(); renderCompose(); renderChrome(); renderPop()
}
function openChat(id) {
  if (!chatById(id)) return
  ui.chat = id
  ui.forceBottom = true
  ui.replyTo = null
  ui.profile = false
  if (ui.observe && S.assists[ui.observe]?.chatId !== id) ui.observe = null
  for (const [k, ent] of cache) { ent.el.remove(); cache.delete(k) }
  yap.send({ t: 'read', chatId: id })
  render()
}

let readTimer
yap.subscribe((state, ev) => {
  S = state
  if (ev?.type === 'message' && ev.chatId === ui.chat && ev.message.from !== S.me) {
    clearTimeout(readTimer)
    readTimer = setTimeout(() => yap.send({ t: 'read', chatId: ui.chat }), 500)
  }
  if (ev?.type === 'assist') {
    const a = ev.assist
    if (a.state === 'ready' && !ui.toasted.has(a.id) && (a.chatId !== ui.chat || $('#oc').classList.contains('no-side'))) { ui.toasted.add(a.id); ocToast(a) }
    if (P.get('observe') && (!ui.observe || S.assists[ui.observe]?.startedAt < a.startedAt) && a.chatId === ui.chat) ui.observe = a.id
    if (P.get('approve') && a.state === 'ready' && a.chatId === ui.chat && a.startedAt > LOADED && !ui.approved) {
      ui.approved = true
      setTimeout(() => yap.send({ t: 'approve', chatId: a.chatId, assistId: a.id }), 1200)
    }
  }
  render()
})
setInterval(() => { renderList(); renderHead(); renderMsgs(); renderCompose(); renderChrome() }, 1500)

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-chat],[data-react],[data-reply],[data-cancel-reply],[data-sees],[data-approve],[data-dismiss],[data-observe],[data-close-pop],[data-profile],[data-invite],#yap-theme,#yap-pill,#yap-tab,#oc-agent,#oc-model,#oc-sidebar-toggle,#oc-panel-toggle')
  if (!t) {
    if (!e.target.closest('#yap-pop') && (ui.observe || ui.profile)) { ui.observe = null; ui.profile = false; renderPop() }
    return
  }
  const d = t.dataset
  if (d.chat) { $('#oc').classList.remove('no-side'); return openChat(d.chat) }
  if (d.react) return yap.send({ t: 'react', chatId: ui.chat, msgId: d.mid, emoji: d.react })
  if (d.reply) { ui.replyTo = d.reply; renderCompose(); return $('#yap-input').focus() }
  if ('cancelReply' in d) { ui.replyTo = null; return renderCompose() }
  if (d.sees) return yap.send({ t: 'set_sees', chatId: ui.chat, on: d.sees === '1' })
  if (d.approve) return yap.send({ t: 'approve', chatId: ui.chat, assistId: d.approve })
  if (d.dismiss) return yap.send({ t: 'dismiss', chatId: ui.chat, assistId: d.dismiss })
  if (d.observe) { ui.profile = false; ui.observe = ui.observe === d.observe ? null : d.observe; return renderPop() }
  if ('closePop' in d) { ui.observe = null; ui.profile = false; return renderPop() }
  if ('profile' in d) { ui.observe = null; ui.profile = !ui.profile; return renderPop() }
  if (d.invite) return yap.send({ t: 'invite_p2p', chatId: d.invite })
  switch (t.id) {
    case 'yap-theme': ui.theme = ui.theme === 'dark' ? 'light' : 'dark'; root.dataset.theme = ui.theme; return renderChrome()
    case 'yap-pill': case 'yap-tab': $('#oc').classList.remove('no-side'); $('#oc-panel-toggle').classList.add('on'); return $('#yap-input').focus()
    case 'oc-agent': { const n = $('#oc-agent-name'); n.textContent = n.textContent === 'Build' ? 'Plan' : 'Build'; t.classList.toggle('plan'); return }
    case 'oc-model': { const m = ['Big Pickle', 'Kimi K2', 'GLM 4.6', 'Qwen3 Coder']; const n = $('#oc-model-name'); n.textContent = m[(m.indexOf(n.textContent) + 1) % m.length]; return }
    case 'oc-sidebar-toggle': return $('#oc').classList.toggle('no-sidebar')
    case 'oc-panel-toggle': $('#oc').classList.toggle('no-side'); t.classList.toggle('on'); return
  }
})

function send(text) {
  if (!text.trim()) return
  yap.send({ t: 'send', chatId: ui.chat, text, replyTo: ui.replyTo || undefined })
  ui.replyTo = null
  ui.forceBottom = true
}
$('#yap-form').addEventListener('submit', (e) => {
  e.preventDefault()
  send($('#yap-input').value)
  $('#yap-input').value = ''
})
let lastTyping = 0
$('#yap-input').addEventListener('input', () => {
  if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); yap.send({ t: 'typing', chatId: ui.chat }) }
})
$('#yap-search').addEventListener('input', (e) => { ui.search = e.target.value; renderList() })
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input,[contenteditable]')) { e.preventDefault(); $('#yap-search').focus() }
  if (e.key === 'Escape') { ui.observe = null; ui.profile = false; ui.replyTo = null; renderPop(); renderCompose() }
})

// opencode composer echoes into the fake session
$('#oc-composer').addEventListener('submit', () => {
  const inp = $('.oc-prompt-input')
  const text = inp.textContent.trim()
  if (!text) return
  const div = document.createElement('div')
  div.className = 'oc-user'
  div.textContent = text
  $('#oc-timeline').appendChild(div)
  inp.textContent = ''
  $('#oc-timeline').scrollTop = 1e6
})
$('.oc-prompt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#oc-composer').requestSubmit() } })

// ─────────────────────────────── debug drivers
const DEMOS = { demo: ['dm-finn', 'hey can you take a look at my demo?'], schedule: ['dm-finn', 'can we grab 30 min thursday?'] }
const demo = P.get('demo')
if (demo === 'theo' && !P.get('chat')) ui.chat = 'br-theo'
if (demo === 'bridge' && !P.get('chat')) ui.chat = 'br-mum'
if (DEMOS[demo] && !P.get('chat')) ui.chat = DEMOS[demo][0]
openChat(chatById(ui.chat) ? ui.chat : 'dm-finn')
if (DEMOS[demo]) setTimeout(() => send(DEMOS[demo][1]), 600)
if (demo === 'theo' && P.get('approve')) setTimeout(() => { const a = helpers.pending(S, 'br-theo')[0]; if (a) yap.send({ t: 'approve', chatId: 'br-theo', assistId: a.id }) }, 1500)
if (demo === 'bridge') setTimeout(() => yap.send({ t: 'invite_p2p', chatId: ui.chat }), 900)
if (P.get('observe')) {
  const latest = Object.values(S.assists).filter((a) => a.chatId === ui.chat).sort((a, b) => b.startedAt - a.startedAt)[0]
  if (latest && !ui.observe) ui.observe = latest.id
  renderPop()
}
window.__yap = { yap, ui }
