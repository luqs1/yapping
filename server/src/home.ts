// The public front page: what yapping is, and how to install it on a Mac and
// into each place people work. Plain words; one copyable line per step.

import { page } from './pages'
import { esc } from './util'

const STEPS = (origin: string) => [
  {
    title: 'Claude Code',
    sub: 'Terminal and desktop app. Your chats dock beside the session.',
    lines: ['/plugin install yapping --marketplace luqs1/yapping'],
    note: 'Type this into Claude Code in a terminal, then /yap to open your chats. In the desktop app: + next to the prompt › Plugins › Add marketplace luqs1/yapping › Add yapping.',
  },
  {
    title: 'Claude: chat and Cowork',
    sub: 'claude.ai, the Claude desktop app and Cowork.',
    lines: [`${origin}/mcp`],
    note: 'Settings › Connectors › Add custom connector, paste this, then Connect. On Team and Enterprise an owner adds it once.',
  },
  {
    title: 'ChatGPT and the Codex app',
    sub: 'Opens as a panel beside the chat in Work chats.',
    lines: [`${origin}/mcp`],
    note: 'Settings › Apps › Advanced › Developer mode › Create app, paste this. On Business and Enterprise an admin adds it.',
  },
  {
    title: 'Codex CLI',
    sub: 'Your Codex agent can read and send for you.',
    lines: ['codex mcp add yapping -- yap mcp'],
    note: '',
  },
]

export function homePage(origin: string, signedIn: boolean) {
  const copy = (text: string) =>
    `<div class="cmd"><code>${esc(text)}</code><button type="button" class="copy" data-copy="${esc(text)}" aria-label="Copy">Copy</button></div>`
  const steps = STEPS(origin)
    .map((s) => `<section class="step"><h2>${esc(s.title)}</h2><p class="muted">${esc(s.sub)}</p>${s.lines.map(copy).join('')}${s.note ? `<p class="muted small">${esc(s.note)}</p>` : ''}</section>`)
    .join('')
  return page(
    'Install',
    `<style>
      main{max-width:560px}
      .lede{font-size:18px;color:#333;margin:0 0 32px}
      h2{font-size:16px;margin:0 0 2px;font-weight:650}
      .step{padding:20px 0;border-top:1px solid #eee}
      .cmd{display:flex;align-items:center;gap:8px;margin:10px 0 6px;border:1px solid #e6e6e6;border-radius:10px;padding:8px 8px 8px 12px;background:#fafafa}
      .cmd code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
      .cmd .copy{width:auto;height:30px;padding:0 12px;font-size:13px;border-radius:8px}
      .small{font-size:13px;margin:6px 0 0}
      .first{border-top:0;padding-top:0}
      .foot{margin-top:28px}
    </style>
    <h1>Chat with your team, beside your AI.</h1>
    <p class="lede">yapping puts your chats in a sidebar next to Claude, ChatGPT or Codex. People text people; your AI can help, only in the chats you let it see, and sends nothing without you.</p>
    <section class="step first"><h2>1. Install it on your Mac</h2><p class="muted">It keeps your messages on your Mac, end to end encrypted, and signs you in.</p>${copy(`curl -fsSL ${origin}/install.sh | sh`)}<p class="muted small">Paste into Terminal. It asks you to sign in once in your browser.</p></section>
    <section class="step"><h2>2. Add it where you work</h2><p class="muted">Any or all of these.</p></section>
    ${steps}
    <section class="step"><h2>3. Invite your teammate</h2><p class="muted">Send them a link from your account page, or type <code>yap invite</code>.</p></section>
    <p class="foot"><a class="btn ${signedIn ? '' : 'secondary'}" href="${signedIn ? '/account' : '/signin'}">${signedIn ? 'Your account' : 'Sign in'}</a></p>`,
    {
      script: `document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;navigator.clipboard?.writeText(b.dataset.copy).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)}).catch(()=>{})})`,
    },
  )
}
