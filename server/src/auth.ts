// Signing in, in a browser. Three ways, all ending in the same session
// cookie:
//   Google      OIDC code flow (with PKCE), shown only when GOOGLE_CLIENT_ID
//               and GOOGLE_CLIENT_SECRET are set. Workspace accounts bring
//               their domain, so teammates get suggested to each other.
//   Email link  a one-time link, sent with Resend (or printed to stdout when
//               RESEND_API_KEY is unset, for development).
//   Passkey     WebAuthn, RP id = YAP_ORIGIN's host. Added from the account
//               page once you're signed in another way.
// Plus /dev/login?email= when YAP_DEV=1, so tests can make users.

import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { Ctx } from './ctx'
import { avatar, message, page } from './pages'
import {
  type UserRow, endSession, publicDevice, publicUser, sessionUser, startSession, upsertUser,
} from './users'
import { HOUR, MIN, body, clientIp, err, esc, id, json, limited, now, redirect, safeNext, secret, sha256 } from './util'
import { createHash, randomBytes } from 'node:crypto'

// ---- helpers -------------------------------------------------------------

// Pages that need a signed-in person send everyone else to sign in first,
// and back here afterwards.
export function signinRedirect(req: Request) {
  const u = new URL(req.url)
  return redirect(`/signin?next=${encodeURIComponent(u.pathname + u.search)}`)
}

function flowPut(ctx: Ctx, kind: string, data: unknown, ttl = 10 * MIN, flowId = id(16)) {
  ctx.db.query('INSERT INTO flows (id, kind, data, expires_at) VALUES (?, ?, ?, ?)').run(flowId, kind, JSON.stringify(data), now() + ttl)
  return flowId
}

// Flows are single use: reading one deletes it.
function flowTake<T = any>(ctx: Ctx, kind: string, flowId: unknown): T | null {
  if (typeof flowId !== 'string') return null
  const row = ctx.db.query<{ data: string }, [string, string, number]>('SELECT data FROM flows WHERE id = ? AND kind = ? AND expires_at > ?').get(flowId, kind, now())
  ctx.db.query('DELETE FROM flows WHERE id = ?').run(flowId)
  return row ? JSON.parse(row.data) : null
}

const rpId = (ctx: Ctx) => new URL(ctx.cfg.origin).hostname
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function signedIn(ctx: Ctx, user: UserRow, next: string) {
  return redirect(safeNext(next), { 'set-cookie': startSession(ctx.cfg, ctx.db, user.id) })
}

// ---- the sign-in page ----------------------------------------------------

export function signinPage(ctx: Ctx, req: Request) {
  const url = new URL(req.url)
  const next = safeNext(url.searchParams.get('next'))
  if (sessionUser(ctx.db, req)) return redirect(next)
  const q = `?next=${encodeURIComponent(next)}`
  const problem = url.searchParams.get('error')
  const google = ctx.cfg.google
    ? `<a class="btn" href="/auth/google${q}">${GOOGLE_G} Continue with Google</a><div class="or">or</div>`
    : ''
  return page('Sign in', `
    <h1>Sign in to yapping</h1>
    <p>Chat with the people you work with, right next to your AI.</p>
    ${problem ? `<p class="err">${esc(problem)}</p>` : ''}
    <div class="stack" style="margin-top:28px">
      ${google}
      <form method="post" action="/auth/email" class="stack">
        <input type="hidden" name="next" value="${esc(next)}">
        <input type="email" name="email" placeholder="you@example.com" autocomplete="email webauthn" required aria-label="Email address">
        <button type="submit"${ctx.cfg.google ? ' class="secondary"' : ''}>Email me a sign-in link</button>
      </form>
      <button type="button" class="secondary" id="pk">Sign in with a passkey</button>
      <p class="err" id="pkerr"></p>
    </div>
    <p class="muted" style="margin-top:28px">New here? Signing in creates your account.</p>`,
    { script: WEBAUTHN_JS + `
      document.getElementById('pk').onclick = async () => {
        const e = document.getElementById('pkerr'); e.textContent = ''
        try {
          const o = await post('/auth/passkey/login/options', {})
          const cred = await navigator.credentials.get({ publicKey: decodeGet(o.options) })
          const r = await post('/auth/passkey/login/verify', { flow: o.flow, response: encodeGet(cred), next: ${JSON.stringify(next)} })
          location.href = r.next
        } catch (x) { e.textContent = x && x.name === 'NotAllowedError' ? '' : (x.message || 'That didn\\'t work. Try another way.') }
      }` })
}

// ---- Google --------------------------------------------------------------

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

export function googleStart(ctx: Ctx, req: Request) {
  const g = ctx.cfg.google
  if (!g) return message('Google sign-in is off', 'Use the email link instead.', 404)
  const next = safeNext(new URL(req.url).searchParams.get('next'))
  const verifier = randomBytes(32).toString('base64url')
  const nonce = id(16)
  const state = flowPut(ctx, 'google', { next, verifier, nonce })
  const u = new URL(GOOGLE_AUTH)
  u.search = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: `${ctx.cfg.origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return redirect(u.toString())
}

export async function googleCallback(ctx: Ctx, req: Request) {
  const g = ctx.cfg.google
  if (!g) return message('Google sign-in is off', 'Use the email link instead.', 404)
  const url = new URL(req.url)
  const flow = flowTake<{ next: string; verifier: string; nonce: string }>(ctx, 'google', url.searchParams.get('state'))
  if (!flow) return redirect('/signin?error=' + encodeURIComponent('That sign-in took too long. Please try again.'))
  const code = url.searchParams.get('code')
  if (!code) return redirect(`/signin?next=${encodeURIComponent(flow.next)}`) // they cancelled

  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: g.clientId, client_secret: g.clientSecret,
      redirect_uri: `${ctx.cfg.origin}/auth/google/callback`,
      grant_type: 'authorization_code', code_verifier: flow.verifier,
    }),
  })
  const tok: any = await res.json().catch(() => ({}))
  // The id token came straight from Google's token endpoint over TLS, so
  // its signature needn't be checked (OIDC Core 3.1.3.7); its claims must.
  const claims = decodeJwt(tok.id_token)
  if (!res.ok || !claims
    || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)
    || claims.aud !== g.clientId || claims.exp * 1000 < now() || claims.nonce !== flow.nonce
    || !claims.email || claims.email_verified === false) {
    console.warn('google sign-in refused', res.status, tok.error)
    return redirect('/signin?error=' + encodeURIComponent('Google sign-in didn\'t work. Please try again.'))
  }
  const user = upsertUser(ctx.db, {
    email: claims.email, name: claims.name, avatar: claims.picture ?? null,
    googleSub: String(claims.sub), domain: claims.hd ?? null,
  })
  return signedIn(ctx, user, flow.next)
}

function decodeJwt(jwt: unknown): any {
  if (typeof jwt !== 'string') return null
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) } catch { return null }
}

// ---- email link ----------------------------------------------------------

const LINK_TTL = 15 * MIN

export async function emailStart(ctx: Ctx, req: Request) {
  const b = await body(req)
  const email = String(b.email || '').trim().toLowerCase()
  const next = safeNext(b.next)
  if (!EMAIL_RE.test(email) || email.length > 254)
    return redirect(`/signin?next=${encodeURIComponent(next)}&error=${encodeURIComponent('That email address doesn\'t look right.')}`)
  if (limited(`mail:${email}`, 5, HOUR) || limited(`mailip:${clientIp(req)}`, 30, HOUR))
    return message('Slow down a little', 'We\'ve sent a few links already. Check your inbox, or try again in an hour.', 429)

  const token = secret('yml')
  ctx.db.query('INSERT INTO magic_links (token_hash, email, next, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), email, next, now() + LINK_TTL)
  const link = `${ctx.cfg.origin}/auth/email/verify?token=${encodeURIComponent(token)}`
  if (ctx.cfg.mail) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.cfg.mail.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: ctx.cfg.mail.from, to: [email], subject: 'Your yapping sign-in link',
        text: `Open this link to sign in to yapping:\n\n${link}\n\nIt works once, for 15 minutes. If you didn't ask for it, ignore this email.`,
        html: `<div style="font:16px/1.5 -apple-system,system-ui,sans-serif;color:#111"><p>Tap the button to sign in to yapping.</p>
          <p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Sign in</a></p>
          <p style="color:#777;font-size:14px">It works once, for 15 minutes. If you didn't ask for it, ignore this email.</p></div>`,
      }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any)
    if (!r.ok) {
      console.error('resend failed', r.status, await r.text())
      return message('We couldn\'t send the email', 'Something went wrong on our side. Please try again in a minute.', 502)
    }
  } else {
    console.log(`[yapping] sign-in link for ${email}: ${link}`)
  }
  return page('Check your email', `
    <h1>Check your email</h1>
    <p>We sent a sign-in link to <b>${esc(email)}</b>. Open it on this device. It works for 15 minutes.</p>
    <p class="muted">Nothing there? Check your spam folder, or <a href="/signin?next=${encodeURIComponent(next)}">try again</a>.</p>`)
}

// Opening the link shows a button rather than signing in straight away:
// mail scanners open links too, and must not use up the token.
export function emailLanding(ctx: Ctx, req: Request) {
  const token = new URL(req.url).searchParams.get('token') || ''
  const row = ctx.db.query<{ email: string }, [string, number]>('SELECT email FROM magic_links WHERE token_hash = ? AND used = 0 AND expires_at > ?').get(sha256(token), now())
  if (!row) return page('Link expired', `<h1>This link has expired</h1><p>Sign-in links work once, for 15 minutes.</p><a class="btn" href="/signin">Get a new link</a>`, { status: 410 })
  return page('Sign in', `
    <h1>Sign in to yapping</h1>
    <p>as <b>${esc(row.email)}</b></p>
    <form method="post" action="/auth/email/verify" style="margin-top:24px">
      <input type="hidden" name="token" value="${esc(token)}">
      <button type="submit" autofocus>Continue</button>
    </form>`)
}

export async function emailVerify(ctx: Ctx, req: Request) {
  const token = String((await body(req)).token || '')
  const row = ctx.db.query<{ email: string; next: string | null }, [string, number]>(
    'UPDATE magic_links SET used = 1 WHERE token_hash = ? AND used = 0 AND expires_at > ? RETURNING email, next',
  ).get(sha256(token), now())
  if (!row) return page('Link expired', `<h1>This link has expired</h1><p>Sign-in links work once, for 15 minutes.</p><a class="btn" href="/signin">Get a new link</a>`, { status: 410 })
  return signedIn(ctx, upsertUser(ctx.db, { email: row.email }), row.next || '/account')
}

// ---- passkeys ------------------------------------------------------------

type PasskeyRow = { id: string; user_id: string; public_key: Uint8Array; counter: number; transports: string | null }

export async function passkeyLoginOptions(ctx: Ctx, req: Request) {
  if (limited(`pk:${clientIp(req)}`, 60, HOUR)) return err(429, 'slow_down')
  const options = await generateAuthenticationOptions({ rpID: rpId(ctx), userVerification: 'preferred' })
  return json({ flow: flowPut(ctx, 'wa-login', { challenge: options.challenge }, 5 * MIN), options })
}

export async function passkeyLoginVerify(ctx: Ctx, req: Request) {
  const b = await body(req)
  const flow = flowTake<{ challenge: string }>(ctx, 'wa-login', b.flow)
  if (!flow || !b.response?.id) return err(400, 'expired', 'That took too long. Please try again.')
  const pk = ctx.db.query<PasskeyRow, [string]>('SELECT * FROM passkeys WHERE id = ?').get(String(b.response.id))
  if (!pk) return err(400, 'unknown_passkey', 'We don\'t know that passkey. Sign in with email, then add it from your account.')
  try {
    const v = await verifyAuthenticationResponse({
      response: b.response, expectedChallenge: flow.challenge,
      expectedOrigin: ctx.cfg.origin, expectedRPID: rpId(ctx),
      credential: { id: pk.id, publicKey: new Uint8Array(pk.public_key), counter: pk.counter, transports: pk.transports ? JSON.parse(pk.transports) : undefined },
    })
    if (!v.verified) throw new Error('not verified')
    ctx.db.query('UPDATE passkeys SET counter = ? WHERE id = ?').run(v.authenticationInfo.newCounter, pk.id)
  } catch (e) {
    return err(400, 'failed', 'That passkey didn\'t work. Please try again.')
  }
  return json({ next: safeNext(b.next) }, 200, { 'set-cookie': startSession(ctx.cfg, ctx.db, pk.user_id) })
}

export async function passkeyRegisterOptions(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return err(401, 'signin_required')
  const existing = ctx.db.query<{ id: string }, [string]>('SELECT id FROM passkeys WHERE user_id = ?').all(user.id)
  const options = await generateRegistrationOptions({
    rpName: 'yapping', rpID: rpId(ctx),
    userName: user.email, userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  return json({ flow: flowPut(ctx, 'wa-reg', { challenge: options.challenge, userId: user.id }, 5 * MIN), options })
}

export async function passkeyRegisterVerify(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return err(401, 'signin_required')
  const b = await body(req)
  const flow = flowTake<{ challenge: string; userId: string }>(ctx, 'wa-reg', b.flow)
  if (!flow || flow.userId !== user.id) return err(400, 'expired', 'That took too long. Please try again.')
  try {
    const v = await verifyRegistrationResponse({
      response: b.response, expectedChallenge: flow.challenge,
      expectedOrigin: ctx.cfg.origin, expectedRPID: rpId(ctx), requireUserVerification: false,
    })
    if (!v.verified) throw new Error('not verified')
    const c = v.registrationInfo.credential
    ctx.db.query('INSERT OR REPLACE INTO passkeys (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, user.id, c.publicKey, c.counter, JSON.stringify(c.transports ?? []), now())
  } catch {
    return err(400, 'failed', 'We couldn\'t add that passkey. Please try again.')
  }
  return json({ ok: true })
}

// ---- dev login, sign out, account ----------------------------------------

// YAP_DEV=1 only: /dev/login?email=a@b.c[&name=&domain=&next=]. Signs in (making
// the user if needed) with no checks at all. `domain` stands in for a
// Google Workspace domain.
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

export function signout(ctx: Ctx, req: Request) {
  return redirect('/signin', { 'set-cookie': endSession(ctx.cfg, ctx.db, req) })
}

export function accountPage(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  const devices = ctx.db.query<any, [string]>('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(user.id).map(publicDevice)
  const passkeys = ctx.db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM passkeys WHERE user_id = ?').get(user.id)!.n
  const macs = devices.length
    ? devices.map((d) => `<div class="row"><div>${esc(d.name)}<div class="muted">${ctx.hub.isConnected(d.deviceId) ? 'Online now' : d.lastSeen ? `Last seen ${new Date(d.lastSeen).toUTCString().slice(5, 22)} UTC` : 'Never connected'}</div></div>
        <form method="post" action="/account/devices/${esc(d.deviceId)}/remove"><button class="link" type="submit">Remove</button></form></div>`).join('')
    : `<p class="muted" style="margin:0">No Macs yet. Open Terminal and paste:</p><pre>curl -fsSL ${esc(ctx.cfg.origin)}/install.sh | sh</pre>`
  return page('Your account', `
    <div class="who">${avatar(user)}<div><b>${esc(user.name)}</b><div class="muted">${esc(user.email)}</div></div></div>
    <h1 style="font-size:18px">Your Macs</h1>
    <div class="card">${macs}</div>
    <h1 style="font-size:18px">Invite someone</h1>
    <p>Send them a link. When they open it, you'll be in each other's contacts.</p>
    <form method="post" action="/account/invite" style="margin-bottom:28px"><button type="submit" class="secondary">Make an invite link</button></form>
    <h1 style="font-size:18px">Passkey</h1>
    <p>${passkeys ? `You have ${passkeys} passkey${passkeys > 1 ? 's' : ''}.` : 'Sign in with your fingerprint or face next time.'}</p>
    <button type="button" class="secondary" id="add">Add a passkey</button>
    <p class="err" id="e"></p>
    <form method="post" action="/signout" style="margin-top:40px"><button class="link" type="submit">Sign out</button></form>`,
    { script: WEBAUTHN_JS + `
      document.getElementById('add').onclick = async () => {
        const e = document.getElementById('e'); e.textContent = ''
        try {
          const o = await post('/auth/passkey/register/options', {})
          const cred = await navigator.credentials.create({ publicKey: decodeCreate(o.options) })
          await post('/auth/passkey/register/verify', { flow: o.flow, response: encodeCreate(cred) })
          location.reload()
        } catch (x) { e.textContent = x && x.name === 'NotAllowedError' ? '' : (x.message || 'That didn\\'t work.') }
      }` })
}

export function removeDevice(ctx: Ctx, req: Request, deviceId: string) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  const origin = req.headers.get('origin')
  if (origin && origin !== ctx.cfg.origin) return err(403, 'bad_origin')
  const gone = ctx.db.query('DELETE FROM devices WHERE id = ? AND user_id = ?').run(deviceId, user.id).changes
  if (gone) {
    ctx.db.query('DELETE FROM mailbox WHERE to_device = ?').run(deviceId)
    ctx.hub.drop(deviceId)
  }
  return redirect('/account')
}

// ---- browser side of WebAuthn ---------------------------------------------
// Plain base64url <-> ArrayBuffer conversion, so it works in browsers that
// lack PublicKeyCredential.parse*FromJSON.

const WEBAUTHN_JS = `
const b2a = (s) => { s = s.replace(/-/g,'+').replace(/_/g,'/'); const b = atob(s + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)).buffer }
const a2b = (a) => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')
async function post(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message || 'That didn\\'t work. Please try again.')
  return j
}
const decodeGet = (o) => ({ ...o, challenge: b2a(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: b2a(c.id) })) })
const decodeCreate = (o) => ({ ...o, challenge: b2a(o.challenge), user: { ...o.user, id: b2a(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: b2a(c.id) })) })
const encodeGet = (c) => ({ id: c.id, rawId: a2b(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment, clientExtensionResults: c.getClientExtensionResults(),
  response: { clientDataJSON: a2b(c.response.clientDataJSON), authenticatorData: a2b(c.response.authenticatorData), signature: a2b(c.response.signature), userHandle: c.response.userHandle ? a2b(c.response.userHandle) : undefined } })
const encodeCreate = (c) => ({ id: c.id, rawId: a2b(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment, clientExtensionResults: c.getClientExtensionResults(),
  response: { clientDataJSON: a2b(c.response.clientDataJSON), attestationObject: a2b(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] } })
`

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`
