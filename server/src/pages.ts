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
`

export function page(title: string, content: string, opts: { script?: string; status?: number } = {}) {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · yapping</title><style>${CSS}</style></head>
<body><main><div class="mark">yapping</div>${content}</main>${opts.script ? `<script>${opts.script}</script>` : ''}</body></html>`,
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
