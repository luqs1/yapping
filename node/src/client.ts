// A tiny client for the local API, used by `yap mcp` and the CLI.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiPort, homeId, localPort, yapHome } from './paths'

export class LocalError extends Error {
  constructor(public code: string, message: string, public data?: Record<string, unknown>) {
    super(message)
  }
}

export function localClient(opts: { home?: string; base?: string } = {}) {
  const home = opts.home || yapHome()
  const fixed = (opts.base || process.env.YAP_API || '').replace(/\/+$/, '') || null
  let found: string | null = fixed
  const token = () => {
    const p = join(home, 'local-token')
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
  }

  // Is a yapping node (not some other program) answering at this base?
  async function probe(base: string): Promise<any | null> {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })
      const body: any = await r.json()
      return body?.app === 'yapping' && body.ok && (fixed || body.home === homeId(home)) ? body : null
    } catch {
      return null
    }
  }

  // Where this home's node is: the port it wrote down, or the default.
  async function locate(): Promise<{ base: string; health: any } | null> {
    const ports = [...new Set([apiPort(home), localPort()].filter((p): p is number => !!p))]
    for (const base of fixed ? [fixed] : ports.map((p) => `http://127.0.0.1:${p}`)) {
      const h = await probe(base)
      if (h) return { base, health: h }
    }
    return null
  }

  async function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const base = found || (found = (await locate())?.base ?? null)
    const down = () => new LocalError('node_down', "Your yapping node isn't running on this Mac.")
    if (!base) throw down()
    let res: Response
    try {
      res = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yap-token': token() }, body: JSON.stringify({ method, params }) })
    } catch {
      if (!fixed) found = null
      throw down()
    }
    const body: any = await res.json().catch(() => ({}))
    if (body.error) throw new LocalError(body.error.code || 'error', body.error.message || String(body.error), body.error.data)
    return body.result as T
  }

  async function health(): Promise<{ ok: boolean; version?: string; connected?: boolean; signedIn?: boolean; base?: string }> {
    const l = await locate()
    if (!l) return { ok: false }
    found = l.base
    return { ...l.health, base: l.base }
  }

  return { rpc, health, probe, token }
}
