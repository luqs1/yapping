// `yap mcp` over stdio, as Claude Desktop runs it from the .mcpb: proxying
// to a running node, running its own node in-process, signing in on first
// run, and serving the same tools and sidebar resource as the remote MCP.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startApi } from '../src/api'
import { login } from '../src/login'
import { startNode, type YapNode } from '../src/node'
import { localToken, saveConfig } from '../src/paths'
import { fakeServer, type FakeServer } from './fake-server'

delete process.env.YAP_SERVER
delete process.env.YAP_AGENT
delete process.env.YAP_API
delete process.env.YAP_KEEP_RUNNING

const ALICE = { id: 'u_alice', name: 'Alice' }
const BOB = { id: 'u_bob', name: 'Bob' }
const CAROL = { id: 'u_carol', name: 'Carol' }
const CLI = join(import.meta.dir, '..', 'src', 'cli.ts')
const APP_ONLY = ['yap_sync', 'yap_approve', 'yap_dismiss', 'yap_set_sees', 'yap_react', 'yap_mark_read', 'yap_bridge', 'yap_send_own', 'yap_create_chat', 'yap_contacts', 'yap_invite']
const MODEL = ['yap_inbox', 'yap_read', 'yap_send', 'yap_propose', 'yap_sign_in']

let fake: FakeServer
const uiFile = join(mkdtempSync(join(tmpdir(), 'yap-ui-')), 'sidebar.html')
const cleanups: (() => Promise<unknown> | unknown)[] = []

async function until<T>(fn: () => T | Promise<T>, what = 'condition', ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    let v: T | undefined
    try { v = await fn() } catch {}
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(25)
  }
}

function freePort() {
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const p = s.port!
  s.stop(true)
  return p
}

function freshHome(label: string) {
  const home = mkdtempSync(join(tmpdir(), `yap-${label}-`))
  saveConfig(home, { server: fake.url, deviceName: label })
  return home
}

async function linked(user: typeof ALICE, label: string) {
  const home = freshHome(label)
  fake.expectLogin(user)
  await login({ home, openUrl: () => {}, say: () => {}, intervalMs: 5 })
  return home
}

// Start `yap mcp` the way Claude Desktop does, and talk MCP to it.
async function mcp(home: string, port: number) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'mcp'],
    env: { ...(process.env as Record<string, string>), YAP_HOME: home, YAP_PORT: String(port), YAP_UI: uiFile, YAP_NO_BROWSER: '1', YAP_AGENT: 'claude' },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
  const client = new Client({ name: 'claude-ai', version: 'test' })
  await client.connect(transport)
  cleanups.push(() => client.close().catch(() => {}))
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as any
  return { client, call, stderr: () => stderr }
}

beforeAll(() => {
  fake = fakeServer()
  writeFileSync(uiFile, '<!doctype html><html><head><title>yapping</title></head><body>SIDEBAR-MARKER</body></html>')
})

afterAll(async () => {
  for (const c of cleanups.reverse()) await c()
  fake.stop()
})

describe('yap mcp', () => {
  test('proxies to a node that is already running', async () => {
    const home = await linked(ALICE, 'alice-mac')
    const node: YapNode = await startNode({ home })
    const port = freePort()
    const api = startApi({ node, token: localToken(home), port, home })
    cleanups.push(async () => { api.stop(); await node.stop() })
    await until(() => node.connected, 'Alice connected')

    const m = await mcp(home, port)
    const r = await m.call('yap_inbox')
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent.me.id).toBe(ALICE.id)
    expect(m.stderr()).not.toContain('in-process')
  }, 20000)

  test('runs its own node in-process when none is running, with every tool and the local API', async () => {
    const home = await linked(BOB, 'bob-mac')
    const port = freePort()
    const m = await mcp(home, port)

    const { tools } = await m.client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...MODEL, ...APP_ONLY].sort())

    // Its own node answers, connects to the server and serves the local API.
    const r = await until(async () => {
      const x = await m.call('yap_inbox')
      return !x.isError && x
    }, 'inbox from the in-process node')
    expect(r.structuredContent.me.id).toBe(BOB.id)
    await until(() => m.stderr().includes('in-process'), 'in-process log line')
    const health = await until(async () => (await fetch(`http://127.0.0.1:${port}/health`)).json(), 'local API')
    expect(health).toMatchObject({ ok: true, signedIn: true })
    await until(async () => (await fetch(`http://127.0.0.1:${port}/health`).then((x) => x.json())).connected, 'connected to the server')

    // A message from Alice reaches Bob's in-process node, seen through yap_sync.
    const alice = await linked(ALICE, 'alice-laptop')
    const an = await startNode({ home: alice })
    cleanups.push(() => an.stop())
    await until(() => an.connected, 'Alice laptop connected')
    await an.call('send', { chat: BOB.id, text: 'hi from alice' })
    const s = await until(async () => {
      const x = await m.call('yap_sync', { since: 0 })
      const msgs = Object.values(x.structuredContent.state.messages).flat() as any[]
      return msgs.some((mm) => mm.text === 'hi from alice') && x
    }, 'message at the in-process node')
    expect(s.structuredContent.seq).toBe(s.structuredContent.state.seq)

    // The harness comes from the client (Claude) for assistedBy.
    const chat = s.structuredContent.state.chats[0].id
    await m.call('yap_set_sees', { chat, on: true })
    const p = await m.call('yap_propose', { chat, label: 'Wave back?', action: 'Send', payload: { kind: 'text', text: '👋' } })
    expect(p.isError).toBeFalsy()
    const sent = await m.call('yap_approve', { id: p.structuredContent.id })
    expect(sent.structuredContent.message).toMatchObject({ text: '👋', assistedBy: 'claude' })
  }, 30000)

  test('another program on the port (agentbus holds 7790 on some Macs) is not mistaken for a node', async () => {
    const home = await linked(BOB, 'bob-3')
    const port = freePort()
    // An impostor with a /health that says ok, like agentbus's.
    const impostor = Bun.serve({ port, hostname: '127.0.0.1', fetch: () => Response.json({ ok: true, version: '0.6.0' }) })
    cleanups.push(() => impostor.stop(true))

    const first = await mcp(home, port)
    const r = await until(async () => {
      const x = await first.call('yap_inbox')
      return !x.isError && x
    }, 'inbox')
    expect(r.structuredContent.me.id).toBe(BOB.id)
    await until(() => first.stderr().includes('in-process'), 'in-process')
    // It took the next port and wrote it down for others.
    const { port: got } = JSON.parse(await Bun.file(join(home, 'api.json')).text())
    expect(got).toBeGreaterThan(port)
    expect(await (await fetch(`http://127.0.0.1:${got}/health`)).json()).toMatchObject({ app: 'yapping', ok: true })

    // A second `yap mcp` (say, Claude Code's) finds it and shares it.
    const second = await mcp(home, port)
    const r2 = await second.call('yap_inbox')
    expect(r2.structuredContent.me.id).toBe(BOB.id)
    await Bun.sleep(300)
    expect(second.stderr()).not.toContain('in-process')
  }, 30000)

  test('tools and the sidebar resource match the remote MCP: app-only visibility, mime and meta', async () => {
    const home = await linked(BOB, 'bob-2')
    const m = await mcp(home, freePort())
    const { tools } = await m.client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t as any]))
    for (const n of APP_ONLY) {
      expect(byName[n]._meta.ui.visibility).toEqual(['app'])
      expect(byName[n]._meta.ui.resourceUri).toBe('ui://yapping/sidebar')
    }
    for (const n of MODEL) expect(byName[n]._meta?.ui?.visibility ?? ['model']).toContain('model')
    expect(byName.yap_inbox._meta.ui.resourceUri).toBe('ui://yapping/sidebar')
    expect(byName.yap_send.description).toContain('exact words')

    const { resources } = await m.client.listResources()
    const res = resources.find((r) => r.uri === 'ui://yapping/sidebar') as any
    expect(res).toBeTruthy()
    expect(res.mimeType).toBe('text/html;profile=mcp-app')
    const read = await m.client.readResource({ uri: 'ui://yapping/sidebar' })
    const c = read.contents[0] as any
    expect(c.mimeType).toBe('text/html;profile=mcp-app')
    expect(c.text).toContain('SIDEBAR-MARKER')
    expect(c._meta.ui.csp.connectDomains).toEqual([fake.url])
    expect(c._meta.ui.prefersBorder).toBe(false)
  }, 20000)

  test('first run: signs in by itself; until linked every tool says how', async () => {
    const home = freshHome('carol-mac')
    fake.expectLogin(CAROL, { manual: true })
    const m = await mcp(home, freePort())

    // It asked the server for a sign-in link on its own.
    await until(() => fake.pendingLogins > 0, 'a sign-in to start')
    const r = await m.call('yap_inbox')
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/^Not signed in yet — open http:\/\/\S+\/verify\/\S+ to link this Mac to yapping\.$/)
    expect(r.structuredContent.error).toMatchObject({ code: 'not_signed_in' })
    const link = r.structuredContent.error.url
    for (const name of ['yap_read', 'yap_send', 'yap_sync']) {
      const x = await m.call(name, name === 'yap_sync' ? {} : { chat: 'x', text: 'y' })
      expect(x.isError).toBe(true)
      expect(x.content[0].text).toContain(link)
    }
    const s = await m.call('yap_sign_in')
    expect(s.structuredContent).toMatchObject({ signedIn: false, url: link, opened: true })

    // Carol signs in with Clerk and clicks "Link this Mac".
    fake.approveAll()
    const ok = await until(async () => {
      const x = await m.call('yap_inbox')
      return !x.isError && x
    }, 'linked', 10000)
    expect(ok.structuredContent.me.id).toBe(CAROL.id)
    expect((await m.call('yap_sign_in')).structuredContent).toMatchObject({ signedIn: true, user: { id: CAROL.id } })
  }, 30000)
})
