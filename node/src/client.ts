// A tiny client for the local API, used by `yap mcp` and the CLI.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { localPort, yapHome } from './paths'

export class LocalError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export function localClient(opts: { home?: string; base?: string } = {}) {
  const home = opts.home || yapHome()
  const base = (opts.base || process.env.YAP_API || `http://127.0.0.1:${localPort()}`).replace(/\/+$/, '')
  const token = () => {
    const p = join(home, 'local-token')
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
  }

  async function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yap-token': token() }, body: JSON.stringify({ method, params }) })
    } catch {
      throw new LocalError('node_down', "Your yapping node isn't running on this Mac. Start it with `yap service install` (or `yap daemon`).")
    }
    const body: any = await res.json().catch(() => ({}))
    if (body.error) throw new LocalError(body.error.code || 'error', body.error.message || String(body.error))
    return body.result as T
  }

  async function health(): Promise<{ ok: boolean; version?: string; connected?: boolean }> {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })
      return await r.json()
    } catch {
      return { ok: false }
    }
  }

  return { rpc, health, base, token }
}
