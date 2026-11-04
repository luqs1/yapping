// The agent marks: the shared flat chibi of each harness, so opencode looks
// the same here as everywhere else.
import { chibi } from '../../shared/chibi.js'

export function ocChibi(state = 'idle', opts = {}) {
  return agentMark('opencode', state, opts)
}

// Any agent: the shared flat chibi of its harness mark.
export function agentMark(harness, state, opts = {}) {
  const svg = chibi(harness, { state: state === 'waiting' || state === 'working' ? (state === 'working' ? 'reading' : 'idle') : state === 'dismissed' ? 'done' : state, size: opts.size || 26, turn: opts.turn })
  return opts.badge ? `<span class="badged">${svg}<i style="background:${opts.badge.color}">${opts.badge.letter}</i></span>` : svg
}
