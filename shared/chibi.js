// The chibi agents: each harness's own mark, made tiny and alive. They are
// the only sign of an agent in yapping: they sit under a message, read it,
// jiggle when two of them talk, hop when something is ready for you.
//
//   chibi('claude', { state: 'reading', size: 28 })  -> '<svg …>'
//
// states: idle · reading (eyes scan) · talking (jiggle, speech dots) ·
//         ready (hops, little "!") · done (happy eyes) · sleeping (agent can't see)
// Pure strings, no DOM: works in pages, in Claude Code mods (Svg) and Node.

export const MARKS = {
  claude: { name: 'Claude', color: '#D97757', ink: '#3D1F12' },
  opencode: { name: 'opencode', color: '#1A1A1A', ink: '#FFFFFF' },
  pi: { name: 'pi', color: '#5B6CF0', ink: '#FFFFFF' },
  codex: { name: 'Codex', color: '#10A37F', ink: '#FFFFFF' },
}

const STYLE = `<style>
.cb-bob{animation:cb-bob 1.6s ease-in-out infinite;transform-origin:50% 90%}
.cb-scan{animation:cb-scan 1.4s ease-in-out infinite}
.cb-talk{animation:cb-talk .32s ease-in-out infinite;transform-origin:50% 85%}
.cb-hop{animation:cb-hop 1.1s cubic-bezier(.3,0,.3,1) infinite;transform-origin:50% 100%}
.cb-blink{animation:cb-blink 3.2s step-end infinite;transform-origin:50% 50%}
.cb-dot{animation:cb-dot 1s ease-in-out infinite}
.cb-dot:nth-child(2){animation-delay:.15s}.cb-dot:nth-child(3){animation-delay:.3s}
.cb-z{animation:cb-z 2.4s ease-in-out infinite}
@keyframes cb-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes cb-scan{0%,100%{transform:translateX(-1.6px)}50%{transform:translateX(1.6px)}}
@keyframes cb-talk{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg) translateY(-1px)}}
@keyframes cb-hop{0%,60%,100%{transform:translateY(0) scaleY(1)}20%{transform:translateY(-5px) scaleY(1.04)}35%{transform:translateY(0) scaleY(.94)}}
@keyframes cb-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes cb-dot{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes cb-z{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(3px,-6px)}}
@media (prefers-reduced-motion:reduce){.cb-bob,.cb-scan,.cb-talk,.cb-hop,.cb-blink,.cb-dot,.cb-z{animation:none}}
</style>`

// Each body is drawn in a 40×40 box centred on (20,22), leaving room above
// for a "!" or speech dots.
function body(harness) {
  if (harness === 'claude') {
    // The spark, softened: twelve rounded petals around a round face.
    const petals = Array.from({ length: 12 }, (_, i) => {
      const a = i * 30
      const len = i % 2 ? 7.5 : 9.5
      return `<rect x="18.4" y="${22 - 9 - len}" width="3.2" height="${len + 4}" rx="1.6" fill="#D97757" transform="rotate(${a} 20 22)"/>`
    }).join('')
    return `${petals}<circle cx="20" cy="22" r="9.2" fill="#D97757"/>`
  }
  if (harness === 'opencode') {
    return `<rect x="9" y="11" width="22" height="22" rx="6" fill="#1A1A1A" stroke="#8C8C8C" stroke-width=".8"/><rect x="15" y="25.5" width="10" height="3.2" rx="1.6" fill="#F5A742"/>`
  }
  if (harness === 'pi') {
    return `<rect x="9" y="11" width="22" height="22" rx="8" fill="#5B6CF0"/>`
  }
  return `<circle cx="20" cy="22" r="11.5" fill="#10A37F"/><circle cx="20" cy="22" r="7.6" fill="#E8F7F1"/>`
}

function face(harness, state) {
  const dark = harness === 'claude' ? '#3D1F12' : harness === 'codex' ? '#0B3B2E' : '#FFFFFF'
  const y = harness === 'claude' || harness === 'codex' ? 21 : 20
  const cheeks = `<ellipse cx="14.6" cy="${y + 4}" rx="2" ry="1.2" fill="#FF8FA3" opacity=".7"/><ellipse cx="25.4" cy="${y + 4}" rx="2" ry="1.2" fill="#FF8FA3" opacity=".7"/>`
  let eyes
  if (state === 'done') {
    eyes = `<path d="M15 ${y + 1} q2 -2.6 4 0 M21 ${y + 1} q2 -2.6 4 0" stroke="${dark}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
  } else if (state === 'sleeping') {
    eyes = `<path d="M15 ${y} h4 M21 ${y} h4" stroke="${dark}" stroke-width="1.5" stroke-linecap="round"/>`
  } else {
    const pupils = `<ellipse cx="17" cy="${y}" rx="1.5" ry="2" fill="${dark}"/><ellipse cx="23" cy="${y}" rx="1.5" ry="2" fill="${dark}"/>`
    eyes = state === 'reading' ? `<g class="cb-scan">${pupils}</g>` : `<g class="cb-blink">${pupils}</g>`
  }
  const mouth =
    harness === 'pi'
      ? `<text x="20" y="${y + 9}" text-anchor="middle" font-family="Georgia,serif" font-size="8" font-weight="700" fill="${dark}">π</text>`
      : state === 'talking'
        ? `<ellipse cx="20" cy="${y + 5}" rx="1.4" ry="1.1" fill="${dark}"/>`
        : `<path d="M18.6 ${y + 4.4} q1.4 1.3 2.8 0" stroke="${dark}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
  return `${harness === 'opencode' ? '' : cheeks}${eyes}${harness === 'opencode' ? '' : mouth}`
}

export function chibi(harness = 'claude', opts = {}) {
  const state = opts.state || 'idle'
  const size = opts.size || 28
  const cls = state === 'talking' ? 'cb-talk' : state === 'ready' ? 'cb-hop' : state === 'sleeping' ? '' : 'cb-bob'
  const extra =
    state === 'ready'
      ? `<g><circle cx="33" cy="7" r="5" fill="#FA5252"/><rect x="32.2" y="3.6" width="1.6" height="4.2" rx=".8" fill="#fff"/><circle cx="33" cy="9.6" r=".9" fill="#fff"/></g>`
      : state === 'talking'
        ? `<g fill="#9A948C"><circle class="cb-dot" cx="27" cy="5" r="1.4"/><circle class="cb-dot" cx="31" cy="5" r="1.4"/><circle class="cb-dot" cx="35" cy="5" r="1.4"/></g>`
        : state === 'sleeping'
          ? `<text class="cb-z" x="29" y="10" font-family="Georgia,serif" font-size="8" font-weight="700" fill="#8C8C8C">z</text>`
          : ''
  const shadow = `<ellipse cx="20" cy="40" rx="${state === 'ready' ? 7 : 8.5}" ry="1.6" fill="#141414" opacity=".1"/>`
  const opacity = state === 'sleeping' ? ' opacity=".45"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 1.1)}" viewBox="0 0 40 44" role="img" aria-label="${MARKS[harness]?.name || harness} ${state}">${STYLE}${shadow}<g class="${cls}"${opacity}>${body(harness)}${face(harness, state)}</g>${extra}</svg>`
}
