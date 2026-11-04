// A pretend yap-wa: the same stdio protocol, no WhatsApp.
//
// It keeps its "session" in $YAP_HOME/bridges/whatsapp/fake-session.json,
// logs every command it gets to fake-commands.jsonl and its pid to
// fake-pids, and takes orders from the test over a little HTTP server whose
// port it writes to fake-port:
//   POST /emit   {…event}   → written to stdout as is
//   POST /scan              → the phone scanned the code: linked
//
// FAKE_WA_SCAN_MS=n scans by itself n ms after the first QR code.

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.env.YAP_HOME!, 'bridges', 'whatsapp')
mkdirSync(dir, { recursive: true, mode: 0o700 })
const sessionFile = join(dir, 'fake-session.json')
const ACCOUNT = { name: 'Test Phone', phone: '+447700900000', jid: '447700900000@s.whatsapp.net' }

const out = (ev: Record<string, unknown>) => process.stdout.write(JSON.stringify(ev) + '\n')
const linked = () => existsSync(sessionFile)
let linking = false
let n = 0

appendFileSync(join(dir, 'fake-pids'), `${process.pid}\n`)

function scan() {
  if (!linking) return
  linking = false
  writeFileSync(sessionFile, JSON.stringify(ACCOUNT))
  out({ type: 'connected', account: ACCOUNT })
}

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/emit') out(await req.json())
    else if (url.pathname === '/scan') scan()
    return new Response('ok')
  },
})
writeFileSync(join(dir, 'fake-port'), String(server.port))

out({ type: 'ready', version: 'fake', linked: linked() })
if (linked()) setTimeout(() => out({ type: 'connected', account: ACCOUNT }), 10)

const reply = (id: unknown, fields: Record<string, unknown> = {}) => out({ type: 'result', ...fields, id, ok: true })

function handle(c: any) {
  appendFileSync(join(dir, 'fake-commands.jsonl'), JSON.stringify(c) + '\n')
  switch (c.cmd) {
    case 'link':
      if (linked()) return reply(c.id, { status: 'linked', account: ACCOUNT })
      linking = true
      reply(c.id, { status: 'linking' })
      out({ type: 'qr', code: `2@fake-code-${++n}`, expiresAt: Date.now() + 60_000 })
      if (process.env.FAKE_WA_SCAN_MS) setTimeout(scan, Number(process.env.FAKE_WA_SCAN_MS))
      return
    case 'status':
      return reply(c.id, { status: linked() ? 'linked' : linking ? 'linking' : 'unlinked', connected: linked(), ...(linked() ? { account: ACCOUNT } : {}) })
    case 'unlink':
      rmSync(sessionFile, { force: true })
      out({ type: 'logged_out', reason: 'unlinked' })
      return reply(c.id, { status: 'unlinked' })
    case 'send':
      if (!linked()) return out({ type: 'result', id: c.id, ok: false, code: 'not_linked', error: 'not linked' })
      return reply(c.id, { msgId: `FAKE${++n}`, ts: Date.now() })
    case 'history':
      return reply(c.id, { messages: [] })
    case 'chats':
      return reply(c.id, { chats: [] })
    default:
      return out({ type: 'result', id: c.id, ok: false, code: 'unknown_command', error: c.cmd })
  }
}

let buf = ''
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk)
  let i: number
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (line.trim()) handle(JSON.parse(line))
  }
}
// The node closed our stdin: leave, like the real one.
server.stop(true)
process.exit(0)
