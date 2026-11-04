// The yapping sidebar: people text people; your agent shows up only as a
// chibi mark under a message it's handling. One render path for every host;
// the layout (compact card, panel, fullscreen) follows the space we're given.
import { helpers } from '../../shared/sim.js'
import { chibi } from '../../shared/chibi.js'
import { NETWORKS, netGlyph, I } from './icons.js'
import { qrSVG } from './qr.js'

const params = new URLSearchParams(location.search)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', codex: 'Codex', opencode: 'opencode', pi: 'pi', mobile: 'yapping' }
const ACTIVE = ['reading', 'talking', 'working', 'waiting']
const CHIBI_STATE = { reading: 'reading', waiting: 'idle', talking: 'talking', working: 'idle', ready: 'ready', done: 'done', dismissed: 'done' }

export function mount(root, yap) {
  let S = yap.state
  const ui = {
    cur: params.get('chat') || null, // open chat
    view: params.get('chat') || params.get('view') === 'chat' ? 'chat' : 'list', // panel navigation
    expanded: params.get('expand') === '1', // compact card opened a chat in place
    query: '',
    searching: false,
    replyTo: null,
    observe: null, // assist id shown in "what it did"
    observeFollow: params.get('observe') === '1',
    menu: params.get('menu') === '1',
    link: null, // { network, phase: 'loading'|'qr'|'linked'|'error', qr, error, expiresAt }
    notice: null,
    firstPaint: true,
  }
  const seen = new Set()
  const settledAt = {}

  // ───────────── who's who ─────────────
  const ME = () => S.me
  const HOST = () => yap.host.agent || 'claude'
  const HOST_NAME = () => NAMES[HOST()] || 'Claude'
  const markOf = (h) => (h === 'chatgpt' ? 'codex' : h || markOf(HOST()))
  const agentLabel = (h) => (!h || markOf(h) === markOf(HOST()) ? HOST_NAME() : NAMES[h] || S.harnesses?.[h]?.name || h)
  const mark = (h, o) => chibi(markOf(h), o)
  const chat = (id = ui.cur) => S.chats.find((c) => c.id === id)
  const title = (c) => helpers.chatTitle(S, c)
  const other = (c) => helpers.otherPerson(S, c)
  const sees = (c) => !!c?.sees?.[ME()]
  const net = (c) => (c && c.transport && c.transport !== 'yap' ? c.transport : null)
  const netName = (n) => NETWORKS[n]?.name || S.bridges?.[n]?.name || n
  const chatOpen = (id) => ui.cur === id && (layout() === 'full' || ui.view === 'chat' || ui.expanded)
  const unread = (c) => (chatOpen(c.id) ? 0 : c.unread?.[ME()] || 0)
  const pending = (c) => (sees(c) ? helpers.pending(S, c.id).filter((a) => a.proposal) : [])
  const lastTs = (c) => helpers.lastMessage(S, c.id)?.ts || 0
  const ordered = () => [...S.chats].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || lastTs(b) - lastTs(a))
  const peerAgent = (a) => {
    const p = a.agents?.[1]
    return p ? `${S.users[p.owner]?.name || 'Their'}’s ${NAMES[p.harness] || 'agent'}` : ''
  }

  // ───────────── layout ─────────────
  function layout() {
    const forced = params.get('layout')
    if (forced) return forced === 'inline' ? (ui.expanded ? 'panel' : 'compact') : forced
    const mode = yap.host.displayMode
    const w = window.innerWidth
    const h = window.innerHeight
    if (mode === 'inline') return ui.expanded ? 'panel' : 'compact'
    if (mode) return w >= 760 ? 'full' : 'panel'
    if (h < 500 && !ui.expanded) return 'compact'
    return w >= 760 ? 'full' : 'panel'
  }

  function applyTheme() {
    const de = document.documentElement
    const t = params.get('theme') || yap.host.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    de.dataset.theme = t
    de.style.colorScheme = t
    de.dataset.flavor = params.get('flavor') || (['chatgpt', 'codex'].includes(HOST()) ? 'neutral' : 'claude')
    de.dataset.host = yap.kind
    if (yap.host.hostVars) de.dataset.hostvars = '1'
  }

  // ───────────── bits ─────────────
  function av(u, size = 36) {
    if (!u) return `<span class="av" style="--s:${size}px;--c:#888">?</span>`
    const initials = String(u.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2)
    return `<span class="av" style="--s:${size}px;--c:${esc(u.color || '#8A8880')}">${esc(initials)}</span>`
  }
  function chatAv(c, size = 36) {
    if (c.kind === 'group') {
      const [a, b] = c.members.filter((id) => id !== ME()).map((id) => S.users[id])
      return `<span class="av-pair" style="--s:${size}px">${av(a, Math.round(size * 0.68))}${av(b, Math.round(size * 0.68))}</span>`
    }
    return av(other(c), size)
  }
  const chip = (n, label = netName(n)) => (n ? `<span class="net net-${esc(n)}" title="On ${esc(netName(n))}">${netGlyph(n, 11)}<span>${esc(label)}</span></span>` : '')
  function preview(c) {
    const m = helpers.lastMessage(S, c.id)
    if (!m) return ''
    if (m.kind === 'system') return esc(m.text)
    const who = m.from === ME() ? 'You: ' : c.kind === 'group' ? `${S.users[m.from]?.name || ''}: ` : ''
    return `${esc(who)}${esc(m.text || m.attachment?.title || '')}`
  }
  function timeLabel(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000)
    if (days === 0) return helpers.time(ts)
    if (days === 1) return 'Yesterday'
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }

  // ───────────── chat list ─────────────
  function rowHTML(c, { compact = false } = {}) {
    const n = unread(c)
    const p = pending(c)[0]
    const busy = sees(c) && helpers.busy(S, c.id)[0]
    const on = c.id === ui.cur && layout() === 'full'
    const nm = c.kind === 'group' ? c.title : title(c)
    return `<button class="li ${on ? 'on' : ''} ${n ? 'has-un' : ''}" data-chat="${esc(c.id)}">
      ${chatAv(c, compact ? 34 : 40)}
      <span class="li-main">
        <span class="li-top"><b class="li-n">${esc(nm)}</b>${chip(net(c))}${c.pinned && !compact ? `<span class="pin" title="Pinned">${I.pin}</span>` : ''}<time>${timeLabel(lastTs(c))}</time></span>
        <span class="li-sub"><span class="li-pv">${preview(c)}</span>${p ? `<span class="li-cb" title="${esc(HOST_NAME())} has something for you">${mark(p.agents?.[0]?.harness, { state: 'ready', size: 16 })}</span>` : busy ? `<span class="li-cb" title="${esc(HOST_NAME())} is on it">${mark(busy.agents?.[0]?.harness, { state: CHIBI_STATE[busy.state], size: 16 })}</span>` : ''}${n ? `<em class="un">${n}</em>` : ''}</span>
      </span>
    </button>`
  }
  function renderList() {
    const q = ui.query.toLowerCase()
    const rows = ordered().filter((c) => !q || `${title(c)} ${c.title || ''} ${net(c) ? netName(net(c)) : ''}`.toLowerCase().includes(q))
    $('.rows').innerHTML = rows.map((c) => rowHTML(c)).join('') || `<p class="empty">${q ? 'No chats match.' : 'No chats yet.'}</p>`
    const total = S.chats.reduce((a, c) => a + unread(c), 0)
    $('.l-title').innerHTML = `Chats${total ? `<span class="l-count">${total}</span>` : ''}`
    $('.list').classList.toggle('searching', ui.searching)
  }

  // ───────────── header ─────────────
  function presence(c) {
    const n = net(c)
    if (n) {
      const o = other(c)
      return `<span class="on-net net-ink-${esc(n)}">on ${esc(netName(n))}</span>${o?.handle && c.kind === 'dm' ? `<span class="dim"> · ${esc(o.handle)}</span>` : ''}`
    }
    if (c.kind === 'group') return `${c.members.length} people`
    const o = other(c)
    if (!o) return ''
    const on = o.status === 'online'
    const h = NAMES[o.harness] || S.harnesses?.[o.harness]?.name
    return `<i class="st ${on ? 'on' : ''}"></i>${on ? (h ? `in ${esc(h)}` : 'online') : h ? `away · works in ${esc(h)}` : 'away'}`
  }
  function seesSwitch(c) {
    const on = sees(c)
    return `<button class="sees ${on ? 'on' : ''}" data-sees="${on ? 0 : 1}" role="switch" aria-checked="${on}" title="${on ? `Turn off: ${HOST_NAME()} stops reading this chat` : `Let ${HOST_NAME()} read this chat and offer to help`}">
      <span class="sees-c">${mark(HOST(), { state: on ? 'idle' : 'sleeping', size: 15 })}</span>
      <span class="sees-t">${esc(HOST_NAME())} ${on ? 'can' : 'can’t'} see this chat</span>
      <span class="sw"><i></i></span></button>`
  }
  function renderHead() {
    const c = chat()
    if (!c) return
    const L = layout()
    const back = L === 'panel' ? `<button class="ib back" data-back="1" title="All chats">${I.back}</button>` : ''
    const full = L === 'panel' && ui.expanded && yap.supports('fullscreen') ? `<button class="ib" data-fullscreen="1" title="Open full screen">${I.expand}</button>` : ''
    $('.ch').innerHTML = `${back}
      <div class="ch-who">${chatAv(c, 34)}<span class="ch-t"><span class="ch-n"><b>${esc(c.kind === 'group' ? c.title : title(c))}</b>${chip(net(c))}</span><small>${presence(c)}</small></span></div>
      ${full}${seesSwitch(c)}`
  }

  // ───────────── messages ─────────────
  const RBAR = ['👍', '❤️', '😂', '🙌']
  const hoverBar = (m) => `<div class="hover">${RBAR.map((e) => `<button data-rx="${e}" data-id="${esc(m.id)}" title="React ${e}">${e}</button>`).join('')}<button class="hv-reply" data-reply="${esc(m.id)}" title="Reply">${I.reply}</button></div>`
  function reactions(m) {
    const r = Object.entries(m.reactions || {}).filter(([, who]) => who?.length)
    if (!r.length) return ''
    return `<div class="rxs">${r.map(([e, who]) => `<button class="rx ${who.includes(ME()) ? 'mine' : ''}" data-rx="${esc(e)}" data-id="${esc(m.id)}" title="${esc(who.map((id) => (id === ME() ? 'You' : S.users[id]?.name)).join(', '))}">${esc(e)}${who.length > 1 ? `<span>${who.length}</span>` : ''}</button>`).join('')}</div>`
  }
  function quote(m) {
    if (!m.replyTo) return ''
    const q = (S.messages[m.chatId] || []).find((x) => x.id === m.replyTo)
    if (!q) return ''
    return `<div class="quote"><b>${esc(q.from === ME() ? 'You' : S.users[q.from]?.name)}</b>${esc(q.text || q.attachment?.title || '')}</div>`
  }
  function attachmentHTML(m) {
    const a = m.attachment || {}
    let icon
    if (a.type === 'event') {
      const [d] = String(a.subtitle || '').split(' ')
      icon = `<span class="at-date"><small>${esc(d)}</small><b>${esc((String(a.subtitle).match(/\d{1,2}:\d{2}/) || [''])[0])}</b></span>`
    } else if (a.type === 'file') icon = `<span class="at-ic file">${esc((String(a.title).split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span>`
    else icon = `<span class="at-ic link">${I.link}</span>`
    const cta = a.type === 'event' ? 'Add to calendar' : a.type === 'file' ? 'Open' : 'Open link'
    return `<div class="attach ${esc(a.type)}">${icon}<span class="at-b"><b>${esc(a.title)}</b><small>${esc(a.subtitle)}</small></span>${a.url ? `<button class="at-cta" data-url="${esc(a.url)}">${cta}</button>` : `<span class="at-cta">${cta}</span>`}</div>`
  }
  function proposalHTML(a, extra = '') {
    return `<div class="prop">
      <div class="prop-t"><b>${esc(a.proposal.label)}</b>${a.proposal.detail ? `<small>${esc(a.proposal.detail)}</small>` : ''}</div>
      <div class="prop-a"><button class="btn-dark" data-approve="${esc(a.id)}">${esc(a.proposal.action || 'Send')}</button><button class="btn-text" data-dismiss="${esc(a.id)}">Not now</button>${extra}</div>
    </div>`
  }
  function assistHTML(a) {
    const st = a.state
    const h = a.agents?.[0]?.harness
    const who = agentLabel(h)
    const settled = (st === 'done' || st === 'dismissed') && settledAt[a.id] && Date.now() - settledAt[a.id] > 6000
    if (settled) return `<div class="as settled"><button class="cb" data-observe="${esc(a.id)}" title="What ${esc(who)} did">${mark(h, { state: 'idle', size: 14 })}</button></div>`
    const mine = mark(h, { state: CHIBI_STATE[st] || 'idle', size: 26 })
    if (st === 'ready' && a.proposal) {
      return `<div class="as s-ready"><button class="cb" data-observe="${esc(a.id)}" title="What ${esc(who)} did">${mine}</button>${proposalHTML(a, `<button class="btn-text quiet" data-observe="${esc(a.id)}">What ${esc(who)} did</button>`)}</div>`
    }
    const theirs = st === 'talking' && a.agents?.[1] ? chibi(markOf(a.agents[1].harness), { state: 'talking', size: 26, turn: 1 }) : ''
    const line = st === 'reading' ? `${who} is reading` : a.line || ''
    return `<div class="as s-${esc(st)}">
      <button class="cb ${theirs ? 'pair' : ''}" data-observe="${esc(a.id)}" title="What ${esc(who)} ${ACTIVE.includes(st) ? 'is doing' : 'did'}">${mine}${theirs}</button>
      <span class="as-line">${esc(line)}${ACTIVE.includes(st) && st !== 'waiting' ? '<span class="ell"><i></i><i></i><i></i></span>' : ''}</span></div>`
  }
  function dayLabel(ts) {
    const d = new Date(ts)
    const days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000)
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: days > 6 ? 'numeric' : undefined, month: days > 6 ? 'short' : undefined })
  }
  function renderMsgs(force) {
    const box = $('.msgs')
    const c = chat()
    if (!c || !box) return
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90
    const list = S.messages[c.id] || []
    const group = c.kind === 'group'
    const canSee = sees(c)
    let html = ''
    let prev = null
    let lastDay = ''
    list.forEach((m, i) => {
      const day = dayLabel(m.ts)
      if (day !== lastDay) { html += `<div class="day"><span>${esc(day)}</span></div>`; lastDay = day; prev = null }
      const fresh = !seen.has(m.id) && !ui.firstPaint
      seen.add(m.id)
      if (m.kind === 'system' || m.from === 'system') { html += `<div class="sysline ${fresh ? 'enter' : ''}">${esc(m.text)}</div>`; prev = null; return }
      const mine = m.from === ME()
      const u = S.users[m.from]
      const cont = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60000
      const body = m.kind === 'attachment' ? `<div class="bubble att">${quote(m)}${attachmentHTML(m)}</div>` : `<div class="bubble">${quote(m)}${esc(m.text)}</div>`
      html += `<div class="row ${mine ? 'mine' : 'them'} ${cont ? 'cont' : ''} ${fresh ? 'enter' : ''}" data-mid="${esc(m.id)}">
        ${!mine && group ? `<span class="row-av">${cont ? '' : av(u, 26)}</span>` : ''}
        <div class="bw">${!mine && group && !cont ? `<span class="who" style="--c:${esc(u?.color || '#888')}">${esc(u?.name)}</span>` : ''}${body}${reactions(m)}${hoverBar(m)}</div></div>`
      const a = canSee ? helpers.assistFor(S, m.id) : null
      const next = list[i + 1]
      if (!next || next.from !== m.from || next.ts - m.ts > 5 * 60000 || m.assistedBy || a) {
        const via = m.via && m.via !== 'yap' && !mine && c.transport === 'yap' ? ` · ${esc(netName(m.via))}` : ''
        html += `<div class="metarow ${mine ? 'mine' : ''} ${group && !mine ? 'ind' : ''}">${m.assistedBy ? `<button class="with" data-observe-msg="${esc(m.id)}">${mark(m.assistedBy, { state: 'idle', size: 11 })}sent with ${esc(agentLabel(m.assistedBy))}</button> · ` : ''}${helpers.time(m.ts)}${via}</div>`
      }
      if (a) html += `<div class="under ${mine ? 'mine' : ''} ${group && !mine ? 'ind' : ''}">${assistHTML(a)}</div>`
      prev = m
    })
    for (const id of helpers.isTyping(S, c.id)) {
      html += `<div class="row them typing">${group ? `<span class="row-av">${av(S.users[id], 26)}</span>` : ''}<div class="bw"><div class="bubble dots"><i></i><i></i><i></i></div></div></div>`
    }
    if (!list.length) html += `<p class="empty">Say hello to ${esc(title(c))}${net(c) ? ` on ${esc(netName(net(c)))}` : ''}.</p>`
    box.innerHTML = `<div class="msgs-in">${html}</div>`
    if (force || atBottom || ui.firstPaint) box.scrollTop = box.scrollHeight
  }

  // ───────────── composer ─────────────
  function renderFoot() {
    const c = chat()
    if (!c) return
    const n = net(c)
    const note = String((n && S.bridges?.[n]?.note) || '').replace(/^Their agent can't join you on [^.]+\./, "Their agent can't join you there.")
    $('.bridge-line').innerHTML = n ? `<span class="net-ink-${esc(n)}">${netGlyph(n, 11)}</span><span>Sent through ${esc(netName(n))}. ${esc(note)}</span>` : ''
    $('.bridge-line').hidden = !n
    const r = ui.replyTo && (S.messages[c.id] || []).find((m) => m.id === ui.replyTo)
    $('.replying').innerHTML = r ? `<div class="rp"><span>Replying to <b>${esc(r.from === ME() ? 'yourself' : S.users[r.from]?.name)}</b> ${esc(r.text || r.attachment?.title || '')}</span><button type="button" data-cancel-reply="1" title="Cancel">${I.close}</button></div>` : ''
    const input = $('.composer textarea')
    input.placeholder = `Message ${c.kind === 'group' ? c.title : title(c)}${n ? ` on ${netName(n)}` : ''}`
    $('.composer').className = `composer ${n ? `bridged net-c-${n}` : ''}`
  }

  // ───────────── what it did ─────────────
  function sheetHTML(a) {
    const h = a.agents?.[0]?.harness
    const who = agentLabel(h)
    const live = ACTIVE.includes(a.state)
    const chibis = (a.agents?.length ? a.agents : [{ harness: h }]).map((g, i) => `<span class="sh-cb">${chibi(markOf(g.harness), { state: a.state === 'talking' ? 'talking' : i ? 'idle' : CHIBI_STATE[a.state], size: 26, turn: i })}<small>${i ? esc(peerAgent(a)) : esc(who)}</small></span>`).join('')
    const msg = (S.messages[a.chatId] || []).find((m) => m.id === a.msgId)
    const c = chat(a.chatId)
    const rows = (a.log || []).map((l) => `<li class="${esc(l.who)}"><span class="tl-dot"></span><div><span class="tl-who">${l.who === 'them' ? esc(peerAgent(a) || 'Their agent') : esc(who)}</span><p>${esc(l.text)}</p></div><time>${l.at ? helpers.time(l.at) : ''}</time></li>`).join('')
    return `<div class="sh" role="dialog" aria-label="What ${esc(who)} ${live ? 'is doing' : 'did'}">
      <div class="sh-head"><div><span class="sh-k">What ${esc(who)} ${live ? 'is doing' : 'did'}${c && layout() === 'compact' ? ` · ${esc(title(c))}` : ''}</span><b>${esc(a.state === 'reading' ? 'Reading' : a.line)}</b></div><button class="ib sh-x" data-close-sheet="1" title="Close">${I.close}</button></div>
      <div class="sh-cbs">${chibis}</div>
      ${msg ? `<div class="sh-re">About ${msg.from === ME() ? 'your' : `<b>${esc(S.users[msg.from]?.name)}</b>’s`} message: “${esc(msg.text || msg.attachment?.title)}”</div>` : ''}
      <ol class="tl">${rows || `<li class="mine"><span class="tl-dot"></span><div><span class="tl-who">${esc(who)}</span><p>${esc(a.state === 'waiting' ? a.line : a.state === 'done' ? a.line : 'Reading the message')}</p></div><time></time></li>`}
        ${live ? '<li class="live"><span class="tl-dot"></span><div><p><span class="ell"><i></i><i></i><i></i></span></p></div><time></time></li>' : ''}</ol>
      ${a.state === 'ready' && a.proposal ? `<div class="sh-prop">${proposalHTML(a)}</div>` : ''}
      <p class="sh-foot">Only you see this. Agents talk here, never in the chat.</p>
    </div>`
  }
  function renderSheet() {
    const el = $('.sheet')
    const a = ui.observe && S.assists[ui.observe]
    el.classList.toggle('open', !!a)
    el.setAttribute('aria-hidden', String(!a))
    $('.scrim').classList.toggle('open', !!a)
    el.innerHTML = a ? sheetHTML(a) : ''
  }

  // ───────────── + menu and bridge linking ─────────────
  function bridgeStatus(n) {
    const b = S.bridges?.[n] || {}
    const st = b.status || (b.linked ? 'linked' : 'unlinked')
    return { st, account: b.account }
  }
  function renderMenu() {
    const el = $('.menu')
    el.hidden = !ui.menu
    if (!ui.menu) return
    const wa = bridgeStatus('whatsapp')
    const sl = bridgeStatus('slack')
    el.innerHTML = `<div class="mn-k">Bring in your other chats</div>
      <button class="mn-row" data-link="whatsapp"><span class="mn-ic net-bg-whatsapp">${netGlyph('whatsapp', 15)}</span><span class="mn-b"><b>${wa.st === 'linked' ? 'WhatsApp' : 'Connect WhatsApp'}</b><small>${wa.st === 'linked' ? `Connected${wa.account ? ` · ${esc(wa.account)}` : ''}` : wa.st === 'linking' ? 'Waiting for your phone' : 'Scan a code with your phone'}</small></span>${wa.st === 'linked' ? `<span class="mn-ok">${I.check}</span>` : I.chev}</button>
      <button class="mn-row" ${sl.st === 'linked' ? '' : 'data-link="slack"'}><span class="mn-ic net-bg-slack">${netGlyph('slack', 14)}</span><span class="mn-b"><b>${sl.st === 'linked' ? 'Slack' : 'Connect Slack'}</b><small>${sl.st === 'linked' ? 'Connected' : 'Your workspace DMs'}</small></span>${sl.st === 'linked' ? `<span class="mn-ok">${I.check}</span>` : I.chev}</button>
      <div class="mn-foot">${mark(HOST(), { state: 'sleeping', size: 13 })}<span>${esc(HOST_NAME())} only sees chats you switch on.</span></div>`
  }
  function renderLink() {
    const el = $('.linkv')
    const L = ui.link
    el.hidden = !L
    $('.scrim').classList.toggle('open', !!L || !!(ui.observe && S.assists[ui.observe]))
    if (!L) { el.innerHTML = ''; return }
    const n = L.network
    const nm = netName(n)
    let body = ''
    if (L.phase === 'loading') body = `<div class="lk-wait"><span class="ell"><i></i><i></i><i></i></span><p>Asking your Mac for a code…</p></div>`
    else if (L.phase === 'qr') {
      const expired = L.expiresAt && Date.now() > L.expiresAt
      body = `<div class="lk-grid">
        <div class="lk-qr ${expired ? 'expired' : ''}">${qrSVG(L.qr, { size: 184 })}${expired ? `<button class="btn-dark lk-re" data-link="${esc(n)}">Get a new code</button>` : ''}</div>
        <ol class="lk-steps"><li>Open ${esc(nm)} on your phone</li><li>Tap <b>Settings</b>, then <b>Linked devices</b></li><li>Tap <b>Link a device</b> and point your phone at this code</li></ol>
      </div>
      <p class="lk-status"><span class="ell"><i></i><i></i><i></i></span>Waiting for your phone</p>`
    } else if (L.phase === 'linked') {
      body = `<div class="lk-done"><span class="lk-ok net-bg-${esc(n)}">${I.check}</span><p><b>${esc(nm)} is connected</b>${L.account ? `<small>${esc(L.account)}</small>` : ''}</p><p class="dim">Your ${esc(nm)} chats will appear in the list, labelled ${esc(nm)}.</p><button class="btn-dark" data-close-link="1">Done</button></div>`
    } else if (L.phase === 'error') {
      const notYet = /not_set_up|not_implemented|unknown|not set up/i.test(`${L.code} ${L.error}`)
      body = `<div class="lk-done"><p><b>${notYet ? `${esc(nm)} linking isn’t set up yet` : `Couldn’t get a code`}</b></p><p class="dim">${notYet ? `Your yapping app on this Mac doesn’t do ${esc(nm)} yet. It’s coming in the next update; nothing to do for now.` : esc(L.error || 'Something went wrong.')}</p><div class="lk-a">${notYet ? '' : `<button class="btn-dark" data-link="${esc(n)}">Try again</button>`}<button class="btn-text" data-close-link="1">Close</button></div></div>`
    }
    el.innerHTML = `<div class="lk" role="dialog" aria-label="Connect ${esc(nm)}">
      <div class="lk-head"><span class="mn-ic net-bg-${esc(n)}">${netGlyph(n, 15)}</span><b>Connect ${esc(nm)}</b><button class="ib" data-close-link="1" title="Close">${I.close}</button></div>
      ${body}
      ${n === 'whatsapp' && (L.phase === 'qr' || L.phase === 'loading') ? `<p class="lk-warn">${I.warn}<span>yapping links as an unofficial WhatsApp client. WhatsApp’s terms don’t allow that, and accounts can be banned.</span></p>` : ''}
    </div>`
  }
  let linkPoll
  async function startLink(network) {
    ui.menu = false
    ui.link = { network, phase: 'loading' }
    renderMenu(); renderLink()
    clearInterval(linkPoll)
    try {
      const r = await yap.call('bridge', { op: 'link', network })
      if (!ui.link) return
      if (r?.status === 'linked') ui.link = { network, phase: 'linked', account: r.account }
      else if (!r?.qr) throw Object.assign(new Error(r?.message || 'not set up'), { code: r?.code || 'not_set_up' })
      else ui.link = { network, phase: 'qr', qr: r.qr, expiresAt: r.expiresAt }
    } catch (e) {
      if (ui.link) ui.link = { network, phase: 'error', error: e.message, code: e.code }
    }
    renderLink()
    if (ui.link?.phase === 'qr') {
      linkPoll = setInterval(async () => {
        if (ui.link?.phase !== 'qr') return clearInterval(linkPoll)
        try {
          const s = await yap.call('bridge', { op: 'status', network })
          if (s?.status === 'linked') linkDone(network, s.account)
        } catch {}
        if (ui.link?.phase === 'qr' && ui.link.expiresAt && Date.now() > ui.link.expiresAt) renderLink()
      }, 2000)
    }
  }
  function linkDone(network, account) {
    if (ui.link?.network !== network || ui.link.phase === 'linked') return
    clearInterval(linkPoll)
    ui.link = { network, phase: 'linked', account }
    renderLink()
  }

  // ───────────── compact card (inline) ─────────────
  function renderCompact() {
    const el = $('.compact')
    const props = S.chats.flatMap((c) => pending(c).map((a) => ({ a, c })))
    const unreadChats = ordered().filter((c) => unread(c) > 0)
    const total = unreadChats.reduce((n, c) => n + unread(c), 0)
    const bits = [total ? `${total} unread` : 'No unread', props.length ? `${props.length} waiting for you` : ''].filter(Boolean)
    const shown = unreadChats.slice(0, 4)
    const rest = unreadChats.length - shown.length
    const recent = !unreadChats.length ? ordered().slice(0, 3) : []
    const a = ui.observe && S.assists[ui.observe]
    if (a) { el.innerHTML = sheetHTML(a); return }
    el.innerHTML = `<header class="cp-h"><span class="cp-t"><b>Messages</b><small>${esc(bits.join(' · '))}</small></span><button class="ib" data-open-all="1" title="${yap.supports('fullscreen') ? 'Open full screen' : 'Open'}">${I.expand}</button></header>
      ${props.map(({ a, c }) => `<div class="cp-prop">
        <button class="cb" data-observe="${esc(a.id)}" title="What ${esc(agentLabel(a.agents?.[0]?.harness))} did">${mark(a.agents?.[0]?.harness, { state: 'ready', size: 24 })}</button>
        <div class="cp-pb"><button class="cp-who" data-chat="${esc(c.id)}">${esc(c.kind === 'group' ? c.title : title(c))}${chip(net(c))}</button>${proposalHTML(a)}</div></div>`).join('')}
      ${shown.length ? `<div class="cp-rows">${shown.map((c) => rowHTML(c, { compact: true })).join('')}${rest > 0 ? `<button class="cp-more" data-open-all="1">${rest} more</button>` : ''}</div>` : ''}
      ${recent.length ? `<p class="cp-k">You’re all caught up</p><div class="cp-rows">${recent.map((c) => rowHTML(c, { compact: true })).join('')}</div>` : ''}`
  }

  // ───────────── render ─────────────
  function $(s) { return root.querySelector(s) }
  function renderAll(force) {
    applyTheme()
    const L = layout()
    root.dataset.layout = L
    root.dataset.view = L === 'full' ? 'both' : L === 'compact' ? 'compact' : ui.view
    // A chat opened in place inside an inline card: give it a fixed height
    // (within the host's limit) so the card grows instead of the page.
    const inplace = ui.expanded && yap.host.displayMode === 'inline'
    const cap = yap.host.containerDimensions?.maxHeight || yap.host.containerDimensions?.height
    root.classList.toggle('inplace', inplace)
    root.style.height = inplace ? `${Math.min(560, cap || 560)}px` : ''
    if (L === 'compact') { renderCompact(); return }
    if (!ui.cur || !chat()) ui.cur = (ordered()[0] || {}).id
    renderList()
    if (chat()) { renderHead(); renderMsgs(force); renderFoot() }
    renderSheet(); renderMenu(); renderLink()
  }

  async function open(id, { expand = true } = {}) {
    if (!chat(id)) return
    const changed = id !== ui.cur
    ui.cur = id
    ui.view = 'chat'
    if (changed) { ui.replyTo = null; ui.observe = null }
    if (layout() === 'compact' && expand) {
      const got = await yap.requestDisplayMode('fullscreen')
      if (got !== 'fullscreen') ui.expanded = true
    }
    const c = chat(id)
    if (c.unread?.[ME()]) { c.unread = { ...c.unread, [ME()]: 0 }; yap.call('mark_read', { chat: id }).catch(() => {}) }
    renderAll(true)
    if (layout() !== 'compact' && matchMedia('(hover: hover)').matches) $('.composer textarea')?.focus({ preventScroll: true })
  }

  // ───────────── events from the backend ─────────────
  let readTimer
  yap.subscribe((state, ev) => {
    S = state
    if (!ev) return
    if (ev.type === 'snapshot') return renderAll()
    if (ev.type === 'message' && ev.message.chatId === ui.cur && ev.message.from !== ME() && chatOpen(ui.cur)) {
      clearTimeout(readTimer)
      readTimer = setTimeout(() => yap.call('mark_read', { chat: ui.cur }).catch(() => {}), 400)
    }
    if (ev.type === 'assist') {
      const a = ev.assist
      if ((a.state === 'done' || a.state === 'dismissed') && !settledAt[a.id]) settledAt[a.id] = Date.now()
      if (ui.observeFollow && a.chatId === ui.cur) ui.observe = a.id
      if (a.state === 'ready' && params.get('approve') === '1') setTimeout(() => yap.call('approve', { id: a.id }), 1200)
    }
    if (ev.type === 'bridge' && ev.status === 'linked') linkDone(ev.network, ev.account)
    if (ev.type === 'offline' || ev.type === 'online') { ui.notice = ev.type === 'offline' ? ev.message : null; renderNotice() }
    renderAll(ev.type === 'message' && ev.message.from === ME())
  })
  yap.onHost(() => renderAll())
  addEventListener('resize', () => renderAll())
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderAll())

  function renderNotice() {
    const el = $('.notice')
    el.hidden = !ui.notice
    el.textContent = ui.notice || ''
  }
  function flash(msg) {
    ui.notice = msg
    renderNotice()
    setTimeout(() => { if (ui.notice === msg) { ui.notice = null; renderNotice() } }, 5000)
  }
  const act = (p) => p.catch((e) => flash(e.message))

  // Assists already settled when we arrived show as quiet marks.
  for (const a of Object.values(S.assists)) if (a.state === 'done' || a.state === 'dismissed') settledAt[a.id] = 1
  if (ui.observeFollow) {
    const latest = Object.values(S.assists).filter((a) => !ui.cur || a.chatId === ui.cur).sort((a, b) => b.startedAt - a.startedAt)[0]
    if (latest) ui.observe = latest.id
  }
  renderAll(true)
  ui.firstPaint = false
  if (params.get('link')) startLink(params.get('link'))
  setInterval(() => {
    const settling = Object.values(S.assists).some((a) => settledAt[a.id] > 1 && Date.now() - settledAt[a.id] < 7500)
    if ((Object.keys(S.typing || {}).length || settling) && layout() !== 'compact') renderMsgs()
  }, 1000)

  // ───────────── interactions ─────────────
  const form = $('.composer')
  const input = $('.composer textarea')
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px' }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = input.value
    if (!text.trim() || !ui.cur) return
    input.value = ''
    autosize()
    const replyTo = ui.replyTo || undefined
    ui.replyTo = null
    renderFoot()
    act(yap.call('send', { chat: ui.cur, text, replyTo }))
  })
  let lastTyping = 0
  input.addEventListener('input', () => {
    autosize()
    if (yap.supports('typing') && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); yap.call('typing', { chat: ui.cur }).catch(() => {}) }
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit() }
  })
  $('.l-search').addEventListener('input', (e) => { ui.query = e.target.value; renderList() })
  $('.l-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { ui.searching = false; ui.query = ''; e.target.value = ''; renderList() } })

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-chat]')
    if (!t) {
      if (ui.menu && !e.target.closest('.menu')) { ui.menu = false; renderMenu() }
      return
    }
    const d = t.dataset
    if (ui.menu && !t.closest('.menu') && !d.menu) { ui.menu = false; renderMenu() }
    if (d.chat) return open(d.chat)
    if (d.back) { ui.view = 'list'; ui.observe = null; if (ui.expanded && yap.host.displayMode === 'inline') ui.expanded = false; return renderAll() }
    if (d.openAll) {
      return yap.requestDisplayMode('fullscreen').then((m) => {
        if (m !== 'fullscreen') { ui.expanded = true; ui.view = 'list' }
        renderAll()
      })
    }
    if (d.fullscreen) return yap.requestDisplayMode('fullscreen').then(() => renderAll())
    if (d.rx) return act(yap.call('react', { chat: ui.cur, msgId: d.id, emoji: d.rx }))
    if (d.reply) { ui.replyTo = d.reply; renderFoot(); input.focus(); return }
    if (d.cancelReply) { ui.replyTo = null; return renderFoot() }
    if (d.sees) return act(yap.call('set_sees', { chat: ui.cur, on: d.sees === '1' }))
    if (d.approve) return act(yap.call('approve', { id: d.approve }))
    if (d.dismiss) return act(yap.call('dismiss', { id: d.dismiss }))
    if (d.observe) { ui.observeFollow = false; ui.observe = ui.observe === d.observe ? null : d.observe; return layout() === 'compact' ? renderCompact() : renderSheet() }
    if (d.observeMsg) {
      const a = Object.values(S.assists).find((x) => (S.messages[x.chatId] || []).some((m) => m.id === d.observeMsg) && x.state === 'done')
      const near = a || Object.values(S.assists).filter((x) => x.chatId === ui.cur && x.state === 'done').sort((x, y) => y.startedAt - x.startedAt)[0]
      if (near) { ui.observe = near.id; renderSheet() }
      return
    }
    if (d.closeSheet) { ui.observeFollow = false; ui.observe = null; return layout() === 'compact' ? renderCompact() : renderSheet() }
    if (d.menu) { ui.menu = !ui.menu; return renderMenu() }
    if (d.search) { ui.searching = !ui.searching; renderList(); if (ui.searching) $('.l-search').focus(); else { ui.query = ''; $('.l-search').value = ''; renderList() } return }
    if (d.link) return startLink(d.link)
    if (d.closeLink) { clearInterval(linkPoll); ui.link = null; return renderLink() }
    if (d.url) return yap.openLink ? yap.openLink(d.url) : window.open(d.url, '_blank', 'noopener')
  })
  root.querySelector('.scrim').addEventListener('click', () => {
    ui.observe = null; ui.observeFollow = false
    if (ui.link && ui.link.phase !== 'qr') { clearInterval(linkPoll); ui.link = null }
    renderSheet(); renderLink()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (ui.link) { clearInterval(linkPoll); ui.link = null; renderLink() } else if (ui.observe) { ui.observe = null; ui.observeFollow = false; layout() === 'compact' ? renderCompact() : renderSheet() } else if (ui.menu) { ui.menu = false; renderMenu() }
  })

  return { ui, renderAll, open }
}

// The static skeleton; render functions fill its parts.
export const SKELETON = `
<nav class="list" aria-label="Chats">
  <header class="l-head"><b class="l-title">Chats</b>
    <button class="ib" data-search="1" title="Search chats">${I.search}</button>
    <button class="ib" data-menu="1" title="Connect WhatsApp and more">${I.plus}</button>
  </header>
  <input class="l-search" placeholder="Search" autocomplete="off" aria-label="Search chats">
  <div class="rows"></div>
  <div class="menu" hidden></div>
</nav>
<section class="chat" aria-label="Conversation">
  <header class="ch"></header>
  <div class="msgs"></div>
  <div class="foot">
    <div class="bridge-line" hidden></div>
    <div class="replying"></div>
    <form class="composer" autocomplete="off">
      <textarea rows="1" placeholder="Message" aria-label="Message"></textarea>
      <button type="submit" class="send" title="Send">${I.send}</button>
    </form>
  </div>
</section>
<div class="compact"></div>
<div class="scrim"></div>
<aside class="sheet" aria-hidden="true"></aside>
<div class="linkv" hidden></div>
<div class="notice" role="status" hidden></div>
`
