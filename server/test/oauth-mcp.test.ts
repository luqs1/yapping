// The OAuth server chat hosts use, and /mcp itself.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { FakeNode, linkDevice, login, pkce, rpcBody, testServer, type TestServer } from './helpers'
import { redirectAllowed } from '../src/oauth'

let s: TestServer
let base: string
let alice: { cookie: string; user: any }

beforeAll(async () => {
  s = testServer()
  base = s.url
  alice = await login(base, 'alice@example.com', { name: 'Alice' })
})
afterAll(() => s.close())

const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) })

// Authorize as Alice: load the consent page, press Allow, return the redirect.
async function authorizeAs(cookie: string, params: Record<string, string>) {
  const page = await fetch(`${base}/oauth/authorize?${new URLSearchParams(params)}`, { headers: { cookie }, redirect: 'manual' })
  expect(page.status).toBe(200)
  const html = await page.text()
  const reqId = html.match(/name="request" value="([^"]+)"/)![1]
  const res = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request: reqId, decision: 'allow' }),
  })
  expect(res.status).toBe(302)
  return { html, location: new URL(res.headers.get('location')!) }
}

// The whole dance for a DCR client; returns its tokens.
async function connectClient(redirectUri = 'https://claude.ai/api/mcp/auth_callback') {
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }),
  })).json() as any
  const { verifier, challenge } = pkce()
  const { location } = await authorizeAs(alice.cookie, {
    response_type: 'code', client_id: reg.client_id, redirect_uri: redirectUri, state: 's1',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'yap offline_access', resource: `${base}/mcp`,
  })
  const tok = await (await fetch(`${base}/oauth/token`, form({
    grant_type: 'authorization_code', code: location.searchParams.get('code')!, redirect_uri: redirectUri,
    client_id: reg.client_id, code_verifier: verifier, resource: `${base}/mcp`,
  }))).json() as any
  return { clientId: reg.client_id, ...tok }
}

describe('discovery', () => {
  test('protected resource and authorization server metadata', async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json() as any
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['yap'] })
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as any
    expect(as.issuer).toBe(base)
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.client_id_metadata_document_supported).toBe(true)
    expect(as.token_endpoint_auth_methods_supported).toContain('none')
    expect(as.scopes_supported).toContain('offline_access')
    expect(as.authorization_response_iss_parameter_supported).toBe(true)
    expect(as.registration_endpoint).toBe(`${base}/oauth/register`)
  })

  test('/mcp without a token: 401 pointing at the metadata', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`)
  })
})

describe('oauth', () => {
  test('DCR → authorize → token with PKCE → refresh', async () => {
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
    const reg = await fetch(`${base}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    })
    expect(reg.status).toBe(201)
    const client = await reg.json() as any
    expect(client.client_id).toBeString()
    expect(client.client_secret).toBeUndefined()

    // Not signed in: authorize sends you to sign in, then back.
    const { verifier, challenge } = pkce()
    const params = {
      response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, state: 'xyz',
      code_challenge: challenge, code_challenge_method: 'S256', scope: 'yap offline_access', resource: `${base}/mcp`,
    }
    const anon = await fetch(`${base}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: 'manual' })
    expect(anon.headers.get('location')).toStartWith('/signin?next=%2Foauth%2Fauthorize')

    const { html, location } = await authorizeAs(alice.cookie, params)
    expect(html).toContain('Allow Claude to use yapping?')
    expect(location.origin + location.pathname).toBe(redirectUri)
    expect(location.searchParams.get('state')).toBe('xyz')
    expect(location.searchParams.get('iss')).toBe(base)
    const code = location.searchParams.get('code')!

    // A wrong verifier fails, and burns the code.
    const bad = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: 'x'.repeat(43) }))
    expect(bad.status).toBe(400)
    expect((await bad.json() as any).error).toBe('invalid_grant')

    // So start again, properly.
    const again = await authorizeAs(alice.cookie, params)
    const tokRes = await fetch(`${base}/oauth/token`, form({
      grant_type: 'authorization_code', code: again.location.searchParams.get('code')!, redirect_uri: redirectUri,
      client_id: client.client_id, code_verifier: verifier, resource: `${base}/mcp`,
    }))
    expect(tokRes.status).toBe(200)
    const tok = await tokRes.json() as any
    expect(tok).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'yap offline_access' })
    expect(tok.access_token).toStartWith('yat_')
    expect(tok.refresh_token).toStartWith('yrt_')

    // Refresh rotates the refresh token.
    const r1 = await (await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id }))).json() as any
    expect(r1.access_token).toStartWith('yat_')
    expect(r1.refresh_token).not.toBe(tok.refresh_token)
    // The new access token works on /mcp.
    const ping = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: `Bearer ${r1.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
    })
    expect(ping.status).toBe(200)

    // Reusing the old refresh token is theft: everything from this grant dies.
    const reuse = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id }))
    expect(reuse.status).toBe(400)
    expect((await reuse.json() as any).error).toBe('invalid_grant')
    const dead = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: r1.refresh_token, client_id: client.client_id }))
    expect(dead.status).toBe(400)
  })

  test('a redirect the client never registered gets an error page, not a redirect', async () => {
    const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://good.example/cb'], token_endpoint_auth_method: 'none' }) })).json() as any
    const { challenge } = pkce()
    const res = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' })}`, { headers: { cookie: alice.cookie }, redirect: 'manual' })
    expect(res.status).toBe(400)
  })

  test('PKCE is required', async () => {
    const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://good.example/cb'], token_endpoint_auth_method: 'none' }) })).json() as any
    const res = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://good.example/cb', state: 'q' })}`, { headers: { cookie: alice.cookie }, redirect: 'manual' })
    const loc = new URL(res.headers.get('location')!)
    expect(loc.searchParams.get('error')).toBe('invalid_request')
    expect(loc.searchParams.get('iss')).toBe(base)
  })

  test('confidential DCR clients must present their secret', async () => {
    const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://app.example/cb'] }) })).json() as any
    expect(reg.token_endpoint_auth_method).toBe('client_secret_basic')
    expect(reg.client_secret).toStartWith('ycs_')
    const res = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: 'x', client_id: reg.client_id }))
    expect(res.status).toBe(401)
  })

  test('loopback redirects match on any port (Claude Code, Codex)', () => {
    expect(redirectAllowed(['http://localhost/callback'], 'http://localhost:51234/callback')).toBe(true)
    expect(redirectAllowed(['http://127.0.0.1/callback'], 'http://127.0.0.1:3118/callback')).toBe(true)
    expect(redirectAllowed(['http://127.0.0.1/callback'], 'http://127.0.0.1:3118/other')).toBe(false)
    expect(redirectAllowed(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback/x')).toBe(false)
    expect(redirectAllowed(['http://localhost/callback'], 'http://evil.example:80/callback')).toBe(false)
  })

  test('CIMD: a URL client_id is fetched, checked and used', async () => {
    // A client metadata document, served the way claude.ai or chatgpt.com would.
    const doc = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch: (req) => Response.json({
        client_id: new URL(req.url).href.replace('localhost', '127.0.0.1'),
        client_name: 'Claude Code',
        redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
        token_endpoint_auth_method: 'private_key_jwt',
        grant_types: ['authorization_code', 'refresh_token'],
      }),
    })
    try {
      const clientId = `http://127.0.0.1:${doc.port}/oauth/client.json`
      const { verifier, challenge } = pkce()
      const redirectUri = 'http://localhost:40123/callback'
      const { html, location } = await authorizeAs(alice.cookie, {
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'c',
        code_challenge: challenge, code_challenge_method: 'S256', resource: `${base}/mcp`,
      })
      expect(html).toContain('Allow Claude Code to use yapping?')
      expect(html).toContain('runs on your own computer')
      const tok = await (await fetch(`${base}/oauth/token`, form({
        grant_type: 'authorization_code', code: location.searchParams.get('code')!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier,
      }))).json() as any
      expect(tok.access_token).toStartWith('yat_')
    } finally { doc.stop(true) }
  })
})

describe('mcp', () => {
  let token: string
  let node: FakeNode
  const calls: any[] = []

  beforeAll(async () => {
    token = (await connectClient()).access_token
    const dev = await linkDevice(base, alice.cookie, 'Alice’s Mac')
    node = await FakeNode.connect(base, dev.deviceToken, (f) => {
      calls.push(f)
      if (f.method === 'inbox') return [{ chat: 'dm:alice:bob', title: 'Bob', unread: 1, sees: true }]
      if (f.method === 'state') return { me: 'alice', users: [], chats: [], messages: [], assists: [], bridges: [], seq: 7 }
      if (f.method === 'sync') return { seq: f.params.since + 1, events: [{ t: 'message' }] }
      if (f.method === 'send') return { ok: true, id: 'm1' }
      throw new Error(`unknown method ${f.method}`)
    })
  })
  afterAll(() => node.close())

  const mcp = async (method: string, params: unknown = {}, id = 1) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    expect(res.status).toBe(200)
    return rpcBody(res)
  }

  test('initialize', async () => {
    const r = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } })
    expect(r.result.serverInfo.name).toBe('yapping')
    expect(r.result.capabilities.tools).toBeDefined()
    expect(r.result.capabilities.resources).toBeDefined()
    expect(r.result.instructions).toContain('exact words')
  })

  test('tools/list: annotations, app-only visibility, ChatGPT entrypoints', async () => {
    const { result } = await mcp('tools/list')
    const t = Object.fromEntries(result.tools.map((x: any) => [x.name, x]))
    expect(Object.keys(t).sort()).toEqual(['yap_approve', 'yap_bridge', 'yap_dismiss', 'yap_inbox', 'yap_mark_read', 'yap_propose', 'yap_react', 'yap_read', 'yap_send', 'yap_set_sees', 'yap_sync'])
    expect(t.yap_inbox.annotations.readOnlyHint).toBe(true)
    expect(t.yap_read.annotations.readOnlyHint).toBe(true)
    expect(t.yap_send.annotations.destructiveHint).toBe(true)
    expect(t.yap_send._meta.ui.visibility).toEqual(['model', 'app'])
    for (const name of ['yap_sync', 'yap_approve', 'yap_dismiss', 'yap_set_sees', 'yap_react', 'yap_mark_read', 'yap_bridge'])
      expect(t[name]._meta.ui.visibility).toEqual(['app'])
    expect(t.yap_inbox._meta.ui.resourceUri).toBe('ui://yapping/sidebar')
    expect(t.yap_inbox._meta['ui/resourceUri']).toBe('ui://yapping/sidebar')
    expect(t.yap_inbox._meta['openai/outputTemplate']).toBe('ui://yapping/sidebar')
    expect(t.yap_inbox._meta['openai/ui'].entrypoints).toEqual([{ type: 'thread' }, { type: 'global' }])
  })

  test('the sidebar resource', async () => {
    const list = await mcp('resources/list')
    const res = list.result.resources.find((r: any) => r.uri === 'ui://yapping/sidebar')
    expect(res.mimeType).toBe('text/html;profile=mcp-app')
    const read = await mcp('resources/read', { uri: 'ui://yapping/sidebar' })
    const c = read.result.contents[0]
    expect(c.mimeType).toBe('text/html;profile=mcp-app')
    expect(c.text).toContain('yapping') // the placeholder, since there's no ui/dist in tests
    expect(c._meta.ui.csp.connectDomains).toEqual([base])
  })

  test('tools/call reaches the node', async () => {
    const r = await mcp('tools/call', { name: 'yap_inbox', arguments: {} })
    expect(r.result.isError).toBeFalsy()
    expect(r.result.structuredContent).toEqual({ items: [{ chat: 'dm:alice:bob', title: 'Bob', unread: 1, sees: true }] })
    expect(calls.at(-1)).toMatchObject({ t: 'rpc', method: 'inbox' })

    const sent = await mcp('tools/call', { name: 'yap_send', arguments: { chat: 'dm:alice:bob', text: 'on my way' } })
    expect(sent.result.structuredContent).toEqual({ ok: true, id: 'm1' })
    expect(calls.at(-1).params).toEqual({ chat: 'dm:alice:bob', text: 'on my way', harness: 'claude' })
    expect(calls.at(-1).via).toEqual({ client: 'Claude', harness: 'claude' })
  })

  test('yap_sync: since 0 is the full state, otherwise events', async () => {
    const first = await mcp('tools/call', { name: 'yap_sync', arguments: { since: 0 } })
    expect(first.result.structuredContent).toMatchObject({ seq: 7, state: { seq: 7, me: 'alice' } })
    const next = await mcp('tools/call', { name: 'yap_sync', arguments: { since: 7 } })
    expect(next.result.structuredContent).toEqual({ seq: 8, events: [{ t: 'message' }] })
  })

  test('the official MCP client works end to end', async () => {
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    const tools = await client.listTools()
    expect(tools.tools.length).toBe(11)
    const r: any = await client.callTool({ name: 'yap_inbox', arguments: {} })
    expect(r.structuredContent.items[0].title).toBe('Bob')
    await client.close()
  })

  test('node offline: the tool says so', async () => {
    await node.close()
    const r = await mcp('tools/call', { name: 'yap_inbox', arguments: {} })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toBe('Your yapping node is offline. Is your Mac asleep?')
  })
})
