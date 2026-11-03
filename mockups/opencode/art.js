// The opencode chibi, redrawn in PostHog's illustration language: flat fill,
// thick ink outline, a blush. It is still the opencode mark: a square frame
// with the lighter "shadow" square in the bottom of its window. The window
// is its face. Other harnesses fall back to the shared chibi.
import { chibi } from '../../shared/chibi.js'

const INK = '#151515'

export function ocChibi(state = 'idle', opts = {}) {
  const s = opts.size || 26
  const badge = opts.badge // { letter, color } for someone else's agent
  const cls = { talking: 'oc-talk', ready: 'oc-hop', working: 'oc-work', sleeping: '' }[state] ?? 'oc-bob'
  let eyes
  if (state === 'done') eyes = `<path d="M16.4 18.6 q1.5 -2 3 0 M20.6 18.6 q1.5 -2 3 0" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  else if (state === 'sleeping') eyes = `<path d="M16.6 18 h2.6 M20.8 18 h2.6" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`
  else {
    const p = `<ellipse cx="18" cy="17.8" rx="1.25" ry="1.7" fill="${INK}"/><ellipse cx="22" cy="17.8" rx="1.25" ry="1.7" fill="${INK}"/>`
    eyes = state === 'reading' ? `<g class="oc-scan">${p}</g>` : `<g class="oc-blink">${p}</g>`
  }
  const mouth = state === 'talking' ? `<ellipse cx="20" cy="25" rx="1.5" ry="1.2" fill="${INK}"/>` : `<path d="M18.7 24.6 q1.3 1.2 2.6 0" stroke="${INK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
  const extra = state === 'ready'
    ? `<g><circle cx="33" cy="8" r="5.2" fill="#F54E00" stroke="${INK}" stroke-width="1.6"/><rect x="32.2" y="4.6" width="1.6" height="4" rx=".8" fill="#fff"/><circle cx="33" cy="10.7" r=".9" fill="#fff"/></g>`
    : state === 'talking'
      ? `<g fill="${INK}"><circle class="oc-dot" cx="29" cy="6" r="1.3"/><circle class="oc-dot" cx="32.6" cy="6" r="1.3"/><circle class="oc-dot" cx="36.2" cy="6" r="1.3"/></g>`
      : state === 'sleeping' ? `<text class="oc-z" x="30" y="10" font-family="IBM Plex Mono, monospace" font-size="8" font-weight="700" fill="#8C8C8C">z</text>` : ''
  const b = badge ? `<g><circle cx="31.5" cy="34" r="5" fill="${badge.color}" stroke="${INK}" stroke-width="1.4"/><text x="31.5" y="36.6" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="7" font-weight="700" fill="#fff">${badge.letter}</text></g>` : ''
  return `<svg class="occ ${state}" width="${s}" height="${Math.round(s * 1.1)}" viewBox="0 0 40 44" aria-label="opencode ${state}" role="img">
    <ellipse cx="20" cy="41" rx="${state === 'ready' ? 6.5 : 8}" ry="1.5" fill="${INK}" opacity=".12"/>
    <g class="${cls}"${state === 'sleeping' ? ' opacity=".5"' : ''}>
      <rect x="15.2" y="35" width="3.2" height="4" rx="1.2" fill="${INK}"/><rect x="21.6" y="35" width="3.2" height="4" rx="1.2" fill="${INK}"/>
      <rect class="oc-body" x="10" y="7.5" width="20" height="28.5" rx="3" fill="#1A1A1A" stroke="${INK}" stroke-width="2"/>
      <rect x="14.6" y="12.2" width="10.8" height="17.6" rx="1.2" fill="#FDFDF8"/>
      <rect x="14.6" y="21.4" width="10.8" height="8.4" rx="1" fill="#B9BAB2"/>
      <ellipse cx="12.4" cy="23" rx="1.3" ry="1.9" fill="#FF8FA3" opacity=".85"/><ellipse cx="27.6" cy="23" rx="1.3" ry="1.9" fill="#FF8FA3" opacity=".85"/>
      ${eyes}${mouth}
    </g>${extra}${b}</svg>`
}

// Any agent: opencode gets the PostHog-style chibi, others the shared one.
export function agentMark(harness, state, opts = {}) {
  if (harness === 'opencode') return ocChibi(state, opts)
  const svg = chibi(harness, { state: state === 'waiting' || state === 'working' ? (state === 'working' ? 'reading' : 'idle') : state === 'dismissed' ? 'done' : state, size: opts.size || 26 })
  return opts.badge ? `<span class="badged">${svg}<i style="background:${opts.badge.color}">${opts.badge.letter}</i></span>` : svg
}
