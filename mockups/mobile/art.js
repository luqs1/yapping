// yapping mobile — drawn things: harness marks, network badges, the doodle
// wallpaper, iOS-ish glyphs and the QR-ish "open on your phone" code.

let uid = 0
export const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0')

// ---------------------------------------------------------------- harness marks
export function harnessSVG(h, size = 16) {
  const s = `width="${size}" height="${size}" viewBox="0 0 24 24" class="hmark hm-${h}" aria-hidden="true"`
  if (h === 'claude') {
    let rays = ''
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const r = i % 2 ? 7.8 : 10.4
      rays += `M${(12 + Math.cos(a) * 2.6).toFixed(2)} ${(12 + Math.sin(a) * 2.6).toFixed(2)}L${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`
    }
    return `<svg ${s}><path d="${rays}" stroke="#D97757" stroke-width="2.7" stroke-linecap="round"/></svg>`
  }
  if (h === 'opencode') return `<svg ${s}><rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="#211E1E"/><rect x="7" y="7" width="10" height="10" rx="1" fill="none" stroke="#F1ECEC" stroke-width="2.2"/><rect x="9.6" y="12" width="4.8" height="2.9" fill="#F5A742"/></svg>`
  if (h === 'pi') return `<svg ${s}><path d="M4.5 7.2Q6 5.6 9 5.8H19.5M9.2 6V18.4M15 6V16.2Q15 18.6 17.6 18.2" stroke="#7C8CF8" stroke-width="2.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  if (h === 'codex') return `<svg ${s}><circle cx="12" cy="12" r="7.6" fill="none" stroke="#10A37F" stroke-width="3.2" stroke-dasharray="38 10" stroke-linecap="round" transform="rotate(-30 12 12)"/><circle cx="12" cy="12" r="2.2" fill="#10A37F"/></svg>`
  return `<svg ${s}><rect x="6.5" y="2.5" width="11" height="19" rx="3" fill="none" stroke="#1DAA61" stroke-width="2.2"/><path d="M10.5 18.2H13.5" stroke="#1DAA61" stroke-width="1.8" stroke-linecap="round"/></svg>`
}

// ---------------------------------------------------------------- network badges
export function netBadge(t) {
  if (t === 'whatsapp') return `<svg viewBox="0 0 20 20" class="netb"><circle cx="10" cy="10" r="10" fill="#25D366"/><path d="M5.2 14.9l.8-2.6A5 5 0 1 1 8 14.3z" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.3 7.6c.2-.4.5-.4.7 0l.4.9c.1.2 0 .4-.2.6l-.3.3c.4.8 1 1.4 1.8 1.8l.3-.3c.2-.2.4-.2.6-.1l.9.4c.3.2.3.5 0 .7-.6.6-1.4.6-2.3.1a5.6 5.6 0 0 1-2.2-2.3c-.4-.9-.3-1.6.3-2.1z" fill="#fff"/></svg>`
  if (t === 'imessage') return `<svg viewBox="0 0 20 20" class="netb"><circle cx="10" cy="10" r="10" fill="#34C759"/><path d="M10 4.8c3.2 0 5.6 2 5.6 4.5s-2.4 4.5-5.6 4.5c-.6 0-1.2-.1-1.8-.2L5.5 14.9l.8-2.3c-1.2-.8-1.9-2-1.9-3.3 0-2.5 2.4-4.5 5.6-4.5z" fill="#fff"/></svg>`
  if (t === 'slack') return `<svg viewBox="0 0 20 20" class="netb"><circle cx="10" cy="10" r="10" fill="#fff"/><g stroke-width="2.3" stroke-linecap="round"><path d="M8.2 4.5v5" stroke="#36C5F0"/><path d="M4.5 11.8h5" stroke="#2EB67D"/><path d="M11.8 15.5v-5" stroke="#ECB22E"/><path d="M15.5 8.2h-5" stroke="#E01E5A"/></g></svg>`
  if (t === 'telegram') return `<svg viewBox="0 0 20 20" class="netb"><circle cx="10" cy="10" r="10" fill="#229ED9"/><path d="M4.5 9.7l10-3.9c.5-.2.9.1.7.8l-1.7 8c-.1.6-.5.7-1 .4l-2.6-1.9-1.3 1.2c-.1.1-.3.2-.5.2l.2-2.7 4.8-4.4c.2-.2 0-.3-.3-.1L6.9 11.1 4.4 10.3c-.5-.2-.5-.5.1-.6z" fill="#fff"/></svg>`
  return `<svg viewBox="0 0 20 20" class="netb"><circle cx="10" cy="10" r="10" fill="#1DAA61"/><path d="M10 5c3 0 5.2 1.9 5.2 4.3S13 13.6 10 13.6c-.6 0-1.2-.1-1.7-.2L5.6 14.6l.8-2.2C5.4 11.6 4.8 10.5 4.8 9.3 4.8 6.9 7 5 10 5z" fill="#fff"/></svg>`
}

// ---------------------------------------------------------------- doodle wallpaper
// Thin-line doodles (cats, paws, yarn, fish, laptops, harness marks) on the
// WhatsApp beige — drawn once, tiled with CSS.
const D = {
  bubble: '<path d="M-10-6Q-10-9-7-9H7Q10-9 10-6V2Q10 5 7 5H-3L-8 9V5Q-10 5-10 2Z"/><circle cx="-4" cy="-2" r=".9" fill="C"/><circle cx="0" cy="-2" r=".9" fill="C"/><circle cx="4" cy="-2" r=".9" fill="C"/>',
  bubble2: '<path d="M-9-5Q-9-8-6-8H6Q9-8 9-5V1Q9 4 6 4H4L7 8 0 4H-6Q-9 4-9 1Z"/><path d="M-5-2H5M-5 1H2"/>',
  laptop: '<rect x="-10" y="-8" width="20" height="13" rx="1.6"/><path d="M-13 7H13L11.5 9.6H-11.5Z"/><path d="M-6-3.6L-3.4-1.6-6 .4M-1.6 .6H3"/>',
  claude: '<path d="M0-9V-3M0 3V9M-9 0H-3M3 0H9M-6.4-6.4L-2.2-2.2M2.2 2.2L6.4 6.4M6.4-6.4L2.2-2.2M-2.2 2.2L-6.4 6.4"/>',
  pi: '<path d="M-8-5Q-6-7-3-6.6H8M-3.4-6.6V7M3-6.6V5Q3 7.6 6 7"/>',
  square: '<rect x="-8" y="-8" width="16" height="16" rx="2"/><rect x="-4" y="-4" width="8" height="8" rx=".6"/>',
  ring: '<circle r="7.5" stroke-dasharray="36 11"/><circle r="1.6" fill="C"/>',
  heart: '<path d="M0 7C-9 1-9-6-4.5-6.6-2-7-0.6-5 0-4 .6-5 2-7 4.5-6.6 9-6 9 1 0 7Z"/>',
  plane: '<path d="M-10 0L10-8 4 9 0 2Z"/><path d="M0 2L10-8"/>',
  spark: '<path d="M0-8C1-2 2-1 8 0 2 1 1 2 0 8-1 2-2 1-8 0-2-1-1-2 0-8Z"/>',
  note: '<path d="M-3 6V-7L7-9V4"/><ellipse cx="-5.5" cy="6.4" rx="2.6" ry="2"/><ellipse cx="4.5" cy="4.4" rx="2.6" ry="2"/>',
  cup: '<path d="M-7-4H5V4Q5 8 1 8H-3Q-7 8-7 4Z"/><path d="M5-2H7.4Q9.6-2 9.6 1T6 4"/><path d="M-3-7Q-4-9-3-11M1-7Q0-9 1-11"/>',
  cal: '<rect x="-8" y="-7" width="16" height="15" rx="2"/><path d="M-8-2.4H8M-4-9.4V-5M4-9.4V-5"/><path d="M-3.4 3L-1 5.2 3.6.6"/>',
  sun: '<circle r="4"/><path d="M0-9V-6.6M0 6.6V9M-9 0H-6.6M6.6 0H9M-6.4-6.4L-4.7-4.7M4.7 4.7L6.4 6.4M6.4-6.4L4.7-4.7M-4.7 4.7L-6.4 6.4"/>',
  leaf: '<path d="M-8 8C-8-4 0-9 9-9 9 0 4 8-8 8Z"/><path d="M-8 8L4-4"/>',
  phone: '<rect x="-5.5" y="-9.5" width="11" height="19" rx="2.4"/><path d="M-1.6 6.6H1.6"/>',
  smile: '<circle r="8"/><circle cx="-2.8" cy="-2" r=".9" fill="C"/><circle cx="2.8" cy="-2" r=".9" fill="C"/><path d="M-3.6 2.4Q0 5.6 3.6 2.4"/>',
  cam: '<rect x="-9" y="-5" width="18" height="12" rx="2.4"/><circle cy="1" r="3.4"/><path d="M-3-5L-1.6-7.6H1.6L3-5"/>',
}
const LAYOUT = [
  ['smile', 22, 22, -12, 1], ['note', 78, 30, 0, .9], ['plane', 150, 18, 18, 1], ['claude', 206, 34, 0, .8],
  ['heart', 120, 64, -20, .85], ['laptop', 36, 78, 6, 1], ['bubble', 186, 84, -8, .9], ['pi', 248, 70, 0, .9],
  ['spark', 88, 104, 12, .7], ['cam', 140, 120, -6, .95], ['square', 24, 138, 10, .75], ['bubble2', 222, 136, 14, .9],
  ['sun', 72, 160, 0, .8], ['ring', 176, 168, 0, .85], ['leaf', 116, 184, -24, .9], ['heart', 250, 188, 18, .7],
  ['cup', 30, 208, -4, .95], ['cal', 196, 222, 8, .85], ['note', 140, 240, 0, .7], ['phone', 70, 252, -16, .9],
  ['laptop', 250, 248, -10, .85], ['spark', 236, 8, 0, .5], ['plane', 100, 8, 30, .55],
]
export function doodleURL(color = '#CDC3B3') {
  const g = LAYOUT.map(([k, x, y, r, s]) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${D[k].replace(/fill="C"/g, `fill="${color}"`)}</g>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="272" height="272" viewBox="0 0 272 272"><g fill="none" stroke="${color}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// ---------------------------------------------------------------- glyphs (SF-symbol-ish)
const st = (d, w = 1.7) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const PHONE = 'M6.6 3.6c.5-.5 1.3-.4 1.7.2l1.7 2.6c.3.5.3 1.1-.1 1.5L8.7 9.1c.9 2.3 3.6 5 6.1 6.1l1.3-1.2c.4-.4 1-.4 1.5-.1l2.6 1.7c.6.4.7 1.2.2 1.7l-1.4 1.6c-.8.9-2.1 1.2-3.2.7C10.6 17.7 6.4 13.4 4.3 8.2c-.5-1.1-.2-2.4.7-3.2z'
export const I = {
  back: '<svg viewBox="0 0 12 21" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 10.5 10 19"/></svg>',
  chevR: st('<path d="M9.5 5.5L16 12l-6.5 6.5"/>', 2.2),
  chevD: st('<path d="M6 9.5l6 6 6-6"/>', 2.2),
  video: st('<rect x="2.6" y="6.2" width="12.8" height="11.6" rx="3"/><path d="M15.4 10.4L21.2 7v10l-5.8-3.4"/>'),
  phone: st(`<path d="${PHONE}"/>`),
  phoneFill: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${PHONE}"/></svg>`,
  plus: st('<path d="M12 4.5v15M4.5 12h15"/>', 2),
  camera: st('<path d="M3.5 8.6c0-1.2 1-2.1 2.1-2.1h1.8l1.5-2h6.2l1.5 2h1.8c1.2 0 2.1.9 2.1 2.1v8.8c0 1.2-.9 2.1-2.1 2.1H5.6c-1.2 0-2.1-.9-2.1-2.1z"/><circle cx="12" cy="12.6" r="3.6"/>'),
  mic: st('<rect x="8.8" y="2.8" width="6.4" height="11.4" rx="3.2"/><path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 17.8v3.4"/>'),
  sticker: st('<path d="M20.5 11.6V7.4a3.9 3.9 0 0 0-3.9-3.9H7.4a3.9 3.9 0 0 0-3.9 3.9v9.2a3.9 3.9 0 0 0 3.9 3.9h4.2"/><path d="M20.5 11.6c-4.9 0-8.9 4-8.9 8.9"/><path d="M8.6 9.4v.1M15.4 9.4v.1M8.6 14c.9.9 2 1.4 3.2 1.4"/>'),
  search: st('<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4l4.6 4.6"/>', 2),
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.6 2.8h6.8c.6 0 .9.6.6 1.1l-1.3 1.8.8 5.2c1.9.9 3 2.4 3.2 4.2.1.5-.3.9-.8.9h-4.9l-.6 6.2c0 .3-.3.3-.4 0l-.6-6.2H6.5c-.5 0-.9-.4-.8-.9.2-1.8 1.3-3.3 3.2-4.2l.8-5.2L8 3.9c-.3-.5 0-1.1.6-1.1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7.6a5 5 0 0 1 10 0V10h.6c1 0 1.8.8 1.8 1.8v7.4c0 1-.8 1.8-1.8 1.8H6.4c-1 0-1.8-.8-1.8-1.8v-7.4c0-1 .8-1.8 1.8-1.8zm2.2 0h5.6V7.6a2.8 2.8 0 0 0-5.6 0z"/></svg>',
  bell: st('<path d="M6.2 16.8V11a5.8 5.8 0 0 1 11.6 0v5.8l1.6 1.6H4.6z"/><path d="M10 20.6a2.2 2.2 0 0 0 4 0"/>'),
  loc: st('<path d="M12 21s-6.4-6-6.4-11A6.4 6.4 0 0 1 18.4 10c0 5-6.4 11-6.4 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  clock: st('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 2"/>'),
  check: st('<path d="M5 12.6l4.4 4.4L19 7.4"/>', 2.3),
  x: st('<path d="M6 6l12 12M18 6L6 18"/>', 2.2),
  reply: st('<path d="M9.6 6.2L4 11.6l5.6 5.4M4.4 11.6h9.4c3.4 0 6.2 2.6 6.2 6.2"/>'),
  copy: st('<rect x="8.4" y="8.4" width="11.6" height="11.6" rx="2.4"/><path d="M15.6 8.4V6.4A2.4 2.4 0 0 0 13.2 4H6.4A2.4 2.4 0 0 0 4 6.4v6.8a2.4 2.4 0 0 0 2.4 2.4h2"/>'),
  star: st('<path d="M12 3.6l2.6 5.4 5.8.8-4.2 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
  info: st('<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4M12 7.6v.1"/>', 2),
  sparkle: st('<path d="M12 3.4c.8 4.6 2.2 6 6.8 6.8-4.6.8-6 2.2-6.8 6.8-.8-4.6-2.2-6-6.8-6.8 4.6-.8 6-2.2 6.8-6.8z"/><path d="M18.6 15.6c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4z"/>'),
  send: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4.2 19.4l16.2-7.1c.4-.2.4-.7 0-.9L4.2 4.6c-.4-.2-.8.2-.7.6l1.6 5.6 8.2 1.2-8.2 1.2-1.6 5.6c-.1.4.3.8.7.6z"/></svg>',
  // tab bar
  tChats: st('<path d="M12 3.6c4.9 0 8.6 3.4 8.6 7.8S16.9 19.2 12 19.2c-1 0-2-.1-2.9-.4L4.4 20.6l1.3-3.7C4.2 15.5 3.4 13.6 3.4 11.4 3.4 7 7.1 3.6 12 3.6z"/>'),
  tChatsOn: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3.6c4.9 0 8.6 3.4 8.6 7.8S16.9 19.2 12 19.2c-1 0-2-.1-2.9-.4L4.4 20.6l1.3-3.7C4.2 15.5 3.4 13.6 3.4 11.4 3.4 7 7.1 3.6 12 3.6z"/></svg>',
  tUpdates: st('<circle cx="12" cy="12" r="8.6" stroke-dasharray="4.2 2.6"/><circle cx="12" cy="12" r="4.4"/>'),
  tCalls: st(`<path d="${PHONE}"/>`),
  tYou: st('<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="10" r="3.1"/><path d="M6.4 18.4c1.2-2.2 3.2-3.4 5.6-3.4s4.4 1.2 5.6 3.4"/>'),
  ticks: '<svg viewBox="0 0 17 11" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M1.2 6.1l3 3 6.4-7.4"/><path d="M7.4 8.8l.5.4 6.4-7.4"/></svg>',
  tick: '<svg viewBox="0 0 12 11" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M1.6 6.1l3 3 6-7.4"/></svg>',
  edit: st('<path d="M4 20h4L19.4 8.6a2.8 2.8 0 0 0-4-4L4 16z"/>'),
  qr: st('<rect x="3.6" y="3.6" width="6.4" height="6.4" rx="1"/><rect x="14" y="3.6" width="6.4" height="6.4" rx="1"/><rect x="3.6" y="14" width="6.4" height="6.4" rx="1"/><path d="M14 14h2.6v2.6M20.4 14v.1M14 20.4h6.4v-3.2"/>'),
  archive: st('<rect x="3.4" y="4.4" width="17.2" height="4.4" rx="1.2"/><path d="M5 8.8v9.6c0 .9.7 1.6 1.6 1.6h10.8c.9 0 1.6-.7 1.6-1.6V8.8M9.8 12.6h4.4"/>'),
  key: st('<circle cx="8" cy="15.4" r="4"/><path d="M10.9 12.6L19.6 4M16.4 7.2l2.6 2.6M14.2 9.4l2 2"/>'),
  shield: st('<path d="M12 3l7.4 2.8v5.6c0 4.6-3 8.2-7.4 9.6-4.4-1.4-7.4-5-7.4-9.6V5.8z"/><path d="M8.8 12l2.2 2.2 4.4-4.6"/>'),
  data: st('<ellipse cx="12" cy="6" rx="7.4" ry="2.8"/><path d="M4.6 6v12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8V6M4.6 12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8"/>'),
  help: st('<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6M12 16.8v.1"/>'),
  link: st('<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1.2 1.2M13.8 10.2a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/>'),
  heart: st('<path d="M12 19.6C4.4 14.8 3.2 10.6 4.6 7.8 6 5 9.8 4.6 12 7.6c2.2-3 6-2.6 7.4.2 1.4 2.8.2 7-7.4 11.8z"/>'),
  arrowUR: st('<path d="M7 17L17 7M9 7h8v8"/>', 2),
  arrowDL: st('<path d="M17 7L7 17M15 17H7V9"/>', 2),
}

// ---------------------------------------------------------------- status bar
export const statusIcons = `<svg class="sb-signal" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg class="sb-wifi" viewBox="0 0 16 12"><path d="M8 2.6c2.4 0 4.6.9 6.2 2.5l1.2-1.3A10.3 10.3 0 0 0 8 .8C5.1.8 2.5 2 .6 3.8l1.2 1.3A8.6 8.6 0 0 1 8 2.6zm0 3.5c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.1 7.1 0 0 0 8 4.3c-1.8 0-3.5.7-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4zm0 3.4c.5 0 .9.2 1.3.5L8 11.4 6.7 10c.4-.3.8-.5 1.3-.5z"/></svg><svg class="sb-batt" viewBox="0 0 28 13"><rect x=".5" y=".5" width="24" height="12" rx="3.6" fill="none" stroke="currentColor" opacity=".38"/><rect x="2" y="2" width="17.4" height="9" rx="2.2"/><path d="M26 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1s-.6-1.8-1.4-2.1z" opacity=".4"/></svg>`

// ---------------------------------------------------------------- QR-ish
export function qrSVG(seed = 'yapping') {
  const N = 25
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296
  const finder = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".8"/>`
  let cells = ''
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inF = (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9)
    const inC = x > 8 && x < 16 && y > 8 && y < 16
    if (inF || inC) continue
    if (rnd() > 0.52) cells += `<rect x="${x + 0.08}" y="${y + 0.08}" width=".84" height=".84" rx=".26"/>`
  }
  return `<svg viewBox="0 0 ${N} ${N}" class="qr" fill="currentColor">${cells}${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}<rect x="9.2" y="9.2" width="6.6" height="6.6" rx="1.8" fill="#25D366"/><path d="M12.5 10.6c1.4 0 2.4.9 2.4 2s-1 2-2.4 2l-.8-.1-1.2.6.4-1c-.5-.4-.8-.9-.8-1.5 0-1.1 1-2 2.4-2z" fill="#fff"/></svg>`
}
