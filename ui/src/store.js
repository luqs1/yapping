// The client-side state every adapter feeds: one normalised snapshot plus the
// same event reducer the sim uses, with the few extra events the node sends.
import { applyEvent, HARNESSES, BRIDGES } from '../../shared/sim.js'

const toMap = (v, key = 'id') => (Array.isArray(v) ? Object.fromEntries(v.map((x) => [x[key], x])) : { ...(v || {}) })

function normChat(c, me) {
  const chat = { members: [], transport: 'yap', kind: 'dm', ...c }
  if (typeof chat.unread === 'number') chat.unread = { [me]: chat.unread }
  chat.unread ||= {}
  if (typeof chat.sees === 'boolean') chat.sees = { [me]: chat.sees }
  chat.sees ||= {}
  return chat
}

// Accepts the sim snapshot and the looser shapes a node or server might send.
export function normalize(snap) {
  const s = JSON.parse(JSON.stringify(snap || {}))
  const me = typeof s.me === 'object' && s.me ? s.me.id : s.me
  const users = toMap(s.users)
  if (typeof s.me === 'object' && s.me && !users[me]) users[me] = s.me
  let messages = s.messages || {}
  if (Array.isArray(messages)) {
    const by = {}
    for (const m of messages) (by[m.chatId] ||= []).push(m)
    messages = by
  }
  const chats = (Array.isArray(s.chats) ? s.chats : Object.values(s.chats || {})).map((c) => normChat(c, me))
  for (const c of chats) messages[c.id] ||= []
  const bridges = {}
  for (const [k, v] of Object.entries({ ...BRIDGES, ...(s.bridges || {}) })) bridges[k] = { ...(BRIDGES[k] || {}), ...(v || {}) }
  return {
    seq: s.seq || 0,
    me,
    users,
    chats,
    messages,
    assists: toMap(s.assists),
    insights: s.insights || {},
    bridges,
    harnesses: { ...HARNESSES, ...(s.harnesses || {}) },
    typing: {},
  }
}

// Fold one UI event into state. Returns state (mutated).
export function reduce(state, ev) {
  if (!ev || !state) return state
  if (ev.seq && ev.seq <= (state.seq || 0)) return state
  switch (ev.type) {
    case 'chat_update': {
      // An unknown chat id means a new chat.
      if (!state.chats.some((c) => c.id === ev.chatId)) {
        state.chats.push(normChat(ev.chat, state.me))
        state.messages[ev.chatId] ||= []
        state.seq = ev.seq || state.seq
        return state
      }
      ev = { ...ev, chat: normChat(ev.chat, state.me) }
      break
    }
    case 'user':
      if (ev.user?.id) state.users[ev.user.id] = { ...(state.users[ev.user.id] || {}), ...ev.user }
      state.seq = ev.seq || state.seq
      return state
    case 'bridge': {
      const { type, seq, at, network, ...rest } = ev
      state.bridges[network] = { ...(state.bridges[network] || {}), ...rest }
      state.seq = ev.seq || state.seq
      return state
    }
    case '_unused':
      state.seq = ev.seq || state.seq
      return state
    case 'message':
      state.messages[ev.chatId] ||= []
      break
  }
  return applyEvent(state, ev)
}

export function createStore() {
  const subs = new Set()
  const store = {
    state: null,
    set(snap) {
      store.state = normalize(snap)
      store.emit({ type: 'snapshot' })
    },
    apply(ev) {
      if (!store.state) return
      reduce(store.state, ev)
      store.emit(ev)
    },
    emit(ev) {
      for (const fn of subs) fn(store.state, ev)
    },
    subscribe(fn) {
      subs.add(fn)
      if (store.state) fn(store.state, null)
      return () => subs.delete(fn)
    },
  }
  return store
}

// Results arrive as {result} / {error} envelopes, raw values, or MCP tool
// results; turn them into a value or a thrown Error with a .code.
export function unwrap(body) {
  if (body && typeof body === 'object' && 'error' in body && body.error) {
    const e = body.error
    const err = new Error(typeof e === 'string' ? e : e.message || e.code || 'Something went wrong')
    err.code = typeof e === 'object' ? e.code : e
    throw err
  }
  if (body && typeof body === 'object' && 'result' in body) return body.result
  return body
}
