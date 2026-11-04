// Chibi style "pixel": each mark as crisp 16×16 grid art. One art pixel is
// size/16 CSS px, so it is pixel-perfect at 16 and 32 (and 24 on a 2× screen).
// No face. Everything moves in whole pixels with steps(): a 1px scanline
// while it reads, its own working motion in pixel frames while it talks
// (Claude's ray tips flicker, opencode's window fills row by row, pi's
// pieces step, Codex's cursor blinks), pixel pips for "!" and done.
//
//   chibi('claude', { state: 'reading', size: 24 })  -> '<svg …>'
//
// states: idle · reading · talking · ready · done · sleeping

export const MARKS = {
  claude: { name: 'Claude', color: '#D97757', ink: '#D97757' },
  opencode: { name: 'opencode', color: 'currentColor', ink: 'currentColor' },
  pi: { name: 'pi', color: '#F09082', ink: '#4D9ABF' },
  codex: { name: 'Codex', color: '#7A9DFF', ink: '#FFFFFF' },
}
export const INFO = {
  id: 'pixel',
  name: 'Pixel',
  line: 'Hand-placed 16×16 grid art that only ever moves in whole pixels: a 1px scanline to read, pixel-frame working motion to talk, pixel pips. Terminal-native.',
}

const P = 'cbp'
const STYLE = `<style>
.${P}-scan{animation:${P}-scan 1.6s steps(16) infinite}
.${P}-talking .${P}-m{animation:${P}-bob .9s steps(1) infinite}
.${P}-talking .${P}-tip{animation:${P}-tip .6s steps(1) infinite}
.${P}-talking .${P}-lvl{animation:${P}-lvl 1.2s steps(1) infinite}
.${P}-talking .${P}-pc{animation:${P}-step .9s steps(1) infinite}
.${P}-talking .${P}-pc+.${P}-pc{animation-delay:.3s}.${P}-talking .${P}-pc+.${P}-pc+.${P}-pc{animation-delay:.6s}
.${P}-idle .${P}-cur,.${P}-reading .${P}-cur{animation:${P}-cur 1s steps(1) infinite}
.${P}-talking .${P}-cur{animation:${P}-cur .5s steps(1) infinite}
.${P}-talking .${P}-chev{animation:${P}-nudge 1s steps(1) infinite}
.${P}-ready .${P}-m{animation:${P}-hop 1.6s steps(1) infinite}
.${P}-ready .${P}-b{animation:${P}-flash 1.6s steps(1) infinite}
.${P}-done .${P}-m{animation:${P}-settle .45s steps(1) 1 both}
.${P}-sleeping{opacity:.4;filter:grayscale(1)}
@keyframes ${P}-scan{0%{transform:translateY(0)}100%{transform:translateY(16px)}}
@keyframes ${P}-bob{0%{transform:translate(0)}50%{transform:translate(0,-1px)}}
@keyframes ${P}-tip{0%{opacity:1}50%{opacity:0}}
@keyframes ${P}-lvl{0%{transform:translateY(4px)}33%{transform:translateY(2px)}66%{transform:translateY(0)}}
@keyframes ${P}-step{0%{transform:translate(0)}33%{transform:translate(0,-1px)}66%{transform:translate(0)}}
@keyframes ${P}-cur{0%{opacity:1}50%{opacity:0}}
@keyframes ${P}-nudge{0%{transform:translate(0)}30%{transform:translate(1px)}60%{transform:translate(0)}}
@keyframes ${P}-hop{0%{transform:translate(0)}10%{transform:translate(0,-1px)}18%{transform:translate(0,-2px)}30%{transform:translate(0,-1px)}38%{transform:translate(0)}}
@keyframes ${P}-flash{0%{transform:translate(0)}10%{transform:translate(0,-1px)}38%{transform:translate(0)}}
@keyframes ${P}-settle{0%{transform:translate(0,-2px)}33%{transform:translate(0,-1px)}66%{transform:translate(0)}}
.${P}-bub{animation:${P}-say 2.4s steps(1) infinite}
.${P}-bub.${P}-t1{animation-delay:-1.2s}
.${P}-bub .${P}-d{animation:${P}-dot 1.2s steps(1) infinite}
.${P}-bub .${P}-d+.${P}-d{animation-delay:.4s}.${P}-bub .${P}-d+.${P}-d+.${P}-d{animation-delay:.8s}
@keyframes ${P}-say{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes ${P}-dot{0%,49%{opacity:1}50%,100%{opacity:.25}}
@media (prefers-reduced-motion:reduce){[class^="${P}-"],[class*=" ${P}-"]{animation:none!important}.${P}-scan{display:none}}
</style>`

const MAP = {
  claude: [
    '................',
    '.........#......',
    '.....#...#......',
    '......#..#...#..',
    '......#..#..#...',
    '..##...#.#.#....',
    '....##.#.##...##',
    '......########..',
    '.##########.....',
    '......########..',
    '....##.##.##..##',
    '..##..#.#.#.#...',
    '......#.#..#.#..',
    '.....#..#..#..#.',
    '.....#..#...#...',
    '........#.......',
  ],
  opencode: [
    '................',
    '..kkkkkkkkkkkk..',
    '..kkkkkkkkkkkk..',
    '..kkkkkkkkkkkk..',
    '..kkk......kkk..',
    '..kkk......kkk..',
    '..kkk......kkk..',
    '..kkkggggggkkk..',
    '..kkkggggggkkk..',
    '..kkkggggggkkk..',
    '..kkkggggggkkk..',
    '..kkkggggggkkk..',
    '..kkkggggggkkk..',
    '..kkkkkkkkkkkk..',
    '..kkkkkkkkkkkk..',
    '..kkkkkkkkkkkk..',
  ],
  pi: [
    '................',
    '................',
    '................',
    '................',
    '..ppppppppp.....',
    '..ppppppppp.....',
    '..ppppppppp.....',
    '..bbb...ppp.....',
    '..bbb...ppp.....',
    '..bbb...ppp.....',
    '..bbbbbb...yyy..',
    '..bbbbbb...yyy..',
    '..bbbbbb...yyy..',
    '..bbb......yyy..',
    '..bbb......yyy..',
    '..bbb......yyy..',
  ],
  codex: [
    '................',
    '......aaa.......',
    '.....aaaaaaaa...',
    '....aaaaaaaaaa..',
    '...aaaaaaaaaaaa.',
    '..bbbbbbbbbbbbb.',
    '.bbbbbbbbbbbbbb.',
    '.bbbbbbbbbbbbbb.',
    '.bbbbbbbbbbbbbbb',
    '..cccccccccccccc',
    '..cccccccccccccc',
    '..ccccccccccccc.',
    '..ccccccccccccc.',
    '...dddddddddd...',
    '....dddddddd....',
    '........ddd.....',
  ],
}
const INK = {
  claude: { '#': '#D97757' },
  opencode: { k: 'currentColor', g: 'currentColor' },
  pi: { p: '#F09082', b: '#4D9ABF', y: '#F1BE58' },
  codex: { a: '#ADA6FF', b: '#8E9EFF', c: '#7088FF', d: '#5563F2' },
}

// one rect per horizontal run of the same colour; keep(x, y) filters pixels
function runs(rows, ink, keep = () => true, attrs = '') {
  let out = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < 16) {
      const c = row[x]
      if (c === '.' || !ink[c] || !keep(x, y, c)) { x++; continue }
      let e = x
      while (e < 16 && row[e] === c && keep(e, y, c)) e++
      out += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${ink[c]}"${attrs}/>`
      x = e
    }
  })
  return out
}
const px = (pts, fill) => pts.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`).join('')
// Claude's outermost ray pixels (beyond radius 5.6 from the hub) flicker while it works
const isTip = (x, y) => Math.hypot(x - 8, y - 8) > 5.6

function body(h) {
  const m = MAP[h], ink = INK[h]
  if (h === 'claude') return runs(m, ink, (x, y) => !isTip(x, y)) + `<g class="${P}-tip">${runs(m, ink, isTip)}</g>`
  if (h === 'opencode') {
    // the window's lower block fills 2 rows at a time, clipped to the hole
    return runs(m, ink, (x, y, c) => c === 'k') + `<svg x="5" y="7" width="6" height="6" overflow="hidden"><rect class="${P}-lvl" x="0" y="0" width="6" height="6" fill="currentColor" opacity=".3"/></svg>`
  }
  if (h === 'pi') return ['p', 'b', 'y'].map((c) => `<g class="${P}-pc">${runs(m, ink, (x, y, k) => k === c)}</g>`).join('')
  // codex: the blob in four bands, and its own >_
  return runs(m, ink) + `<g class="${P}-chev">${px([[4, 6], [5, 7], [6, 8], [5, 9], [4, 10]], '#fff')}</g><rect class="${P}-cur" x="9" y="10" width="4" height="1" fill="#fff"/>`
}

const PHASE = { claude: 0, opencode: -0.45, pi: -0.3, codex: -0.45 }
let uid = 0
// The conversation bubble while agents talk; `turn` (0 or 1) offsets it so
// two agents side by side take turns.
function bubble(turn, id) {
  return `<g class="${P}-bub${turn ? ` ${P}-t1` : ``}"><rect x="10" y="-5" width="8" height="5" style="fill:var(--cb-cut,#fff)"/><rect x="11" y="-4" width="6" height="3" fill="#ECEAF1"/><rect x="10" y="0" width="2" height="1" style="fill:var(--cb-cut,#fff)"/><rect x="11" y="0" width="1" height="1" fill="#ECEAF1"/><rect class="${P}-d" x="12" y="-3" width="1" height="1" fill="#3D3A44"/><rect class="${P}-d" x="14" y="-3" width="1" height="1" fill="#3D3A44"/><rect class="${P}-d" x="16" y="-3" width="1" height="1" fill="#3D3A44"/></g>`
}

export function chibi(harness = 'claude', opts = {}) {
  const state = opts.state || 'idle'
  const size = opts.size || 28
  const h = MARKS[harness] ? harness : 'claude'
  const id = `${P}${uid++}`
  const scan =
    state === 'reading'
      ? `<defs><clipPath id="${id}k">${runs(MAP[h], INK[h])}</clipPath></defs><g clip-path="url(#${id}k)"><rect class="${P}-scan" x="0" y="0" width="16" height="1" fill="#fff" opacity=".7"/></g>`
      : ''
  const cut = 'style="fill:var(--cb-cut,#fff)"'
  const extra =
    state === 'ready'
      ? `<g class="${P}-b"><rect x="11" y="-3" width="7" height="8" ${cut}/><rect x="12" y="-2" width="5" height="6" fill="#E5484D"/><rect x="14" y="-1" width="1" height="2" fill="#fff"/><rect x="14" y="2" width="1" height="1" fill="#fff"/></g>`
      : state === 'done'
        ? `<g><rect x="10" y="10" width="8" height="8" ${cut}/><rect x="11" y="11" width="6" height="6" fill="#2F9E6E"/>${px([[12, 13], [13, 14], [14, 13], [15, 12]], '#fff')}</g>`
        : ''
  const delay = state === 'talking' ? ` style="animation-delay:${PHASE[h]}s"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" overflow="visible" style="overflow:visible" shape-rendering="crispEdges" role="img" aria-label="${MARKS[h].name} ${state}">${STYLE}<g class="${P}-${state}"><g class="${P}-m"${delay}>${body(h)}${scan}</g>${extra}${state === 'talking' ? bubble(opts.turn ? 1 : 0, `${P}${uid++}`) : ''}</g></svg>`
}
