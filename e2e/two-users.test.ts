// Two real people in the yaplab: Alice (yapa) and Bob (yapb), each with their
// own node (systemd, from this tree) linked to the lab's dev server and made
// contacts through a real invite. This test only talks to their nodes' local
// APIs, like the sidebar and `yap mcp` do, and reads the server's DB to check
// it never holds plaintext. Build the lab first: e2e/lab/setup.sh.
//
//   on the VM (root):  cd /srv/yaplab/repo && bun test ./e2e/two-users.test.ts
//   from the Mac:      e2e/lab/lab-mac.sh test
//
// Every run uses fresh random text, so it can run again and again on the
// same lab. It leaves each chat hidden from both agents, as it found it.

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const ETC = process.env.YAPLAB_ETC || '/srv/yaplab/etc'
const DB = process.env.YAPLAB_DB || '/srv/yaplab/server-data/server.db'
const run = randomBytes(4).toString('hex')
const secrets: string[] = []
const secret = (what: string) => {
  const s = `${what} ${run} ${randomBytes(6).toString('hex')}`
  secrets.push(s)
  return s
}

class RpcFail extends Error {
  constructor(public code: string, message: string) { super(message) }
}

type Person = {
  who: string
  id: string
  name: string
  rpc: (method: string, params?: Record<string, unknown>) => Promise<any>
}

function readEnv(user: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(join(ETC, `${user}.env`), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

async function person(user: string): Promise<Person> {
  const env = readEnv(user)
  const base = `http://127.0.0.1:${env.YAP_PORT}`
  const token = readFileSync(join(env.YAP_HOME, 'local-token'), 'utf8').trim()
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yap-token': token }, body: JSON.stringify({ method, params }) })
    const body: any = await res.json()
    if (body.error) throw new RpcFail(body.error.code, body.error.message)
    return body.result
  }
  const health: any = await (await fetch(`${base}/health`)).json()
  if (!health.ok || !health.signedIn) throw new Error(`${env.LAB_WHO}'s node is not up and signed in: ${JSON.stringify(health)}`)
  const s = await rpc('state')
  return { who: env.LAB_WHO, id: s.me, name: s.users[s.me]?.name, rpc }
}

async function until<T>(fn: () => T | Promise<T>, what: string, ms = 10000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  let last: unknown
  for (;;) {
    let v: T | undefined
    try { v = await fn() } catch (e) { last = e }
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? ` (last error: ${(last as Error).message})` : ''}`)
    await Bun.sleep(50)
  }
}

const messages = async (p: Person, chat: string): Promise<any[]> => (await p.rpc('state')).messages[chat] || []
const msgById = async (p: Person, chat: string, id: string) => (await messages(p, chat)).find((m) => m.id === id)
const chatOf = async (p: Person, chat: string) => (await p.rpc('state')).chats.find((c: any) => c.id === chat)
const dmId = (a: string, b: string) => `dm:${[a, b].sort().join(',')}`

let alice: Person, bob: Person, dm: string

beforeAll(async () => {
  ;[alice, bob] = await Promise.all([person('yapa'), person('yapb')])
  dm = dmId(alice.id, bob.id)
  // Start from "hidden from both agents" (the default for every chat).
  for (const p of [alice, bob]) await p.rpc('set_sees', { chat: p === alice ? bob.id : alice.id, on: false }).catch(() => {})
})

describe('yaplab: Alice and Bob on real nodes', () => {
  test('they are contacts (made by a real invite)', async () => {
    expect(alice.name).toBe('Alice Lab')
    expect(bob.name).toBe('Bob Lab')
    expect((await alice.rpc('contacts')).map((u: any) => u.id)).toContain(bob.id)
    expect((await bob.rpc('contacts')).map((u: any) => u.id)).toContain(alice.id)
  })

  test('Alice → Bob arrives at Bob decrypted', async () => {
    const text = secret('meet by the lab fountain at seven')
    const r = await alice.rpc('send', { chat: bob.id, text })
    expect(r.message.chatId).toBe(dm)
    const got = await until(() => msgById(bob, dm, r.message.id), "Bob's copy")
    expect(got).toMatchObject({ id: r.message.id, from: alice.id, text, via: 'yap' })
  })

  test('Bob → Alice reply', async () => {
    const text = secret('see you there')
    const r = await bob.rpc('send', { chat: dm, text })
    const got = await until(() => msgById(alice, dm, r.message.id), "the reply at Alice's")
    expect(got).toMatchObject({ from: bob.id, text })
  })

  test('reactions round-trip both ways (and come off again)', async () => {
    const a = (await alice.rpc('send', { chat: dm, text: secret('react to this') })).message
    await until(() => msgById(bob, dm, a.id), 'message at Bob')
    expect((await bob.rpc('react', { chat: dm, msgId: a.id, emoji: '❤️' })).on).toBe(true)
    await until(async () => (await msgById(alice, dm, a.id))?.reactions?.['❤️']?.includes(bob.id), "Bob's ❤️ at Alice")
    const b = (await bob.rpc('send', { chat: dm, text: secret('and this') })).message
    await until(() => msgById(alice, dm, b.id), 'message at Alice')
    expect((await alice.rpc('react', { chat: dm, msgId: b.id, emoji: '👍' })).on).toBe(true)
    await until(async () => (await msgById(bob, dm, b.id))?.reactions?.['👍']?.includes(alice.id), "Alice's 👍 at Bob")
    expect((await alice.rpc('react', { chat: dm, msgId: b.id, emoji: '👍' })).on).toBe(false)
    await until(async () => !(await msgById(bob, dm, b.id))?.reactions?.['👍']?.includes(alice.id), "Alice's 👍 gone at Bob")
  })

  test("Alice's set_sees reaches Bob as chat.sees[alice]", async () => {
    expect((await alice.rpc('set_sees', { chat: dm, on: true })).sees).toBe(true)
    await until(async () => (await chatOf(bob, dm))?.sees?.[alice.id] === true, 'sees[alice]=true at Bob')
    expect((await alice.rpc('set_sees', { chat: dm, on: false })).sees).toBe(false)
    await until(async () => (await chatOf(bob, dm))?.sees?.[alice.id] === false, 'sees[alice]=false at Bob')
    // Bob's own agent still can't see it: sees is per person.
    expect((await chatOf(bob, dm)).sees?.[bob.id]).toBeFalsy()
  })

  test("an agent can't send into a chat hidden from it; the owner can", async () => {
    expect((await chatOf(alice, dm)).sees?.[alice.id]).toBeFalsy()
    const hidden = secret('agent tried to send this')
    const err = await alice.rpc('send', { chat: dm, text: hidden, agent: true }).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(RpcFail)
    expect(err.code).toBe('sees_off')
    // …nor read it, nor propose there.
    expect((await alice.rpc('read', { chat: dm }).then(() => null, (e) => e))?.code).toBe('sees_off')
    expect((await alice.rpc('propose', { chat: dm, label: 'x', payload: { kind: 'text', text: 'x' } }).then(() => null, (e) => e))?.code).toBe('sees_off')

    const own = secret('the owner typed this herself')
    const r = await alice.rpc('send', { chat: dm, text: own })
    await until(() => msgById(bob, dm, r.message.id), "the owner's message at Bob")
    expect((await messages(bob, dm)).some((m) => m.text === hidden)).toBe(false)
  })

  test('propose → approve delivers the payload to Bob with assistedBy', async () => {
    await alice.rpc('set_sees', { chat: dm, on: true })
    try {
      const title = secret('Lab notes')
      const url = `https://example.test/lab/${run}`
      const p = await alice.rpc('propose', { chat: dm, label: 'Send Bob the lab notes?', action: 'Send', payload: { kind: 'link', title, url } })
      expect(p.state).toBe('ready')
      const inbox = await alice.rpc('inbox')
      expect(inbox.chats.find((c: any) => c.chat === dm)?.pending?.map((x: any) => x.id)).toContain(p.id)
      // Nothing has gone to Bob yet.
      expect((await messages(bob, dm)).some((m) => m.attachment?.title === title)).toBe(false)

      const ok = await alice.rpc('approve', { id: p.id })
      expect(ok.message.assistedBy).toBe('claude')
      const got = await until(() => msgById(bob, dm, ok.message.id), 'approved payload at Bob')
      expect(got).toMatchObject({ from: alice.id, assistedBy: 'claude', attachment: { type: 'link', title, url } })
      expect((await alice.rpc('approve', { id: p.id }).then(() => null, (e) => e))?.code).toBe('not_ready')
    } finally {
      await alice.rpc('set_sees', { chat: dm, on: false })
    }
  })

  test('Bob creates a chat with a contact: a DM, and a group Alice receives', async () => {
    const d = await bob.rpc('create_chat', { members: [alice.id] })
    expect(d.chat.id).toBe(dm)

    const title = `Lab group ${run}`
    const g = (await bob.rpc('create_chat', { members: [alice.id], title })).chat
    expect(g).toMatchObject({ kind: 'group', title })
    expect([...g.members].sort()).toEqual([alice.id, bob.id].sort())
    const text = secret('first words in the group')
    const r = await bob.rpc('send', { chat: g.id, text })
    const got = await until(() => msgById(alice, g.id, r.message.id), 'group message at Alice')
    expect(got.text).toBe(text)
    expect(await chatOf(alice, g.id)).toMatchObject({ kind: 'group', title })
    // A new chat starts hidden from Alice's agent too.
    expect((await chatOf(alice, g.id)).sees?.[alice.id]).toBeFalsy()
  })

  test('the server DB never holds any of the plaintext', async () => {
    expect(existsSync(DB)).toBe(true)
    await Bun.sleep(300) // let the server's last writes land
    expect(secrets.length).toBeGreaterThan(5)
    for (const f of [DB, `${DB}-wal`]) {
      if (!existsSync(f)) continue
      const bytes = readFileSync(f)
      for (const s of secrets) expect({ file: f, found: bytes.includes(Buffer.from(s)) }).toEqual({ file: f, found: false })
      expect(bytes.includes(Buffer.from(run))).toBe(false)
    }
  })
})
