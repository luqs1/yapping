#!/usr/bin/env bun
// yap: the yapping node's command line.
//
//   yap login                     link this Mac to your yapping account
//   yap status                    signed in? node running? connected?
//   yap open                      open the sidebar in your browser
//   yap mcp                       stdio MCP server for Claude Code / Codex CLI
//   yap contacts                  who you can message
//   yap invite                    make an invite link for someone new
//   yap logout                    unlink this Mac
//   yap service install|uninstall run the node at login (launchd)
//   yap daemon                    run the node in the foreground

import { localClient } from './client'
import { login, logout, openInBrowser } from './login'
import { ensureHome, loadConfig, localToken, yapHome } from './paths'
import { serverApi } from './server-api'
import { installService, uninstallService } from './service'

const HELP = `yapping: messages beside your agent

  yap login                      link this Mac to your yapping account
  yap status                     check that everything's running
  yap open                       open your chats in the browser
  yap contacts                   list the people you can message
  yap invite                     make an invite link for someone new
  yap mcp                        MCP server for Claude Code and Codex
                                   claude mcp add yapping -- yap mcp
  yap logout                     unlink this Mac
  yap service install|uninstall  start yapping when you log in
  yap daemon                     run the node in this terminal
`

const home = ensureHome(yapHome())
const say = (s = '') => console.log(s)

async function daemon() {
  const { startNode } = await import('./node')
  const { claimApi } = await import('./api')
  const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
  const log = (...a: unknown[]) => console.log(stamp(), ...a)
  // Claim the port first: it's the lock that keeps two nodes off one home.
  let node: Awaited<ReturnType<typeof startNode>> | null = null
  const claim = await claimApi({ node: () => node, token: localToken(home), home, log }).catch((e) => {
    console.error(`No free port for the local API (${(e as Error).message}).`)
    process.exit(1)
  })
  if ('running' in claim) {
    console.error(`A yapping node is already running for ${home} at ${claim.running}.`)
    process.exit(1)
  }
  const { api } = claim
  node = await startNode({ home, log })
  log(`yapping node ${home} → http://127.0.0.1:${api.port} (server ${node.config.server})`)
  const bye = async () => {
    api.stop()
    await node?.stop()
    process.exit(0)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

async function status() {
  const cfg = loadConfig(home)
  const h = await localClient({ home }).health()
  say(cfg.user ? `Signed in as ${cfg.user.name}${cfg.user.email ? ` <${cfg.user.email}>` : ''}` : 'Not signed in. Run `yap login`.')
  say(`Server: ${cfg.server}`)
  if (!h.ok) return say("Node: not running. Run `yap service install` to start it at login.")
  say(`Node: running (v${h.version}), ${h.connected ? 'connected' : 'not connected to the server yet'}`)
  try {
    const s = await localClient({ home }).rpc('status')
    if (s.outbox) say(`Waiting to send: ${s.outbox}`)
  } catch {}
}

async function main() {
  const [cmd, sub] = process.argv.slice(2)
  switch (cmd) {
    case 'daemon':
      return daemon()
    case 'mcp': {
      const { runMcp } = await import('./mcp')
      return runMcp()
    }
    case 'login': {
      const cfg = await login({ home })
      say(`You're in, ${cfg.user?.name}. This Mac is linked.`)
      const local = localClient({ home })
      if (!(await local.health()).ok) say('Start the node with `yap service install` so messages arrive while you work.')
      return
    }
    case 'logout':
      logout(home)
      return say('This Mac is unlinked. Your messages stay in ' + home + '.')
    case 'status':
      return status()
    case 'open': {
      const local = localClient({ home })
      if (!(await local.health()).ok) return say("The node isn't running. Run `yap service install` first.")
      const { base } = await local.health()
      openInBrowser(base + '/')
      return say(`Opened ${base}/`)
    }
    case 'contacts': {
      const cfg = loadConfig(home)
      if (!cfg.deviceToken) return say('Not signed in. Run `yap login`.')
      const list = await serverApi(cfg.server, cfg.deviceToken).contacts()
      if (!list.length) return say('No contacts yet. Run `yap invite` and send someone the link.')
      for (const c of list) say(`${c.user.name.padEnd(24)} ${c.user.email || ''}`)
      return
    }
    case 'invite': {
      const cfg = loadConfig(home)
      if (!cfg.deviceToken) return say('Not signed in. Run `yap login`.')
      const { url } = await serverApi(cfg.server, cfg.deviceToken).invite()
      return say(`Send this link to someone you want to yap with:\n  ${url}`)
    }
    case 'service':
      if (sub === 'install') return say(`Installed. yapping now starts when you log in (${installService(home)}).`)
      if (sub === 'uninstall') return say(`Removed ${uninstallService()}.`)
      return say('Usage: yap service install|uninstall')
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      return say(HELP)
    case '--version':
    case 'version': {
      const { VERSION } = await import('./node')
      return say(VERSION)
    }
    default:
      say(`Unknown command "${cmd}".\n`)
      say(HELP)
      process.exit(1)
  }
}

main().catch((e) => {
  console.error((e as Error).message || e)
  process.exit(1)
})
