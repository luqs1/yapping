// Small inline glyphs. Network marks are simplified so they read at 10–14px.
const svg = (size, body, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" ${extra}>${body}</svg>`

export const NETWORKS = {
  yap: { name: 'yapping', color: 'var(--accent)' },
  whatsapp: { name: 'WhatsApp', color: '#25D366', ink: '#0B7A3B', inkDark: '#4BDB83', tint: 'rgba(37,211,102,.13)' },
  slack: { name: 'Slack', color: '#4A154B', ink: '#611f69', inkDark: '#E3A6E5', tint: 'rgba(97,31,105,.10)' },
  imessage: { name: 'iMessage', color: '#0A84FF', ink: '#0062CC', inkDark: '#5AB0FF', tint: 'rgba(10,132,255,.11)' },
  telegram: { name: 'Telegram', color: '#2AABEE', ink: '#1A7FB5', inkDark: '#6CC6F5', tint: 'rgba(42,171,238,.12)' },
}

export function netGlyph(net, size = 12) {
  if (net === 'whatsapp')
    return svg(size, `<path fill="currentColor" d="M8 1.2a6.7 6.7 0 0 0-5.8 10.1L1.3 14.7l3.5-.9A6.7 6.7 0 1 0 8 1.2Zm0 1.3a5.4 5.4 0 1 1-2.8 10l-.2-.1-2 .5.5-2-.1-.2A5.4 5.4 0 0 1 8 2.5Z"/><path fill="currentColor" d="M5.9 4.8c-.1-.3-.3-.3-.4-.3h-.4a.8.8 0 0 0-.6.3c-.2.2-.8.7-.8 1.8s.8 2.1.9 2.2c.1.2 1.6 2.5 3.9 3.4 1.9.8 2.3.6 2.7.6.4 0 1.3-.5 1.5-1.1.2-.5.2-1 .1-1.1l-.4-.2-1.4-.7c-.2-.1-.3-.1-.5.1l-.6.8c-.1.1-.2.2-.4.1a4.5 4.5 0 0 1-2.3-2c-.2-.3.2-.3.5-1 .1-.1 0-.2 0-.3l-.7-1.6Z"/>`)
  if (net === 'slack')
    return svg(size, `<g fill="currentColor"><rect x="6.2" y="1" width="2.3" height="6" rx="1.15"/><rect x="9" y="6.2" width="6" height="2.3" rx="1.15"/><rect x="7.5" y="9" width="2.3" height="6" rx="1.15"/><rect x="1" y="7.5" width="6" height="2.3" rx="1.15"/><circle cx="11.9" cy="3.3" r="1.15"/><circle cx="12.7" cy="11.9" r="1.15"/><circle cx="4.1" cy="12.7" r="1.15"/><circle cx="3.3" cy="4.1" r="1.15"/></g>`)
  if (net === 'imessage')
    return svg(size, `<path fill="currentColor" d="M8 2C4.4 2 1.5 4.3 1.5 7.2c0 1.7 1 3.2 2.5 4.1-.1.9-.6 1.8-1.2 2.4 1.4 0 2.6-.6 3.4-1.3.6.1 1.2.2 1.8.2 3.6 0 6.5-2.3 6.5-5.4S11.6 2 8 2Z"/>`)
  if (net === 'telegram')
    return svg(size, `<path fill="currentColor" d="M14.5 2.3 1.9 7.2c-.8.3-.8.8 0 1l3.2 1 1.2 3.8c.2.4.3.5.6.5s.4-.1.6-.3l1.6-1.5 3.2 2.4c.6.3 1 .2 1.2-.5l2.1-10c.2-.9-.3-1.3-1.1-1Zm-2 2.4-6 5.4-.3 2.6-1-3.3 7.1-4.5c.3-.2.5 0 .2.2Z"/>`)
  return ''
}

export const I = {
  back: svg(16, '<path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  plus: svg(15, '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  search: svg(15, '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  expand: svg(14, '<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  close: svg(14, '<path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  send: svg(13, '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  reply: svg(13, '<path d="M6.5 4 2.5 8l4 4M3 8h6.5a4 4 0 0 1 4 4v.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  pin: svg(9, '<path fill="currentColor" d="M10 1.5 14.5 6l-2 .6-2.8 2.8.3 3.1-1.5 1.5L5.6 11 2 14.6 1.4 14 5 10.4 2 7.5 3.5 6l3.1.3L9.4 3.5Z"/>'),
  link: svg(16, '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  chev: svg(12, '<path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  warn: svg(13, '<path d="M8 1.8 15 14H1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.2v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.8" r=".9" fill="currentColor"/>'),
  check: svg(13, '<path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
}
