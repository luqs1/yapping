// The node, end to end, against a fake server: real keys, real SQLite,
// real WebSockets, real encryption. Each node gets its own YAP_HOME.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyEvent, createSim } from '../../shared/sim.js'
import { startApi } from '../src/api'
import { login } from '../src/login'
import { dmId, startNode, type YapNode } from '../src/node'
import { localToken, saveConfig } from '../src/paths'
import { plist } from '../src/service'
import { fakeServer, type FakeServer } from './fake-server'

delete process.env.YAP_SERVER
delete process.env.YAP_AGENT

const ALICE = { id: 'u_alice', name: 'Alice' }
const BOB = { id: 'u_bob', name: 'Bob' }
const SECRET = 'meet me by the barbican fountain at 7 🎻'

type Running = { home: string; node: YapNode; api: ReturnType<typeof startApi>; base: string; token: string; rpc: (m: string, p?: Record<string, unknown>) => Promise<any> }

async function until<T>(fn: () => T | Promise<T>, what = 'condition', ms = 4000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    let v: T | undefined
    try { v = await fn() } catch {}
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(15)
  }
}

// A fresh YAP_HOME, signed in through the device-code flow.
async function linkDevice(fake: FakeServer, user: { id: string; name: string }, label: string) {
  const home = mkdtempSync(join(tmpdir(), `yap-${label}-`))
  saveConfig(home, { server: fake.url, deviceName: label })
  fake.expectLogin(user)
  const opened: string[] = []
  await login({ home, openUrl: (u) => opened.push(u), say: () => {}, intervalMs: 5 })
  expect(opened[0]).toContain('/verify/')
  return home
}

async function boot(home: string): Promise<Running> {
  const node = await startNode({ home, readingMs: 80 })
  const token = localToken(home)
  const api = startApi({ node, token, port: 0, home })
  await until(() => node.connected, 'node to connect')
  await node.flush()
  const base = `http://127.0.0.1:${api.port}`
  return { home, node, api, base, token, rpc: (m, p = {}) => node.call(m, p) as Promise<any> }
}

const down = async (r: Running) => { r.api.stop(); await r.node.stop() }
const lastMsg = (s: any, chatId: string) => s.messages[chatId]?.at(-1)

let fake: FakeServer
let aliceHome: string, alice2Home: string, bobHome: string
let alice: Running, alice2: Running, bob: Running
let chatId: string

beforeAll(async () => {
  fake = fakeServer()
  aliceHome = await linkDevice(fake, ALICE, 'alice-mac')
  alice2Home = await linkDevice(fake, ALICE, 'alice-laptop')
  bobHome = await linkDevice(fake, BOB, 'bob-mac')
  ;[alice, alice2, bob] = await Promise.all([boot(aliceHome), boot(alice2Home), boot(bobHome)])
  chatId = dmId(ALICE.id, BOB.id)
})

afterAll(async () => {
  for (const r of [alice, alice2, bob]) await down(r).catch(() => {})
  fake.stop()
})

describe('keys and storage', () => {
  test('keys.json, config.json and local-token are private to the owner', () => {
    for (const f of ['keys.json', 'config.json', 'local-token']) expect(statSync(join(aliceHome, f)).mode & 0o777).toBe(0o600)
    const k = JSON.parse(readFileSync(join(aliceHome, 'keys.json'), 'utf8'))
    expect(Object.keys(k.box)).toEqual(['publicKey', 'secretKey'])
    expect(alice.node.config.deviceId).toBeTruthy()
    expect(alice.node.config.user?.id).toBe(ALICE.id)
  })
})

describe('messages, end to end', () => {
  test('two nodes exchange a message; the server only sees ciphertext', async () => {
    const r = await alice.rpc('send', { chat: BOB.id, text: SECRET })
    expect(r.message.chatId).toBe(chatId)
    const got = await until(async () => lastMsg(await bob.rpc('state'), chatId), "Bob's copy")
    expect(got).toMatchObject({ id: r.message.id, from: ALICE.id, text: SECRET, kind: 'text', via: 'yap' })
    // Alice's other Mac gets her own message too, and it isn't unread there.
    const mine = await until(async () => lastMsg(await alice2.rpc('state'), chatId), "Alice's laptop copy")
    expect(mine.text).toBe(SECRET)
    expect((await alice2.rpc('state')).chats.find((c: any) => c.id === chatId).unread[ALICE.id]).toBe(0)
    expect((await bob.rpc('state')).chats.find((c: any) => c.id === chatId).unread[BOB.id]).toBe(1)

    // Everything the server relayed was boxed.
    const envs = fake.frames.map((f) => JSON.parse(f)).filter((f) => f.t === 'env')
    expect(envs.length).toBeGreaterThanOrEqual(2)
    for (const f of envs) expect(Object.keys(f.env).sort()).toEqual(['box', 'from', 'nonce'])
    const all = fake.frames.join('\n')
    for (const needle of ['barbican', 'fountain', SECRET, chatId, '"kind"', 'message']) expect(all).not.toContain(needle)
  })

  test('the offline mailbox: Bob is away, then back', async () => {
    const bobDevice = bob.node.config.deviceId!
    await down(bob)
    await until(() => !fake.isOnline(bobDevice), 'Bob offline')
    await alice.rpc('send', { chat: chatId, text: 'are you there?' })
    await until(() => (fake.mailbox.get(bobDevice) || []).length > 0, 'mailbox item')
    bob = await boot(bobHome)
    const got = await until(async () => {
      const m = lastMsg(await bob.rpc('state'), chatId)
      return m?.text === 'are you there?' && m
    }, 'mailbox delivery')
    expect(got.from).toBe(ALICE.id)
    // Acked, so the mailbox is empty again.
    await until(() => (fake.mailbox.get(bobDevice) || []).length === 0, 'mailbox drained')
  })

  test('reactions and read state reach every device', async () => {
    const s = await bob.rpc('state')
    const m = lastMsg(s, chatId)
    await bob.rpc('react', { chat: chatId, msgId: m.id, emoji: '❤️' })
    await until(async () => lastMsg(await alice.rpc('state'), chatId).reactions['❤️']?.includes(BOB.id), 'reaction at Alice')
    await bob.rpc('react', { chat: chatId, msgId: m.id, emoji: '❤️' }) // toggles off
    await until(async () => !lastMsg(await alice.rpc('state'), chatId).reactions['❤️'], 'reaction removed')
    // Alice reads on one Mac; the other Mac clears its count too.
    await bob.rpc('send', { chat: chatId, text: 'yes!' })
    await until(async () => (await alice2.rpc('state')).chats.find((c: any) => c.id === chatId).unread[ALICE.id] > 0, 'unread on laptop')
    await alice.rpc('mark_read', { chat: chatId })
    await until(async () => (await alice2.rpc('state')).chats.find((c: any) => c.id === chatId).unread[ALICE.id] === 0, 'read synced')
  })
})

describe('the UI shapes (shared/sim.js)', () => {
  test('state has the sim snapshot shape, and sync events fold into it with applyEvent', async () => {
    const sim = createSim({ schedule: () => 0 }).snapshot('luqmaan')
    const s0 = await bob.rpc('state')
    for (const k of Object.keys(sim)) expect(s0).toHaveProperty(k)
    expect(s0.me).toBe(BOB.id)

    const simChat = sim.chats[0]
    const chat = s0.chats.find((c: any) => c.id === chatId)
    for (const k of ['id', 'kind', 'title', 'transport', 'members', 'pinned', 'unread', 'sees']) expect(chat).toHaveProperty(k)
    expect(Object.keys(simChat).every((k) => k in chat)).toBe(true)
    expect(chat.title).toBe('Alice')
    const simMsg = sim.messages['dm-finn'][0]
    const msg = lastMsg(s0, chatId)
    for (const k of Object.keys(simMsg)) expect(msg).toHaveProperty(k)
    for (const k of ['id', 'name', 'handle', 'color', 'agent', 'harness', 'status']) expect(s0.users[ALICE.id]).toHaveProperty(k)
    expect(s0.bridges.whatsapp).toMatchObject({ name: 'WhatsApp', status: 'unlinked' })
    expect(s0.harnesses.claude.name).toBe('Claude')

    // Things happen: a message in, a reaction, sees on, a read glance, a proposal.
    await alice.rpc('send', { chat: chatId, text: 'one more thing' })
    const incoming = await until(async () => {
      const m = lastMsg(await bob.rpc('state'), chatId)
      return m?.text === 'one more thing' && m
    }, 'message')
    await alice.rpc('react', { chat: chatId, msgId: incoming.id, emoji: '😂' })
    await until(async () => lastMsg(await bob.rpc('state'), chatId).reactions['😂'], 'reaction')
    await bob.rpc('set_sees', { chat: chatId, on: true })
    // Alice is told that Bob's AI can now read along.
    const bobId = (await bob.rpc('state')).me
    await until(async () => (await alice.rpc('state')).chats.find((c: any) => c.id === chatId)?.sees?.[bobId], "bob's sees to reach alice")
    await bob.rpc('read', { chat: chatId })
    await bob.rpc('propose', { chat: chatId, label: 'Send Alice the map?', action: 'Send', payload: { kind: 'link', title: 'Barbican map', url: 'https://example.com/map' } })
    await Bun.sleep(150) // the reading glance settles

    const { events, seq } = await bob.rpc('sync', { since: s0.seq })
    expect(seq).toBeGreaterThan(s0.seq)
    const types = new Set(events.map((e: any) => e.type))
    for (const t of ['message', 'message_update', 'chat_update', 'assist']) expect(types.has(t)).toBe(true)
    for (const e of events) expect(e.seq).toBeGreaterThan(s0.seq)

    const folded = structuredClone(s0)
    for (const e of events) applyEvent(folded, structuredClone(e))
    const s1 = await bob.rpc('state')
    expect(folded.seq).toBe(s1.seq)
    expect(folded.chats.find((c: any) => c.id === chatId)).toEqual(s1.chats.find((c: any) => c.id === chatId))
    expect(folded.messages[chatId]).toEqual(s1.messages[chatId])
    expect(folded.assists).toEqual(s1.assists)

    // An assist in the shape SPEC.md describes.
    const a: any = Object.values(s1.assists).find((x: any) => x.state === 'ready')
    for (const k of ['id', 'chatId', 'msgId', 'owner', 'agents', 'state', 'line', 'proposal', 'log', 'startedAt']) expect(a).toHaveProperty(k)
    expect(a.agents).toEqual([{ owner: BOB.id, harness: 'claude' }])
  })
})

describe('agents and sees', () => {
  test('read is refused while sees is off, and records a reading assist when on', async () => {
    await alice.rpc('set_sees', { chat: chatId, on: false })
    await expect(alice.rpc('read', { chat: chatId })).rejects.toMatchObject({ code: 'sees_off' })
    await expect(alice.rpc('propose', { chat: chatId, label: 'x', action: 'Send', payload: { kind: 'text', text: 'x' } })).rejects.toMatchObject({ code: 'sees_off' })
    // An agent can't send into a hidden chat either; the owner still can.
    await expect(alice.rpc('send', { chat: chatId, text: 'from an agent', agent: true })).rejects.toMatchObject({ code: 'sees_off' })
    // The inbox admits the chat exists, and nothing more.
    const inbox = await alice.rpc('inbox')
    const row = inbox.chats.find((c: any) => c.chat === chatId)
    expect(row.sees).toBe(false)
    expect(row.last).toBeUndefined()
    expect(JSON.stringify(inbox)).not.toContain('one more thing')

    await alice.rpc('set_sees', { chat: 'Bob', on: true }) // names work too
    const r = await alice.rpc('read', { chat: 'Bob', limit: 3 })
    expect(r.messages.map((m: any) => m.text)).toEqual(['are you there?', 'yes!', 'one more thing'])
    expect(r.messages.map((m: any) => m.from)).toEqual(['Alice (you)', 'Bob', 'Alice (you)'])
    const newest = lastMsg(await alice.rpc('state'), chatId)
    const reading: any = Object.values((await alice.rpc('state')).assists).find((x: any) => x.msgId === newest.id)
    expect(reading).toMatchObject({ state: 'reading', owner: ALICE.id, agents: [{ owner: ALICE.id, harness: 'claude' }] })
    await until(async () => (await alice.rpc('state')).assists[reading.id].state === 'done', 'glance settles')
    expect((await alice.rpc('inbox')).chats.find((c: any) => c.chat === chatId).last.text).toBeTruthy()
  })

  test('propose → approve posts the payload as the owner\'s message, with assistedBy', async () => {
    const { id } = await alice.rpc('propose', {
      chat: chatId,
      label: 'Send Bob the invite for Thursday?',
      detail: 'Thu 14:30–15:00 · walking call',
      action: 'Send invite',
      payload: { kind: 'event', title: 'Alice × Bob', subtitle: 'Thu 14:30 – 15:00 · walking call' },
      harness: 'codex',
    })
    let a = (await alice.rpc('state')).assists[id]
    expect(a).toMatchObject({ state: 'ready', line: 'Send Bob the invite for Thursday?', proposal: { action: 'Send invite', payload: { kind: 'event' } } })
    // Nothing is sent before approval.
    expect(lastMsg(await bob.rpc('state'), chatId).kind).not.toBe('attachment')

    const r = await alice.rpc('approve', { id })
    expect(r.message).toMatchObject({ from: ALICE.id, kind: 'attachment', assistedBy: 'codex', attachment: { type: 'event', title: 'Alice × Bob' } })
    a = (await alice.rpc('state')).assists[id]
    expect(a.state).toBe('done')
    expect(a.proposal).toBeUndefined()
    const atBob = await until(async () => {
      const m = lastMsg(await bob.rpc('state'), chatId)
      return m?.id === r.message.id && m
    }, 'approved message at Bob')
    expect(atBob).toMatchObject({ kind: 'attachment', assistedBy: 'codex', attachment: { type: 'event' } })
    await expect(alice.rpc('approve', { id })).rejects.toMatchObject({ code: 'not_ready' })

    // Dismissing leaves nothing behind.
    const p2 = await alice.rpc('propose', { chat: chatId, label: 'Reply "on my way"?', action: 'Send', payload: { kind: 'text', text: 'on my way' } })
    await alice.rpc('dismiss', { id: p2.id })
    expect((await alice.rpc('state')).assists[p2.id].state).toBe('dismissed')
  })

  test('bridges say they are not set up yet', async () => {
    expect(await alice.rpc('bridge', { op: 'status', network: 'whatsapp' })).toMatchObject({ status: 'unlinked', code: 'not_set_up' })
    await expect(alice.rpc('bridge', { op: 'link', network: 'whatsapp' })).rejects.toMatchObject({ code: 'not_set_up' })
  })
})

describe('the gateway', () => {
  test('an rpc frame from the server is answered by the same handlers', async () => {
    const res = await fake.rpc(alice.node.config.deviceId!, 'inbox')
    expect(res.error).toBeUndefined()
    expect(res.result.me.id).toBe(ALICE.id)
    expect(res.result.chats.some((c: any) => c.chat === chatId)).toBe(true)
    const prefixed = await fake.rpc(alice.node.config.deviceId!, 'yap_sync', { since: 0 })
    expect(prefixed.result.events.length).toBeGreaterThan(0)
    const bad = await fake.rpc(alice.node.config.deviceId!, 'nope')
    expect(bad.error).toContain('Unknown method')
  })
})

describe('the local API', () => {
  test('rpc needs the token; /events streams; / serves the sidebar with the token', async () => {
    const no = await fetch(`${alice.base}/rpc`, { method: 'POST', body: JSON.stringify({ method: 'state' }) })
    expect(no.status).toBe(401)
    const wrongHost = await fetch(`${alice.base}/health`, { headers: { host: 'evil.example' } })
    expect(wrongHost.status).toBe(421)
    const ok = await fetch(`${alice.base}/rpc`, { method: 'POST', headers: { 'x-yap-token': alice.token }, body: JSON.stringify({ method: 'status' }) })
    expect((await ok.json()).result.connected).toBe(true)
    const err = await fetch(`${alice.base}/rpc`, { method: 'POST', headers: { 'x-yap-token': alice.token }, body: JSON.stringify({ method: 'read', params: { chat: 'nobody' } }) })
    expect((await err.json()).error.code).toBe('no_chat')

    const page = await (await fetch(`${alice.base}/`)).text()
    expect(page).toContain(`window.__YAP__=`)
    expect(page).toContain(alice.token)

    // SSE: subscribe, cause an event, see it arrive.
    const ac = new AbortController()
    const res = await fetch(`${alice.base}/events?token=${alice.token}`, { signal: ac.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    await alice.rpc('set_sees', { chat: chatId, on: true })
    let buf = ''
    const seen = await until(async () => {
      const { value } = await reader.read()
      buf += new TextDecoder().decode(value)
      return buf.includes('"chat_update"')
    }, 'SSE event')
    expect(seen).toBe(true)
    ac.abort()
  })
})

describe('service', () => {
  test('the launchd plist runs `yap daemon` at login with KeepAlive', () => {
    const xml = plist({ args: ['/Users/x/.yapping/bin/yap', 'daemon'], home: '/Users/x/.yapping', env: { YAP_SERVER: 'https://yap.luqmaan.dev' } })
    expect(xml).toContain('<string>dev.luqmaan.yapping</string>')
    expect(xml).toContain('<string>daemon</string>')
    expect(xml).toContain('<key>KeepAlive</key><true/>')
    expect(xml).toContain('<key>RunAtLoad</key><true/>')
  })
})
