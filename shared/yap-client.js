// yapping client for browsers and Node/Bun.
//
//   import { connect } from './yap-client.js'
//   const yap = await connect({ user: 'luqmaan', client: 'claude' })
//   yap.subscribe((state, ev) => render(state))
//   yap.send({ t: 'send', chatId: 'dm-finn', text: 'hi' })
//
// Tries the relay over WebSocket first; if none answers it runs the whole
// world in-page (offline mode) so a mockup works as a static file too.
// URL params override: ?user=finn  ?relay=ws://host:7788/ws  ?offline=1

import { createSim, applyEvent, helpers } from './sim.js'

export { helpers }

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()

function defaultRelay() {
  if (params.get('relay')) return params.get('relay')
  if (typeof location !== 'undefined' && location.protocol.startsWith('http') && location.port === '7788') return `ws://${location.host}/ws`
  return 'ws://localhost:7788/ws'
}

export async function connect(opts = {}) {
  const user = params.get('user') || opts.user || 'luqmaan'
  const client = params.get('client') || opts.client || 'web'
  const subs = new Set()
  let state = null
  const fire = (ev) => { for (const fn of subs) fn(state, ev) }

  const api = {
    mode: 'offline',
    user,
    get state() { return state },
    subscribe(fn) { subs.add(fn); if (state) fn(state, null); return () => subs.delete(fn) },
    send: () => {},
    helpers,
  }

  const tryWs = params.get('offline') !== '1' && !opts.offline && typeof WebSocket !== 'undefined'
  if (tryWs) {
    const ok = await new Promise((resolve) => {
      let done = false
      let ws
      try { ws = new WebSocket(`${opts.relay || defaultRelay()}?user=${user}&client=${client}`) } catch { return resolve(false) }
      const timer = setTimeout(() => { if (!done) { done = true; try { ws.close() } catch {} resolve(false) } }, opts.timeout || 900)
      ws.onmessage = (e) => {
        const ev = JSON.parse(e.data)
        if (ev.type === 'snapshot') {
          state = ev.state
          state.typing = {}
          if (!done) { done = true; clearTimeout(timer); resolve(true) }
          fire(null)
        } else if (state) {
          applyEvent(state, ev)
          fire(ev)
        }
      }
      ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve(false) } }
      ws.onclose = () => { if (api.mode === 'live') { api.mode = 'disconnected'; fire({ type: 'disconnected' }) } }
      api.send = (action) => ws.readyState === 1 && ws.send(JSON.stringify({ ...action, client }))
    })
    if (ok) { api.mode = 'live'; return api }
  }

  // Offline: the world lives in this page.
  const sim = createSim({ speed: opts.speed || 1 })
  sim.connect(user, client)
  state = sim.snapshot(user)
  state.typing = {}
  sim.on((ev) => {
    const vis = sim.since(user, ev.seq - 1).some((x) => x.seq === ev.seq)
    if (!vis) return
    applyEvent(state, JSON.parse(JSON.stringify(ev)))
    fire(ev)
  })
  api.send = (action) => sim.handle(user, { ...action, client })
  api.sim = sim
  if (!opts.noAmbient) setInterval(() => sim.ambient(), 45000)
  return api
}
