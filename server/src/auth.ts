// Signing in, in a browser. Clerk does the signing in (Google, email, phone,
// passkeys: whatever the Clerk dashboard has switched on) with its own
// component on /signin. The page then hands the Clerk session token to
// POST /auth/clerk, which verifies it and starts our own session cookie, so
// everything else here (linking a Mac, invites, the connector consent page)
// keeps working on that one cookie.
// Plus /dev/login?email= when YAP_DEV=1, so tests can make users.

import { createClerkClient, verifyToken } from '@clerk/backend'
import type { Ctx } from './ctx'
import { avatar, page } from './pages'
import { type UserRow, endSession, publicDevice, publicUser, sessionUser, startSession, upsertUser } from './users'
import { body, err, esc, json, redirect, safeNext, crossSite } from './util'

// ---- helpers -------------------------------------------------------------

// Pages that need a signed-in person send everyone else to sign in first,
// and back here afterwards.
export function signinRedirect(req: Request) {
  const u = new URL(req.url)
  return redirect(`/signin?next=${encodeURIComponent(u.pathname + u.search)}`)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Personal mail providers don't make people teammates; a work domain does.
const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com'])
const workDomain = (email: string) => {
  const d = email.split('@')[1]?.toLowerCase()
  return d && !PERSONAL.has(d) ? d : null
}

// ClerkJS, loaded from the app's own Frontend API: the UI bundle, then the
// SDK, as Clerk's no-bundler quickstart has it.
function clerkScripts(ctx: Ctx) {
  const c = ctx.cfg.clerk!
  return `<script crossorigin="anonymous" src="https://${esc(c.frontendApi)}/npm/@clerk/ui@1/dist/ui.browser.js"></script>
<script crossorigin="anonymous" data-clerk-publishable-key="${esc(c.publishableKey)}" src="https://${esc(c.frontendApi)}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"></script>`
}

const CLERK_LOAD = `await Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } })`

// ---- the sign-in page ----------------------------------------------------

export function signinPage(ctx: Ctx, req: Request) {
  const url = new URL(req.url)
  const next = safeNext(url.searchParams.get('next'))
  const leaving = url.searchParams.has('signedout')
  if (!leaving && sessionUser(ctx.db, req)) return redirect(next)
  if (!ctx.cfg.clerk) return page('Sign in', `<h1>Sign-in isn't set up</h1><p>This server has no Clerk keys yet.</p>`, { status: 503 })
  return page('Sign in', `
    <h1>Sign in to yapping</h1>
    <p>Chat with the people you work with, right next to your AI.</p>
    <div id="clerk" style="margin-top:28px;min-height:420px"></div>
    <p class="err" id="e"></p>
    ${clerkScripts(ctx)}`, {
    script: `
      const next = ${JSON.stringify(next)}
      // Our session from Clerk's: the server checks the token and sets its cookie.
      async function enter() {
        const token = await Clerk.session.getToken()
        const r = await fetch('/auth/clerk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, next }) })
        const j = await r.json().catch(() => ({}))
        if (r.ok) location.href = j.next
        else document.getElementById('e').textContent = j.message || "That didn't work. Please try again."
      }
      window.addEventListener('load', async () => {
        ${CLERK_LOAD}
        if (${leaving ? 'true' : 'false'} && Clerk.isSignedIn) await Clerk.signOut()
        if (Clerk.isSignedIn) return enter()
        Clerk.mountSignIn(document.getElementById('clerk'), { withSignUp: true })
        Clerk.addListener(({ session }) => { if (session) enter() })
      })`,
  })
}

// POST /auth/clerk {token, next}: a Clerk session token in, our session out.
export async function clerkExchange(ctx: Ctx, req: Request) {
  if (!ctx.cfg.clerk) return err(503, 'not_configured')
  if (crossSite(req, ctx.cfg.origin)) return err(403, 'bad_origin')
  const b = await body(req)
  let claims
  try {
    claims = await verifyToken(String(b.token || ''), { secretKey: ctx.cfg.clerk.secretKey, authorizedParties: [ctx.cfg.origin] })
  } catch {
    return err(401, 'bad_token', "That sign-in didn't check out. Please try again.")
  }
  const clerk = createClerkClient({ secretKey: ctx.cfg.clerk.secretKey })
  const cu = await clerk.users.getUser(claims.sub)
  const email = cu.primaryEmailAddress?.emailAddress ?? cu.emailAddresses[0]?.emailAddress
  const phone = cu.primaryPhoneNumber?.phoneNumber ?? cu.phoneNumbers[0]?.phoneNumber
  const handle = email || phone
  if (!handle) return err(400, 'no_contact', 'Add an email or phone number to your account first.')
  const user = upsertUser(ctx.db, {
    email: handle,
    name: cu.fullName || cu.username || undefined,
    avatar: cu.hasImage ? cu.imageUrl : null,
    clerkId: cu.id,
    domain: email ? workDomain(email) : null,
  })
  return json({ next: safeNext(b.next) }, 200, { 'set-cookie': startSession(ctx.cfg, ctx.db, user.id) })
}

// YAP_DEV=1 only: /dev/login?email=a@b.c[&name=&domain=&next=]. Signs in (making
// the user if needed) with no checks at all. `domain` stands in for a work
// email's domain.
export function devLogin(ctx: Ctx, req: Request) {
  if (!ctx.cfg.dev) return new Response('Not found', { status: 404 })
  const q = new URL(req.url).searchParams
  const email = q.get('email') || ''
  if (!EMAIL_RE.test(email)) return err(400, 'bad_email')
  const user = upsertUser(ctx.db, { email, name: q.get('name') || undefined, domain: q.get('domain') || null })
  const setCookie = startSession(ctx.cfg, ctx.db, user.id)
  const next = q.get('next')
  if (next) return redirect(safeNext(next), { 'set-cookie': setCookie })
  return json({ user: publicUser(user) }, 200, { 'set-cookie': setCookie })
}

// Ends our session, then the sign-in page ends Clerk's too.
export function signout(ctx: Ctx, req: Request) {
  return redirect('/signin?signedout', { 'set-cookie': endSession(ctx.cfg, ctx.db, req) })
}

// ---- the account page ----------------------------------------------------

export function accountPage(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  const devices = ctx.db.query<any, [string]>('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(user.id).map(publicDevice)
  const macs = devices.length
    ? devices.map((d) => `<div class="row"><div>${esc(d.name)}<div class="muted">${ctx.hub.isConnected(d.deviceId) ? 'Online now' : d.lastSeen ? `Last seen ${new Date(d.lastSeen).toUTCString().slice(5, 22)} UTC` : 'Never connected'}</div></div>
        <form method="post" action="/account/devices/${esc(d.deviceId)}/remove"><button class="link" type="submit">Remove</button></form></div>`).join('')
    : `<p class="muted" style="margin:0 0 12px">No Macs yet.</p><a class="btn" href="/dl/yapping.mcpb" download>Add to Claude</a>`
  const manage = ctx.cfg.clerk
    ? `<h1 style="font-size:18px">Signing in</h1>
    <p>Your email, phone, passkeys and connected accounts.</p>
    <button type="button" class="secondary" id="manage">Manage how you sign in</button>${clerkScripts(ctx)}`
    : ''
  return page('Your account', `
    <div class="who">${avatar(user)}<div><b>${esc(user.name)}</b><div class="muted">${esc(user.email)}</div></div></div>
    <h1 style="font-size:18px">Your Macs</h1>
    <div class="card">${macs}</div>
    <h1 style="font-size:18px">Invite someone</h1>
    <p>Send them a link. When they open it, you'll be in each other's contacts.</p>
    <form method="post" action="/account/invite" style="margin-bottom:28px"><button type="submit" class="secondary">Make an invite link</button></form>
    ${manage}
    <form method="post" action="/signout" style="margin-top:40px"><button class="link" type="submit">Sign out</button></form>`,
    ctx.cfg.clerk ? { script: `window.addEventListener('load', async () => { ${CLERK_LOAD}; document.getElementById('manage').onclick = () => Clerk.openUserProfile() })` } : {})
}

export function removeDevice(ctx: Ctx, req: Request, deviceId: string) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  if (crossSite(req, ctx.cfg.origin)) return err(403, 'bad_origin')
  const gone = ctx.db.query('DELETE FROM devices WHERE id = ? AND user_id = ?').run(deviceId, user.id).changes
  if (gone) {
    ctx.db.query('DELETE FROM mailbox WHERE to_device = ?').run(deviceId)
    ctx.hub.drop(deviceId)
  }
  return redirect('/account')
}

export type { UserRow }
