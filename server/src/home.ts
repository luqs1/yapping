// The public front page: what yapping is, a picture of it, one button that
// installs it into Claude, and quieter notes for the other places it works.
// No terminal on the main path. On a phone (or anything but a Mac) the
// button becomes "open this page on your Mac".

import { type Platform, addToClaude, copyLine, page } from './pages'

export function homePage(origin: string, signedIn: boolean, platform: Platform) {
  return page(
    'Team chat beside your AI',
    `<style>
      main{max-width:1040px}
      .col{max-width:560px;margin:0 auto}
      .mark{max-width:560px;margin-left:auto;margin-right:auto}
      h1.hero{font-size:34px;line-height:1.15;letter-spacing:-.02em;margin:0 0 14px}
      .lede{font-size:18px;color:#333;margin:0 0 24px}
      .lede b{color:#111;font-weight:600}
      .cta{height:56px;font-size:17px;border-radius:14px}
      .cta svg{flex:none}
      .small{font-size:13px;margin:4px 0 0}
      .shot{margin:40px 0 8px}
      .shot img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid rgba(127,127,127,.28);box-shadow:0 1px 2px rgba(0,0,0,.06),0 16px 48px -12px rgba(0,0,0,.28);background:#f4f3ef}
      .shot figcaption{font-size:13px;color:#777;text-align:center;margin-top:12px}
      .steps{list-style:none;padding:0;margin:28px 0 0;counter-reset:s}
      .steps li{counter-increment:s;display:flex;gap:14px;padding:12px 0;border-top:1px solid #f0f0f0;color:#333}
      .steps li:before{content:counter(s);flex:none;width:26px;height:26px;border-radius:50%;background:#111;color:#fff;font-size:13px;font-weight:600;display:grid;place-items:center}
      details{margin-top:36px;border-top:1px solid #eee;padding-top:18px}
      summary{cursor:pointer;font-weight:600}
      h2{font-size:15px;margin:22px 0 2px;font-weight:650}
      @media (max-width:520px){main{padding-top:40px}.mark{margin-bottom:28px}h1.hero{font-size:28px}.lede{font-size:17px}.shot{margin:28px -12px 8px}.shot img{border-radius:8px}}
    </style>
    <div class="col">
      <h1 class="hero">Team chat, right beside your AI.</h1>
      <p class="lede">yapping puts your team's chats in a sidebar next to Claude. <b>Your AI can help in the chats you allow, and sends nothing without you.</b></p>
      ${addToClaude(origin, { cls: 'cta' })}
    </div>
    <figure class="shot" style="margin-left:0;margin-right:0">
      <picture>
        <source media="(max-width:700px)" srcset="/static/claude-desktop-960.jpg">
        <img src="/static/claude-desktop.jpg" width="1440" height="900" loading="eager" decoding="async"
          alt="The Claude desktop app with a yapping Chats panel docked on the right. A chat with Finn is open, a switch at the top says Claude can see this chat, and Claude has drafted a reply, “Send Finn the demo link and a test login?”, with Send and Not now buttons waiting for you.">
      </picture>
      <figcaption>Your chats dock beside Claude. Claude drafts; you press Send.</figcaption>
    </figure>
    <div class="col">
      <p class="muted" style="margin-top:20px">Messages stay on your Mac, end-to-end encrypted. The server only relays sealed envelopes.</p>
      <h2 class="mac-only" style="margin-top:28px">After you click Add to Claude</h2>
      <ol class="steps mac-only" style="margin-top:8px">
        <li>Open the file you just downloaded. Claude asks to install yapping: click Install.</li>
        <li>Your browser opens. Sign in, then click “Link this Mac”.</li>
        <li>In any Claude chat, say “open my chats”. Invite a teammate from there.</li>
      </ol>
      <details>
        <summary>Also works in</summary>
        <p class="muted small" style="margin-top:12px">Each of these needs yapping running on your Mac: the Add to Claude download, or this in Terminal:</p>
        ${copyLine(`curl -fsSL ${origin}/install.sh | sh`)}
        <h2>Claude Code</h2>
        <p class="muted small">In a terminal session, run this, then <b>/yap</b>:</p>
        ${copyLine('/plugin install yapping --marketplace luqs1/yapping')}
        <p class="muted small">In the desktop app: + next to the prompt › Plugins › Add marketplace, enter <b>luqs1/yapping</b>, then add yapping. Your chats dock beside the session.</p>
        <h2>Claude chat and Cowork</h2>
        <p class="muted small">Settings › Connectors › Add custom connector, and paste this. Works on the web and your phone while yapping runs on your Mac.</p>
        ${copyLine(`${origin}/mcp`)}
        <h2>ChatGPT and the Codex app</h2>
        <p class="muted small">Settings › Apps › Advanced › Developer mode › Create app, and paste the same address. On Business or Enterprise, an admin adds it.</p>
        ${copyLine(`${origin}/mcp`)}
        <h2>Codex CLI</h2>
        <p class="muted small">Run the installer above first: it puts <b>yap</b> on your PATH. Then, in a new terminal:</p>
        ${copyLine('codex mcp add yapping -- yap mcp')}
      </details>
      <p style="margin-top:32px"><a class="btn secondary" href="${signedIn ? '/account' : '/signin'}">${signedIn ? 'Your account' : 'Sign in'}</a></p>
      <p class="muted small" style="text-align:center;margin-top:24px"><a href="/privacy">Privacy</a></p>
    </div>`,
    { platform },
  )
}
