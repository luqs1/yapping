// The few pages people see in a browser: sign in, link a Mac, accept an
// invite, allow a chat app, and their account. One plain look for all of
// them, the same as the sidebar: system font, white page, black buttons.
// The copy is for anyone, not just developers.

import { esc, html } from './util'

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#111;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:400px;margin:0 auto;padding:72px 24px 48px}
.mark{font-weight:700;letter-spacing:-.02em;font-size:20px;margin:0 0 40px}
h1{font-size:24px;line-height:1.25;letter-spacing:-.01em;margin:0 0 8px;font-weight:650}
p{margin:0 0 16px;color:#444}
.muted{color:#777;font-size:14px}
form{margin:0}
.stack>*+*{margin-top:12px}
button,.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:48px;padding:0 18px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;font:inherit;font-weight:550;cursor:pointer;text-decoration:none}
button:hover,.btn:hover{background:#333}
button.secondary,.btn.secondary{background:#fff;color:#111;border-color:#d4d4d4}
button.secondary:hover,.btn.secondary:hover{background:#f6f6f6}
button.link{display:inline;width:auto;height:auto;padding:0;border:0;background:none;color:#111;text-decoration:underline;font-weight:400}
input[type=email],input[type=text]{width:100%;height:48px;padding:0 14px;border:1px solid #d4d4d4;border-radius:10px;font:inherit;color:#111;background:#fff}
input:focus{outline:2px solid #111;outline-offset:1px;border-color:#111}
.or{display:flex;align-items:center;gap:12px;color:#999;font-size:13px;margin:20px 0}
.or:before,.or:after{content:"";flex:1;height:1px;background:#eee}
.code{font:600 28px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-align:center;padding:18px;border:1px solid #eee;border-radius:12px;margin:8px 0 24px}
.card{border:1px solid #eee;border-radius:12px;padding:16px;margin:0 0 24px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #f0f0f0}
.row:first-child{border-top:0}
.who{display:flex;align-items:center;gap:12px;margin:0 0 24px}
.av{width:40px;height:40px;border-radius:50%;background:#111;color:#fff;display:grid;place-items:center;font-weight:600;flex:none;overflow:hidden}
.av img{width:100%;height:100%;object-fit:cover}
.warn{background:#fff8e6;border:1px solid #f3e1b5;border-radius:10px;padding:12px 14px;font-size:14px;color:#5c4400;margin:0 0 20px}
.err{color:#b42318;font-size:14px;min-height:1px}
pre{background:#f6f6f6;border-radius:10px;padding:12px 14px;font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
a{color:#111}
.cmd{display:flex;align-items:center;gap:8px;margin:8px 0 4px;border:1px solid #e6e6e6;border-radius:10px;padding:8px 8px 8px 12px;background:#fafafa}
.cmd code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.cmd .copy{width:auto;height:30px;padding:0 12px;font-size:13px;border-radius:8px;flex:none}
.not-mac{display:none}
html[data-platform=other] .mac-only{display:none}
html[data-platform=other] .not-mac{display:block}
@media (hover:none) and (pointer:coarse){.mac-only{display:none!important}.not-mac{display:block!important}}
`

// Copy buttons ([data-copy]) work on every page.
const COPY_JS = `document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;navigator.clipboard?.writeText(b.dataset.copy).then(()=>{const t=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=t,1500)}).catch(()=>{})})`

// yapping runs on a Mac. Pages mark Mac-only things .mac-only and the
// alternative .not-mac; the server picks from the user agent, and a CSS
// media query catches touch devices that claim to be a Mac (iPadOS Safari).
// No user agent (curl, crawlers): leave it to the CSS.
export type Platform = 'mac' | 'other' | undefined
export function platformOf(req: Request): Platform {
  const ua = req.headers.get('user-agent') || ''
  if (!ua) return undefined
  if (/iPhone|iPad|iPod|Android|Mobile|CrOS|Windows|Linux/i.test(ua)) return 'other'
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  return undefined
}

export function page(title: string, content: string, opts: { script?: string; status?: number; platform?: Platform } = {}) {
  return html(
    `<!doctype html><html lang="en"${opts.platform ? ` data-platform="${opts.platform}"` : ''}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · yapping</title><style>${CSS}</style></head>
<body><main><div class="mark"><a href="/" style="text-decoration:none">yapping</a></div>${content}</main><script>${COPY_JS}${opts.script ? `\n${opts.script}` : ''}</script></body></html>`,
    opts.status,
  )
}

export function avatar(u: { name?: string; avatar?: string | null }) {
  const initial = esc((u.name || '?').trim().charAt(0).toUpperCase())
  return `<div class="av">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : initial}</div>`
}

export function message(title: string, text: string, status = 200) {
  return page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`, { status })
}

// A line of text to copy: a command, a URL.
export function copyLine(text: string) {
  return `<div class="cmd"><code>${esc(text)}</code><button type="button" class="copy secondary" data-copy="${esc(text)}" aria-label="Copy ${esc(text)}">Copy</button></div>`
}

// "Add to Claude": the Mac download, or, anywhere else, what to do instead.
// The download is 60 MB of Mac app, so a phone never gets the link.
export function addToClaude(origin: string, opts: { cls?: string } = {}) {
  return `<div class="mac-only">
    <a class="btn ${opts.cls ?? ''}" href="/dl/yapping.mcpb" download>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/></svg>
      Add to Claude
    </a>
    <p class="muted" style="margin:8px 0 0">For Claude on Mac. <a href="https://claude.ai/download">Don't have it yet?</a></p>
  </div>
  <div class="not-mac card" style="margin:0">
    <b>yapping runs on your Mac.</b>
    <p style="margin:4px 0 12px">Open this page on your Mac to add it to Claude.</p>
    <button type="button" class="secondary" data-copy="${esc(origin)}">Copy this page's link</button>
    <p class="muted" style="margin:16px 0 4px">Already set up on your Mac? In Claude on the web or your phone: Settings › Connectors › Add custom connector, and paste:</p>
    ${copyLine(`${origin}/mcp`)}
  </div>`
}
