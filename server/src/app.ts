// The routes, wired into one Bun.serve. index.ts starts it for real; the
// tests start it on a random port.

import { privacyPage } from './privacy'
import { sessionUser } from './users'
import { homePage } from './home'
import { existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type { Server } from 'bun'
import { type Config, loadConfig } from './config'
import type { Ctx } from './ctx'
import { openDb, sweep } from './db'
import { Hub, type NodeSocketData, MAX_FRAME } from './hub'
import * as auth from './auth'
import * as device from './device'
import * as dir from './directory'
import * as oauth from './oauth'
import { mcpHandler, mcpPreflight } from './mcp'
import { message, platformOf } from './pages'
import { bearer, deviceByToken } from './users'
import { HOUR, err, json, redirect } from './util'

export type Running = { ctx: Ctx; server: Server<NodeSocketData>; url: string; stop: () => Promise<void> }

export function startServer(env: Record<string, string | undefined> = process.env, over: Partial<Config> = {}): Running {
  const cfg = loadConfig(env, over)
  const db = openDb(cfg.dataDir)
  sweep(db)
  const hub = new Hub(cfg, db)
  const ctx: Ctx = { cfg, db, hub }
  const mcp = mcpHandler(ctx)

  const r = (fn: (ctx: Ctx, req: Request) => Response | Promise<Response>) => (req: Request) => fn(ctx, req)

  const server = Bun.serve({
    hostname: cfg.host,
    port: over.port ?? cfg.port,
    idleTimeout: 60,
    routes: {
      // Sign-in and the account page.
      '/': r((c, req) => homePage(c.cfg.origin, !!sessionUser(c.db, req), platformOf(req))),
      '/signin': { GET: r(auth.signinPage) },
      '/signout': { POST: r(auth.signout) },
      '/account': { GET: r(auth.accountPage) },
      '/account/invite': { POST: r(dir.accountInvite) },
      '/account/devices/:id/remove': { POST: (req) => auth.removeDevice(ctx, req, req.params.id) },
      '/auth/clerk': { POST: r(auth.clerkExchange) },
      '/dev/login': { GET: r(auth.devLogin) },

      // Linking a Mac.
      '/api/device/start': { POST: r(device.deviceStart) },
      '/api/device/poll': { POST: r(device.devicePoll) },
      '/link': { GET: r(device.linkPage), POST: r(device.linkDecide) },

      // The directory.
      '/api/me': { GET: r(dir.me) },
      '/api/contacts': { GET: r(dir.contacts) },
      '/api/contacts/:userId': { POST: (req) => dir.addSuggested(ctx, req, req.params.userId) },
      '/api/suggestions': { GET: r(dir.suggestions) },
      '/api/relationships/:userId': { PUT: (req) => dir.putRelationship(ctx, req, req.params.userId) },
      '/api/users/:id/devices': { GET: (req) => dir.userDevices(ctx, req, req.params.id) },
      '/api/invites': { POST: r(dir.createInvite) },
      '/api/invites/:code/accept': { POST: (req) => dir.acceptInvite(ctx, req, req.params.code) },
      '/i/:code': { GET: (req) => dir.invitePage(ctx, req, req.params.code), POST: (req) => dir.invitePagePost(ctx, req, req.params.code) },

      // Nodes.
      '/ws/node': (req, srv) => {
        const tok = bearer(req) || new URL(req.url).searchParams.get('token')
        const who = deviceByToken(db, tok)
        if (!who) return err(401, 'unauthorized', 'Send Authorization: Bearer <deviceToken>')
        if (srv.upgrade(req, { data: { deviceId: who.device.id, userId: who.user.id } })) return undefined
        return err(426, 'upgrade_required', 'This is a WebSocket endpoint')
      },

      // OAuth for chat hosts, and MCP.
      '/.well-known/oauth-protected-resource': { GET: () => oauth.protectedResourceMetadata(ctx), OPTIONS: oauth.preflight },
      '/.well-known/oauth-protected-resource/mcp': { GET: () => oauth.protectedResourceMetadata(ctx), OPTIONS: oauth.preflight },
      '/.well-known/oauth-authorization-server': { GET: () => oauth.authorizationServerMetadata(ctx), OPTIONS: oauth.preflight },
      '/.well-known/oauth-authorization-server/mcp': { GET: () => oauth.authorizationServerMetadata(ctx), OPTIONS: oauth.preflight },
      '/oauth/register': { POST: r(oauth.register), OPTIONS: oauth.preflight },
      '/oauth/authorize': { GET: r(oauth.authorize), POST: r(oauth.authorizeDecide) },
      '/oauth/token': { POST: r(oauth.token), OPTIONS: oauth.preflight },
      '/oauth/revoke': { POST: r(oauth.revoke), OPTIONS: oauth.preflight },
      '/mcp': { GET: mcp, POST: mcp, DELETE: mcp, OPTIONS: mcpPreflight },

      // Static.
      '/healthz': () => json({ ok: true, version: '0.1.0' }),
      '/install.sh': () => file(join(cfg.publicDir, 'install.sh'), 'text/x-shellscript; charset=utf-8'),
      '/static/*': (req) => staticFile(cfg, new URL(req.url).pathname.slice('/static/'.length)),
      '/privacy': () => privacyPage(),
      '/dl/*': (req) => download(cfg, new URL(req.url).pathname.slice('/dl/'.length)),
    },
    fetch: () => message('Not found', 'There\'s nothing here.', 404),
    websocket: {
      data: {} as NodeSocketData,
      maxPayloadLength: MAX_FRAME,
      idleTimeout: 120, // Bun pings idle sockets, which keeps the Cloudflare tunnel open
      open: (ws) => hub.open(ws),
      message: (ws, m) => hub.message(ws, m),
      close: (ws) => hub.close(ws),
    },
    error: (e) => {
      console.error('[yapping]', e)
      return json({ error: 'server_error' }, 500)
    },
  })

  // With PORT=0 (tests) and no YAP_ORIGIN, the origin is wherever we landed.
  if (!env.YAP_ORIGIN && !over.origin) cfg.origin = `http://localhost:${server.port}`
  const timer = setInterval(() => sweep(db), HOUR)

  return {
    ctx, server, url: cfg.origin,
    async stop() {
      clearInterval(timer)
      await server.stop(true)
      db.close()
    },
  }
}

function file(path: string, type: string) {
  if (!existsSync(path)) return new Response('Not found', { status: 404 })
  return new Response(Bun.file(path), { headers: { 'content-type': type, 'cache-control': 'no-cache' } })
}

// A file under `root`, or null. No escaping that folder.
function within(root: string, rel: string): string | null {
  let name: string
  try { name = decodeURIComponent(rel) } catch { return null }
  const path = normalize(join(root, name))
  return path.startsWith(root + sep) && existsSync(path) && statSync(path).isFile() ? path : null
}

// /static/<name>: the front page's pictures, from server/public/static/.
const STATIC_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' }
function staticFile(cfg: Config, rel: string) {
  const path = within(join(cfg.publicDir, 'static'), rel)
  const type = path && STATIC_TYPES[path.split('.').pop()!.toLowerCase()]
  if (!path || !type) return new Response('Not found', { status: 404 })
  return new Response(Bun.file(path), { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } })
}

// /dl/<name>: the node binaries, from $YAP_DATA/dl/. No escaping that folder.
function download(cfg: Config, rel: string) {
  const path = within(join(cfg.dataDir, 'dl'), rel)
  if (!path) return new Response('Not found', { status: 404 })
  return new Response(Bun.file(path), {
    headers: {
      'content-type': path.endsWith('.sh') ? 'text/x-shellscript' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'cache-control': 'public, max-age=300',
      // The Claude bundle downloads as a file, so opening it hands it to Claude.
      ...(path.endsWith('.mcpb') ? { 'content-disposition': 'attachment; filename="yapping.mcpb"' } : {}),
    },
  })
}
