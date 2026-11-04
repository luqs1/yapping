// The OAuth 2.1 authorization server that chat hosts (claude.ai, Cowork,
// Claude Code, ChatGPT, Codex) use to act as a person on /mcp.
//
// Follows the MCP authorization spec (2026-07-28) and what Claude's and
// OpenAI's connector docs ask for:
//   discovery   RFC 9728 protected-resource metadata at
//               /.well-known/oauth-protected-resource[/mcp], RFC 8414 AS
//               metadata at /.well-known/oauth-authorization-server
//   clients     CIMD (the client_id is an https URL to its metadata, which we
//               fetch and check) first, DCR at /oauth/register as fallback
//   code flow   PKCE S256 only; `iss` on every authorization response
//               (RFC 9207); `resource` checked and bound into the token
//               (RFC 8707); loopback redirects match on any port (RFC 8252,
//               for Claude Code and Codex)
//   tokens      opaque, stored hashed; access 1 h, refresh 90 days, rotated
//               on every use. A refresh token used twice is a theft signal:
//               the whole grant is revoked.
//   consent     a page behind the normal sign-in.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server'
import type { Ctx } from './ctx'
import { signinRedirect } from './auth'
import { page } from './pages'
import { sessionUser } from './users'
import { DAY, HOUR, MIN, body, clientIp, esc, id, json, limited, now, redirect, safeEqual, secret, sha256 } from './util'
import { createHash } from 'node:crypto'

export const SCOPE = 'yap' // everything the connector does
const ACCESS_TTL = HOUR
const REFRESH_TTL = 90 * DAY
const CODE_TTL = 5 * MIN
const CIMD_FRESH = HOUR

export const resourceUrl = (ctx: Ctx) => `${ctx.cfg.origin}/mcp`
export const resourceMetadataUrl = (ctx: Ctx) => `${ctx.cfg.origin}/.well-known/oauth-protected-resource/mcp`

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

// ---- discovery -----------------------------------------------------------

export function protectedResourceMetadata(ctx: Ctx) {
  return json({
    resource: resourceUrl(ctx),
    authorization_servers: [ctx.cfg.origin],
    scopes_supported: [SCOPE], // offline_access deliberately not here (spec: it isn't a resource requirement)
    bearer_methods_supported: ['header'],
    resource_name: 'yapping',
  }, 200, { ...cors, 'cache-control': 'public, max-age=300' })
}

export function authorizationServerMetadata(ctx: Ctx) {
  const o = ctx.cfg.origin
  return json({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    revocation_endpoint: `${o}/oauth/revoke`,
    scopes_supported: [SCOPE, 'offline_access'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // `none` must be here for Claude to pick CIMD; ChatGPT intersects it with its own list.
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${o}/`,
  }, 200, { ...cors, 'cache-control': 'public, max-age=300' })
}

export const preflight = () => new Response(null, { status: 204, headers: { ...cors, 'access-control-max-age': '86400' } })

// ---- clients -------------------------------------------------------------

type Client = { clientId: string; kind: 'dcr' | 'cimd'; name: string; redirectUris: string[]; authMethod: string; secretHash: string | null }
type ClientRow = { client_id: string; kind: 'dcr' | 'cimd'; name: string | null; redirect_uris: string; auth_method: string; secret_hash: string | null; metadata: string; fetched_at: number | null }

const rowToClient = (r: ClientRow): Client => ({
  clientId: r.client_id, kind: r.kind, name: r.name || hostOf(r.client_id) || 'An app',
  redirectUris: JSON.parse(r.redirect_uris), authMethod: r.auth_method, secretHash: r.secret_hash,
})
const hostOf = (s: string) => { try { return new URL(s).host } catch { return '' } }

class ClientError extends Error {}

export async function getClient(ctx: Ctx, clientId: string): Promise<Client> {
  if (!clientId) throw new ClientError('client_id is missing')
  const row = ctx.db.query<ClientRow, [string]>('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId)
  if (!/^https?:\/\//.test(clientId)) {
    if (!row || row.kind !== 'dcr') throw new ClientError('Unknown client. Remove the connector and add it again.')
    return rowToClient(row)
  }
  if (row && row.fetched_at && now() - row.fetched_at < CIMD_FRESH) return rowToClient(row)
  try {
    return await fetchCimd(ctx, clientId)
  } catch (e) {
    if (row && row.fetched_at && now() - row.fetched_at < DAY) return rowToClient(row) // a stale copy beats failing
    throw e
  }
}

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./]
const isPrivateIp = (ip: string) =>
  isIP(ip) === 4 ? PRIVATE_V4.some((r) => r.test(ip))
    : /^(::1?|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:|::ffff:(127|10|192\.168|169\.254)\.)/i.test(ip) || ip === '::'
const isLoopback = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)

// A Client ID Metadata Document: the client_id is a URL, and the document
// there says who the client is and where it may be redirected.
async function fetchCimd(ctx: Ctx, clientId: string): Promise<Client> {
  let url: URL
  try { url = new URL(clientId) } catch { throw new ClientError('client_id is not a valid URL') }
  const devLoopback = ctx.cfg.dev && url.protocol === 'http:' && isLoopback(url.hostname)
  if ((url.protocol !== 'https:' && !devLoopback) || url.pathname === '/' || url.hash || url.username || url.password || /\/\.\.?(\/|$)/.test(url.pathname))
    throw new ClientError('client_id must be an https URL with a path')
  // Don't let a client id make us fetch something on our own network.
  if (!devLoopback) {
    const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => [])
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)) || isLoopback(url.hostname)) throw new ClientError('client_id host is not reachable')
  }
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
    .catch(() => { throw new ClientError('Couldn\'t fetch the client metadata document') })
  const text = await res.text()
  if (!res.ok || text.length > 32_768) throw new ClientError('Couldn\'t fetch the client metadata document')
  let doc: any
  try { doc = JSON.parse(text) } catch { throw new ClientError('The client metadata document isn\'t JSON') }
  if (doc.client_id !== clientId) throw new ClientError('The client metadata document names a different client_id')
  const redirectUris = doc.redirect_uris
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.some((u: unknown) => !validRedirect(u)))
    throw new ClientError('The client metadata document has no usable redirect_uris')
  // CIMD clients are public clients here: they must be able to use `none`.
  // (ChatGPT lists ["none","private_key_jwt"] plus a singular preference.)
  const methods = [...(Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported : []),
    ...(doc.token_endpoint_auth_method ? [doc.token_endpoint_auth_method] : [])]
  if (methods.length && !methods.includes('none'))
    throw new ClientError('This client needs a token authentication method yapping doesn\'t support')
  const name = typeof doc.client_name === 'string' ? doc.client_name.slice(0, 80) : url.host
  ctx.db.query(`INSERT INTO oauth_clients (client_id, kind, name, redirect_uris, auth_method, secret_hash, metadata, created_at, fetched_at)
      VALUES (?, 'cimd', ?, ?, 'none', NULL, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, metadata = excluded.metadata, fetched_at = excluded.fetched_at`)
    .run(clientId, name, JSON.stringify(redirectUris), text, now(), now())
  return { clientId, kind: 'cimd', name, redirectUris, authMethod: 'none', secretHash: null }
}

// Allowed redirect URIs: https; http only to loopback (a native app's local
// listener); or an app's own private scheme (com.example.app:/cb).
function validRedirect(u: unknown): boolean {
  if (typeof u !== 'string' || u.length > 2000) return false
  let url: URL
  try { url = new URL(u) } catch { return false }
  if (url.hash) return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return isLoopback(url.hostname)
  return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:'].includes(url.protocol)
}

// Exact match, except that loopback redirects match on any port.
export function redirectAllowed(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.protocol !== 'http:' || !isLoopback(u.hostname)) return false
  return registered.some((r) => {
    try {
      const x = new URL(r)
      return x.protocol === 'http:' && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search
    } catch { return false }
  })
}

// RFC 7591 dynamic client registration.
export async function register(ctx: Ctx, req: Request) {
  if (limited(`dcr:${clientIp(req)}`, 30, HOUR)) return oauthErr(429, 'slow_down', 'Too many registrations')
  const raw = await req.text()
  if (raw.length > 16_384) return oauthErr(400, 'invalid_client_metadata', 'Metadata too large')
  let m: any
  try { m = JSON.parse(raw) } catch { return oauthErr(400, 'invalid_client_metadata', 'Body must be JSON') }
  if (!m || typeof m !== 'object') return oauthErr(400, 'invalid_client_metadata', 'Body must be a JSON object')
  if (!Array.isArray(m.redirect_uris) || !m.redirect_uris.length || m.redirect_uris.length > 20 || !m.redirect_uris.every(validRedirect))
    return oauthErr(400, 'invalid_redirect_uri', 'redirect_uris must be https, http on loopback, or an app scheme')
  const method = m.token_endpoint_auth_method ?? 'client_secret_basic' // the RFC 7591 default
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(method))
    return oauthErr(400, 'invalid_client_metadata', `token_endpoint_auth_method ${method} is not supported`)
  const grants: string[] = m.grant_types ?? ['authorization_code', 'refresh_token']
  if (!Array.isArray(grants) || grants.some((g) => !['authorization_code', 'refresh_token'].includes(g)))
    return oauthErr(400, 'invalid_client_metadata', 'Only authorization_code and refresh_token are supported')
  const clientId = `yc_${id(12)}`
  const clientSecret = method === 'none' ? null : secret('ycs')
  const name = typeof m.client_name === 'string' ? m.client_name.slice(0, 80) : null
  const issuedAt = Math.floor(now() / 1000)
  const out = {
    ...m,
    client_id: clientId, client_id_issued_at: issuedAt,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    redirect_uris: m.redirect_uris, token_endpoint_auth_method: method,
    grant_types: grants, response_types: ['code'],
  }
  ctx.db.query('INSERT INTO oauth_clients (client_id, kind, name, redirect_uris, auth_method, secret_hash, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(clientId, 'dcr', name, JSON.stringify(m.redirect_uris), method, clientSecret ? sha256(clientSecret) : null, JSON.stringify(m), now())
  return json(out, 201, cors)
}

// ---- authorize -----------------------------------------------------------

const oauthErr = (status: number, error: string, description?: string) =>
  json({ error, ...(description ? { error_description: description } : {}) }, status, cors)

function errorPage(text: string) {
  return page('Can\'t connect', `<h1>This app can't connect</h1><p>${esc(text)}</p><p class="muted">Try removing it and adding it again.</p>`, { status: 400 })
}

// Back to the client with an error, carrying state and iss.
function redirectBack(ctx: Ctx, redirectUri: string, params: Record<string, string | undefined>) {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries({ ...params, iss: ctx.cfg.origin })) if (v !== undefined) u.searchParams.set(k, v)
  return redirect(u.toString())
}

// The resource a client asked for, if it's us; we accept the bare origin too.
function canonicalResource(ctx: Ctx, resource: string | null | undefined): string | null {
  if (!resource) return resourceUrl(ctx)
  const r = resource.replace(/#.*$/, '').replace(/\/$/, '')
  const ok = [resourceUrl(ctx), ctx.cfg.origin].map((x) => x.toLowerCase())
  return ok.includes(r.toLowerCase()) ? resourceUrl(ctx) : null
}

function grantedScope(requested: string | null | undefined) {
  const want = new Set((requested || '').split(/\s+/).filter(Boolean))
  return [SCOPE, ...(want.has('offline_access') ? ['offline_access'] : [])].join(' ')
}

type AuthzParams = { clientId: string; redirectUri: string; state?: string; codeChallenge: string; scope: string; resource: string }

export async function authorize(ctx: Ctx, req: Request) {
  const q = new URL(req.url).searchParams
  let client: Client
  try { client = await getClient(ctx, q.get('client_id') || '') } catch (e) { return errorPage((e as Error).message) }
  let redirectUri = q.get('redirect_uri') || ''
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0]
  if (!redirectAllowed(client.redirectUris, redirectUri)) return errorPage('The app asked to return somewhere it hasn\'t registered.')

  const state = q.get('state') ?? undefined
  if (q.get('response_type') !== 'code') return redirectBack(ctx, redirectUri, { error: 'unsupported_response_type', state })
  const challenge = q.get('code_challenge') || ''
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
    return redirectBack(ctx, redirectUri, { error: 'invalid_request', error_description: 'PKCE with S256 is required', state })
  const resource = canonicalResource(ctx, q.get('resource'))
  if (!resource) return redirectBack(ctx, redirectUri, { error: 'invalid_target', error_description: 'Unknown resource', state })

  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)

  const params: AuthzParams = { clientId: client.clientId, redirectUri, state, codeChallenge: challenge, scope: grantedScope(q.get('scope')), resource }
  const reqId = id(18)
  ctx.db.query('INSERT INTO oauth_requests (id, user_id, params, expires_at) VALUES (?, ?, ?, ?)').run(reqId, user.id, JSON.stringify(params), now() + 15 * MIN)

  const back = new URL(redirectUri)
  const local = back.protocol === 'http:' && isLoopback(back.hostname)
  const where = local ? 'an app on this computer' : back.protocol === 'https:' ? back.host : `the ${back.protocol.replace(':', '')} app`
  return page('Allow access', `
    <h1>Allow ${esc(client.name)} to use yapping?</h1>
    <p>Signed in as <b>${esc(user.email)}</b>.</p>
    <div class="card"><p style="margin:0 0 8px"><b>${esc(client.name)}</b> will be able to:</p>
      <p style="margin:0">· see your yapping inbox and read the chats you've let your AI see<br>· send messages you ask it to send<br>· suggest replies for you to approve</p></div>
    ${local ? '<div class="warn">This app runs on your own computer. Only continue if you just started it yourself.</div>' : ''}
    <form method="post" action="/oauth/authorize" class="stack">
      <input type="hidden" name="request" value="${reqId}">
      <button type="submit" name="decision" value="allow">Allow</button>
      <button type="submit" name="decision" value="deny" class="secondary">Cancel</button>
    </form>
    <p class="muted" style="margin-top:20px">After this you'll go back to ${esc(where)}. You can disconnect it at any time from the app.</p>`)
}

export async function authorizeDecide(ctx: Ctx, req: Request) {
  const user = sessionUser(ctx.db, req)
  if (!user) return signinRedirect(req)
  const origin = req.headers.get('origin')
  if (origin && origin !== ctx.cfg.origin) return errorPage('That request came from somewhere else.')
  const b = await body(req)
  const row = ctx.db.query<{ params: string }, [string, string, number]>(
    'DELETE FROM oauth_requests WHERE id = ? AND user_id = ? AND expires_at > ? RETURNING params',
  ).get(String(b.request || ''), user.id, now())
  if (!row) return errorPage('That took too long. Go back to the app and try connecting again.')
  const p: AuthzParams = JSON.parse(row.params)
  if (b.decision !== 'allow') return redirectBack(ctx, p.redirectUri, { error: 'access_denied', state: p.state })
  const code = secret('yac')
  ctx.db.query('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, family, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(code), p.clientId, user.id, p.redirectUri, p.codeChallenge, p.scope, p.resource, id(12), now() + CODE_TTL)
  return redirectBack(ctx, p.redirectUri, { code, state: p.state })
}

// ---- token ---------------------------------------------------------------

type CodeRow = { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string; family: string; expires_at: number; used: number }
type TokenRow = { token_hash: string; kind: string; client_id: string; user_id: string; scope: string; resource: string; family: string; expires_at: number; revoked: number }

// Who's calling the token endpoint: client_secret_basic, _post, or none.
async function authenticateClient(ctx: Ctx, req: Request, b: Record<string, any>): Promise<Client> {
  let clientId = String(b.client_id || ''), clientSecret: string | undefined = b.client_secret
  const basic = req.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1]
  if (basic) {
    const [i, s] = Buffer.from(basic, 'base64').toString('utf8').split(':')
    clientId = decodeURIComponent(i || ''); clientSecret = decodeURIComponent(s || '')
  }
  const client = await getClient(ctx, clientId).catch(() => null)
  if (!client) throw new OAuthError(OAuthErrorCode.InvalidClient, 'Unknown client')
  if (client.secretHash) {
    if (!clientSecret || !safeEqual(sha256(clientSecret), client.secretHash)) throw new OAuthError(OAuthErrorCode.InvalidClient, 'Bad client credentials')
  }
  return client
}

function issue(ctx: Ctx, t: { clientId: string; userId: string; scope: string; resource: string; family: string }) {
  const access = secret('yat'), refresh = secret('yrt')
  const ins = ctx.db.query('INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, resource, family, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  ins.run(sha256(access), 'access', t.clientId, t.userId, t.scope, t.resource, t.family, now() + ACCESS_TTL)
  ins.run(sha256(refresh), 'refresh', t.clientId, t.userId, t.scope, t.resource, t.family, now() + REFRESH_TTL)
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: t.scope }, 200, { ...cors, pragma: 'no-cache' })
}

const revokeFamily = (ctx: Ctx, family: string) => ctx.db.query('UPDATE oauth_tokens SET revoked = 1 WHERE family = ?').run(family)

export async function token(ctx: Ctx, req: Request) {
  const b = await body(req)
  let client: Client
  try { client = await authenticateClient(ctx, req, b) } catch (e) { return oauthErr(401, 'invalid_client', (e as Error).message) }

  if (b.grant_type === 'authorization_code') {
    const hash = sha256(String(b.code || ''))
    const code = ctx.db.query<CodeRow, [string]>('SELECT * FROM oauth_codes WHERE code_hash = ?').get(hash)
    if (!code) return oauthErr(400, 'invalid_grant', 'Unknown or expired code')
    if (code.used) { revokeFamily(ctx, code.family); return oauthErr(400, 'invalid_grant', 'Code already used') }
    ctx.db.query('UPDATE oauth_codes SET used = 1 WHERE code_hash = ?').run(hash)
    if (code.expires_at < now()) return oauthErr(400, 'invalid_grant', 'Code expired')
    if (code.client_id !== client.clientId) return oauthErr(400, 'invalid_grant', 'Code was issued to another client')
    if (b.redirect_uri !== undefined && b.redirect_uri !== code.redirect_uri) return oauthErr(400, 'invalid_grant', 'redirect_uri doesn\'t match')
    const verifier = String(b.code_verifier || '')
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== code.code_challenge)
      return oauthErr(400, 'invalid_grant', 'PKCE verification failed')
    if (b.resource !== undefined && canonicalResource(ctx, b.resource) !== code.resource) return oauthErr(400, 'invalid_target', 'Unknown resource')
    return issue(ctx, { clientId: client.clientId, userId: code.user_id, scope: code.scope, resource: code.resource, family: code.family })
  }

  if (b.grant_type === 'refresh_token') {
    const hash = sha256(String(b.refresh_token || ''))
    const old = ctx.db.query<TokenRow, [string]>("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(hash)
    if (!old || old.client_id !== client.clientId) return oauthErr(400, 'invalid_grant', 'Unknown refresh token')
    if (old.revoked) { revokeFamily(ctx, old.family); return oauthErr(400, 'invalid_grant', 'Refresh token already used') }
    if (old.expires_at < now()) return oauthErr(400, 'invalid_grant', 'Refresh token expired')
    if (b.resource !== undefined && canonicalResource(ctx, b.resource) !== old.resource) return oauthErr(400, 'invalid_target', 'Unknown resource')
    // A refresh may narrow the scope, never widen it.
    let scope = old.scope
    if (b.scope) {
      const had = new Set(old.scope.split(' '))
      const want = String(b.scope).split(/\s+/).filter((s) => had.has(s))
      if (!want.includes(SCOPE)) want.unshift(SCOPE)
      scope = want.join(' ')
    }
    ctx.db.query('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?').run(hash)
    return issue(ctx, { clientId: client.clientId, userId: old.user_id, scope, resource: old.resource, family: old.family })
  }

  return oauthErr(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token')
}

// RFC 7009. Always 200, whether or not the token existed.
export async function revoke(ctx: Ctx, req: Request) {
  const b = await body(req)
  let client: Client
  try { client = await authenticateClient(ctx, req, b) } catch (e) { return oauthErr(401, 'invalid_client', (e as Error).message) }
  const row = ctx.db.query<TokenRow, [string]>('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha256(String(b.token || '')))
  if (row && row.client_id === client.clientId) {
    if (row.kind === 'refresh') revokeFamily(ctx, row.family)
    else ctx.db.query('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?').run(row.token_hash)
  }
  return new Response(null, { status: 200, headers: cors })
}

// ---- for /mcp: check an access token ---------------------------------------

export function verifyAccessToken(ctx: Ctx, token: string): AuthInfo {
  const row = ctx.db.query<TokenRow, [string]>("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(sha256(token))
  if (!row || row.revoked || row.expires_at < now()) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired access token')
  const client = ctx.db.query<{ name: string | null }, [string]>('SELECT name FROM oauth_clients WHERE client_id = ?').get(row.client_id)
  return {
    token, clientId: row.client_id, scopes: row.scope.split(' '),
    expiresAt: Math.floor(row.expires_at / 1000), resource: new URL(row.resource),
    extra: { userId: row.user_id, clientName: client?.name || hostOf(row.client_id) },
  }
}
