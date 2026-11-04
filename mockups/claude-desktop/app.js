import { connect, helpers } from '../../shared/yap-client.js'
import { chibi, MARKS } from '../../shared/chibi.js'

const $ = (s) => document.querySelector(s)
// Headless screenshots can't advance entrance animations; show end states instead.
if (/HeadlessChrome/.test(navigator.userAgent)) document.documentElement.classList.add('shot')
const params = new URLSearchParams(location.search)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ?demo= drivers: [chat, message to send | null]
const DEMOS = {
  demo: ['dm-finn', 'hey can you take a look at my demo?'],
  schedule: ['dm-finn', 'can we grab 30 min thursday?'],
  theo: ['br-theo', null],
  bridge: ['br-mum', null],
}
const demoId = params.get('demo')
const demo = DEMOS[demoId]
const autoApprove = params.get('approve') === '1'

const yap = await connect({ user: 'luqmaan', client: 'claude', offline: demo ? true : undefined })
let S = yap.state
const ME = () => S.me
const AGENT = () => S.users[S.me]?.agent || 'claude'
const AGENT_NAME = () => MARKS[AGENT()]?.name || 'Claude'

let cur = params.get('chat') || demo?.[0] || null
let query = ''
let replyTo = null
let observeId = null
let observeFollow = params.get('observe') === '1'
let profileOpen = params.get('panel') === 'profile' || params.get('panel') === 'insights'
let peekMsg = null
let peekAssist = null
let firstPaint = true
const seen = new Set()
const settledAt = {}
const lastState = {}

// ───────────────────────── helpers ─────────────────────────
const chat = (id = cur) => S.chats.find((c) => c.id === id)
const title = (c) => helpers.chatTitle(S, c)
const other = (c) => helpers.otherPerson(S, c)
const unread = (c) => (c.id === cur ? 0 : c.unread?.[ME()] || 0)
const totalUnread = () => S.chats.reduce((a, c) => a + unread(c), 0)
const sees = (c) => helpers.canSee(S, c)
const peerAgent = (a) => {
  const p = a.agents?.[1]
  if (!p) return ''
  return `${S.users[p.owner]?.name}'s ${MARKS[p.harness]?.name || 'agent'}`
}
const SPARK = `<svg class="spark" width="11" height="11" viewBox="0 0 24 24"><g stroke="#D97757" stroke-width="2.6" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => { const t = (i / 12) * Math.PI * 2; const r = i % 2 ? 8.5 : 10.5; return `<line x1="${12 + Math.cos(t) * 2.4}" y1="${12 + Math.sin(t) * 2.4}" x2="${(12 + Math.cos(t) * r).toFixed(1)}" y2="${(12 + Math.sin(t) * r).toFixed(1)}"/>` }).join('')}</g></svg>`

function av(u, size = 36) {
  if (!u) return ''
  const initials = u.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)
  return `<span class="av" style="--s:${size}px;--c:${u.color}">${esc(initials)}</span>`
}
function chatAv(c, size = 36) {
  if (c.kind === 'group') {
    const [a, b] = c.members.filter((id) => id !== ME()).map((id) => S.users[id])
    return `<span class="av-pair" style="--s:${size}px">${av(a, Math.round(size * 0.68))}${av(b, Math.round(size * 0.68))}</span>`
  }
  return av(other(c), size)
}
const sourceName = (c) => (c.transport !== 'yap' ? S.bridges[c.transport]?.name : '')

$('.working .star').innerHTML = SPARK.replace('width="11" height="11"', 'width="16" height="16"')
$('.sess .spin').innerHTML = SPARK
// ───────────────────────── chat list ─────────────────────────
function renderList() {
  const lastTs = (c) => helpers.lastMessage(S, c.id)?.ts || 0
  const order = [...S.chats].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || lastTs(b) - lastTs(a))
  const q = query.toLowerCase()
  $('#rail').innerHTML = order
    .filter((c) => !q || `${title(c)} ${sourceName(c)}`.toLowerCase().includes(q))
    .map((c) => {
      const n = unread(c)
      const waiting = sees(c) && helpers.pending(S, c.id).length
      return `<button class="li ${c.id === cur ? 'on' : ''}" data-chat="${c.id}" title="${esc(title(c))}${sourceName(c) ? ' · ' + sourceName(c) : ''}">
        <span class="li-av">${chatAv(c, 36)}${n ? `<em class="un">${n}</em>` : ''}${waiting && !n ? '<em class="wt" title="Claude has something for you"></em>' : ''}</span>
        <span class="li-n">${c.pinned ? '<svg class="pin" width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M10 1.5 14.5 6l-2 .6-2.8 2.8.3 3.1-1.5 1.5L5.6 11 2 14.6 1.4 14 5 10.4 2 7.5 3.5 6l3.1.3L9.4 3.5Z"/></svg>' : ''}${esc(c.kind === 'group' ? c.title.replace(/ cohort$/, '') : title(c))}</span>
        ${sourceName(c) ? `<span class="li-src">${esc(sourceName(c))}</span>` : ''}
      </button>`
    })
    .join('')
  const total = totalUnread()
  $('#tabBadge').textContent = total || ''
  $('#tabBadge').style.display = total ? '' : 'none'
}

// ───────────────────────── header ─────────────────────────
function presence(c) {
  if (c.kind === 'group') {
    const n = c.members.length
    return `${n} people`
  }
  const o = other(c)
  if (c.transport !== 'yap') return `via ${esc(S.bridges[c.transport].name)}`
  const h = S.harnesses[o.harness]
  const on = o.status === 'online'
  return `<i class="st ${on ? 'on' : ''}" title="${on ? 'online' : 'away'}"></i>${h ? `in ${esc(h.name)}` : 'on yapping'}`
}
function seesToggle(c, big) {
  const on = sees(c)
  return `<button class="sees ${on ? 'on' : ''} ${big ? 'big' : ''}" data-sees="${on ? 0 : 1}" role="switch" aria-checked="${on}" title="${on ? 'Turn off: Claude stops reading this chat' : 'Let Claude read this chat and help'}">
    <span class="sees-c">${chibi(AGENT(), { state: on ? 'idle' : 'sleeping', size: 16 })}</span>
    <span class="sees-t">${AGENT_NAME()} ${on ? 'can' : "can't"} see this chat</span>
    <span class="sw"><i></i></span></button>`
}
function renderHead() {
  const c = chat()
  $('#chatHead').innerHTML = `
    <button class="ch-who" data-profile="1" title="Contact info">${chatAv(c, 32)}<span class="ch-t"><b>${esc(title(c))}</b><small>${presence(c)}</small></span></button>
    ${seesToggle(c)}`
}

// ───────────────────────── messages ─────────────────────────
const RBAR = ['👍', '❤️', '😂', '🙌']
function actions(m) {
  return `<div class="hover">${RBAR.map((e) => `<button data-rx="${e}" data-id="${m.id}" title="React ${e}">${e}</button>`).join('')}<button class="hv-reply" data-reply="${m.id}" title="Reply"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 2.5 8l4 4M3 8h6.5a4 4 0 0 1 4 4v.5"/></svg></button></div>`
}
function reactions(m) {
  const r = Object.entries(m.reactions || {})
  if (!r.length) return ''
  return `<div class="rxs">${r.map(([e, who]) => `<button class="rx ${who.includes(ME()) ? 'mine' : ''}" data-rx="${e}" data-id="${m.id}" title="${who.map((id) => S.users[id]?.name).join(', ')}">${e}${who.length > 1 ? `<span>${who.length}</span>` : ''}</button>`).join('')}</div>`
}
function quote(m) {
  if (!m.replyTo) return ''
  const q = (S.messages[m.chatId] || []).find((x) => x.id === m.replyTo)
  if (!q) return ''
  return `<div class="quote"><b>${esc(q.from === ME() ? 'You' : S.users[q.from]?.name)}</b>${esc(q.text || q.attachment?.title || '')}</div>`
}
function attachmentHTML(m) {
  const a = m.attachment
  let icon
  if (a.type === 'event') {
    const [d] = String(a.subtitle).split(' ')
    icon = `<span class="at-date"><small>${esc(d)}</small><b>${esc((String(a.subtitle).match(/\d{1,2}:\d{2}/) || [''])[0])}</b></span>`
  } else if (a.type === 'file') icon = `<span class="at-ic file">PDF</span>`
  else icon = `<span class="at-ic link"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></span>`
  const cta = a.type === 'event' ? 'Add to calendar' : a.type === 'file' ? 'Open' : 'Open link'
  return `<div class="attach ${a.type}">${icon}<span class="at-b"><b>${esc(a.title)}</b><small>${esc(a.subtitle)}</small></span><span class="at-cta">${cta}</span></div>`
}

function assistHTML(a, c) {
  const st = a.state
  const settled = (st === 'done' || st === 'dismissed') && settledAt[a.id] && Date.now() - settledAt[a.id] > 6000
  if (settled) return `<div class="as settled"><button class="cb" data-observe="${a.id}" title="What ${AGENT_NAME()} did">${chibi(AGENT(), { state: 'idle', size: 14 })}</button></div>`
  const map = { reading: 'reading', waiting: 'idle', talking: 'talking', working: 'idle', ready: 'ready', done: 'done', dismissed: 'done' }
  const mine = chibi(a.agents?.[0]?.harness || AGENT(), { state: map[st] || 'idle', size: 30 })
  const theirs = st === 'talking' && a.agents?.[1] ? chibi(a.agents[1].harness, { state: 'talking', size: 30, turn: 1 }) : ''
  const line = st === 'reading' ? `${AGENT_NAME()} is reading` : a.line
  const html = `<div class="as s-${st}">
    <button class="cb ${theirs ? 'pair' : ''}" data-observe="${a.id}" title="What ${AGENT_NAME()} is doing">${mine}${theirs}</button>
    <span class="as-line">${esc(line)}${['reading', 'talking', 'working'].includes(st) ? '<span class="ell"><i></i><i></i><i></i></span>' : ''}</span>`
  if (st === 'ready' && a.proposal) {
    return `<div class="as s-ready"><button class="cb" data-observe="${a.id}" title="What ${AGENT_NAME()} found">${mine}</button><div class="prop">
      <div class="prop-t"><b>${esc(a.proposal.label)}</b><small>${esc(a.proposal.detail || '')}</small></div>
      <div class="prop-a"><button class="btn-dark" data-approve="${a.id}">${esc(a.proposal.action || 'Send')}</button><button class="btn-text" data-dismiss="${a.id}">Not now</button><button class="btn-text quiet" data-observe="${a.id}">Details</button></div>
    </div></div>`
  }
  return html + '</div>'
}

function dayLabel(ts) {
  const d = new Date(ts), n = new Date()
  const days = Math.round((new Date(n.toDateString()) - new Date(d.toDateString())) / 86400000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long' })
}

function renderMsgs(force) {
  const box = $('#msgs')
  const c = chat()
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90
  const list = S.messages[c.id] || []
  const group = c.kind === 'group'
  const canSee = sees(c)
  let html = ''
  let prev = null
  let lastDay = ''
  for (const m of list) {
    const day = dayLabel(m.ts)
    if (day !== lastDay) { html += `<div class="day"><span>${day}</span></div>`; lastDay = day; prev = null }
    const fresh = !seen.has(m.id) && !firstPaint
    seen.add(m.id)
    if (m.kind === 'system') { html += `<div class="sysline ${fresh ? 'enter' : ''}">${esc(m.text)}</div>`; prev = null; continue }
    const mine = m.from === ME()
    const u = S.users[m.from]
    const cont = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60000
    const body = m.kind === 'attachment'
      ? `<div class="bubble att">${quote(m)}${attachmentHTML(m)}</div>`
      : `<div class="bubble">${quote(m)}${esc(m.text)}</div>`
    const meta = `<span class="meta">${m.assistedBy ? `<span class="with">${SPARK}sent with ${esc(MARKS[m.assistedBy]?.name || m.assistedBy)}</span> · ` : ''}${helpers.time(m.ts)}${m.via && m.via !== 'yap' && !mine ? ` · ${esc(S.bridges[m.via]?.name || m.via)}` : ''}</span>`
    html += `<div class="row ${mine ? 'mine' : 'them'} ${cont ? 'cont' : ''} ${fresh ? 'enter' : ''}" data-mid="${m.id}">
      ${!mine && group ? `<span class="row-av">${cont ? '' : av(u, 26)}</span>` : ''}
      <div class="bw">${!mine && group && !cont ? `<span class="who" style="color:${u.color}">${esc(u.name)}</span>` : ''}${body}${reactions(m)}${actions(m)}</div>
    </div>`
    const a = canSee ? helpers.assistFor(S, m.id) : null
    const next = list[list.indexOf(m) + 1]
    const showMeta = !next || next.from !== m.from || next.ts - m.ts > 5 * 60000 || m.assistedBy || a
    if (showMeta) html += `<div class="metarow ${mine ? 'mine' : ''} ${group && !mine ? 'ind' : ''}">${meta}</div>`
    if (a) html += `<div class="under ${mine ? 'mine' : ''} ${group && !mine ? 'ind' : ''}">${assistHTML(a, c)}</div>`
    prev = m
  }
  for (const id of helpers.isTyping(S, c.id)) {
    const u = S.users[id]
    html += `<div class="row them typing">${group ? `<span class="row-av">${av(u, 26)}</span>` : ''}<div class="bw"><div class="bubble dots"><i></i><i></i><i></i></div></div></div>`
  }
  box.innerHTML = `<div class="msgs-in">${html}</div>`
  if (force || atBottom || firstPaint) box.scrollTop = box.scrollHeight
}

// ───────────────────────── footer: bridge line, reply, composer ─────────────────────────
function renderFoot() {
  const c = chat()
  const bl = $('#bridgeLine')
  if (c.transport !== 'yap') {
    const invited = (S.messages[c.id] || []).some((m) => m.kind === 'system' && /^Invite sent/.test(m.text))
    bl.innerHTML = `<span>${esc(S.bridges[c.transport].note || '')}</span>${invited ? '<span class="sent">Invite sent</span>' : `<button class="link" data-invite="${c.id}">Invite to yapping</button>`}`
    bl.style.display = ''
  } else bl.style.display = 'none'
  const r = replyTo && (S.messages[c.id] || []).find((m) => m.id === replyTo)
  $('#replying').innerHTML = r ? `<div class="rp"><span>Replying to <b>${esc(r.from === ME() ? 'yourself' : S.users[r.from]?.name)}</b> ${esc(r.text || r.attachment?.title || '')}</span><button data-cancel-reply="1" title="Cancel">×</button></div>` : ''
  $('#input').placeholder = `Message ${title(c)}${c.transport !== 'yap' ? ` on ${S.bridges[c.transport].name}` : ''}`
}

// ───────────────────────── observation sheet ─────────────────────────
function renderSheet() {
  const el = $('#sheet')
  const a = observeId && S.assists[observeId]
  el.classList.toggle('open', !!a)
  el.setAttribute('aria-hidden', String(!a))
  if (!a) { el.innerHTML = ''; return }
  const map = { reading: 'reading', waiting: 'idle', talking: 'talking', working: 'idle', ready: 'ready', done: 'done', dismissed: 'done' }
  const chibis = (a.agents || [{ harness: AGENT() }]).map((g, i) => `<span class="sh-cb">${chibi(g.harness, { state: a.state === 'talking' ? 'talking' : i ? 'idle' : map[a.state], size: 30, turn: i })}<small>${i ? esc(peerAgent(a)) : esc(AGENT_NAME())}</small></span>`).join('')
  const msg = (S.messages[a.chatId] || []).find((m) => m.id === a.msgId)
  const items = [...(a.log || [])]
  const rows = items.map((l) => `<li class="${l.who}"><span class="tl-dot"></span><div><span class="tl-who">${l.who === 'mine' ? esc(AGENT_NAME()) : esc(peerAgent(a) || 'Their agent')}</span><p>${esc(l.text)}</p></div><time>${helpers.time(l.at)}</time></li>`).join('')
  el.innerHTML = `<div class="sh">
    <div class="sh-grab"></div>
    <div class="sh-head"><div><span class="sh-k">What ${esc(AGENT_NAME())} is doing</span><b>${esc(a.state === 'reading' ? 'Reading' : a.line)}</b></div><button class="sh-x" data-close-sheet="1" title="Close">×</button></div>
    <div class="sh-cbs">${chibis}</div>
    ${msg ? `<div class="sh-re">About <b>${esc(msg.from === ME() ? 'your' : S.users[msg.from]?.name + '’s')}</b> message: “${esc(msg.text || msg.attachment?.title)}”</div>` : ''}
    <ol class="tl">${rows || `<li class="mine"><span class="tl-dot"></span><div><span class="tl-who">${esc(AGENT_NAME())}</span><p>${esc(a.state === 'waiting' ? a.line : 'Reading the message')}</p></div></li>`}
      ${['reading', 'talking', 'working', 'waiting'].includes(a.state) ? '<li class="live"><span class="tl-dot"></span><div><p><span class="ell"><i></i><i></i><i></i></span></p></div></li>' : ''}</ol>
    ${a.state === 'ready' && a.proposal ? `<div class="sh-prop"><b>${esc(a.proposal.label)}</b><small>${esc(a.proposal.detail || '')}</small><div class="prop-a"><button class="btn-dark" data-approve="${a.id}">${esc(a.proposal.action || 'Send')}</button><button class="btn-text" data-dismiss="${a.id}">Not now</button></div></div>` : ''}
    <p class="sh-foot">Only you see this. Agents talk here, never in the chat.</p>
  </div>`
}

// ───────────────────────── contact info ─────────────────────────
function renderProfile() {
  const el = $('#profile')
  el.classList.toggle('open', profileOpen)
  el.setAttribute('aria-hidden', String(!profileOpen))
  if (!profileOpen) { el.innerHTML = ''; return }
  const c = chat()
  const o = c.kind === 'dm' ? other(c) : null
  const ins = sees(c) ? S.insights[c.id] : null
  const members = c.kind === 'group' ? c.members.map((id) => S.users[id]) : []
  el.innerHTML = `<div class="pf">
    <button class="sh-x pf-x" data-close-profile="1" title="Close">×</button>
    <div class="pf-top">${chatAv(c, 64)}<h2>${esc(title(c))}</h2><p>${o ? `${esc(o.handle)}${o.agent && c.transport === 'yap' ? ` · works in ${esc(MARKS[o.agent]?.name || o.agent)}` : ''}` : `${members.length} people`}</p>
      ${c.transport !== 'yap' ? `<span class="pf-src">via ${esc(S.bridges[c.transport].name)}</span>` : ''}</div>
    ${members.length ? `<div class="pf-sec"><span class="pf-k">People</span>${members.map((u) => `<div class="pf-m">${av(u, 24)}<span>${esc(u.id === ME() ? 'You' : u.name)}</span><small>${u.agent ? esc(MARKS[u.agent]?.name || '') : ''}</small></div>`).join('')}</div>` : ''}
    <div class="pf-sec">${seesToggle(c, true)}<p class="pf-note">${sees(c) ? `${AGENT_NAME()} reads new messages here and can offer to help. Nothing is sent without you.` : `${AGENT_NAME()} doesn't read this chat. Turn it on to let it help.`}</p></div>
    ${ins ? `<div class="pf-sec"><span class="pf-k">What ${esc(AGENT_NAME())} knows about you two</span>
      <p class="pf-rel">${esc(ins.relation)}</p>
      <ul class="pf-facts">${ins.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <div class="pf-vibe">${ins.vibe.map((v) => `<span>${esc(v)}</span>`).join('')}</div>
      <div class="pf-warm"><span>Closeness</span><span class="bar"><i style="width:${Math.round(ins.warmth * 100)}%"></i></span></div>
      <p class="pf-note">Kept on this Mac. Only ${esc(AGENT_NAME())} uses it, only for you.</p></div>` : ''}
  </div>`
}

// ───────────────────────── Claude chrome: band, status line, toast ─────────────────────────
function renderPeek() {
  const el = $('#peek')
  const pa = peekAssist && S.assists[peekAssist]
  if (pa && pa.state === 'ready' && pa.proposal) {
    const c = chat(pa.chatId)
    el.innerHTML = `<div class="peek-in ask">${chibi(AGENT(), { state: 'ready', size: 18 })}<span class="pk-t"><b>${esc(title(c))}</b> · ${esc(pa.proposal.label)}</span>
      <button class="pk-r" data-approve="${pa.id}">${esc(pa.proposal.action || 'Send')}</button><button class="pk-n" data-dismiss="${pa.id}">Not now</button></div>`
    return
  }
  if (!peekMsg) {
    const pc = S.chats.find((c) => c.pinned) || S.chats[0]
    peekMsg = [...(S.messages[pc.id] || [])].reverse().find((m) => m.kind === 'text' && m.from !== ME())
  }
  if (!peekMsg) { el.innerHTML = ''; return }
  const u = S.users[peekMsg.from]
  const c = chat(peekMsg.chatId)
  el.innerHTML = `<div class="peek-in">${av(u, 20)}<span class="pk-t"><b>${esc(u.name)}:</b> ${esc(peekMsg.text)}</span>
    <span class="pk-via">${c && c.transport !== 'yap' ? esc(S.bridges[c.transport].name) + ' · ' : ''}${helpers.ago(peekMsg.ts)}</span>
    <button class="pk-r" data-open="${peekMsg.chatId}">Reply</button></div>`
}

function renderStatus() {
  const total = totalUnread()
  const pend = S.chats.filter(sees).reduce((n, c) => n + helpers.pending(S, c.id).length, 0)
  const busy = helpers.busy(S).filter((a) => sees(chat(a.chatId) || {}))[0]
  const bits = [total ? `${total} unread` : 'No unread']
  if (pend) bits.push(`${pend} waiting for you`)
  if (busy) bits.push(`${AGENT_NAME()} ${busy.state === 'talking' ? `is talking to ${peerAgent(busy)}` : busy.state === 'waiting' ? `is waiting on ${title(chat(busy.chatId))}` : `is reading ${title(chat(busy.chatId))}`}…`)
  $('#statusline').innerHTML = `<span class="sl-a">~/repos/yapping</span><span class="sl-g">main*</span><span>Opus 5.5</span><span>ctx 41%</span>
    <span class="sl-yap"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a1.5 1.5 0 0 1-1.5-1.5Z"/></svg><span class="sl-txt">${esc(bits.join(' · '))}</span></span>
    <span class="sl-mode ${yap.mode}">${yap.mode === 'live' ? '● live' : '○ offline'}</span>`
}

function toast({ icon, kicker, title: t, body, chatId, actions = '' }) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = `<span class="to-icon">${icon}</span><div class="to-b"><span class="to-k">${esc(kicker)}</span><b>${esc(t)}</b>${body ? `<small>${esc(body)}</small>` : ''}</div>${actions || `<button class="to-o" data-open="${chatId}">Open</button>`}`
  $('#toasts').appendChild(el)
  setTimeout(() => el.classList.add('out'), 9000)
  setTimeout(() => el.remove(), 9600)
}

// ───────────────────────── render loop ─────────────────────────
function renderAll(force) {
  renderList(); renderHead(); renderMsgs(force); renderFoot(); renderPeek(); renderStatus()
  if (observeId) renderSheet()
}

function open(id) {
  if (!chat(id)) return
  const changed = id !== cur
  cur = id
  if (changed) { replyTo = null; observeId = null; renderSheet() }
  yap.send({ t: 'read', chatId: id })
  renderAll(true)
  renderProfile()
}

if (!cur || !chat(cur)) cur = (S.chats.find((c) => c.pinned) || S.chats[0]).id

let readTimer
yap.subscribe((state, ev) => {
  S = state
  if (ev?.type === 'message') {
    const m = ev.message
    if (m.chatId === cur && m.from !== ME()) { clearTimeout(readTimer); readTimer = setTimeout(() => yap.send({ t: 'read', chatId: cur }), 400) }
    if (m.kind === 'text' && m.from !== ME() && m.from !== 'system') {
      peekMsg = m
      if (m.chatId !== cur) toast({ icon: av(S.users[m.from], 34), kicker: sourceName(chat(m.chatId)) || 'Message', title: S.users[m.from].name, body: m.text, chatId: m.chatId })
    }
  }
  if (ev?.type === 'assist') {
    const a = ev.assist
    if ((a.state === 'done' || a.state === 'dismissed') && !settledAt[a.id]) settledAt[a.id] = Date.now()
    if (a.state === 'ready' && lastState[a.id] !== 'ready') {
      peekAssist = a.id
      toast({ icon: chibi(AGENT(), { state: 'ready', size: 30 }), kicker: `${AGENT_NAME()} · ${title(chat(a.chatId))}`, title: a.proposal?.label || a.line, body: a.proposal?.detail, chatId: a.chatId })
      if (autoApprove && a.chatId === cur) setTimeout(() => yap.send({ t: 'approve', chatId: a.chatId, assistId: a.id }), 1200)
    }
    if (a.state !== 'ready' && peekAssist === a.id) peekAssist = null
    lastState[a.id] = a.state
    if (observeFollow && a.chatId === cur) observeId = a.id
  }
  if ((ev?.type === 'insight' || ev?.type === 'chat_update') && profileOpen && ev.chatId === cur) renderProfile()
  renderAll(ev?.type === 'message' && ev.message.from === ME())
})
// Assists already settled when we arrived are shown as idle marks.
for (const a of Object.values(S.assists)) { lastState[a.id] = a.state; if (a.state === 'done' || a.state === 'dismissed') settledAt[a.id] = 1 }
if (observeFollow) {
  const latest = Object.values(S.assists).filter((a) => a.chatId === cur).sort((a, b) => b.startedAt - a.startedAt)[0]
  if (latest) observeId = latest.id
}
renderAll(true)
renderSheet()
renderProfile()
firstPaint = false
$('#transcript').scrollTop = 1e6
yap.send({ t: 'read', chatId: cur })

// Typing dots expire; done assists settle into idle marks.
setInterval(() => {
  const settling = Object.values(S.assists).some((a) => settledAt[a.id] > 1 && Date.now() - settledAt[a.id] < 7500)
  if (Object.keys(S.typing || {}).length || settling) renderMsgs()
}, 1000)

// ───────────────────────── interactions ─────────────────────────
function say(text) {
  const c = chat()
  if (!text.trim()) return
  yap.send({ t: 'send', chatId: c.id, text, replyTo: replyTo || undefined })
  replyTo = null
}
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault()
  const v = $('#input').value
  $('#input').value = ''
  autosize()
  say(v)
})
let lastTyping = 0
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 110) + 'px' }
$('#input').addEventListener('input', () => {
  autosize()
  if (Date.now() - lastTyping > 2500) { lastTyping = Date.now(); yap.send({ t: 'typing', chatId: cur }) }
})
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit() }
})
$('#searchBtn').addEventListener('click', () => {
  $('#list').classList.toggle('searching')
  if ($('#list').classList.contains('searching')) $('#search').focus()
  else { query = ''; $('#search').value = ''; renderList() }
})
$('#search').addEventListener('input', (e) => { query = e.target.value; renderList() })
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#searchBtn').click() })

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-chat]')
  if (!t) return
  const d = t.dataset
  if (d.chat) return open(d.chat)
  if (d.open) return open(d.open)
  if (d.rx) return yap.send({ t: 'react', chatId: cur, msgId: d.id, emoji: d.rx })
  if (d.reply) { replyTo = d.reply; renderFoot(); $('#input').focus(); return }
  if (d.cancelReply) { replyTo = null; renderFoot(); return }
  if (d.sees) return yap.send({ t: 'set_sees', chatId: cur, on: d.sees === '1' })
  if (d.approve) { const a = S.assists[d.approve]; return yap.send({ t: 'approve', chatId: a?.chatId || cur, assistId: d.approve }) }
  if (d.dismiss) { const a = S.assists[d.dismiss]; return yap.send({ t: 'dismiss', chatId: a?.chatId || cur, assistId: d.dismiss }) }
  if (d.observe) { observeFollow = false; observeId = observeId === d.observe ? null : d.observe; return renderSheet() }
  if (d.closeSheet) { observeFollow = false; observeId = null; return renderSheet() }
  if (d.invite) return yap.send({ t: 'invite_p2p', chatId: d.invite })
  if (d.profile) { profileOpen = true; return renderProfile() }
  if (d.closeProfile) { profileOpen = false; return renderProfile() }
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (observeId) { observeId = null; observeFollow = false; renderSheet() } else if (profileOpen) { profileOpen = false; renderProfile() }
})

// ───────────────────────── demo drivers ─────────────────────────
if (demo) {
  const [chatId, text] = demo
  setTimeout(() => {
    if (text) yap.send({ t: 'send', chatId, text })
    else if (demoId === 'bridge') yap.send({ t: 'invite_p2p', chatId })
    else if (demoId === 'theo' && autoApprove) {
      const a = helpers.pending(S, chatId)[0]
      if (a) yap.send({ t: 'approve', chatId, assistId: a.id })
    }
  }, 1000)
}
