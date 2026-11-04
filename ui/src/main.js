import { connect } from './adapters.js'
import { mount, SKELETON } from './ui.js'

const params = new URLSearchParams(location.search)
// Headless screenshots can't advance entrance animations; show end states.
if (/HeadlessChrome/.test(navigator.userAgent)) document.documentElement.classList.add('shot')

const root = document.getElementById('yap')
root.innerHTML = SKELETON

let yap
try {
  yap = await connect()
} catch (e) {
  root.innerHTML = `<p class="boot-err">Couldn’t reach yapping. ${String(e.message || e)}</p>`
  throw e
}
const view = mount(root, yap)
window.__yap = { yap, view }

// ?demo= drivers, as in the mockups: [chat, message to send]
const DEMOS = {
  demo: ['dm-finn', 'hey can you take a look at my demo?'],
  schedule: ['dm-finn', 'can we grab 30 min thursday?'],
  theo: ['br-theo', null],
  mum: ['br-mum', null],
}
const demo = yap.kind === 'demo' && DEMOS[params.get('demo')]
if (demo) {
  const [chatId, text] = demo
  if (!params.get('chat') && params.get('layout') !== 'inline') view.open(chatId, { expand: false })
  if (text) setTimeout(() => yap.call('send', { chat: chatId, text }), Number(params.get('at')) || 600)
}
