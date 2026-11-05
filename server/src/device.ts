// Linking a Mac to an account (`yap login`), a device-code flow:
//
//   node    POST /api/device/start {name, boxPub, signPub}
//           → {deviceCode, userCode, verifyUrl, interval, expiresIn}
//   person  opens verifyUrl (/link?code=ABCD-EFGH), signs in, taps "Link"
//   node    POST /api/device/poll {deviceCode} every `interval` seconds
//           → 428 {error:'authorization_pending'} while waiting
//           → 200 {deviceToken, deviceId, user} once, when approved
//           → 403 {error:'access_denied'} | 410 {error:'expired_token'} (final)
//
// The device token is what the node then sends as Bearer, to the API and
// on /ws/node. The server keeps only its hash, and the device's public
// keys, which contacts fetch to encrypt to it.

import type { Ctx } from './ctx'
import { signinRedirect } from './auth'
import { page } from './pages'
import { publicUser, sessionUser, getUser } from './users'
import { MIN, body, clientIp, err, esc, id, json, limited, now, secret, sha256, userCode, crossSite } from './util'

const CODE_TTL = 10 * MIN
const INTERVAL = 2 // seconds between polls

// A NaCl public key: 32 bytes, base64 (standard or url-safe).
const isKey = (s: unknown) => typeof s === 'string' && s.length <= 64 && Buffer.from(s, s.includes('-') || s.includes('_') ? 'base64url' : 'base64').length === 32

type CodeRow = { device_code_hash: string; user_code: string; name: string; box_pub: string; sign_pub: string; status: string; user_id: string | null; expires_at: number }

export async function deviceStart(ctx: Ctx, req: Request) {
  if (limited(`dev:${clientIp(req)}`, 30, 60 * MIN)) return err(429, 'slow_down', 'Too many attempts. Try again later.')
  const b = await body(req)
  const name = String(b.name || 'Mac').trim().slice(0, 64) || 'Mac'
  if (!isKey(b.boxPub) || !isKey(b.signPub)) return err(400, 'invalid_request', 'boxPub and signPub must be 32-byte base64 keys')
  const deviceCode = secret('ydc')
  let code = userCode()
  while (ctx.db.query('SELECT 1 FROM device_codes WHERE user_code = ?').get(code)) code = userCode()
  ctx.db.query('INSERT INTO device_codes (device_code_hash, user_code, name, box_pub, sign_pub, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(deviceCode), code, name, b.boxPub, b.signPub, 'pending', now(), now() + CODE_TTL)
  return json({
    deviceCode, userCode: code,
    verifyUrl: `${ctx.cfg.origin}/link?code=${code}`,
    interval: INTERVAL, expiresIn: CODE_TTL / 1000,
  })
}

export async function devicePoll(ctx: Ctx, req: Request) {
  const b = await body(req)
  const hash = sha256(String(b.deviceCode || ''))
  const row = ctx.db.query<CodeRow, [string]>('SELECT * FROM device_codes WHERE device_code_hash = ?').get(hash)
  if (!row) return err(400, 'invalid_grant', 'Unknown device code')
  if (row.expires_at < now()) return err(410, 'expired_token', 'The code expired. Run yap login again.')
  if (row.status === 'pending') return err(428, 'authorization_pending')
  if (row.status === 'denied') {
    ctx.db.query('DELETE FROM device_codes WHERE device_code_hash = ?').run(hash)
    return err(403, 'access_denied', 'Linking was cancelled.')
  }
  // Approved: hand out the token exactly once.
  const claimed = ctx.db.query<CodeRow, [string]>(
    "UPDATE device_codes SET status = 'done' WHERE device_code_hash = ? AND status = 'approved' RETURNING *",
  ).get(hash)
  if (!claimed?.user_id) return err(400, 'invalid_grant', 'This code was already used')
  const user = getUser(ctx.db, claimed.user_id)
  if (!user) return err(400, 'invalid_grant')
  const deviceId = id(9)
  const deviceToken = secret('ydt')
  ctx.db.query('INSERT INTO devices (id, user_id, name, box_pub, sign_pub, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(deviceId, user.id, claimed.name, claimed.box_pub, claimed.sign_pub, sha256(deviceToken), now())
  ctx.db.query('DELETE FROM device_codes WHERE device_code_hash = ?').run(hash)
  return json({ deviceToken, deviceId, user: publicUser(user) })
}

// ---- the approve page ----------------------------------------------------

const pendingByUserCode = (ctx: Ctx, code: string) =>
  ctx.db.query<CodeRow, [string, number]>("SELECT * FROM device_codes WHERE user_code = ? AND status = 'pending' AND expires_at > ?")
    .get(code.trim().toUpperCase().replace(/[^A-Z]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2'), now())

export function linkPage(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  const code = new URL(req.url).searchParams.get('code') || ''
  if (!code) return page('Link your Mac', `
    <h1>Link your Mac</h1><p>Type the code your Mac is showing.</p>
    <form method="get" action="/link" class="stack" style="margin-top:20px">
      <input type="text" name="code" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" required aria-label="Code">
      <button type="submit">Continue</button></form>`)
  const row = pendingByUserCode(ctx, code)
  if (!row) return page('Code expired', `<h1>That code has expired</h1><p>Run <b>yap login</b> on your Mac again to get a new one.</p>`, { status: 410 })
  return page('Link your Mac', `
    <h1>Link “${esc(row.name)}” to yapping?</h1>
    <p>Check that your Mac shows this code:</p>
    <div class="code">${esc(row.user_code)}</div>
    <p class="muted" style="margin-bottom:24px">Signed in as ${esc(user.email)}. Only link a Mac that's yours.</p>
    <form method="post" action="/link" class="stack">
      <input type="hidden" name="code" value="${esc(row.user_code)}">
      <button type="submit" name="decision" value="approve">Link this Mac</button>
      <button type="submit" name="decision" value="deny" class="secondary">Cancel</button>
    </form>`)
}

export async function linkDecide(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  if (crossSite(req, ctx.cfg.origin)) return err(403, 'bad_origin')
  const b = await body(req)
  const row = pendingByUserCode(ctx, String(b.code || ''))
  if (!row) return page('Code expired', `<h1>That code has expired</h1><p>Run <b>yap login</b> on your Mac again to get a new one.</p>`, { status: 410 })
  const approve = b.decision === 'approve'
  ctx.db.query('UPDATE device_codes SET status = ?, user_id = ? WHERE device_code_hash = ?').run(approve ? 'approved' : 'denied', user.id, row.device_code_hash)
  if (!approve) return page('Cancelled', `<h1>Not linked</h1><p>“${esc(row.name)}” wasn't linked. You can close this tab.</p>`)
  return page('Linked', `<h1>Your Mac is linked</h1><p>“${esc(row.name)}” is now signed in to yapping as ${esc(user.email)}. You can close this tab.</p>
    <a class="btn secondary" href="/account" style="margin-top:24px">Your account</a>`)
}
