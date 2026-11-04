// The WhatsApp bridge against a fake sidecar (test/fake-wa.ts) that speaks
// yap-wa's stdio protocol. No real WhatsApp anywhere.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WHATSAPP_WARNING } from '../src/bridges'
import { login } from '../src/login'
import { startNode, type YapNode } from '../src/node'
import { saveConfig } from '../src/paths'
import { fakeServer, type FakeServer } from './fake-server'

delete process.env.YAP_SERVER
delete process.env.YAP_AGENT
delete process.env.YAP_WA_BIN

const ALICE = { id: 'u_alice', name: 'Alice' }
const FAKE = join(import.meta.dir, 'fake-wa.ts')
const MUM = '447700900111@s.whatsapp.net'
const MUM_CHAT = `wa:${MUM}`
const GROUP = '120363000000000001@g.us'

async function until<T>(fn: () => T | Promise<T>, what = 'condition', ms = 5000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    let v: T | undefined
    try { v = await fn() } catch {}
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(15)
  }
}

let fake: FakeServer
let home: string
let node: YapNode
const waDir = () => join(home, 'bridges', 'whatsapp')
const rpc = (m: string, p: Record<string, unknown> = {}) => node.call(m, p) as Promise<any>
const pids = () => (existsSync(join(waDir(), 'fake-pids')) ? readFileSync(join(waDir(), 'fake-pids'), 'utf8').trim().split('\n').filter(Boolean).map(Number) : [])
const commands = () => (existsSync(join(waDir(), 'fake-commands.jsonl')) ? readFileSync(join(waDir(), 'fake-commands.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const control = async (path: string, body?: unknown) => {
  const port = readFileSync(join(waDir(), 'fake-port'), 'utf8').trim()
  await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const wa = () => rpc('state').then((s) => s.bridges.whatsapp)

async function boot() {
  node = await startNode({
    home,
    readingMs: 50,
    log: process.env.DEBUG_WA ? (...a: unknown[]) => console.error("[node]", ...a) : undefined,
    bridges: { whatsapp: { command: [process.execPath, FAKE], backoffMs: [50, 400], linkTimeoutMs: 4000 } },
  })
  await until(() => node.connected, 'node to connect')
}

beforeAll(async () => {
  fake = fakeServer()
  home = mkdtempSync(join(tmpdir(), 'yap-wa-'))
  saveConfig(home, { server: fake.url, deviceName: 'alice-mac' })
  fake.expectLogin(ALICE)
  await login({ home, openUrl: () => {}, say: () => {}, intervalMs: 5 })
  await boot()
})

afterAll(async () => {
  await node?.stop().catch(() => {})
  fake.stop()
})

describe('linking', () => {
  test('nothing runs until the person asks; the warning is there before the first link', async () => {
    const s = await wa()
    expect(s).toMatchObject({ name: 'WhatsApp', status: 'unlinked', account: null, warning: WHATSAPP_WARNING })
    expect(await rpc('bridge', { op: 'status', network: 'whatsapp' })).toMatchObject({ network: 'whatsapp', status: 'unlinked', warning: WHATSAPP_WARNING })
    await Bun.sleep(100)
    expect(pids()).toEqual([])
  })

  test('link → QR code → the phone scans → connected', async () => {
    const r = await rpc('bridge', { op: 'link', network: 'whatsapp' })
    expect(r.qr).toStartWith('2@fake-code-')
    expect(r.expiresAt).toBeGreaterThan(Date.now())
    expect(r.warning).toBe(WHATSAPP_WARNING)
    expect(r.status).toBe('linking')
    expect(pids().length).toBe(1)
    expect((await wa()).status).toBe('linking')
    // Asking again while the code is good shows the same code.
    expect((await rpc('bridge', { op: 'link', network: 'whatsapp' })).qr).toBe(r.qr)

    const s0 = await rpc('state')
    await control('/scan')
    const s = await until(async () => { const b = await wa(); return b.status === 'linked' && b }, 'linked')
    expect(s).toMatchObject({ status: 'linked', account: '+447700900000', accountName: 'Test Phone', connected: true })
    expect(s.warning).toBeUndefined()
    // The sidebar hears it as a bridge event.
    const { events } = await rpc('sync', { since: s0.seq })
    expect(events.find((e: any) => e.type === 'bridge' && e.status === 'linked')).toMatchObject({ network: 'whatsapp', account: '+447700900000' })
    // Linking again just says so.
    expect(await rpc('bridge', { op: 'link', network: 'whatsapp' })).toMatchObject({ status: 'linked', account: '+447700900000' })
    // The session marker is the owner's alone.
    expect(statSync(join(waDir(), 'account.json')).mode & 0o777).toBe(0o600)
    expect(statSync(waDir()).mode & 0o777).toBe(0o700)
  })
})

describe('messages', () => {
  test('an incoming WhatsApp message shows up in state as a whatsapp chat, hidden from the agent', async () => {
    const framesBefore = fake.frames.length
    const s0 = await rpc('state')
    await control('/emit', { type: 'message', jid: MUM, chatName: 'Mum', isGroup: false, from: { jid: MUM, name: 'Mum' }, id: 'ABC1', ts: Date.now(), text: 'dinner at 7?', fromMe: false })
    const s = await until(async () => { const x = await rpc('state'); return x.messages[MUM_CHAT]?.length && x }, 'bridged message')
    const chat = s.chats.find((c: any) => c.id === MUM_CHAT)
    expect(chat).toMatchObject({ id: MUM_CHAT, kind: 'dm', title: 'Mum', transport: 'whatsapp', members: [ALICE.id, MUM_CHAT], unread: { [ALICE.id]: 1 }, sees: { [ALICE.id]: false } })
    expect(s.messages[MUM_CHAT][0]).toMatchObject({ id: 'wa:ABC1', chatId: MUM_CHAT, from: MUM_CHAT, text: 'dinner at 7?', via: 'whatsapp', kind: 'text' })
    expect(s.users[MUM_CHAT]).toMatchObject({ id: MUM_CHAT, name: 'Mum', bridge: 'whatsapp', handle: '+447700900111' })

    // Live events for the sidebar: the person, the new chat, the message.
    const { events } = await rpc('sync', { since: s0.seq })
    expect(events.map((e: any) => e.type)).toEqual(['user', 'chat_update', 'message'])
    // The agent can't read it until the owner switches it on.
    await expect(rpc('read', { chat: MUM_CHAT })).rejects.toMatchObject({ code: 'sees_off' })
    expect((await rpc('inbox')).chats.find((c: any) => c.chat === MUM_CHAT)).toMatchObject({ transport: 'whatsapp', sees: false })
    // And none of it went near our server.
    expect(fake.frames.slice(framesBefore).join('\n')).not.toContain('dinner')
  })

  test('groups gather members as they speak; the first import is not unread', async () => {
    await control('/emit', { type: 'message', jid: GROUP, chatName: 'Family', isGroup: true, from: { jid: '447700900222@s.whatsapp.net', name: 'Sam' }, id: 'G1', ts: Date.now() - 3600_000, text: 'old news', fromMe: false, history: true })
    await control('/emit', { type: 'message', jid: GROUP, chatName: 'Family', isGroup: true, from: { jid: '447700900000@s.whatsapp.net', name: 'Test Phone' }, id: 'G2', ts: Date.now() - 3000_000, text: 'from my phone', fromMe: true, history: true })
    await control('/emit', { type: 'message', jid: GROUP, chatName: 'Family', isGroup: true, from: { jid: MUM, name: 'Mum' }, id: 'G3', ts: Date.now(), text: 'hello all', fromMe: false })
    // Too old for the first import: dropped.
    await control('/emit', { type: 'message', jid: GROUP, chatName: 'Family', isGroup: true, from: { jid: MUM, name: 'Mum' }, id: 'G0', ts: Date.now() - 90 * 86400_000, text: 'ancient', fromMe: false, history: true })
    const s = await until(async () => { const x = await rpc('state'); return x.messages[`wa:${GROUP}`]?.length === 3 && x }, 'group messages')
    const chat = s.chats.find((c: any) => c.id === `wa:${GROUP}`)
    expect(chat).toMatchObject({ kind: 'group', title: 'Family', transport: 'whatsapp', unread: { [ALICE.id]: 1 } })
    expect(chat.members.sort()).toEqual([ALICE.id, 'wa:447700900222@s.whatsapp.net', MUM_CHAT].sort())
    expect(s.messages[`wa:${GROUP}`].map((m: any) => [m.from, m.text])).toEqual([
      ['wa:447700900222@s.whatsapp.net', 'old news'],
      [ALICE.id, 'from my phone'],
      [MUM_CHAT, 'hello all'],
    ])
  })

  test('send on a WhatsApp chat goes to the sidecar, and stays off our network', async () => {
    const framesBefore = fake.frames.filter((f) => f.includes('"env"')).length
    const r = await rpc('send', { chat: MUM_CHAT, text: 'yes, see you there', replyTo: 'wa:ABC1' })
    expect(r.message).toMatchObject({ chatId: MUM_CHAT, from: ALICE.id, text: 'yes, see you there', via: 'whatsapp', replyTo: 'wa:ABC1' })
    expect(r.message.id).toStartWith('wa:FAKE')
    const sent = commands().filter((c) => c.cmd === 'send')
    expect(sent.at(-1)).toMatchObject({ cmd: 'send', jid: MUM, text: 'yes, see you there', replyTo: 'ABC1' })
    // By name works too, and reading it marks it read.
    await rpc('send', { chat: 'Mum', text: 'love you' })
    expect(commands().filter((c) => c.cmd === 'send').at(-1)).toMatchObject({ jid: MUM, text: 'love you' })
    const s = await rpc('state')
    expect(s.chats.find((c: any) => c.id === MUM_CHAT).unread[ALICE.id]).toBe(0)
    expect(s.messages[MUM_CHAT].map((m: any) => m.text)).toEqual(['dinner at 7?', 'yes, see you there', 'love you'])
    expect(fake.frames.filter((f) => f.includes('"env"')).length).toBe(framesBefore)
    // Reactions don't cross over yet, and say so.
    await expect(rpc('react', { chat: MUM_CHAT, msgId: 'wa:ABC1', emoji: '❤️' })).rejects.toMatchObject({ code: 'not_supported' })
  })

  test('an approved proposal on a WhatsApp chat goes out through the sidecar', async () => {
    await rpc('set_sees', { chat: MUM_CHAT, on: true })
    const { id } = await rpc('propose', { chat: MUM_CHAT, label: 'Say you\'re on the way?', action: 'Send', payload: { kind: 'text', text: 'on my way' } })
    expect(commands().filter((c) => c.cmd === 'send').at(-1).text).not.toBe('on my way') // nothing before approval
    const r = await rpc('approve', { id })
    expect(r.message).toMatchObject({ text: 'on my way', via: 'whatsapp', assistedBy: 'claude' })
    expect(commands().filter((c) => c.cmd === 'send').at(-1)).toMatchObject({ jid: MUM, text: 'on my way' })
  })
})

describe('supervision', () => {
  test('a crashed sidecar is started again, and picks up where it was', async () => {
    const [first] = pids().slice(-1)
    expect(alive(first)).toBe(true)
    process.kill(first, 'SIGKILL')
    const next = await until(() => { const p = pids().slice(-1)[0]; return p !== first ? p : 0 }, 'a new sidecar')
    expect(alive(next)).toBe(true)
    await until(async () => (await wa()).connected === true, 'reconnected')
    expect((await wa()).status).toBe('linked')
    const r = await rpc('send', { chat: MUM_CHAT, text: 'still here' })
    expect(r.message.id).toStartWith('wa:FAKE')
  })

  test('a node that restarts with a session starts the sidecar by itself', async () => {
    const before = pids().length
    await node.stop()
    await boot()
    await until(() => pids().length === before + 1, 'sidecar on boot')
    await until(async () => (await wa()).connected === true, 'connected on boot')
    expect(commands().slice(-1)[0]?.cmd).not.toBe('link') // nobody had to ask
  })
})

describe('unlinking', () => {
  test('unlink logs out, stops the sidecar and clears the account', async () => {
    const [pid] = pids().slice(-1)
    const s0 = await rpc('state')
    expect(await rpc('bridge', { op: 'unlink', network: 'whatsapp' })).toMatchObject({ ok: true, status: 'unlinked' })
    expect(commands().slice(-1)[0].cmd).toBe('unlink')
    expect(await wa()).toMatchObject({ status: 'unlinked', account: null, warning: WHATSAPP_WARNING })
    expect(existsSync(join(waDir(), 'account.json'))).toBe(false)
    await until(() => !alive(pid), 'sidecar gone')
    const { events } = await rpc('sync', { since: s0.seq })
    expect(events.find((e: any) => e.type === 'bridge')).toMatchObject({ status: 'unlinked', account: null })
    // Old chats stay; sending says why it can't.
    await expect(rpc('send', { chat: MUM_CHAT, text: 'hello?' })).rejects.toMatchObject({ code: 'not_linked' })
  })

  test('the phone removing the device unlinks too', async () => {
    const r = await rpc('bridge', { op: 'link', network: 'whatsapp' })
    expect(r.qr).toBeTruthy()
    await control('/scan')
    await until(async () => (await wa()).status === 'linked', 'linked again')
    await control('/emit', { type: 'logged_out', reason: 'logged_out' })
    const s = await until(async () => { const b = await wa(); return b.status === 'unlinked' && b }, 'logged out')
    expect(s).toMatchObject({ account: null, reason: 'logged_out' })
  })
})
