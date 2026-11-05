// Where a node keeps its things. Everything lives in one folder,
// ~/.yapping by default; YAP_HOME moves it, so tests (or two people on one
// Mac) can run two nodes side by side.
//
//   keys.json    device keypairs (mode 600)
//   config.json  server URL, device token, who we are (mode 600)
//   local-token  the secret local clients send as x-yap-token (mode 600)
//   node.db      messages, chats, assists… (SQLite)
//   bridges/     bridge sidecars' state (next phase)

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

export const DEFAULT_SERVER = 'https://yap.luqmaan.dev'
export const DEFAULT_PORT = 7790

export function yapHome(env = process.env): string {
  return env.YAP_HOME || join(homedir(), '.yapping')
}

// The folder is the owner's alone: messages and keys live here.
export function ensureHome(home: string): string {
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })
  try { chmodSync(home, 0o700) } catch {}
  return home
}

// A file only its owner may read.
export function writePrivate(path: string, data: string) {
  writeFileSync(path, data, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export type User = { id: string; name: string; email?: string; avatar?: string | null }

export type Config = {
  server: string
  deviceToken?: string
  deviceId?: string
  user?: User
  deviceName?: string
  // Which harness this person's agent is, for assistedBy and the chibi.
  agent?: string
  // Who installed the launchd agent ('mcpb': the Claude bundle, which may also remove it).
  service?: string
}

export function loadConfig(home: string, env = process.env): Config {
  const path = join(home, 'config.json')
  let cfg: Config = { server: DEFAULT_SERVER }
  if (existsSync(path)) {
    try { cfg = { ...cfg, ...JSON.parse(readFileSync(path, 'utf8')) } } catch {}
  }
  // The environment wins, so tests and staging can point anywhere.
  if (env.YAP_SERVER) cfg.server = env.YAP_SERVER
  cfg.server = cfg.server.replace(/\/+$/, '')
  return cfg
}

export function saveConfig(home: string, cfg: Config) {
  ensureHome(home)
  writePrivate(join(home, 'config.json'), JSON.stringify(cfg, null, 2))
}

// The local API's secret. Made once; local clients read it from disk.
export function localToken(home: string): string {
  ensureHome(home)
  const path = join(home, 'local-token')
  if (existsSync(path)) {
    const t = readFileSync(path, 'utf8').trim()
    if (t) return t
  }
  const t = randomBytes(24).toString('base64url')
  writePrivate(path, t)
  return t
}

// The port the local API actually got. 7790 is the default, but another
// program may hold it (agentbus does on some Macs), so the node takes the
// next free one and says which in YAP_HOME/api.json.
export function apiPort(home: string): number | undefined {
  try {
    const p = Number(JSON.parse(readFileSync(join(home, 'api.json'), 'utf8')).port)
    return p > 0 ? p : undefined
  } catch {
    return undefined
  }
}

// Which YAP_HOME a node serves, without saying the path: /health carries it
// so a client never talks to another home's node.
export const homeId = (home: string) => createHash('sha256').update(home).digest('hex').slice(0, 12)

export function saveApiPort(home: string, port: number) {
  writePrivate(join(home, 'api.json'), JSON.stringify({ port, pid: process.pid }))
}

export function localPort(env = process.env): number {
  return env.YAP_PORT ? Number(env.YAP_PORT) : DEFAULT_PORT
}

export function deviceName(): string {
  return hostname().replace(/\.local$/, '') || 'Mac'
}
