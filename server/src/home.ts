// The public front page: one button that installs yapping into Claude, and
// quieter notes for the other places it works. No terminal on the main path.

import { page } from './pages'
import { esc } from './util'

export function homePage(origin: string, signedIn: boolean) {
  const copy = (text: string) =>
    `<div class="cmd"><code>${esc(text)}</code><button type="button" class="copy" data-copy="${esc(text)}" aria-label="Copy">Copy</button></div>`
  return page(
    'yapping',
    `<style>
      main{max-width:560px}
      .lede{font-size:18px;color:#333;margin:0 0 28px}
      .cta{height:56px;font-size:17px;border-radius:14px}
      .cta svg{flex:none}
      .steps{list-style:none;padding:0;margin:28px 0 0;counter-reset:s}
      .steps li{counter-increment:s;display:flex;gap:14px;padding:12px 0;border-top:1px solid #f0f0f0;color:#333}
      .steps li:before{content:counter(s);flex:none;width:26px;height:26px;border-radius:50%;background:#111;color:#fff;font-size:13px;font-weight:600;display:grid;place-items:center}
      details{margin-top:36px;border-top:1px solid #eee;padding-top:18px}
      summary{cursor:pointer;font-weight:600}
      h2{font-size:15px;margin:22px 0 2px;font-weight:650}
      .cmd{display:flex;align-items:center;gap:8px;margin:8px 0 4px;border:1px solid #e6e6e6;border-radius:10px;padding:8px 8px 8px 12px;background:#fafafa}
      .cmd code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
      .cmd .copy{width:auto;height:30px;padding:0 12px;font-size:13px;border-radius:8px}
      .small{font-size:13px;margin:4px 0 0}
    </style>
    <h1>Chat with your team, beside your AI.</h1>
    <p class="lede">yapping puts your chats in Claude. People text people; Claude can help, only in the chats you let it see, and sends nothing without you. Your messages stay on your Mac.</p>
    <a class="btn cta" href="/dl/yapping.mcpb" download>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/></svg>
      Add to Claude
    </a>
    <p class="muted small">For Claude on Mac. <a href="https://claude.ai/download">Don't have it yet?</a></p>
    <ol class="steps">
      <li>Open the file you just downloaded. Claude asks to install yapping: click Install.</li>
      <li>Your browser opens. Sign in, then click “Link this Mac”.</li>
      <li>In any Claude chat, say “open my chats”. Invite a teammate from there.</li>
    </ol>
    <details>
      <summary>Also works in</summary>
      <h2>Claude Code</h2>
      <p class="muted small">In the desktop app: + next to the prompt › Plugins › Add marketplace, enter <b>luqs1/yapping</b>, then add yapping. Your chats dock beside the session.</p>
      <h2>ChatGPT and the Codex app</h2>
      <p class="muted small">Settings › Apps › Advanced › Developer mode › Create app, and paste this. Works while yapping is running on your Mac.</p>
      ${copy(`${origin}/mcp`)}
      <h2>Codex CLI</h2>
      ${copy('codex mcp add yapping -- yap mcp')}
    </details>
    <p style="margin-top:32px"><a class="btn secondary" href="${signedIn ? '/account' : '/signin'}">${signedIn ? 'Your account' : 'Sign in'}</a></p>`,
    {
      script: `document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;navigator.clipboard?.writeText(b.dataset.copy).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)}).catch(()=>{})})`,
    },
  )
}
