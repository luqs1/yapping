// Configuration, all from the environment. See README.md for the list.
//
// The server always listens on loopback (cloudflared fronts it in
// production), and builds every absolute URL from YAP_ORIGIN, never from
// the request: behind the tunnel requests arrive as plain http from
// 127.0.0.1, so the request URL says nothing about the public address.

import { join } from 'node:path'

export type Config = {
  origin: string // https://yap.luqmaan.dev, no trailing slash
  host: string
  port: number
  dataDir: string
  dev: boolean // YAP_DEV=1: /dev/login, links logged, http CIMD on loopback
  clerk?: { publishableKey: string; secretKey: string; frontendApi: string }
  uiDist: string // ui/dist/sidebar.html
  publicDir: string // server/public (install.sh)
  rpcTimeoutMs: number
}

const SERVER_DIR = join(import.meta.dir, '..')

export function loadConfig(env: Record<string, string | undefined> = process.env, over: Partial<Config> = {}): Config {
  const dev = env.YAP_DEV === '1'
  const port = Number(env.PORT || 8787)
  const cfg: Config = {
    origin: (env.YAP_ORIGIN || `http://localhost:${port}`).replace(/\/+$/, ''),
    host: env.HOST || '127.0.0.1',
    port,
    dataDir: env.YAP_DATA || (dev ? join(SERVER_DIR, '.data') : '/var/lib/yapping'),
    dev,
    clerk: env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY
      ? { publishableKey: env.CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY, frontendApi: frontendApi(env.CLERK_PUBLISHABLE_KEY) }
      : undefined,
    uiDist: env.YAP_UI_DIST || join(SERVER_DIR, '..', 'ui', 'dist', 'sidebar.html'),
    publicDir: join(SERVER_DIR, 'public'),
    rpcTimeoutMs: Number(env.YAP_RPC_TIMEOUT_MS || 20000),
    ...over,
  }
  return cfg
}

// A Clerk publishable key is "pk_test_" or "pk_live_" plus base64 of the
// Frontend API host and a trailing "$": that host serves ClerkJS.
export function frontendApi(publishableKey: string) {
  return atob(publishableKey.split('_').slice(2).join('_')).replace(/\$$/, '')
}
