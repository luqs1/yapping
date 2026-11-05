// The directory: who you are, who you know, and how to reach their Macs.
//
//   GET  /api/me                      {user, devices}
//   GET  /api/contacts                [{user, relationship, online}]
//   GET  /api/suggestions             [{user}]  same Google Workspace domain, not yet contacts
//   POST /api/contacts/:userId        add a suggested teammate (same domain only)
//   PUT  /api/relationships/:userId   {relation?, tags?, notes?}  your private view
//   GET  /api/users/:id/devices       [{deviceId, boxPub, signPub, name, lastSeen}]  contacts only
//   POST /api/invites                 {code, url}
//   POST /api/invites/:code/accept    {user}  you and the inviter are now contacts
// and the invite page, /i/:code, that a person opens from the link.

import type { Ctx } from './ctx'
import { signinRedirect } from './auth'
import { avatar, message, page } from './pages'
import {
  type DeviceRow, type UserRow, apiCaller, connect, getUser, isContact, publicDevice, publicUser, sessionUser,
} from './users'
import { DAY, body, err, esc, id, json, now, crossSite } from './util'

const INVITE_TTL = 14 * DAY

const caller = (ctx: Ctx, req: Request) => apiCaller(ctx.cfg, ctx.db, req)
const unauthorized = () => err(401, 'unauthorized', 'Sign in, or send a device token')

export function me(ctx: Ctx, req: Request) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  const devices = ctx.db.query<DeviceRow, [string]>('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(c.user.id)
  return json({
    user: publicUser(c.user),
    devices: devices.map((d) => ({ ...publicDevice(d), online: ctx.hub.isConnected(d.id) })),
    ...(c.device ? { deviceId: c.device.id } : {}),
  })
}

type ContactRow = UserRow & { relation: string | null; tags: string; notes: string | null }

export function contacts(ctx: Ctx, req: Request) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  const rows = ctx.db.query<ContactRow, [string]>(
    'SELECT u.*, c.relation, c.tags, c.notes FROM contacts c JOIN users u ON u.id = c.contact_id WHERE c.owner_id = ? ORDER BY u.name',
  ).all(c.user.id)
  return json(rows.map((r) => ({
    user: publicUser(r),
    relationship: { relation: r.relation, tags: JSON.parse(r.tags || '[]'), notes: r.notes },
    online: ctx.hub.online(r.id),
  })))
}

// Teammates: people on the same Google Workspace domain you haven't added yet.
export function suggestions(ctx: Ctx, req: Request) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  if (!c.user.domain) return json([])
  const rows = ctx.db.query<UserRow, [string, string, string]>(
    'SELECT * FROM users WHERE domain = ? AND id != ? AND id NOT IN (SELECT contact_id FROM contacts WHERE owner_id = ?) ORDER BY name LIMIT 200',
  ).all(c.user.domain, c.user.id, c.user.id)
  return json(rows.map((u) => ({ user: publicUser(u) })))
}

export function addSuggested(ctx: Ctx, req: Request, userId: string) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  const other = getUser(ctx.db, userId)
  if (!other || !c.user.domain || other.domain !== c.user.domain || other.id === c.user.id)
    return err(403, 'not_allowed', 'Only teammates on your Google Workspace can be added directly. Send an invite link instead.')
  if (connect(ctx.db, c.user.id, other.id)) ctx.hub.contactAdded(c.user.id, other.id)
  return json({ user: publicUser(other) })
}

export async function putRelationship(ctx: Ctx, req: Request, userId: string) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  if (!isContact(ctx.db, c.user.id, userId)) return err(404, 'not_a_contact')
  const b = await body(req)
  const sets: string[] = [], vals: (string | null)[] = []
  if ('relation' in b) {
    if (b.relation !== null && (typeof b.relation !== 'string' || b.relation.length > 200)) return err(400, 'invalid_request', 'relation: a string up to 200 characters')
    sets.push('relation = ?'); vals.push(b.relation)
  }
  if ('tags' in b) {
    if (!Array.isArray(b.tags) || b.tags.length > 32 || b.tags.some((t: unknown) => typeof t !== 'string' || t.length > 40)) return err(400, 'invalid_request', 'tags: up to 32 short strings')
    sets.push('tags = ?'); vals.push(JSON.stringify(b.tags))
  }
  if ('notes' in b) {
    if (b.notes !== null && (typeof b.notes !== 'string' || b.notes.length > 10_000)) return err(400, 'invalid_request', 'notes: a string up to 10,000 characters')
    sets.push('notes = ?'); vals.push(b.notes)
  }
  if (sets.length) ctx.db.query(`UPDATE contacts SET ${sets.join(', ')} WHERE owner_id = ? AND contact_id = ?`).run(...vals, c.user.id, userId)
  const r = ctx.db.query<{ relation: string | null; tags: string; notes: string | null }, [string, string]>(
    'SELECT relation, tags, notes FROM contacts WHERE owner_id = ? AND contact_id = ?',
  ).get(c.user.id, userId)!
  return json({ relation: r.relation, tags: JSON.parse(r.tags), notes: r.notes })
}

// A contact's (or your own) devices, with the public keys to encrypt to.
export function userDevices(ctx: Ctx, req: Request, userId: string) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  if (userId !== c.user.id && !isContact(ctx.db, c.user.id, userId)) return err(403, 'not_a_contact', 'Only your contacts\' devices are visible')
  const rows = ctx.db.query<DeviceRow, [string]>('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(userId)
  return json(rows.map(publicDevice))
}

// ---- invites -------------------------------------------------------------

function makeInvite(ctx: Ctx, inviterId: string) {
  const code = id(9)
  ctx.db.query('INSERT INTO invites (code, inviter_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(code, inviterId, now(), now() + INVITE_TTL)
  return { code, url: `${ctx.cfg.origin}/i/${code}` }
}

const inviteRow = (ctx: Ctx, code: string) =>
  ctx.db.query<{ code: string; inviter_id: string }, [string, number]>('SELECT code, inviter_id FROM invites WHERE code = ? AND expires_at > ?').get(code, now())

// Accept: one link can be used by several people until it expires.
function accept(ctx: Ctx, user: UserRow, code: string): { inviter?: UserRow; problem?: string } {
  const inv = inviteRow(ctx, code)
  const inviter = inv && getUser(ctx.db, inv.inviter_id)
  if (!inviter) return { problem: 'expired' }
  if (inviter.id === user.id) return { inviter, problem: 'self' }
  if (connect(ctx.db, inviter.id, user.id)) ctx.hub.contactAdded(inviter.id, user.id)
  return { inviter }
}

export function createInvite(ctx: Ctx, req: Request) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  return json(makeInvite(ctx, c.user.id))
}

export function acceptInvite(ctx: Ctx, req: Request, code: string) {
  const c = caller(ctx, req)
  if (!c) return unauthorized()
  const r = accept(ctx, c.user, code)
  if (r.problem === 'expired') return err(404, 'invite_expired', 'This invite has expired')
  if (r.problem === 'self') return err(400, 'own_invite', 'That\'s your own invite')
  return json({ user: publicUser(r.inviter!) })
}

// The page behind an invite link.
export function invitePage(ctx: Ctx, req: Request, code: string) {
  const inv = inviteRow(ctx, code)
  const inviter = inv && getUser(ctx.db, inv.inviter_id)
  if (!inviter) return message('This invite has expired', 'Ask whoever sent it for a new link.', 404)
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  if (user.id === inviter.id) return page('Your invite', `
    <h1>This is your invite link</h1><p>Send it to someone. When they open it, you'll be in each other's contacts.</p>
    <pre>${esc(`${ctx.cfg.origin}/i/${code}`)}</pre>`)
  const already = isContact(ctx.db, user.id, inviter.id)
  return page('Invite', `
    <div class="who">${avatar(inviter)}<div><b>${esc(inviter.name)}</b><div class="muted">${esc(inviter.email)}</div></div></div>
    <h1>${esc(inviter.name)} invited you to yapping</h1>
    <p>${already ? 'You\'re already connected.' : 'Add each other, and you can chat right next to your AI.'}</p>
    ${already ? '' : `<form method="post" action="/i/${esc(code)}" style="margin-top:24px"><button type="submit">Add ${esc(inviter.name.split(' ')[0])}</button></form>`}`)
}

export function invitePagePost(ctx: Ctx, req: Request, code: string) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  if (crossSite(req, ctx.cfg.origin)) return err(403, 'bad_origin')
  const r = accept(ctx, user, code)
  if (r.problem === 'expired') return message('This invite has expired', 'Ask whoever sent it for a new link.', 404)
  if (r.problem === 'self') return message('That\'s your own invite', 'Send it to someone else.')
  const linked = ctx.db.query('SELECT 1 FROM devices WHERE user_id = ? LIMIT 1').get(user.id)
  return page('Connected', `
    <h1>You and ${esc(r.inviter!.name)} are connected</h1>
    ${linked
      ? `<p>${esc(r.inviter!.name.split(' ')[0])} is in your yapping contacts now.</p>`
      : `<p>One more step: put yapping on your Mac. Open Terminal and paste this:</p><pre>curl -fsSL ${esc(ctx.cfg.origin)}/install.sh | sh</pre>`}
    <a class="btn secondary" href="/account" style="margin-top:24px">Your account</a>`)
}

// The account page's "Make an invite link" button.
export function accountInvite(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  if (crossSite(req, ctx.cfg.origin)) return err(403, 'bad_origin')
  const { url } = makeInvite(ctx, user.id)
  return page('Invite link', `
    <h1>Your invite link</h1>
    <p>Send this to someone. It works for 14 days, for anyone you send it to.</p>
    <pre id="u">${esc(url)}</pre>
    <button type="button" class="secondary" onclick="navigator.clipboard.writeText(document.getElementById('u').textContent).then(()=>this.textContent='Copied')">Copy link</button>
    <a class="btn secondary" href="/account" style="margin-top:12px">Back</a>`)
}
