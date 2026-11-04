// Small helpers shared by every route: ids, secrets, hashing, responses,
// cookies and HTML escaping.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const now = () => Date.now()
export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

// Random ids and secrets. Secrets carry a short prefix so a leaked one is
// easy to recognise (ydt_ device token, yat_ access, yrt_ refresh …).
export const id = (bytes = 12) => randomBytes(bytes).toString('base64url')
export const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`

// Secrets are stored only as their SHA-256.
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url')

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// A code people read off one screen and type or compare on another:
// 8 letters from an alphabet without look-alikes, shown as ABCD-EFGH.
export function userCode() {
  const A = 'BCDFGHJKLMNPQRSTVWXZ'
  const b = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export const err = (status: number, error: string, message?: string) => json({ error, ...(message ? { message } : {}) }, status)

export function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  })
}

export function redirect(location: string, headers: Record<string, string> = {}) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } })
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function cookie(name: string, value: string, opts: { maxAge?: number; secure: boolean; path?: string }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax']
  if (opts.secure) parts.push('Secure')
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`)
  return parts.join('; ')
}

// Read a body as JSON or form data, whichever it is. OAuth token requests
// are form-encoded; the API is JSON.
export async function body(req: Request): Promise<Record<string, any>> {
  const type = req.headers.get('content-type') || ''
  try {
    if (type.includes('application/json')) return (await req.json()) ?? {}
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const f = await req.formData()
      const o: Record<string, any> = {}
      f.forEach((v, k) => (o[k] = typeof v === 'string' ? v : ''))
      return o
    }
    const t = await req.text()
    return t ? JSON.parse(t) : {}
  } catch {
    return {}
  }
}

// The caller's IP. Behind cloudflared everything comes from 127.0.0.1, so
// trust CF-Connecting-IP (only cloudflared can reach our loopback port).
export function clientIp(req: Request, fallback = '') {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || fallback
}

// A tiny fixed-window rate limiter, in memory. Good enough for one box.
const buckets = new Map<string, { n: number; reset: number }>()
export function limited(key: string, max: number, windowMs: number) {
  const t = now()
  const b = buckets.get(key)
  if (!b || b.reset < t) {
    buckets.set(key, { n: 1, reset: t + windowMs })
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k)
    return false
  }
  return ++b.n > max
}

// Only local paths may be used as a post-sign-in destination.
export const safeNext = (next: unknown) =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/account'
