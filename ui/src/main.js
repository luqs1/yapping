import { connect } from './adapters.js'
import { mount, SKELETON, gateHTML } from './ui.js'

const params = new URLSearchParams(location.search)
// Headless screenshots can't advance entrance animations; show end states.
if (/HeadlessChrome/.test(navigator.userAgent)) document.documentElement.classList.add('shot')

const root = document.getElementById('yap')
root.innerHTML = SKELETON

// Before we have a host theme: follow ?theme= or the system.
const de = document.documentElement
const t0 = params.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
de.dataset.theme = t0
de.style.colorScheme = t0

// Signed out, or the node can't be reached: a proper screen that waits and
// gets out of the way by itself once yapping answers.
let gateLink = null
function onWaiting(err, { openLink } = {}) {
  gateLink = openLink || null
  root.dataset.layout = 'gate'
  root.innerHTML = gateHTML(err)
}
root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-gate-open],[data-gate-copy]')
  if (!b) return
  if (b.dataset.gateOpen) {
    const url = b.dataset.gateOpen
    if (gateLink) gateLink(url)
    else window.open(url, '_blank', 'noopener')
  } else {
    const text = b.dataset.gateCopy
    navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copied' }, () => {})
  }
})

let yap
try {
  yap = await connect({ onWaiting })
} catch (e) {
  root.dataset.layout = 'gate'
  root.innerHTML = gateHTML(e, { fatal: true })
  throw e
}
if (root.dataset.layout === 'gate') { root.dataset.layout = 'panel'; root.innerHTML = SKELETON }
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
