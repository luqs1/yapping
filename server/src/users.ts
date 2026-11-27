// Users, browser sessions, device tokens and the contact book.
//
// A request is authenticated one of two ways:
//   - a browser: the httpOnly session cookie set at sign-in;
//   - a node:    Authorization: Bearer <deviceToken> from `yap login`.
// (Chat hosts use OAuth access tokens, and only on /mcp; see oauth.ts.)

import type { Config } from './config'
import type { DB } from './db'
import { DAY, cookie, id, now, parseCookies, secret, sha256 } from './util'

export type UserRow = {
  id: string; email: string; name: string; avatar: string | null
  google_sub: string | null; clerk_id: string | null; domain: string | null; created_at: number
}
export type DeviceRow = {
  id: string; user_id: string; name: string; box_pub: string; sign_pub: string
  token_hash: string; created_at: number; last_seen: number | null
}
export type PublicUser = { id: string; name: string; email: string; avatar: string | null }

export const publicUser = (u: UserRow): PublicUser => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar })
export const publicDevice = (d: DeviceRow) => ({ deviceId: d.id, boxPub: d.box_pub, signPub: d.sign_pub, name: d.name, lastSeen: d.last_seen })

export const getUser = (db: DB, userId: string) => db.query<UserRow, [string]>('SELECT * FROM users WHERE id = ?').get(userId)
export const userByEmail = (db: DB, email: string) => db.query<UserRow, [string]>('SELECT * FROM users WHERE email = ?').get(email.toLowerCase())

// Find or make the user. A Clerk sign-in carries a stable Clerk user id,
// preferred over the email (which can change); `email` is their primary
// email, or their phone number when they signed up with a phone.
export function upsertUser(db: DB, p: { email: string; name?: string; avatar?: string | null; clerkId?: string; domain?: string | null }): UserRow {
  const email = p.email.trim().toLowerCase()
  let u = (p.clerkId && db.query<UserRow, [string]>('SELECT * FROM users WHERE clerk_id = ?').get(p.clerkId)) || userByEmail(db, email)
  if (!u) {
    const userId = id(9)
    db.query('INSERT INTO users (id, email, name, avatar, clerk_id, domain, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, email, p.name?.trim() || defaultName(email), p.avatar ?? null, p.clerkId ?? null, p.domain ?? null, now())
    return getUser(db, userId)!
  }
  db.query(`UPDATE users SET
      clerk_id = COALESCE(?, clerk_id),
      email = ?,
      avatar = COALESCE(?, avatar),
      domain = COALESCE(?, domain),
      name = CASE WHEN ? IS NOT NULL AND name = ? THEN ? ELSE name END
    WHERE id = ?`)
    .run(p.clerkId ?? null, email, p.avatar ?? null, p.domain ?? null, p.name ?? null, defaultName(u.email), p.name ?? null, u.id)
  return getUser(db, u.id)!
}

// "finn.o@acme.com" → "Finn O": a friendly name until the person sets one.
export const defaultName = (email: string) =>
  email.split('@')[0].split(/[._+-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || email

// ---- browser sessions ----------------------------------------------------

export const SESSION_COOKIE = 'yap_session'
const SESSION_TTL = 30 * DAY
const secureCookies = (cfg: Config) => cfg.origin.startsWith('https://')

export function startSession(cfg: Config, db: DB, userId: string): string {
  const sid = secret('yss')
  db.query('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(sid), userId, now(), now() + SESSION_TTL)
  return cookie(SESSION_COOKIE, sid, { maxAge: SESSION_TTL / 1000, secure: secureCookies(cfg) })
}

export function endSession(cfg: Config, db: DB, req: Request): string {
  const sid = parseCookies(req)[SESSION_COOKIE]
  if (sid) db.query('DELETE FROM sessions WHERE id_hash = ?').run(sha256(sid))
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: secureCookies(cfg) })
}

export function sessionUser(db: DB, req: Request): UserRow | null {
  const sid = parseCookies(req)[SESSION_COOKIE]
  if (!sid) return null
  return db.query<UserRow, [string, number]>(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?',
  ).get(sha256(sid), now())
}

// ---- device tokens -------------------------------------------------------

export const bearer = (req: Request) => req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1].trim() || null

export function deviceByToken(db: DB, token: string | null): { device: DeviceRow; user: UserRow } | null {
  if (!token) return null
  const device = db.query<DeviceRow, [string]>('SELECT * FROM devices WHERE token_hash = ?').get(sha256(token))
  if (!device) return null
  const user = getUser(db, device.user_id)
  return user ? { device, user } : null
}

// Who is calling the JSON API: a node (device token) or a browser (cookie).
// Cookie-authenticated writes must come from our own pages: SameSite=Lax
// already keeps other sites' POSTs cookieless, and the Origin check is a
// second lock.
export function apiCaller(cfg: Config, db: DB, req: Request): { user: UserRow; device?: DeviceRow } | null {
  const tok = bearer(req)
  if (tok) return deviceByToken(db, tok)
  const user = sessionUser(db, req)
  if (!user) return null
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (origin && origin !== cfg.origin) return null
  }
  return { user }
}

// ---- contacts ------------------------------------------------------------

export const isContact = (db: DB, owner: string, other: string) =>
  !!db.query('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?').get(owner, other)

export const contactIds = (db: DB, owner: string) =>
  db.query<{ contact_id: string }, [string]>('SELECT contact_id FROM contacts WHERE owner_id = ?').all(owner).map((r) => r.contact_id)

// Make two people each other's contacts. Returns true if it's new.
export function connect(db: DB, a: string, b: string): boolean {
  if (a === b) return false
  const fresh = !isContact(db, a, b) || !isContact(db, b, a)
  const ins = db.query('INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)')
  db.transaction(() => { ins.run(a, b, now()); ins.run(b, a, now()) })()
  return fresh
}

// Who made an invite, if the code is real and still good.
export function inviterByCode(db: DB, code: string): UserRow | null {
  const inv = db.query<{ inviter_id: string }, [string, number]>('SELECT inviter_id FROM invites WHERE code = ? AND expires_at > ?').get(code, now())
  return (inv && getUser(db, inv.inviter_id)) || null
}

// The account page's list: everyone you're connected with, newest first,
// with when you connected and whether they've linked a Mac yet.
export type ContactSummary = UserRow & { connected_at: number; has_mac: number }
export const contactSummaries = (db: DB, owner: string) =>
  db.query<ContactSummary, [string]>(
    `SELECT u.*, c.created_at AS connected_at, EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id) AS has_mac
     FROM contacts c JOIN users u ON u.id = c.contact_id WHERE c.owner_id = ? ORDER BY c.created_at DESC, u.name`,
  ).all(owner)
