// yapping mobile — the phone app (PWA). WhatsApp-for-iOS bones.
// People text people. Your agent is only a chibi under the message it's
// handling; tap it to watch. Nothing is sent without you.
import { connect, helpers } from '../../shared/yap-client.js'
import { chibi } from '../../shared/chibi.js'
import { harnessSVG, netBadge, doodleURL, I, statusIcons, qrSVG, tint } from './art.js'

const P = new URLSearchParams(location.search)
const $ = (s, r = document) => r.querySelector(s)
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const tpl = document.createElement('template')
const el = (html) => { tpl.innerHTML = html.trim(); if (tpl.content.childElementCount > 1) { const d = document.createElement('div'); d.append(...tpl.content.childNodes); return d } return tpl.content.firstElementChild }
const pad = (n) => String(n).padStart(2, '0')

// ------------------------------------------------------------------ chrome
document.documentElement.style.setProperty('--doodle', doodleURL())
$('#qr').innerHTML = qrSVG(location.origin + location.pathname)
$('#qr-url').textContent = (location.host || 'localhost:7788') + location.pathname.replace(/index\.html$/, '')
$('#sbRight').innerHTML = statusIcons
const clock = () => { const d = new Date(); $('#sbTime').textContent = `${d.getHours()}:${pad(d.getMinutes())}` }
clock(); setInterval(clock, 15000)

if (/HeadlessChrome/.test(navigator.userAgent) || P.has('capture')) document.documentElement.classList.add('capture')
const native = matchMedia('(max-width: 519px), (display-mode: standalone)')
let SCALE = 1
function fit() {
  document.documentElement.classList.toggle('native', native.matches)
  document.documentElement.classList.toggle('framed', !native.matches)
  SCALE = native.matches ? 1 : Math.min(1, (innerHeight - 36) / 884, (innerWidth - 32) / 425)
  document.documentElement.style.setProperty('--scale', SCALE)
}
fit(); addEventListener('resize', fit); native.addEventListener?.('change', fit)

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !P.has('nosw')) navigator.serviceWorker.register('sw.js').catch(() => {})
let installPrompt = null
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e })

// ------------------------------------------------------------------ connect
const yap = await connect({ user: 'luqmaan', client: 'mobile' })
let S = yap.state
const me = () => S.users[S.me]
const AG = () => helpers.agentName(S, S.me) // "Claude"
const myHarness = () => me()?.agent || 'claude'

const ui = { tab: 'chats', filter: 'all', q: '', stack: [], rsvp: {}, seen: new Set(), doneAt: {}, newFacts: new Map(), booted: false, sheet: null, replyTo: {}, toastT: 0 }

// ------------------------------------------------------------------ small renderers
const time = (ts) => helpers.time(ts)
const sameDay = (a, b) => a.toDateString() === b.toDateString()
function dayLabel(ts) {
  const d = new Date(ts), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1)
  if (sameDay(d, n)) return 'Today'
  if (sameDay(d, y)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long' })
}
const when = (ts) => (!ts ? '' : dayLabel(ts) === 'Today' ? time(ts) : dayLabel(ts))
const initials = (name = '?') => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
function avatar(u, size = 40) {
  if (!u) return ''
  return `<span class="av hum" style="--s:${size}px;--c:${tint(u.color || '#25D366', 0.16)};--t:${u.color || '#1DAA61'}"><span>${esc(initials(u.name))}</span></span>`
}
function chatAvatar(c, size = 52) {
  if (c.kind === 'group') {
    return `<span class="avw"><span class="av grp" style="--s:${size}px"><svg viewBox="0 0 24 24" fill="#fff"><circle cx="9" cy="8.6" r="3.6"/><path d="M2.6 19.4c.6-3.6 3.2-5.6 6.4-5.6s5.8 2 6.4 5.6z"/><circle cx="16.6" cy="9.4" r="2.9" opacity=".85"/><path d="M16.8 13.8c2.6 0 4.4 1.7 4.8 4.6h-4.6c-.3-1.8-1-3.2-2.1-4.2.6-.3 1.2-.4 1.9-.4z" opacity=".85"/></svg></span></span>`
  }
  const o = helpers.otherPerson(S, c)
  return `<span class="avw">${avatar(o, size)}${c.transport !== 'yap' ? `<span class="netbadge" title="${esc(S.bridges[c.transport]?.name)}">${netBadge(c.transport)}</span>` : ''}</span>`
}
const chatTitle = (c) => helpers.chatTitle(S, c)
const lastVisible = (c) => (S.messages[c.id] || []).filter((m) => m.kind !== 'system').at(-1)
const canSee = (c) => helpers.canSee(S, c)

function tickState(chat, m) {
  const list = S.messages[chat.id] || []
  const replied = list.some((x) => x.ts > m.ts && x.from !== S.me && x.from !== 'system')
  const age = Date.now() - m.ts
  if (replied || (age > 120000 && chat.transport === 'yap')) return 'read'
  return age < 600 ? 'sent' : 'delivered'
}
const ticks = (chat, m) => { const t = tickState(chat, m); return `<span class="tk ${t}">${t === 'sent' ? I.tick : I.ticks}</span>` }
function attachPreview(a) {
  if (!a) return ''
  return { link: `🔗 ${a.title}`, file: `📄 ${a.title}`, event: `📅 ${a.title}` }[a.type] || a.title
}

// ------------------------------------------------------------------ assists → chibis
const CB_STATE = { reading: 'reading', waiting: 'idle', talking: 'talking', working: 'reading', ready: 'ready', done: 'done', dismissed: 'done' }
function cb(harness, state, size) { return `<span class="cb">${chibi(harness, { state, size })}</span>` }
function assistPhase(a) {
  if (!['done', 'dismissed'].includes(a.state)) return 'live'
  const t = ui.doneAt[a.id]
  if (t && Date.now() - t < 6000) return 'settling'
  return a.scenario ? 'idle' : 'gone'
}
function shortLine(a) {
  const peer = helpers.otherPerson(S, S.chats.find((c) => c.id === a.chatId) || { members: [] })
  return { reading: 'Reading', waiting: `Waiting on ${peer?.name || 'them'}`, talking: `With ${peer?.name || 'their'}'s ${S.harnesses[a.agents?.[1]?.harness]?.name || 'agent'}`, working: 'On it', ready: 'Ready for you', done: 'Done', dismissed: 'Left it' }[a.state] || a.state
}

// ------------------------------------------------------------------ morph: keyed, keeps live nodes (and animations) alive
function morph(box, items) {
  const old = new Map([...box.children].map((n) => [n.dataset.k, n]))
  const created = []
  let prev = null
  const keep = new Set()
  for (const [k, html] of items) {
    let n = old.get(k)
    if (n && n._h !== html) { const m = el(html); m.dataset.k = k; m._h = html; n.replaceWith(m); n = m }
    else if (!n) { n = el(html); n.dataset.k = k; n._h = html; created.push(n) }
    keep.add(k)
    const want = prev ? prev.nextSibling : box.firstChild
    if (want !== n) box.insertBefore(n, want)
    prev = n
  }
  for (const [k, n] of old) if (!keep.has(k)) n.remove()
  return created
}
const setHTML = (node, html) => { if (node._h !== html) { node.innerHTML = html; node._h = html } }

// ------------------------------------------------------------------ views & navigation
const views = $('#views')
const root = el(`<section class="view root">
  <div class="pane" data-pane="chats"><div class="scroll"></div></div>
  <div class="pane" data-pane="updates"><div class="scroll"></div></div>
  <div class="pane" data-pane="calls"><div class="scroll"></div></div>
  <div class="pane" data-pane="you"><div class="scroll"></div></div>
  <nav class="tabbar"></nav>
</section>`)
views.append(root)
const topView = () => ui.stack.at(-1)
const topEl = () => topView()?.el || root

function push(v, animate = true) {
  const node = el(v.type === 'chat'
    ? `<section class="view pushed chat-view">
        <header class="nav chat-head"></header>
        <div class="wall"><div class="msgs scroll"></div><button class="jump" data-act="jump" aria-label="Scroll to latest">${I.chevD}</button><div class="toast"></div></div>
        <footer class="compose">
          <div class="replyband"></div>
          <div class="bar">
            <button class="ic" aria-label="Attach">${I.plus}</button>
            <label class="field"><input type="text" enterkeyhint="send" autocomplete="off" placeholder="Message"><span class="ic sm" aria-hidden="true">${I.sticker}</span></label>
            <button class="ic cam" aria-label="Camera">${I.camera}</button>
            <button class="ic mic" aria-label="Voice note">${I.mic}</button>
            <button class="sendbtn" data-act="send" aria-label="Send">${I.send}</button>
          </div>
        </footer>
      </section>`
    : `<section class="view pushed info-view"><header class="nav info-head"></header><div class="scroll info-body"></div></section>`)
  v.el = node
  const under = topEl()
  views.append(node)
  ui.stack.push(v)
  if (v.type === 'chat') wireComposer(v)
  render()
  if (v.type === 'chat') { const box = $('.msgs', node); box.scrollTop = box.scrollHeight }
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) { node.classList.add('enter'); node.offsetWidth; node.classList.remove('enter') }
  under.classList.add('under')
}
function pop() {
  const v = ui.stack.pop()
  if (!v) return
  topEl().classList.remove('under')
  v.el.classList.add('enter', 'leaving')
  setTimeout(() => v.el.remove(), 480)
  render()
}
function openChat(id, animate = true) {
  if (!S.chats.find((c) => c.id === id)) return
  const v = topView()
  if (v?.type === 'chat' && v.chatId === id) return
  push({ type: 'chat', chatId: id }, animate)
  markRead(id)
}
const readT = {}
function markRead(id) { clearTimeout(readT[id]); readT[id] = setTimeout(() => { const c = S.chats.find((x) => x.id === id); if (c?.unread?.[S.me]) yap.send({ t: 'read', chatId: id }) }, 250) }

// edge-swipe back, iOS style
let drag = null
const topUnder = () => (ui.stack.length > 1 ? ui.stack.at(-2).el : root)
views.addEventListener('pointerdown', (e) => {
  const v = topView(); if (!v) return
  const r = v.el.getBoundingClientRect()
  if ((e.clientX - r.left) / SCALE > 22) return
  drag = { x: e.clientX, w: r.width, v }
  v.el.classList.add('dragging'); topUnder().classList.add('dragging')
})
addEventListener('pointermove', (e) => {
  if (!drag) return
  drag.dx = Math.max(0, e.clientX - drag.x) / drag.w
  drag.v.el.style.transform = `translateX(${drag.dx * 100}%)`
  topUnder().style.transform = `translateX(${-28 + drag.dx * 28}%)`
})
addEventListener('pointerup', () => {
  if (!drag) return
  const { v, dx = 0 } = drag
  v.el.classList.remove('dragging'); topUnder().classList.remove('dragging')
  v.el.style.transform = ''; topUnder().style.transform = ''
  drag = null
  if (dx > 0.33) pop()
})

// ------------------------------------------------------------------ render
let queued = false
function schedule() { if (!queued) { queued = true; Promise.resolve().then(() => { queued = false; render() }) } }
function render() {
  renderTabbar()
  morph($(`.pane[data-pane="${ui.tab}"] .scroll`, root), { chats: chatsPane, updates: updatesPane, calls: callsPane, you: youPane }[ui.tab]())
  for (const v of ui.stack) v.type === 'chat' ? renderChat(v) : renderInfo(v)
  renderIsland()
  if (ui.sheet) renderSheet()
}

const TABS = [['updates', 'Updates', I.tUpdates, I.tUpdates], ['calls', 'Calls', I.tCalls, I.phoneFill], ['chats', 'Chats', I.tChats, I.tChatsOn], ['you', 'You', I.tYou, I.tYou]]
function renderTabbar() {
  const unread = S.chats.reduce((n, c) => n + ((c.unread?.[S.me] || 0) > 0 ? 1 : 0), 0)
  setHTML($('.tabbar', root), TABS.map(([id, label, off, on]) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><span class="ti">${ui.tab === id ? on : off}${id === 'chats' && unread ? `<b class="tbadge">${unread}</b>` : ''}${id === 'updates' ? '<b class="tdot"></b>' : ''}</span><span class="tl">${label}</span></button>`).join(''))
  for (const p of root.querySelectorAll('.pane')) p.classList.toggle('on', p.dataset.pane === ui.tab)
}
const largeTop = (right = '', left = `<button class="circ" aria-label="More">${I.more}</button>`) => `<div class="lt-top">${left}<div class="lt-r">${right}</div></div>`
const modeChip = () => `<span class="mode ${yap.mode}" title="${yap.mode === 'live' ? 'connected' : 'running on this phone'}"><i></i>${yap.mode === 'live' ? 'live' : yap.mode === 'offline' ? 'offline' : 'reconnecting'}</span>`

// ---- Chats
function chatsPane() {
  const q = ui.q.trim().toLowerCase()
  let list = [...S.chats].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (lastVisible(b)?.ts || 0) - (lastVisible(a)?.ts || 0))
  const nUnread = list.filter((c) => c.unread?.[S.me]).length
  if (ui.filter === 'unread') list = list.filter((c) => c.unread?.[S.me])
  if (ui.filter === 'favs') list = list.filter((c) => c.pinned)
  if (ui.filter === 'groups') list = list.filter((c) => c.kind === 'group')
  if (q) list = list.filter((c) => chatTitle(c).toLowerCase().includes(q) || (S.messages[c.id] || []).some((m) => (m.text || '').toLowerCase().includes(q)))
  const pills = [['all', 'All'], ['unread', `Unread${nUnread ? ` <em>${nUnread}</em>` : ''}`], ['favs', 'Favourites'], ['groups', 'Groups']]
  const items = [
    ['top', largeTop(`<button class="circ" aria-label="Camera">${I.camera}</button><button class="circ green" aria-label="New chat">${I.plus}</button>`)],
    ['title', `<h1 class="lt">Chats ${modeChip()}</h1>`],
    ['search', `<label class="search">${I.search}<input type="search" data-role="q" placeholder="Search" autocomplete="off"></label>`],
    ['pills', `<div class="pills">${pills.map(([id, l]) => `<button class="pill ${ui.filter === id ? 'on' : ''}" data-act="filter" data-f="${id}">${l}</button>`).join('')}<button class="pill add" aria-label="New list">${I.plus}</button></div>`],
    ['arch', `<div class="arch">${I.archive}<span>Archived</span><em>2</em></div>`],
  ]
  for (const c of list) items.push([`c:${c.id}`, chatRow(c)])
  if (!list.length) items.push(['empty', `<div class="empty"><p>No chats here.</p></div>`])
  items.push(['foot', `<div class="list-foot">${I.lock}<span>Your personal messages are end-to-end encrypted and go phone to phone.</span></div>`])
  return items
}
function chatRow(c) {
  const last = lastVisible(c)
  const unread = c.unread?.[S.me] || 0
  const typers = helpers.isTyping(S, c.id)
  let prev = ''
  if (typers.length) prev = `<span class="green">${c.kind === 'dm' ? '' : esc(S.users[typers[0]]?.name) + ' is '}typing…</span>`
  else if (last) {
    const u = S.users[last.from]
    const pre = last.from === S.me ? ticks(c, last) : c.kind !== 'dm' ? `<span class="pfx">${esc(u?.name || '')}: </span>` : ''
    prev = pre + esc(last.kind === 'attachment' ? attachPreview(last.attachment) : last.text)
  }
  // a quiet chibi when your agent has something for you, or is busy
  let mark = ''
  if (canSee(c)) {
    if (helpers.pending(S, c.id).length) mark = `<span class="rowcb" title="${esc(AG())} has something for you">${chibi(myHarness(), { state: 'ready', size: 20 })}</span>`
    else if (helpers.busy(S, c.id).length) { const a = helpers.busy(S, c.id)[0]; mark = `<span class="rowcb">${chibi(myHarness(), { state: CB_STATE[a.state], size: 20 })}</span>` }
  }
  const src = c.transport !== 'yap' ? `<span class="src">${esc(S.bridges[c.transport]?.name)}</span>` : ''
  return `<div class="crow" data-act="open" data-id="${c.id}">
    <div class="crow-av">${chatAvatar(c, 54)}</div>
    <div class="crow-main">
      <div class="crow-top"><span class="crow-name">${esc(chatTitle(c))}</span>${src}<span class="crow-time ${unread ? 'u' : ''}">${when(last?.ts)}</span></div>
      <div class="crow-bot"><span class="crow-prev">${prev}</span><span class="crow-flags">${mark}${c.pinned ? `<span class="pinI">${I.pin}</span>` : ''}${unread ? `<span class="badge">${unread}</span>` : ''}</span></div>
    </div></div>`
}

// ---- Updates: people's statuses (text statuses, WhatsApp style)
const STATUSES = [
  ['finn', 'demo day prep. send help 😬', '2h'],
  ['nikita', 'lisbon next week ☀️', '5h'],
  ['maya', 'office hours moved to 4:30', '6h'],
  ['aisha', 'barbican saturday 🎻', '9h'],
]
const stories = () => STATUSES.filter(([id]) => S.users[id])
function updatesPane() {
  const st = stories()
  return [
    ['top', largeTop(`<button class="circ" aria-label="Camera">${I.camera}</button><button class="circ" aria-label="Edit">${I.edit}</button>`, '<span></span>')],
    ['title', `<h1 class="lt">Updates</h1>`],
    ['h-status', `<div class="sec-row"><span class="sec-h2">Status</span></div>`],
    ['rail', `<div class="rail">
      <div class="story mine">${avatar(me(), 58)}<span class="plus">${I.plus}</span><b>Add status</b></div>
      ${st.map(([id, text], i) => { const u = S.users[id]; return `<button class="story txt" data-act="story" data-i="${i}" style="--c:${u.color}"><span class="ring">${avatar(u, 32)}</span><span class="st-q">${esc(text)}</span><span class="st-txt"><b>${esc(u.name)}</b></span></button>` }).join('')}
    </div>`],
    ['h-chan', `<div class="sec-row"><span class="sec-h2">Channels</span><span class="sec-link">Explore</span></div>`],
    ['find', `<div class="group flat">${[['🗞️', 'yapping changelog', '12K followers · ships Fridays'], ['🚀', 'EF Fall26', '214 followers'], ['🎻', 'Barbican Centre', '88K followers']].map(([e, t, s]) => `<div class="gr"><span class="gr-ic chan">${e}</span><span class="gr-main"><b>${t}</b><small>${s}</small></span><button class="follow" data-act="follow">Follow</button></div>`).join('')}</div>`],
    ['pad', '<div class="padb"></div>'],
  ]
}
function openStory(i) {
  const st = stories()
  if (i < 0 || i >= st.length) { closeOverlay(); return }
  ui.story = i
  const [id, text, ago] = st[i], u = S.users[id]
  const ov = $('#overlay')
  ov.className = 'overlay on story-ov'
  ov.innerHTML = `<div class="storyv" style="--c:${u.color}" data-act="story-next">
    <div class="sv-bars">${st.map((_, j) => `<span class="${j < i ? 'full' : j === i ? 'run' : ''}"><i></i></span>`).join('')}</div>
    <div class="sv-head">${avatar(u, 34)}<div><b>${esc(u.name)}</b><small>${ago} ago</small></div><button class="sv-x" data-act="close-ov" aria-label="Close">${I.x}</button></div>
    <div class="sv-body"><h2>${esc(text)}</h2></div>
    <div class="sv-foot"><span>Reply…</span>${I.heart}</div>
  </div>`
  clearTimeout(ui.storyT)
  if (!P.has('story')) ui.storyT = setTimeout(() => ui.story === i && openStory(i + 1), 5000)
}

// ---- Calls
function callsPane() {
  const U = (id) => S.users[id]
  const rows = [['finn', 'in', 'Incoming video', 'Today · 12 min', 'video'], ['mum', 'missed', 'Missed voice call', 'Yesterday', 'phone'], ['nikita', 'out', 'Outgoing', 'Yesterday · 23 min', 'phone'], ['maya', 'in', 'Incoming', 'Saturday · 41 min', 'phone'], ['aisha', 'out', 'Outgoing', 'Friday · 6 min', 'phone']].filter(([id]) => U(id))
  return [
    ['top', largeTop(`<button class="circ green" aria-label="New call">${I.plus}</button>`, `<button class="txtbtn">Edit</button>`)],
    ['title', `<h1 class="lt">Calls</h1>`],
    ['search', `<label class="search">${I.search}<input type="search" placeholder="Search" autocomplete="off"></label>`],
    ['favs', `<div><div class="sec-row"><span class="sec-h2">Favourites</span></div><div class="favs">${['finn', 'mum', 'nikita'].map(U).filter(Boolean).map((u) => `<div class="fav">${avatar(u, 56)}<small>${esc(u.name)}</small></div>`).join('')}<div class="fav add"><span class="av" style="--s:56px">${I.plus}</span><small>Add</small></div></div></div>`],
    ['h-recent', `<div class="sec-row"><span class="sec-h2">Recent</span></div>`],
    ['recent', `<div class="callist">${rows.map(([id, k, l, s, ic]) => `<div class="call ${k}"><span class="avw">${avatar(U(id), 44)}</span><span class="call-main"><b>${esc(U(id).name)}</b><small>${k === 'out' ? I.arrowUR : I.arrowDL}${esc(l)}</small></span><span class="call-r"><small>${esc(s)}</small><span class="call-ic">${I[ic]}</span></span></div>`).join('')}</div>`],
    ['foot', `<div class="list-foot">${I.lock}<span>Calls between yapping users go device to device, end-to-end encrypted.</span></div>`],
    ['pad', '<div class="padb"></div>'],
  ]
}

// ---- You
function youPane() {
  const u = me()
  const sees = S.chats.filter((c) => canSee(c)).length
  const row = (ic, t, r = '', act = '') => `<div class="gr" ${act}><span class="gr-ic tile">${ic}</span><span class="gr-main"><b>${t}</b></span><span class="gr-r">${r}${I.chevR}</span></div>`
  return [
    ['top', largeTop(`<button class="circ" aria-label="QR">${I.qr}</button>`, '<span></span>')],
    ['title', `<h1 class="lt">You</h1>`],
    ['me', `<div class="group"><div class="gr me-row">${avatar(u, 62)}<span class="gr-main"><b class="big">${esc(u.name)}</b><small>${esc(u.handle)}</small></span><span class="gr-r">${I.chevR}</span></div></div>`],
    ['agent', `<div class="group"><div class="gr"><span class="gr-ic cbtile">${chibi(myHarness(), { state: 'idle', size: 26 })}</span><span class="gr-main"><b>${esc(AG())}</b><small>Can see ${sees} of ${S.chats.length} chats · asks before sending anything</small></span><span class="gr-r">${I.chevR}</span></div></div>`],
    ['g1', `<div class="group">${row(I.star, 'Starred')}${row(I.link, 'Bridges', `<span class="mut">WhatsApp, iMessage, Slack</span>`)}</div>`],
    ['g2', `<div class="group">${row(I.key, 'Account')}${row(I.shield, 'Privacy')}${row(I.tChats, 'Chats')}${row(I.bell, 'Notifications')}${row(I.data, 'Storage and data')}</div>`],
    ['g3', `<div class="group"><div class="gr"><span class="gr-ic tile ${yap.mode === 'live' ? 'ok' : ''}">${I.sparkle}</span><span class="gr-main"><b>Connection</b><small>${yap.mode === 'live' ? `live · ${esc(location.host || 'localhost:7788')}` : 'offline · running on this phone'}</small></span>${modeChip()}</div>
      <div class="gr" data-act="install"><span class="gr-ic tile">${I.plus}</span><span class="gr-main"><b>${matchMedia('(display-mode: standalone)').matches ? 'Installed on this device' : 'Add to Home Screen'}</b><small>${installPrompt ? 'tap to install' : 'Share → Add to Home Screen'}</small></span><span class="gr-r">${I.chevR}</span></div></div>`],
    ['g4', `<div class="group">${row(I.help, 'Help')}${row(I.heart, 'Invite a friend')}</div>`],
    ['pad', '<div class="padb"></div>'],
  ]
}

// ------------------------------------------------------------------ chat screen
const side = (m) => (m.kind === 'system' ? 'center' : m.from === S.me ? 'out' : 'in')
function topPill(chat) {
  if (chat.transport !== 'yap') {
    const b = S.bridges[chat.transport] || {}
    const e2e = ['whatsapp', 'imessage'].includes(chat.transport)
    return `<div class="sysrow col"><div class="encpill">${e2e ? I.lock : ''}<span>${e2e ? `Messages to this chat are end-to-end encrypted by ${esc(b.name)}.` : `Bridged from ${esc(b.name)}.`}</span></div>
      <div class="bridgeline"><span class="bl-ic">${netBadge(chat.transport)}</span>${esc(b.note || '')} <button data-act="invite">Invite to yapping</button></div></div>`
  }
  return `<div class="sysrow"><div class="encpill">${I.lock}<span>Messages are end-to-end encrypted and go phone to phone. No server in between.</span></div></div>`
}
function chatItems(chat) {
  const main = S.messages[chat.id] || []
  const items = [['pill', topPill(chat)]]
  let lastDay = null
  const see = canSee(chat)
  const under = (m) => see && m && helpers.assistFor(S, m.id) && assistPhase(helpers.assistFor(S, m.id)) !== 'gone'
  const same = (a, b) => a && b && a.from === b.from && a.kind !== 'system' && b.kind !== 'system' && a.kind !== 'attachment' && b.kind !== 'attachment' && Math.abs(b.ts - a.ts) < 6 * 60e3 && dayLabel(a.ts) === dayLabel(b.ts)
  main.forEach((m, i) => {
    const day = dayLabel(m.ts)
    if (day !== lastDay) { items.push([`d:${day}`, `<div class="sysrow"><span class="datechip">${day}</span></div>`]); lastDay = day }
    const prev = main[i - 1], next = main[i + 1]
    const first = !same(prev, m) || !!under(prev) || dayLabel(prev.ts) !== day
    const last = !same(m, next) || !!under(m)
    items.push([m.id, m.kind === 'system' ? `<div class="sysrow"><span class="sysline">${esc(m.text)}</span></div>` : renderMsg(chat, m, first, last)])
    if (under(m)) items.push([`${m.id}:as`, renderAssist(chat, m, helpers.assistFor(S, m.id))])
  })
  const typers = helpers.isTyping(S, chat.id).filter((id) => S.users[id])
  if (typers.length) items.push(['typing', `<div class="row in first last ${chat.kind !== 'dm' ? 'withav' : ''}">${chat.kind !== 'dm' ? `<div class="mav">${avatar(S.users[typers[0]], 28)}</div>` : ''}<div class="bubble tail typing"><i></i><i></i><i></i></div></div>`])
  return items
}
const EMOJI_ONLY = /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s){1,8}$/u
function reactionsHTML(m) {
  const rx = Object.entries(m.reactions || {}).filter(([, v]) => v.length)
  if (!rx.length) return ''
  const total = rx.reduce((n, [, v]) => n + v.length, 0)
  return `<button class="rx ${rx.some(([, v]) => v.includes(S.me)) ? 'mine' : ''}" data-act="rxsheet">${rx.map(([e]) => `<span>${e}</span>`).join('')}${total > 1 ? `<em>${total}</em>` : ''}</button>`
}
function quoteHTML(chat, m) {
  if (!m.replyTo) return ''
  const q = (S.messages[chat.id] || []).find((x) => x.id === m.replyTo)
  if (!q) return ''
  const u = S.users[q.from]
  return `<div class="quote" style="--t:${q.from === S.me ? '#1DAA61' : u?.color || '#1F7AEC'}"><b>${q.from === S.me ? 'You' : esc(u?.name || '')}</b><span>${esc(q.kind === 'attachment' ? attachPreview(q.attachment) : q.text)}</span></div>`
}
function renderMsg(chat, m, first, last) {
  const u = S.users[m.from] || { name: '?' }
  const s = side(m)
  const showAv = s === 'in' && chat.kind !== 'dm'
  const showName = showAv && first
  const rx = reactionsHTML(m)
  const assisted = m.assistedBy ? `<span class="sentwith">${harnessSVG(m.assistedBy, 10)}sent with ${esc(S.harnesses[m.assistedBy]?.name || m.assistedBy)}</span>` : ''
  const meta = `<span class="meta">${time(m.ts)}${s === 'out' ? ticks(chat, m) : ''}</span>`
  const name = showName ? `<div class="who" style="color:${u.color}">${esc(u.name)}</div>` : ''
  const avCol = showAv ? `<div class="mav">${last ? avatar(u, 28) : ''}</div>` : ''
  const wrap = (cls, inner) => `<div class="row ${s} ${first ? 'first' : ''} ${last ? 'last' : ''} ${showAv ? 'withav' : ''} ${rx ? 'has-rx' : ''}">${avCol}<div class="bubble ${cls} ${last ? 'tail' : ''}" data-mid="${m.id}">${name}${inner}${rx}</div></div>`
  if (m.kind === 'attachment') {
    const a = m.attachment || {}
    const foot = `<div class="metarow">${assisted}${meta}</div>`
    if (a.type === 'link') {
      const host = (a.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || a.subtitle
      return wrap('card lnk', `<div class="lk-prev"><div class="lk-art"><span class="lk-dom">${esc(host)}</span><span class="lk-big">${esc((a.title || '').split(' ')[0])}</span><span class="lk-sub">staging · build 214</span></div><div class="lk-meta"><b>${esc(a.title)}</b><small>${esc(a.subtitle || '')}</small><em>${esc(host)}</em></div></div><div class="text lk-url">${esc(a.url || '')}</div>${foot}`)
    }
    if (a.type === 'file') return wrap('card doc', `<div class="doc-row"><span class="pdf">PDF</span><span class="doc-tt"><b>${esc(a.title)}</b><small>${esc(a.subtitle || '')}</small></span></div>${foot}`)
    if (a.type === 'event') {
      const d = new Date(); d.setDate(d.getDate() + (((4 - d.getDay() + 7) % 7) || 7))
      const r = ui.rsvp[m.id] || 'going'
      return wrap('card ev', `<div class="ev-top"><div class="ev-cal"><span>${d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</span><b>${d.getDate()}</b></div><div class="ev-tt"><div class="ev-title">${esc(a.title)}</div><div class="ev-when">${esc(a.subtitle || '')}</div></div></div>
        <div class="ev-going"><span class="stack">${chat.members.map((id) => avatar(S.users[id], 22)).join('')}</span>${chat.members.length} invited</div>${foot}
        <div class="ev-actions">${[['going', 'Going'], ['maybe', 'Maybe'], ['no', "Can't go"]].map(([k, l]) => `<button class="${r === k ? 'on' : ''}" data-act="rsvp" data-mid="${m.id}" data-v="${k}">${r === k ? I.check : ''}${l}</button>`).join('')}</div>`)
    }
  }
  const jumbo = EMOJI_ONLY.test(m.text || '') && [...(m.text || '')].length <= 6
  return wrap(jumbo ? 'jumbo' : '', `${quoteHTML(chat, m)}<div class="text">${esc(m.text)}<span class="spacer" style="width:${s === 'out' ? 62 : 42}px"></span></div>${meta}`)
}

// The chibi row under a message: the agent's whole visible life.
function renderAssist(chat, m, a) {
  const s = side(m) === 'out' ? 'out' : 'in'
  const phase = assistPhase(a)
  const agents = a.agents?.length ? a.agents : [{ harness: myHarness() }]
  const st = CB_STATE[a.state] || 'idle'
  if (phase === 'idle') return `<div class="assist ${s} idle"><button class="cbbtn" data-act="observe" data-aid="${a.id}" aria-label="What ${esc(AG())} did">${cb(agents[0].harness, 'idle', 16)}</button></div>`
  const pair = agents.slice(0, a.state === 'talking' ? 2 : 1).map((g, i) => cb(g.harness, st, 26)).join('')
  const chip = `<button class="cbbtn ${a.state === 'talking' ? 'pair' : ''}" data-act="observe" data-aid="${a.id}" aria-label="What ${esc(AG())} is doing">${pair}</button>`
  if (a.state === 'ready' && a.proposal) {
    return `<div class="assist ${s} ready">${chip}<div class="proposal" data-aid="${a.id}">
      <div class="pp-body" data-act="observe" data-aid="${a.id}"><b>${esc(a.proposal.label)}</b>${a.proposal.detail ? `<small>${esc(a.proposal.detail)}</small>` : ''}</div>
      <div class="pp-actions"><button data-act="dismiss" data-aid="${a.id}">Not now</button><button class="go" data-act="approve" data-aid="${a.id}">${esc(a.proposal.action || 'Send')}</button></div>
    </div></div>`
  }
  return `<div class="assist ${s} ${phase} st-${a.state}">${chip}<span class="as-line" data-act="observe" data-aid="${a.id}">${esc(a.line || shortLine(a))}</span></div>`
}

function subtitle(chat) {
  const typers = helpers.isTyping(S, chat.id)
  if (typers.length) return `<span class="green">${chat.kind === 'dm' ? 'typing…' : `${esc(typers.map((id) => S.users[id]?.name).join(', '))} typing…`}</span>`
  if (chat.kind === 'group') return esc(chat.members.map((id) => (id === S.me ? 'You' : S.users[id]?.name)).join(', '))
  const o = helpers.otherPerson(S, chat)
  if (!o) return ''
  if (chat.transport !== 'yap') return `<span class="srcsub">${netBadge(chat.transport)}${esc(S.bridges[chat.transport]?.name)}</span>`
  const hid = o.harness || 'mobile'
  return `${o.status === 'online' ? 'online · ' : ''}${hid === 'mobile' ? 'on mobile' : `in ${esc(S.harnesses[hid]?.name || hid)}`} <span class="hsub">${harnessSVG(hid, 12)}</span>`
}
function headerChibi(chat) {
  if (!canSee(chat)) return `<button class="hcb off" data-act="sees" aria-label="${esc(AG())} can't see this chat" title="${esc(AG())} can't see this chat">${chibi(myHarness(), { state: 'sleeping', size: 24 })}</button>`
  const busy = helpers.busy(S, chat.id)[0], ready = helpers.pending(S, chat.id)[0]
  const st = ready ? 'ready' : busy ? CB_STATE[busy.state] : 'idle'
  return `<button class="hcb" data-act="sees" aria-label="${esc(AG())} can see this chat" title="${esc(AG())} can see this chat">${chibi(myHarness(), { state: st, size: 24 })}</button>`
}
function renderChat(v) {
  const chat = S.chats.find((c) => c.id === v.chatId)
  if (!chat) return
  const node = v.el
  const otherUnread = S.chats.reduce((n, c) => n + (c.id !== chat.id && c.unread?.[S.me] ? 1 : 0), 0)
  setHTML($('.chat-head', node), `<button class="back" data-act="back" aria-label="Back">${I.back}${otherUnread ? `<span class="bcount">${otherUnread}</span>` : ''}</button>
    <button class="who-btn" data-act="info">${chatAvatar(chat, 38)}<span class="who-t"><b>${esc(chatTitle(chat))}</b><small>${subtitle(chat)}</small></span></button>
    ${headerChibi(chat)}<button class="hbtn" aria-label="Video call">${I.video}</button><button class="hbtn" aria-label="Voice call">${I.phone}</button>`)
  const box = $('.msgs', node)
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160
  const created = morph(box, chatItems(chat))
  if (v.painted) for (const n of created) if (!ui.seen.has(n.dataset.k)) n.classList.add('pop')
  for (const n of box.children) ui.seen.add(n.dataset.k)
  v.painted = true
  if (atBottom || v.stick) { box.scrollTop = box.scrollHeight; v.stick = false }
  const rq = ui.replyTo[chat.id] && (S.messages[chat.id] || []).find((x) => x.id === ui.replyTo[chat.id])
  setHTML($('.replyband', node), rq ? `<div class="rb" style="--t:${rq.from === S.me ? '#1DAA61' : S.users[rq.from]?.color}"><div><b>${rq.from === S.me ? 'You' : esc(S.users[rq.from]?.name)}</b><span>${esc(rq.kind === 'attachment' ? attachPreview(rq.attachment) : rq.text)}</span></div><button data-act="unreply" aria-label="Cancel reply">${I.x}</button></div>` : '')
}
function toast(v, text) {
  const t = $('.toast', v.el)
  t.textContent = text; t.classList.remove('on'); t.offsetWidth; t.classList.add('on')
  clearTimeout(ui.toastT); ui.toastT = setTimeout(() => t.classList.remove('on'), 2200)
}

// ------------------------------------------------------------------ contact info
function renderInfo(v) {
  const chat = S.chats.find((c) => c.id === v.chatId)
  if (!chat) return
  const node = v.el
  const isDm = chat.kind === 'dm'
  setHTML($('.info-head', node), `<button class="back" data-act="back" aria-label="Back">${I.back}</button><b>${isDm ? 'Contact info' : 'Group info'}</b><button class="txtbtn">Edit</button>`)
  const o = helpers.otherPerson(S, chat)
  const see = canSee(chat)
  const ins = see ? S.insights[chat.id] : null
  const bridged = chat.transport !== 'yap'
  const items = []
  items.push(['hero', `<div class="ihero">${chatAvatar(chat, 104)}<h2>${esc(chatTitle(chat))}</h2><div class="ih-sub">${isDm ? esc(o?.handle || '') : `Group · ${chat.members.length} members`}</div>${isDm && !bridged && o ? `<div class="ih-pres"><span class="dot ${o.status}"></span>${o.status === 'online' ? 'online' : 'away'} · ${o.harness && o.harness !== 'mobile' ? `in ${esc(S.harnesses[o.harness]?.name || '')}` : 'on mobile'} ${harnessSVG(o.harness || 'mobile', 13)}</div>` : ''}</div>`])
  items.push(['acts', `<div class="iacts three">${[[I.phone, 'Audio'], [I.video, 'Video'], [I.search, 'Search']].map(([ic, l]) => `<button>${ic}<span>${l}</span></button>`).join('')}</div>`])
  items.push(['sees', `<div class="group seesbox"><div class="gr" data-act="sees"><span class="gr-ic cbtile">${chibi(myHarness(), { state: see ? 'idle' : 'sleeping', size: 26 })}</span><span class="gr-main"><b>${esc(AG())} can see this chat</b><small>${see ? `${esc(AG())} reads new messages here and may offer to help. Nothing is sent without you.` : `${esc(AG())} can't read anything here.`}</small></span><span class="toggle ${see ? 'on' : ''}"><i></i></span></div></div>`])
  if (ins) {
    const isNew = (f) => ui.newFacts.has(f) && Date.now() - ui.newFacts.get(f) < 90000
    const w = Math.round((ins.warmth || 0) * 100)
    items.push(['notes', `<div class="sec-h">What ${esc(AG())} knows about you two</div><div class="group notes">
      <div class="nt-rel"><small>Relation</small><b>${esc(ins.relation)}</b></div>
      <div class="warm"><div class="warm-top"><small>Closeness</small><span>${w}%</span></div><div class="warm-bar"><i style="width:${w}%"></i></div></div>
      <div class="vibes">${(ins.vibe || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="facts">${(ins.facts || []).map((f) => `<div class="fact ${isNew(f) ? 'new' : ''}"><span class="fb">•</span><span>${esc(f)}</span>${isNew(f) ? '<em>new</em>' : ''}</div>`).join('')}</div>
      <div class="nt-foot">Kept on your phone. ${isDm && o ? esc(o.name) + ' never sees this.' : 'Nobody else sees this.'}</div></div>`])
  }
  if (bridged) {
    const b = S.bridges[chat.transport]
    items.push(['bridge', `<div class="group"><div class="gr"><span class="gr-ic netic">${netBadge(chat.transport)}</span><span class="gr-main"><b>Bridged from ${esc(b.name)}</b><small>${esc(b.note || '')}</small></span></div><div class="gr" data-act="invite"><span class="gr-ic tile">${I.plus}</span><span class="gr-main"><b class="lnk">Invite ${esc(o?.name || 'them')} to yapping</b></span></div></div>`])
  }
  if (!isDm) items.push(['members', `<div><div class="sec-h">${chat.members.length} members</div><div class="group">${chat.members.map((id) => { const u = S.users[id]; return `<div class="gr mem">${avatar(u, 40)}<span class="gr-main"><b>${id === S.me ? 'You' : esc(u.name)}</b><small>${esc(u.handle || '')}</small></span><span class="mut">${chat.sees?.[id] && u.agent ? harnessSVG(u.agent, 14) : ''}</span></div>` }).join('')}</div></div>`])
  const files = (S.messages[chat.id] || []).filter((m) => m.kind === 'attachment').length
  items.push(['media', `<div class="group"><div class="gr"><span class="gr-main"><b>Media, links and docs</b></span><span class="gr-r"><span class="mut">${files + 9}</span>${I.chevR}</span></div><div class="thumbs"><span class="th t2"><b>demo</b><small>staging</small></span><span class="th t3">🍲</span><span class="th t5"></span><span class="th t4">📅<b>THU</b></span></div></div>`])
  items.push(['opts', `<div class="group"><div class="gr"><span class="gr-ic tile">${I.bell}</span><span class="gr-main"><b>Notifications</b></span><span class="gr-r">${I.chevR}</span></div><div class="gr"><span class="gr-ic tile">${I.clock}</span><span class="gr-main"><b>Disappearing messages</b></span><span class="gr-r"><span class="mut">Off</span>${I.chevR}</span></div><div class="gr"><span class="gr-ic tile ok">${I.lock}</span><span class="gr-main"><b>Encryption</b><small>${bridged ? (['whatsapp', 'imessage'].includes(chat.transport) ? `end-to-end encrypted by ${esc(S.bridges[chat.transport].name)}` : `not end-to-end encrypted on ${esc(S.bridges[chat.transport].name)}`) : 'end-to-end, phone to phone'}</small></span></div></div>`])
  if (isDm && o) items.push(['danger', `<div class="group danger"><div class="gr"><b>Block ${esc(o.name)}</b></div><div class="gr"><b>Report ${esc(o.name)}</b></div></div>`])
  items.push(['pad', '<div class="padb"></div>'])
  morph($('.info-body', node), items)
}

// ------------------------------------------------------------------ observation sheet: "What Claude is doing"
function openSheet(aid) { ui.sheet = aid; renderSheet() }
function renderSheet() {
  const a = S.assists[ui.sheet]
  const ov = $('#overlay')
  if (!a) return
  const chat = S.chats.find((c) => c.id === a.chatId)
  const m = (S.messages[a.chatId] || []).find((x) => x.id === a.msgId)
  const agents = a.agents?.length ? a.agents : [{ owner: S.me, harness: myHarness() }]
  const st = CB_STATE[a.state] || 'idle'
  const peer = helpers.otherPerson(S, chat || { members: [] })
  const theirs = agents[1] ? `${esc(S.users[agents[1].owner]?.name || peer?.name)}'s ${esc(S.harnesses[agents[1].harness]?.name || 'agent')}` : ''
  const label = (who) => (who === 'them' ? theirs || 'Their agent' : `Your ${esc(AG())}`)
  const hz = (who) => (who === 'them' ? agents[1]?.harness || 'opencode' : agents[0].harness)
  const log = a.log || []
  const html = `<div class="ov-back" data-act="close-ov"></div>
    <div class="sheet" role="dialog" aria-label="What ${esc(AG())} is doing">
      <div class="grab" data-act="close-ov"></div>
      <div class="sh-head"><span class="sh-cbs">${agents.slice(0, 2).map((g, i) => cb(g.harness, i === 0 || a.state === 'talking' ? st : 'idle', 40)).join('')}</span>
        <div><b>What ${esc(AG())} is doing</b><small>${esc(a.line || shortLine(a))}</small></div><button class="sh-x" data-act="close-ov" aria-label="Close">${I.x}</button></div>
      ${m ? `<div class="sh-msg"><small>On ${m.from === S.me ? 'your' : esc(S.users[m.from]?.name || '') + "'s"} message</small><span>${esc(m.text || attachPreview(m.attachment))}</span></div>` : ''}
      <div class="sh-log">${log.length ? log.map((e) => `<div class="lg ${e.who}"><span class="lg-cb">${chibi(hz(e.who), { state: 'idle', size: 22 })}</span><div><b>${label(e.who)}</b><p>${esc(e.text)}</p></div><time>${e.at ? time(e.at) : ''}</time></div>`).join('') : `<div class="lg mine"><span class="lg-cb">${chibi(agents[0].harness, { state: st, size: 22 })}</span><div><b>Your ${esc(AG())}</b><p>${esc(a.line || 'Reading the message')}</p></div><time>${time(a.startedAt || Date.now())}</time></div>`}
        ${['reading', 'talking', 'working', 'waiting'].includes(a.state) ? `<div class="lg live"><span class="dots"><i></i><i></i><i></i></span><p>${esc(shortLine(a))}</p></div>` : ''}</div>
      ${a.state === 'ready' && a.proposal ? `<div class="sh-prop"><b>${esc(a.proposal.label)}</b>${a.proposal.detail ? `<small>${esc(a.proposal.detail)}</small>` : ''}<div class="sh-btns"><button data-act="dismiss" data-aid="${a.id}">Not now</button><button class="go" data-act="approve" data-aid="${a.id}">${esc(a.proposal.action || 'Send')}</button></div></div>` : ''}
      <div class="sh-foot">${I.lock}<span>${esc(AG())} only reads chats you let it see. Agents talk logistics, never your messages. Nothing is sent without you.</span></div>
    </div>`
  if (ov._h === html && ov.classList.contains('sheet-ov')) return
  const fresh = !ov.classList.contains('sheet-ov') || !ov.classList.contains('on')
  ov.className = `overlay on sheet-ov ${fresh ? 'fresh' : ''}`
  ov.innerHTML = html; ov._h = html
}

// ------------------------------------------------------------------ Dynamic Island live activity
const ISLAND = {
  reading: () => 'Reading', working: () => 'On it', ready: () => 'For you',
  waiting: (a) => `Waiting on ${helpers.otherPerson(S, S.chats.find((c) => c.id === a.chatId) || { members: [] })?.name || 'them'}`,
  talking: (a) => `With ${helpers.otherPerson(S, S.chats.find((c) => c.id === a.chatId) || { members: [] })?.name || 'them'}`,
}
function renderIsland() {
  const isl = $('#island')
  const mine = Object.values(S.assists).filter((a) => canSee(S.chats.find((c) => c.id === a.chatId)) && (['reading', 'talking', 'working', 'waiting', 'ready'].includes(a.state)) && (a.state !== 'reading' || a.scenario))
  const open = topView()?.chatId
  const a = mine.find((x) => x.chatId === open && x.state !== 'ready') || mine.find((x) => x.state !== 'ready') || mine.find((x) => x.chatId === open) || mine[0]
  if (!a) { isl.classList.remove('live'); setHTML(isl, ''); isl.dataset.aid = ''; return }
  const agents = a.agents?.length ? a.agents : [{ harness: myHarness() }]
  const st = CB_STATE[a.state]
  isl.classList.add('live'); isl.dataset.aid = a.id
  setHTML(isl, `<span class="isl-l">${agents.slice(0, a.state === 'talking' ? 2 : 1).map((g) => chibi(g.harness, { state: st, size: 22 })).join('')}</span><span class="isl-t ${a.state}">${esc(ISLAND[a.state] ? ISLAND[a.state](a) : a.state)}</span>`)
}
$('#island').addEventListener('click', () => {
  const aid = $('#island').dataset.aid; const a = S.assists[aid]; if (!a) return
  openChat(a.chatId); openSheet(aid)
})

// ------------------------------------------------------------------ banner (plain, chat-like)
let bannerT
function banner(icon, title, text, chatId) {
  const b = $('#banner')
  b.innerHTML = `<button class="bn" data-act="open" data-id="${chatId || ''}"><span class="bn-ic">${icon}</span><span class="bn-m"><span class="bn-top"><b>${esc(title)}</b><small>now</small></span><span class="bn-t">${esc(text)}</span></span></button>`
  b.classList.remove('on'); b.offsetWidth; b.classList.add('on')
  clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 3800)
}

// ------------------------------------------------------------------ react sheet (tap / long-press)
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥']
function openReact(mid, bubble) {
  const chat = S.chats.find((c) => c.id === topView()?.chatId)
  const m = (S.messages[chat?.id] || []).find((x) => x.id === mid)
  if (!m) return
  const sr = $('#screen').getBoundingClientRect(), r = bubble.getBoundingClientRect()
  const H = sr.height / SCALE
  const top = (r.top - sr.top) / SCALE, left = (r.left - sr.left) / SCALE, w = r.width / SCALE, h = r.height / SCALE
  const s = side(m)
  let shift = 0
  const bottom = top + h + 10 + 3 * 46
  if (bottom > H - 40) shift = bottom - (H - 40)
  if (top - shift - 62 < 60) shift = top - 122
  const y = top - shift
  const mine = Object.entries(m.reactions || {}).filter(([, v]) => v.includes(S.me)).map(([e]) => e)
  const ov = $('#overlay')
  ui.sheet = null
  ov.className = 'overlay on react-ov'; ov._h = ''
  ov.innerHTML = `<div class="ov-back" data-act="close-ov"></div>
    <div class="rx-bar ${s}" style="top:${y - 58}px">${EMOJIS.map((e, i) => `<button data-act="rx" data-mid="${mid}" data-e="${e}" class="${mine.includes(e) ? 'on' : ''}" style="--i:${i}">${e}</button>`).join('')}<button class="more" aria-label="More">${I.plus}</button></div>
    <div class="rx-clone row ${s} last" style="top:${top}px;--to:${y}px;left:${left}px;width:${w}px">${bubble.outerHTML}</div>
    <div class="ctx ${s}" style="top:${y + h + 10}px">
      <button data-act="reply" data-mid="${mid}">Reply<span>${I.reply}</span></button>
      <button data-act="close-ov">Copy<span>${I.copy}</span></button>
      <button data-act="close-ov">Star<span>${I.star}</span></button>
    </div>`
}
function closeOverlay() { const ov = $('#overlay'); ov.classList.remove('on'); ui.sheet = null; clearTimeout(ui.storyT); ui.story = null; setTimeout(() => { if (!ov.classList.contains('on')) { ov.innerHTML = ''; ov._h = ''; ov.className = 'overlay' } }, 260) }

// ------------------------------------------------------------------ composer
function wireComposer(v) {
  const input = $('.field input', v.el), compose = $('.compose', v.el)
  let lastTyping = 0
  input.addEventListener('input', () => {
    compose.classList.toggle('has-text', !!input.value.trim())
    if (Date.now() - lastTyping > 2500) { lastTyping = Date.now(); yap.send({ t: 'typing', chatId: v.chatId }) }
  })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendText(v, input.value) } })
}
function sendText(v, text, chatId = v?.chatId) {
  if (!text?.trim()) return
  if (v) v.stick = true
  yap.send({ t: 'send', chatId, text: text.trim(), replyTo: ui.replyTo[chatId] })
  delete ui.replyTo[chatId]
  const input = v && $('.field input', v.el)
  if (input) { input.value = ''; $('.compose', v.el).classList.remove('has-text') }
}

// ------------------------------------------------------------------ events
const screen = $('#screen')
let press = null
screen.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.msgs .bubble[data-mid]')
  if (!b || e.target.closest('button')) return
  press = { b, t: setTimeout(() => { press.long = true; openReact(b.dataset.mid, b) }, 380) }
})
screen.addEventListener('pointerup', () => { if (press) clearTimeout(press.t) })
screen.addEventListener('pointercancel', () => { if (press) clearTimeout(press.t); press = null })
screen.addEventListener('input', (e) => { if (e.target.dataset.role === 'q') { ui.q = e.target.value; schedule() } })

screen.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]')
  const bub = e.target.closest('.msgs .bubble[data-mid]')
  if (bub && (!t || t === bub) && !e.target.closest('button')) {
    if (press?.long) { press = null; return }
    press = null
    openReact(bub.dataset.mid, bub); return
  }
  if (!t) return
  const act = t.dataset.act
  const v = topView()
  const chatId = v?.chatId
  switch (act) {
    case 'tab': while (ui.stack.length) ui.stack.pop().el.remove(); root.classList.remove('under'); ui.tab = t.dataset.tab; render(); $(`.pane[data-pane="${ui.tab}"] .scroll`, root).scrollTop = 0; break
    case 'filter': ui.filter = t.dataset.f; render(); break
    case 'open': closeOverlay(); if (t.dataset.id) openChat(t.dataset.id); break
    case 'back': pop(); break
    case 'info': push({ type: 'info', chatId }); break
    case 'send': sendText(v, $('.field input', v.el).value); break
    case 'sees': {
      const c = S.chats.find((x) => x.id === chatId); const on = !canSee(c)
      yap.send({ t: 'set_sees', chatId, on })
      if (v.type === 'chat') toast(v, on ? `${AG()} can see this chat` : `${AG()} can't see this chat`)
      break
    }
    case 'invite': yap.send({ t: 'invite_p2p', chatId }); if (v?.type === 'chat') v.stick = true; break
    case 'observe': openSheet(t.dataset.aid); break
    case 'approve': { const a = S.assists[t.dataset.aid]; yap.send({ t: 'approve', chatId: a?.chatId || chatId, assistId: t.dataset.aid }); if (v?.type === 'chat') v.stick = true; if (ui.sheet) closeOverlay(); break }
    case 'dismiss': { const a = S.assists[t.dataset.aid]; yap.send({ t: 'dismiss', chatId: a?.chatId || chatId, assistId: t.dataset.aid }); if (ui.sheet) closeOverlay(); break }
    case 'rsvp': ui.rsvp[t.dataset.mid] = t.dataset.v; render(); break
    case 'rx': yap.send({ t: 'react', chatId, msgId: t.dataset.mid, emoji: t.dataset.e }); closeOverlay(); break
    case 'rxsheet': { const b = t.closest('.bubble'); if (b) openReact(b.dataset.mid, b); break }
    case 'reply': ui.replyTo[chatId] = t.dataset.mid; closeOverlay(); render(); $('.field input', v.el)?.focus(); break
    case 'unreply': delete ui.replyTo[chatId]; render(); break
    case 'close-ov': closeOverlay(); break
    case 'story': openStory(+t.dataset.i); break
    case 'story-next': if (!e.target.closest('[data-act="close-ov"]')) openStory((ui.story ?? -1) + 1); break
    case 'jump': { const box = $('.msgs', v.el); box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); break }
    case 'follow': t.textContent = t.textContent === 'Following' ? 'Follow' : 'Following'; t.classList.toggle('on'); break
    case 'install': if (installPrompt) { installPrompt.prompt(); installPrompt = null } else banner(`<img src="icons/icon.svg" alt="">`, 'Add to Home Screen', 'Tap Share, then “Add to Home Screen”.'); break
  }
})
screen.addEventListener('scroll', (e) => {
  if (!e.target.classList?.contains('msgs')) return
  const b = e.target
  b.parentElement.classList.toggle('scrolled', b.scrollHeight - b.scrollTop - b.clientHeight > 260)
}, true)

// ------------------------------------------------------------------ live events
const AUTO_APPROVE = P.get('approve') === '1'
yap.subscribe((state, ev) => {
  S = state
  if (ev && ui.booted) {
    const open = topView()?.chatId || null
    if (ev.type === 'message') {
      const m = ev.message
      if (m.chatId === open) markRead(open)
      else if (m.from !== S.me && m.kind !== 'system') {
        const c = S.chats.find((x) => x.id === m.chatId), u = S.users[m.from]
        if (c && u) { const body = m.kind === 'attachment' ? attachPreview(m.attachment) : m.text; banner(chatAvatar(c, 38), chatTitle(c), c.kind === 'dm' ? body : `${u.name}: ${body}`, c.id) }
      }
    }
    if (ev.type === 'assist') {
      const a = ev.assist
      if (['done', 'dismissed'].includes(a.state) && !ui.doneAt[a.id]) ui.doneAt[a.id] = Date.now()
      if (a.state === 'ready' && AUTO_APPROVE && a.owner === S.me) setTimeout(() => yap.send({ t: 'approve', chatId: a.chatId, assistId: a.id }), 1200)
      if (P.has('observe') && !ui.sheet && a.owner === S.me && a.scenario) openSheet(a.id)
    }
    if (ev.type === 'insight' && ev.note) ui.newFacts.set(ev.note, Date.now())
  }
  schedule()
})
setInterval(() => { if (ui.stack.length || helpers.busy(S).length) schedule() }, 1000)

// ------------------------------------------------------------------ boot + debug params
// assists already settled when we arrive are shown as idle marks, not replayed
for (const a of Object.values(S.assists)) if (['done', 'dismissed'].includes(a.state)) ui.doneAt[a.id] = 1
render()
const DEMOS = { demo: ['dm-finn', 'hey can you take a look at my demo?'], schedule: ['dm-finn', 'can we grab 30 min thursday?'], theo: ['br-theo'], bridge: ['br-mum'] }
const demo = P.get('demo')
const scr = P.get('screen') || P.get('tab')
let startChat = P.get('chat') || (demo && DEMOS[demo]?.[0]) || (scr === 'info' ? 'dm-finn' : null)
if (['updates', 'calls', 'you', 'chats'].includes(scr)) ui.tab = scr
if (P.has('filter')) ui.filter = P.get('filter')
if (startChat) openChat(startChat, false)
if (scr === 'info' && startChat) push({ type: 'info', chatId: startChat }, false)
ui.booted = true
render()
const v0 = ui.stack.find((v) => v.type === 'chat')
if (demo && DEMOS[demo]?.[1]) setTimeout(() => sendText(v0, DEMOS[demo][1], DEMOS[demo][0]), 600)
if (demo === 'theo') {
  const a = Object.values(S.assists).find((x) => x.chatId === 'br-theo' && x.state === 'ready')
  if (a && AUTO_APPROVE) setTimeout(() => yap.send({ t: 'approve', chatId: 'br-theo', assistId: a.id }), 1200)
}
if (demo === 'bridge') setTimeout(() => { if (v0) v0.stick = true; yap.send({ t: 'invite_p2p', chatId: 'br-mum' }) }, 800)
if (P.has('observe')) setTimeout(() => {
  if (ui.sheet) return
  const a = Object.values(S.assists).filter((x) => x.owner === S.me && (!startChat || x.chatId === startChat)).sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0))[0] || Object.values(S.assists)[0]
  if (a) openSheet(a.id)
}, demo ? 2400 : 300)
if (P.has('story')) openStory(Math.max(0, stories().findIndex(([id]) => id === P.get('story'))))
if (P.has('react')) setTimeout(() => { const b = [...document.querySelectorAll('.msgs .bubble[data-mid]')].at(-1); if (b) openReact(b.dataset.mid, b) }, 300)
window.__yap = { yap, ui, render }
