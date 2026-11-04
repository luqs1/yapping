// Chibi style "flat": the harness mark exactly as shipped, nothing added.
// It acts with its whole body: it leans in to read, bobs and wobbles while it
// talks (its own working motion running inside), hops when something is
// ready, settles when done. Two small pips carry "!" and "done".
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
  id: 'flat',
  name: 'Flat',
  line: 'The untouched logo, acting with its whole body: leans in to read, bobs as it talks, hops when ready, settles when done. The baseline.',
}

const P = 'cbf'
const STYLE = `<style>
.${P}-m{transform-box:view-box;transform-origin:16px 29px}
.${P}-reading .${P}-m{animation:${P}-lean 2.6s ease-in-out infinite}
.${P}-talking .${P}-m{animation:${P}-bob .9s ease-in-out infinite}
.${P}-ready .${P}-m{animation:${P}-hop 1.8s cubic-bezier(.3,0,.25,1) infinite}
.${P}-done .${P}-m{animation:${P}-settle .7s cubic-bezier(.3,0,.25,1) 1 both}
.${P}-spark{transform-box:view-box;transform-origin:16.28px 16.31px}
.${P}-talking .${P}-spark{animation:${P}-turn 1.4s ease-in-out infinite alternate}
.${P}-level{transform-box:fill-box;transform-origin:50% 100%}
.${P}-talking .${P}-level{animation:${P}-fill 1s ease-in-out infinite alternate}
.${P}-talking .${P}-pc{animation:${P}-step .9s steps(1) infinite}
.${P}-talking .${P}-pc+.${P}-pc{animation-delay:.3s}.${P}-talking .${P}-pc+.${P}-pc+.${P}-pc{animation-delay:.6s}
.${P}-reading .${P}-cur,.${P}-idle .${P}-cur{animation:${P}-cur 1.1s steps(1) infinite}
.${P}-talking .${P}-cur{animation:${P}-cur .5s steps(1) infinite}
.${P}-pip{transform-box:fill-box;transform-origin:center;animation:${P}-pop .35s cubic-bezier(.3,1.6,.5,1) 1 both}
.${P}-sleeping{opacity:.4;filter:grayscale(1)}
@keyframes ${P}-lean{0%,100%{transform:rotate(0)}30%,70%{transform:rotate(-7deg) translateX(-.6px)}}
@keyframes ${P}-bob{0%,100%{transform:translateY(0) rotate(-2.5deg)}50%{transform:translateY(-1.4px) rotate(2.5deg)}}
@keyframes ${P}-turn{0%{transform:rotate(-12deg) scale(.92)}100%{transform:rotate(12deg) scale(1)}}
@keyframes ${P}-fill{0%{transform:scaleY(.25)}100%{transform:scaleY(1)}}
@keyframes ${P}-step{0%{transform:translateY(0)}33%{transform:translateY(-1.6px)}66%{transform:translateY(0)}}
@keyframes ${P}-cur{0%{opacity:1}50%{opacity:0}}
@keyframes ${P}-hop{0%,46%,100%{transform:translateY(0) scale(1,1)}14%{transform:translateY(-3.4px) scale(.97,1.03)}28%{transform:translateY(0) scale(1.04,.95)}36%{transform:translateY(0) scale(1,1)}}
@keyframes ${P}-settle{0%{transform:translateY(-2px)}55%{transform:translateY(0) scale(1.04,.95)}100%{transform:translateY(0) scale(1,1)}}
@keyframes ${P}-pop{0%{transform:scale(0)}100%{transform:scale(1)}}
.${P}-bub{transform-box:fill-box;transform-origin:20% 100%;animation:${P}-say 2.4s cubic-bezier(.3,1.4,.5,1) infinite}
.${P}-bub.${P}-t1{animation-delay:-1.2s}
.${P}-bub .${P}-d{animation:${P}-dot 1.2s ease-in-out infinite}
.${P}-bub .${P}-d+.${P}-d{animation-delay:.18s}.${P}-bub .${P}-d+.${P}-d+.${P}-d{animation-delay:.36s}
@keyframes ${P}-say{0%{opacity:0;transform:scale(.4)}8%,46%{opacity:1;transform:scale(1)}54%,100%{opacity:0;transform:scale(.6)}}
@keyframes ${P}-dot{0%,100%{opacity:.3}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){[class^="${P}-"],[class*=" ${P}-"]{animation:none!important}}
</style>`

const SPARK = 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
const BLOB = 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457z'
const T24 = 'translate(3 3) scale(1.0833)'
let uid = 0

function mark(h, gid) {
  if (h === 'claude') return `<g class="${P}-spark"><path transform="${T24}" d="${SPARK}" fill="#D97757"/></g>`
  if (h === 'opencode') return `<g fill="currentColor"><path fill-rule="evenodd" d="M5.6 3h20.8v26H5.6zM10.8 8.2v15.6h10.4V8.2z"/><rect class="${P}-level" x="10.8" y="13.4" width="10.4" height="10.4" opacity=".32"/></g>`
  if (h === 'pi') return `<path class="${P}-pc" d="M4 4H22V16H16V10H4Z" fill="#F09082"/><path class="${P}-pc" d="M4 10H10V16H16V22H10V28H4Z" fill="#4D9ABF"/><path class="${P}-pc" d="M22 16H28V28H22Z" fill="#F1BE58"/>`
  return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs><g transform="${T24}"><path d="${BLOB}" fill="url(#${gid})"/><g stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M6.55 8.75 8.5 12.12 6.55 15.45"/><path class="${P}-cur" d="M13.6 15.4H18.4"/></g></g>`
}

const PHASE = { claude: 0, opencode: -0.45, pi: -0.3, codex: -0.45 }

// The conversation bubble while agents talk; `turn` (0 or 1) offsets it so
// two agents side by side take turns.
function bubble(turn, id) {
  return `<g class="${P}-bub${turn ? ` ${P}-t1` : ``}"><path d="M21.5 -6.5h9.5a4.5 4.5 0 0 1 4.5 4.5v0a4.5 4.5 0 0 1 -4.5 4.5h-6.2l-3.3 3v-3.1a4.5 4.5 0 0 1 0 -8.9z" fill="#fff" stroke="#D6D3DC" stroke-width=".9"/><circle class="${P}-d" cx="23.6" cy="-2" r="1.05" fill="#6F6B76"/><circle class="${P}-d" cx="26.3" cy="-2" r="1.05" fill="#6F6B76"/><circle class="${P}-d" cx="29" cy="-2" r="1.05" fill="#6F6B76"/></g>`
}

export function chibi(harness = 'claude', opts = {}) {
  const state = opts.state || 'idle'
  const size = opts.size || 28
  const h = MARKS[harness] ? harness : 'claude'
  const cut = 'style="stroke:var(--cb-cut,#fff)"'
  const pip =
    state === 'ready'
      ? `<g class="${P}-pip"><circle cx="28.4" cy="3.8" r="4.3" fill="#E5484D" ${cut} stroke-width="1.6" paint-order="stroke"/><rect x="27.65" y="1.4" width="1.5" height="3.3" rx=".75" fill="#fff"/><circle cx="28.4" cy="6.2" r=".85" fill="#fff"/></g>`
      : state === 'done'
        ? `<g class="${P}-pip"><circle cx="27.4" cy="27.4" r="4.3" fill="#2F9E6E" ${cut} stroke-width="1.6" paint-order="stroke"/><path d="M25.4 27.5l1.4 1.4 2.7-2.9" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
        : ''
  const delay = state === 'talking' ? ` style="animation-delay:${PHASE[h]}s"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" overflow="visible" style="overflow:visible" role="img" aria-label="${MARKS[h].name} ${state}">${STYLE}<g class="${P}-${state}"><g class="${P}-m"${delay}>${mark(h, `${P}${uid++}`)}</g>${pip}${state === 'talking' ? bubble(opts.turn ? 1 : 0, `${P}${uid++}`) : ''}</g></svg>`
}
