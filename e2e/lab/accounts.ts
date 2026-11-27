#!/usr/bin/env bun
// Lab accounts: link a node home to a dev-login account, and make two lab
// people contacts through a real invite. Used by setup.sh; safe to re-run.
//
//   bun accounts.ts link <email> <name> <deviceName>
//       run AS the lab user, with YAP_HOME and YAP_SERVER set. Dev-logs-in
//       (server must run with YAP_DEV=1), then the real device-code flow:
//       /api/device/start → POST /link with the dev cookie → poll.
//       Skips if the home is already linked to that email on that server.
//
//   bun accounts.ts befriend <homeA> <homeB>
//       run as root (reads both homes). A invites, B accepts, with each
//       node's own device token. Skips if they're already contacts.
//
// Only @example.test dev accounts. Never a real account.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { login } from '../../node/src/login'
import { loadConfig, saveConfig } from '../../node/src/paths'
import { serverApi } from '../../node/src/server-api'

const [cmd, ...args] = process.argv.slice(2)
const die = (m: string) => { console.error(m); process.exit(1) }

async function link(email: string, name: string, deviceName: string) {
  if (!email?.endsWith('@example.test')) die('lab accounts must be @example.test')
  const home = process.env.YAP_HOME || die('YAP_HOME is not set')!
  const server = (process.env.YAP_SERVER || die('YAP_SERVER is not set')!).replace(/\/+$/, '')
  process.env.YAP_NO_BROWSER = '1'

  const cfg = loadConfig(home)
  if (cfg.deviceToken && cfg.user?.email === email && cfg.server === server) {
    try {
      await serverApi(server, cfg.deviceToken).me()
      return console.log(`${email}: already linked (${cfg.deviceId})`)
    } catch {
      console.log(`${email}: saved device token no longer works; linking again`)
    }
  }

  const res = await fetch(`${server}/dev/login?${new URLSearchParams({ email, name })}`)
  if (!res.ok) die(`dev login failed (${res.status}); is the lab server running with YAP_DEV=1?`)
  const cookie = res.headers.get('set-cookie')!.split(';')[0]

  // config.json without a token, so login() runs the whole flow.
  saveConfig(home, { ...cfg, server, deviceName, deviceToken: undefined, deviceId: undefined, user: undefined })
  const approvals: Promise<Response>[] = []
  const done = await login({
    home, intervalMs: 200, say: () => {},
    openUrl: (u) => {
      const code = new URL(u).searchParams.get('code')!
      approvals.push(fetch(`${server}/link`, {
        method: 'POST',
        headers: { cookie, origin: server, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, decision: 'approve' }),
      }))
    },
  })
  for (const a of await Promise.all(approvals)) if (!a.ok) die(`approve failed: ${a.status}`)
  console.log(`${email}: linked as ${done.user?.name} (${done.deviceId})`)
}

function tokenOf(home: string) {
  const p = join(home, 'config.json')
  if (!existsSync(p)) die(`${home} is not linked`)
  const c = JSON.parse(readFileSync(p, 'utf8'))
  if (!c.deviceToken) die(`${home} is not linked`)
  return c as { server: string; deviceToken: string; user: { id: string; name: string } }
}

async function befriend(homeA: string, homeB: string) {
  const a = tokenOf(homeA), b = tokenOf(homeB)
  const server = (process.env.YAP_SERVER || a.server).replace(/\/+$/, '')
  const A = serverApi(server, a.deviceToken), B = serverApi(server, b.deviceToken)
  const has = (await A.contacts()).some((c) => c.user.id === b.user.id)
  if (has) return console.log(`${a.user.name} and ${b.user.name}: already contacts`)
  const inv = await A.invite()
  await B.acceptInvite(inv.code)
  const now = await A.contacts()
  if (!now.some((c) => c.user.id === b.user.id)) die('invite accepted but Bob is not in Alice\'s contacts')
  console.log(`${a.user.name} and ${b.user.name}: contacts now (invite ${inv.code.slice(0, 6)}…)`)
}

if (cmd === 'link') await link(args[0], args[1], args[2] || 'lab')
else if (cmd === 'befriend') await befriend(args[0], args[1])
else die('usage: accounts.ts link <email> <name> [deviceName] | befriend <homeA> <homeB>')
