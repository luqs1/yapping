// yapping — the shared core. Pure ESM, no deps: runs in the relay (Bun/Node),
// in a browser (offline fallback) and inside harness plugins.
//
// People text people. Each person may let their own agent (the harness they
// work in: Claude, opencode, pi, Codex) see a chat. An agent never posts in
// the chat: it hangs an *assist* under a message — reading it, talking to
// the other person's agent, or holding something ready for its owner to
// approve. Only what the owner approves lands in the chat, as their message.
//
// Every change is an event with a sequence number; clients fold events into
// state with applyEvent(), the same reducer everywhere.

export const HARNESSES = {
  claude: { name: 'Claude', color: '#D97757' },
  opencode: { name: 'opencode', color: '#1A1A1A' },
  pi: { name: 'pi', color: '#5B6CF0' },
  codex: { name: 'Codex', color: '#10A37F' },
  mobile: { name: 'yapping', color: '#25D366' },
}

// Honest one-liners: what a bridge costs you. WhatsApp and iMessage are
// end-to-end encrypted; the real loss there is that agents can't join.
export const BRIDGES = {
  yap: { name: 'yapping' },
  whatsapp: { name: 'WhatsApp', note: "Their agent can't join you on WhatsApp." },
  imessage: { name: 'iMessage', note: "Their agent can't join you on iMessage." },
  slack: { name: 'Slack', note: "Workspace admins can read Slack DMs, and Theo's agent can't join." },
  telegram: { name: 'Telegram', note: "Telegram chats aren't end-to-end encrypted by default." },
}

const PEOPLE = [
  { id: 'luqmaan', name: 'Luqmaan', handle: '@luqmaan', agent: 'claude', harness: 'claude', color: '#E8590C' },
  { id: 'finn', name: 'Finn', handle: '@finn', agent: 'opencode', harness: 'opencode', color: '#1C7ED6' },
  { id: 'nikita', name: 'Nikita', handle: '@nikita', agent: 'pi', harness: 'pi', color: '#2F9E44' },
  { id: 'maya', name: 'Maya', handle: '@maya', agent: 'codex', harness: 'codex', color: '#AE3EC9' },
  { id: 'mum', name: 'Mum', handle: '+44 7700 900123', bridge: 'whatsapp', color: '#2B8A3E' },
  { id: 'aisha', name: 'Aisha', handle: 'aisha@icloud.com', bridge: 'imessage', color: '#0B7285' },
  { id: 'theo', name: 'Theo', handle: 'Theo Park · Acme', bridge: 'slack', color: '#C2255C' },
]

// `sees`: whose agent may read this chat. Off for family by default.
const CHATS = [
  { id: 'dm-finn', kind: 'dm', title: 'Finn', transport: 'yap', members: ['luqmaan', 'finn'], pinned: true, sees: { luqmaan: true, finn: true } },
  { id: 'grp-cohort', kind: 'group', title: 'fall26 cohort', transport: 'yap', members: ['luqmaan', 'finn', 'nikita', 'maya'], sees: { luqmaan: true, finn: true, nikita: true, maya: false } },
  { id: 'br-theo', kind: 'dm', title: 'Theo', transport: 'slack', members: ['luqmaan', 'theo'], sees: { luqmaan: true } },
  { id: 'dm-nikita', kind: 'dm', title: 'Nikita', transport: 'yap', members: ['luqmaan', 'nikita'], sees: { luqmaan: true, nikita: true } },
  { id: 'br-mum', kind: 'dm', title: 'Mum', transport: 'whatsapp', members: ['luqmaan', 'mum'], sees: { luqmaan: false } },
  { id: 'br-aisha', kind: 'dm', title: 'Aisha', transport: 'imessage', members: ['luqmaan', 'aisha'], sees: { luqmaan: false } },
]

// Seeded history: [chat, from, text, minutesAgo, extra]
const HISTORY = [
  ['dm-finn', 'finn', 'yo did you see the demo day slot list', 95],
  ['dm-finn', 'luqmaan', "yeah we're right after the fintech lot 😬", 93],
  ['dm-finn', 'finn', "honestly if you ship that chat-in-claude thing i'd use it straight away", 90],
  ['dm-finn', 'finn', 'i live in claude all day and then have to alt-tab to whatsapp like a caveman', 90],
  ['dm-finn', 'luqmaan', "that's literally the pitch haha", 88, { reactions: { '😂': ['finn'] } }],
  ['grp-cohort', 'maya', "anyone else's board of goals still blank 👀", 240],
  ['grp-cohort', 'nikita', 'mine says "ship" and nothing else', 238, { reactions: { '💀': ['maya', 'finn'] } }],
  ['grp-cohort', 'finn', 'growth office hours at 4 if anyone wants to come roast my funnel', 120],
  ['grp-cohort', 'luqmaan', "i'll come", 117, { reactions: { '🙌': ['finn'] } }],
  ['dm-nikita', 'nikita', 'h2h worked first try btw. wild', 1440],
  ['dm-nikita', 'luqmaan', 'it only shares the wNikita folder, promise', 1438],
  ['dm-nikita', 'nikita', 'cute. scary. cute.', 1436, { reactions: { '❤️': ['luqmaan'] } }],
  ['br-mum', 'mum', 'Did you eat', 300],
  ['br-mum', 'luqmaan', 'yes mum', 299],
  ['br-mum', 'mum', 'What did you eat', 299],
  ['br-mum', 'mum', '🍲🍲 come sunday. bring your friend', 200],
  ['br-aisha', 'aisha', 'are we still on for the barbican thing saturday', 600],
  ['br-aisha', 'luqmaan', 'yes!! 7pm?', 590],
  ['br-aisha', 'aisha', 'perfect 🎻', 588],
  ['br-theo', 'theo', "hey, could you send over the API docs before thursday's call?", 40],
]

const INSIGHTS = {
  'dm-finn': { relation: 'Cohort-mates, friendly rivals', vibe: ['banter', 'builders', 'late-night'], facts: ['Both in the Fall26 EF cohort', 'Finn is building a consumer social app', 'You talk most days, usually after 10pm', 'Finn would use yapping inside Claude'], warmth: 0.82 },
  'dm-nikita': { relation: 'Friend, trusted peer', vibe: ['trust', 'tinkering'], facts: ['First h2h connection', 'His agent may read wNikita/ only', 'Prefers text over voice notes'], warmth: 0.74 },
  'grp-cohort': { relation: 'Your cohort', vibe: ['support', 'deadlines'], facts: ['Board of Goals due Thursday', 'Finn runs growth office hours at 4pm'], warmth: 0.68 },
  'br-theo': { relation: 'Work contact at Acme', vibe: ['formal', 'deadlines'], facts: ['Wants the API docs before Thursday', 'Replies within working hours'], warmth: 0.35 },
}

// What people nobody is driving say back. First matching rule wins.
const PERSONA = {
  finn: [
    [/\b(demo|look|check( it)? out|feedback|try)\b/i, ['yeah send it over!', 'ooh yes, send me the link', 'sure, after 4?']],
    [/\b(meet|call|coffee|catch ?up|thurs(day)?|fri(day)?|tomorrow|sync|30 ?min)\b/i, ["down, i'm free thursday afternoon", 'yes pls. thursday?']],
    [/\?$/, ['hmm good q', 'honestly no idea', 'yes. ship it.']],
    [/.*/, ['haha', 'real', 'ok this is sick', 'wait say more', 'lol']],
  ],
  nikita: [[/.*/, ['nice', 'checking', 'ha', 'cute. scary. cute.']]],
  maya: [[/.*/, ['love this', 'omw', '😂']]],
  mum: [
    [/\b(eat|ate|food|hungry)\b/i, ['Good. What did you eat', 'Eat properly']],
    [/.*/, ['Ok', 'Call me', 'Did you eat', '❤️', 'Sunday?']],
  ],
  aisha: [[/.*/, ['haha yes', 'perfect', 'see you there 🎻', 'omg']]],
  theo: [[/.*/, ['Thanks, will review and circle back.', 'Great, appreciate it.', 'Perfect, thanks.']]],
}

// What an agent can do about a message. `ask` matches the message that
// starts it; `yes` (optional) is the other person's reply it waits for.
const SCENARIOS = [
  {
    id: 'demo',
    ask: /\b(look at|check out|try|feedback on)\b.*\bdemo\b|\bdemo\b.*\?/i,
    yes: /\b(yes|yeah|yep|sure|send|ok|down)\b/i,
    waiting: (o) => `I'll send ${o.name} the link and a test login once they say yes`,
    talk: (me, o) => [
      ['them', `${o.name} has 20 minutes after 4 and prefers a Loom to a call`],
      ['mine', `Sending the staging link and a test login. Pointing ${o.name} at onboarding, it's the bit that changed`],
      ['them', `Got it. I'll remind ${o.name} at 4`],
    ],
    ready: (o) => ({ label: `Send ${o.name} the demo link and a test login?`, detail: 'staging.yapping.app · login: demo / ••••••', action: 'Send' }),
    result: (me, o) => ({ kind: 'attachment', attachment: { type: 'link', title: 'yapping demo (staging)', subtitle: 'staging.yapping.app · test login inside', url: 'https://staging.yapping.app' } }),
    done: (o) => `Sent. ${o.name}'s agent will nudge them at 4`,
  },
  {
    id: 'schedule',
    ask: /\b(meet|call|coffee|catch ?up|sync|grab \d+|30 ?min)\b/i,
    talk: (me, o) => [
      ['mine', `${me.name} is free Thu 14:00–16:00 or Fri 10:00`],
      ['them', `${o.name} can do Thu from 14:30, walking call if possible`],
      ['mine', 'Thu 14:30–15:00 then. Notes on?'],
      ['them', 'Fine by both'],
    ],
    ready: (o) => ({ label: `Thu 14:30–15:00 works for you both. Send ${o.name} the invite?`, detail: 'Walking call · Google Meet as backup · notes on', action: 'Send invite' }),
    result: (me, o) => ({ kind: 'attachment', attachment: { type: 'event', title: `${me.name} × ${o.name}`, subtitle: 'Thu 14:30 – 15:00 · walking call' } }),
    done: () => 'Invite sent. Both calendars updated',
  },
  {
    id: 'docs',
    ask: /\b(send|share)\b.*\b(docs?|deck|pdf|file|spec)\b/i,
    incoming: true,
    talk: () => [['action', 'Found "Acme API docs v3.pdf" in Drive, last edited Monday']],
    ready: (o) => ({ label: `Send ${o.name} "Acme API docs v3.pdf"?`, detail: '2.4 MB · last edited Monday', action: 'Send' }),
    result: () => ({ kind: 'attachment', attachment: { type: 'file', title: 'Acme API docs v3.pdf', subtitle: '2.4 MB · PDF' } }),
    done: (o) => `Sent to ${o.name}`,
  },
]

let idCounter = 0
const uid = (p) => `${p}_${Date.now().toString(36)}${(idCounter++).toString(36)}`
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length]

export function createSim(opts = {}) {
  const now = opts.now || (() => Date.now())
  const later = opts.schedule || ((fn, ms) => setTimeout(fn, ms))
  const speed = opts.speed || 1
  const listeners = new Set()
  const log = []
  let seq = 0
  let rolling = 0

  const users = Object.fromEntries(PEOPLE.map((p) => [p.id, { ...p, status: p.bridge ? 'bridged' : 'away', clients: [] }]))
  const chats = Object.fromEntries(CHATS.map((c) => [c.id, { ...c, members: [...c.members], sees: { ...c.sees }, unread: {} }]))
  const messages = Object.fromEntries(CHATS.map((c) => [c.id, []]))
  const assists = {}
  const insights = JSON.parse(JSON.stringify(INSIGHTS))
  const live = new Map()
  const waiting = [] // assists parked until the other person says yes

  const t0 = now()
  for (const [chatId, from, text, ago, extra = {}] of HISTORY) {
    messages[chatId].push({ id: uid('m'), chatId, from, kind: 'text', text, ts: t0 - ago * 60000, reactions: {}, via: chats[chatId].transport, ...extra })
  }
  chats['grp-cohort'].unread.luqmaan = 2
  chats['br-theo'].unread.luqmaan = 1

  // Theo's request is already sitting there with the doc found.
  const theoMsg = messages['br-theo'].at(-1)
  assists.seedTheo = {
    id: 'seedTheo', chatId: 'br-theo', msgId: theoMsg.id, owner: 'luqmaan', scenario: 'docs',
    agents: [{ owner: 'luqmaan', harness: 'claude' }], state: 'ready', line: 'Found the API docs',
    proposal: SCENARIOS[2].ready(users.theo), log: [{ who: 'mine', text: 'Found "Acme API docs v3.pdf" in Drive, last edited Monday', at: t0 - 39 * 60000 }],
    startedAt: t0 - 39 * 60000,
  }

  function emit(ev) {
    ev.seq = ++seq
    ev.at = now()
    log.push(ev)
    if (log.length > 3000) log.splice(0, log.length - 3000)
    for (const fn of listeners) fn(ev)
    return ev
  }

  const visible = (userId, chat) => chat.members.includes(userId)

  function snapshot(userId) {
    const mine = Object.values(chats).filter((c) => visible(userId, c))
    const ids = new Set(mine.map((c) => c.id))
    return {
      seq,
      me: userId,
      users,
      bridges: BRIDGES,
      harnesses: HARNESSES,
      chats: mine,
      messages: Object.fromEntries(mine.map((c) => [c.id, messages[c.id]])),
      assists: Object.fromEntries(Object.entries(assists).filter(([, a]) => a.owner === userId && ids.has(a.chatId))),
      insights: Object.fromEntries(Object.entries(insights).filter(([k]) => ids.has(k) && chats[k].sees[userId])),
    }
  }

  function eventVisible(userId, ev) {
    if (ev.type === 'presence') return true
    const chat = chats[ev.chatId]
    if (!chat || !visible(userId, chat)) return false
    if (ev.type === 'assist') return ev.assist.owner === userId
    if (ev.type === 'insight') return !!chat.sees[userId]
    return true
  }

  const since = (userId, after = 0) => log.filter((e) => e.seq > after && eventVisible(userId, e))
  const wait = (ms) => new Promise((r) => later(r, ms / speed))

  function post(chatId, from, extra) {
    const chat = chats[chatId]
    const m = { id: uid('m'), chatId, from, kind: 'text', text: '', ts: now(), reactions: {}, via: chat.transport, ...extra }
    messages[chatId].push(m)
    if (from !== 'system') for (const id of chat.members) if (id !== from && !users[id].bridge) chat.unread[id] = (chat.unread[id] || 0) + 1
    emit({ type: 'message', chatId, message: m })
    return m
  }

  function system(chatId, text) {
    return post(chatId, 'system', { kind: 'system', text })
  }

  function setAssist(a) {
    assists[a.id] = a
    emit({ type: 'assist', chatId: a.chatId, assist: JSON.parse(JSON.stringify(a)) })
  }

  // A person's agent is the harness they're working in right now (the mobile
  // app has none of its own, so it falls back to their usual one).
  const agentOf = (id) => (users[id]?.harness && users[id].harness !== 'mobile' ? users[id].harness : users[id]?.agent)

  // An agent can only act in a chat its owner lets it see.
  const canSee = (chat, userId) => !!chat.sees[userId] && !!users[userId]?.agent

  function newAssist(chat, msg, owner, scenario, partner) {
    const agents = [{ owner, harness: agentOf(owner) }]
    if (partner && canSee(chat, partner)) agents.push({ owner: partner, harness: agentOf(partner) })
    return { id: uid('a'), chatId: chat.id, msgId: msg.id, owner, scenario: scenario?.id, agents, state: 'reading', line: 'Reading', log: [], startedAt: now() }
  }

  // A glance: the agent reads a new message and, with nothing to do, rests.
  async function glance(chat, msg, owner) {
    const a = newAssist(chat, msg, owner)
    setAssist(a)
    await wait(2400)
    setAssist({ ...a, state: 'done', line: 'Read it. Nothing for you to do' })
  }

  async function run(sc, chat, msg, owner) {
    const me = users[owner]
    const otherId = chat.members.find((id) => id !== owner)
    const other = users[otherId]
    const a = newAssist(chat, msg, owner, sc, otherId)
    // The other side sees its own agent working on the same message.
    const b = a.agents.length > 1 ? { ...newAssist(chat, msg, otherId, sc, owner), agents: [a.agents[1], a.agents[0]] } : null
    const both = (patch) => {
      Object.assign(a, patch(a, 'mine'))
      setAssist(a)
      if (b) {
        Object.assign(b, patch(b, 'them'))
        setAssist(b)
      }
    }
    setAssist(a)
    if (b) setAssist(b)
    await wait(1600)
    if (sc.waiting) {
      both((x, side) => ({ state: 'waiting', line: side === 'mine' ? sc.waiting(other) : `${me.name} wants to send you something` }))
      await new Promise((resolve) => waiting.push({ chatId: chat.id, from: otherId, re: sc.yes, resolve }))
      await wait(900)
    }
    const talk = sc.talk(me, other)
    both((x, side) => {
      const peer = side === 'mine' ? other : me
      return { state: a.agents.length > 1 ? 'talking' : 'working', line: a.agents.length > 1 ? `Talking to ${peer.name}'s ${HARNESSES[agentOf(peer.id)]?.name ?? 'agent'}` : 'Looking' }
    })
    for (const [who, text] of talk) {
      if (who === 'them' && a.agents.length < 2) continue
      await wait(1400 + (rolling++ % 3) * 300)
      both((x, side) => ({ log: [...x.log, { who: who === 'action' ? 'mine' : side === 'mine' ? who : who === 'mine' ? 'them' : 'mine', text, at: now() }] }))
    }
    await wait(900)
    Object.assign(a, { state: 'ready', line: sc.ready(other).label, proposal: sc.ready(other) })
    setAssist(a)
    if (b) {
      Object.assign(b, { state: 'done', line: `${me.name} will send it over` })
      setAssist(b)
    }
  }

  async function autoReply(chat, trigger) {
    const responders = chat.members.filter((id) => id !== trigger.from && id !== 'luqmaan' && !(live.get(id) > 0))
    if (!responders.length) return
    const who = chat.kind === 'group' ? responders[rolling++ % responders.length] : responders[0]
    const rules = PERSONA[who] || [[/.*/, ['👍']]]
    const rule = rules.find(([re]) => re.test(trigger.text)) || rules[rules.length - 1]
    await wait(1400)
    emit({ type: 'typing', chatId: chat.id, user: who, until: now() + 2200 / speed })
    await wait(2200)
    received(chat, post(chat.id, who, { text: pick(rule[1], trigger.text.length + rolling++) }))
  }

  // Someone sent something: release parked assists, and let every member's
  // agent that can see the chat take a look.
  function received(chat, m) {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i]
      if (w.chatId === chat.id && w.from === m.from && w.re.test(m.text)) {
        waiting.splice(i, 1)
        w.resolve()
      }
    }
    const sc = SCENARIOS.find((s) => s.ask.test(m.text))
    for (const owner of chat.members) {
      if (!canSee(chat, owner) || users[owner].bridge) continue
      const busy = Object.values(assists).some((x) => x.chatId === chat.id && x.owner === owner && !['done', 'dismissed', 'ready'].includes(x.state))
      if (sc && !sc.incoming && owner === m.from && chat.kind === 'dm') run(sc, chat, m, owner)
      else if (sc && sc.incoming && owner !== m.from) run(sc, chat, m, owner)
      else if (owner !== m.from && !busy) glance(chat, m, owner)
    }
  }

  function handle(userId, action) {
    const chat = chats[action.chatId]
    if (!chat || !visible(userId, chat)) return { error: 'no such chat' }
    switch (action.t) {
      case 'send': {
        const text = String(action.text || '').slice(0, 4000)
        if (!text.trim()) return { error: 'empty' }
        const m = post(chat.id, userId, { text, replyTo: action.replyTo, client: action.client })
        chat.unread[userId] = 0
        received(chat, m)
        autoReply(chat, m)
        return { ok: true, message: m }
      }
      case 'react': {
        const m = messages[chat.id].find((x) => x.id === action.msgId)
        if (!m) return { error: 'no such message' }
        const list = m.reactions[action.emoji] || []
        m.reactions = { ...m.reactions, [action.emoji]: list.includes(userId) ? list.filter((x) => x !== userId) : [...list, userId] }
        if (!m.reactions[action.emoji].length) delete m.reactions[action.emoji]
        emit({ type: 'message_update', chatId: chat.id, message: { ...m } })
        return { ok: true }
      }
      case 'typing':
        emit({ type: 'typing', chatId: chat.id, user: userId, until: now() + 3000 })
        return { ok: true }
      case 'read':
        chat.unread[userId] = 0
        emit({ type: 'chat_update', chatId: chat.id, chat: { ...chat } })
        return { ok: true }
      case 'set_sees': {
        chat.sees = { ...chat.sees, [userId]: !!action.on }
        emit({ type: 'chat_update', chatId: chat.id, chat: { ...chat } })
        if (action.on && insights[chat.id]) emit({ type: 'insight', chatId: chat.id, insight: insights[chat.id] })
        return { ok: true }
      }
      case 'approve': {
        const a = assists[action.assistId]
        if (!a || a.owner !== userId || a.state !== 'ready') return { error: 'nothing to approve' }
        const sc = SCENARIOS.find((s) => s.id === a.scenario)
        const other = users[chat.members.find((id) => id !== userId)]
        setAssist({ ...a, state: 'working', line: 'Sending' })
        later(() => {
          post(chat.id, userId, { ...sc.result(users[userId], other), text: '', assistedBy: agentOf(userId) })
          setAssist({ ...assists[a.id], state: 'done', line: sc.done(other), proposal: undefined })
        }, 900 / speed)
        return { ok: true }
      }
      case 'dismiss': {
        const a = assists[action.assistId]
        if (!a || a.owner !== userId) return { error: 'no such assist' }
        setAssist({ ...a, state: 'dismissed', line: 'Left it', proposal: undefined })
        return { ok: true }
      }
      case 'invite_p2p': {
        if (chat.transport === 'yap') return { ok: true }
        const other = users[chat.members.find((id) => users[id].bridge)]
        system(chat.id, `Invite sent to ${other.name} through ${BRIDGES[chat.transport].name}`)
        later(() => {
          chat.transport = 'yap'
          other.bridge = null
          emit({ type: 'chat_update', chatId: chat.id, chat: { ...chat } })
          system(chat.id, `${other.name} is on yapping now. Same chat, no middleman`)
        }, 3000 / speed)
        return { ok: true }
      }
      default:
        return { error: 'unknown action' }
    }
  }

  function connect(userId, client) {
    if (!users[userId]) return
    live.set(userId, (live.get(userId) || 0) + 1)
    const u = users[userId]
    u.clients = [...new Set([...(u.clients || []), client])]
    u.status = 'online'
    if (client && HARNESSES[client]) u.harness = client
    emit({ type: 'presence', user: userId, status: 'online', harness: u.harness, clients: u.clients })
  }

  function disconnect(userId, client) {
    if (!users[userId]) return
    const n = (live.get(userId) || 1) - 1
    live.set(userId, n)
    const u = users[userId]
    if (n <= 0) {
      u.status = 'away'
      u.clients = []
    } else u.clients = u.clients.filter((c) => c !== client)
    emit({ type: 'presence', user: userId, status: u.status, harness: u.harness, clients: u.clients })
  }

  // People drift in and out so a room left open stays alive.
  const AMBIENT = [
    ['grp-cohort', 'maya', 'board of goals: "ship". stealing it'],
    ['dm-nikita', 'nikita', 'lisbon next week btw'],
    ['grp-cohort', 'finn', 'office hours moved to 4:30'],
  ]
  let ambientIdx = 0
  function ambient() {
    const [chatId, from, text] = AMBIENT[ambientIdx++ % AMBIENT.length]
    received(chats[chatId], post(chatId, from, { text }))
  }

  return {
    snapshot,
    since,
    handle,
    connect,
    disconnect,
    ambient,
    get seq() { return seq },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

// Fold one event into a client-side snapshot (mutates and returns state).
export function applyEvent(state, ev) {
  if (ev.seq && ev.seq <= (state.seq || 0)) return state
  state.seq = ev.seq || state.seq
  switch (ev.type) {
    case 'message': {
      const list = (state.messages[ev.chatId] ||= [])
      if (!list.some((m) => m.id === ev.message.id)) list.push(ev.message)
      const c = state.chats.find((x) => x.id === ev.chatId)
      if (c && ev.message.from !== state.me && ev.message.kind !== 'system') c.unread = { ...c.unread, [state.me]: (c.unread?.[state.me] || 0) + 1 }
      if (state.typing?.[ev.chatId]) delete state.typing[ev.chatId][ev.message.from]
      break
    }
    case 'message_update': {
      const list = state.messages[ev.chatId] || []
      const i = list.findIndex((m) => m.id === ev.message.id)
      if (i >= 0) list[i] = ev.message
      break
    }
    case 'assist':
      state.assists[ev.assist.id] = ev.assist
      break
    case 'typing':
      ;((state.typing ||= {})[ev.chatId] ||= {})[ev.user] = ev.until
      break
    case 'presence':
      if (state.users[ev.user]) Object.assign(state.users[ev.user], { status: ev.status, harness: ev.harness, clients: ev.clients })
      break
    case 'chat_update': {
      const i = state.chats.findIndex((c) => c.id === ev.chatId)
      if (i >= 0) state.chats[i] = ev.chat
      if (ev.chat.transport === 'yap') for (const id of ev.chat.members) if (state.users[id]?.bridge) state.users[id].bridge = null
      break
    }
    case 'insight':
      state.insights[ev.chatId] = ev.insight
      break
  }
  return state
}

// Helpers every UI wants.
export const helpers = {
  isTyping(state, chatId) {
    const t = state.typing?.[chatId] || {}
    const n = Date.now()
    return Object.entries(t).filter(([u, until]) => until > n && u !== state.me).map(([u]) => u)
  },
  // The assist hanging under a message, if any (the latest one).
  assistFor(state, msgId) {
    return Object.values(state.assists).filter((a) => a.msgId === msgId).sort((a, b) => b.startedAt - a.startedAt)[0]
  },
  // Assists that want the owner: a proposal waiting for approval.
  pending(state, chatId) {
    return Object.values(state.assists).filter((a) => a.state === 'ready' && (!chatId || a.chatId === chatId))
  },
  busy(state, chatId) {
    return Object.values(state.assists).filter((a) => ['reading', 'talking', 'working', 'waiting'].includes(a.state) && (!chatId || a.chatId === chatId))
  },
  canSee(state, chat) {
    return !!chat?.sees?.[state.me]
  },
  agentName(state, owner) {
    const u = state.users[owner]
    return state.harnesses[u?.agent]?.name ?? 'agent'
  },
  lastMessage(state, chatId) {
    const list = state.messages[chatId] || []
    return list[list.length - 1]
  },
  chatTitle(state, chat) {
    if (chat.kind !== 'dm') return chat.title
    const other = chat.members.find((id) => id !== state.me)
    return state.users[other]?.name || chat.title
  },
  otherPerson(state, chat) {
    return state.users[chat.members.find((x) => x !== state.me)]
  },
  time(ts) {
    return new Date(ts).toTimeString().slice(0, 5)
  },
  ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000)
    if (s < 60) return 'now'
    if (s < 3600) return `${Math.round(s / 60)}m`
    if (s < 86400) return `${Math.round(s / 3600)}h`
    return `${Math.round(s / 86400)}d`
  },
}
