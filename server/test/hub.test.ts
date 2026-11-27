// /ws/node: presence, envelope relay (live and through the mailbox), and the
// gateway RPC.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeNode, befriend, linkDevice, login, sleep, testServer, type TestServer } from './helpers'

let s: TestServer
let base: string
let finn: { cookie: string; user: any; dev: { deviceToken: string; deviceId: string } }
let maya: { cookie: string; user: any; dev: { deviceToken: string; deviceId: string } }

beforeAll(async () => {
  s = testServer({ YAP_RPC_TIMEOUT_MS: '500' })
  base = s.url
  const f = await login(base, 'finn@example.com', { name: 'Finn' })
  const m = await login(base, 'maya@example.com', { name: 'Maya' })
  await befriend(base, f, m)
  finn = { ...f, dev: await linkDevice(base, f.cookie, 'Finn’s Mac') }
  maya = { ...m, dev: await linkDevice(base, m.cookie, 'Maya’s Mac') }
})
afterAll(() => s.close())

const sealed = (n: number) => ({ from: 'whatever', nonce: `nonce${n}`, box: `box${n}` })

describe('node websocket', () => {
  test('needs a device token', async () => {
    const res = await fetch(`${base}/ws/node`, { headers: { upgrade: 'websocket', connection: 'Upgrade' } })
    expect(res.status).toBe(401)
  })

  test('presence: contacts are told when you come and go, and you hear who is on', async () => {
    const a = await FakeNode.connect(base, finn.dev.deviceToken)
    expect(await a.next((f) => f.t === 'presence' && f.userId === maya.user.id)).toMatchObject({ online: false })
    const b = await FakeNode.connect(base, maya.dev.deviceToken)
    expect(await b.next((f) => f.t === 'presence' && f.userId === finn.user.id)).toMatchObject({ online: true })
    expect(await a.next((f) => f.t === 'presence' && f.userId === maya.user.id)).toMatchObject({ online: true })
    await b.close()
    expect(await a.next((f) => f.t === 'presence' && f.userId === maya.user.id)).toMatchObject({ online: false })
    await a.close()
  })

  test('an envelope goes live to an online device, stamped with the sender', async () => {
    const a = await FakeNode.connect(base, finn.dev.deviceToken)
    const b = await FakeNode.connect(base, maya.dev.deviceToken)
    a.send({ t: 'env', to: [maya.dev.deviceId], env: sealed(1) })
    const got = await b.next((f) => f.t === 'env')
    expect(got.from).toBe(finn.dev.deviceId)
    expect(got.env).toEqual({ from: finn.dev.deviceId, nonce: 'nonce1', box: 'box1' })
    expect(got.id).toBeString()
    b.send({ t: 'ack', id: got.id })
    await sleep(50)
    // Acked, so it doesn't come back on reconnect.
    await b.close()
    const b2 = await FakeNode.connect(base, maya.dev.deviceToken)
    await sleep(100)
    expect(b2.frames.filter((f) => f.t === 'env')).toEqual([])
    await Promise.all([a.close(), b2.close()])
  })

  test('the mailbox holds envelopes for an offline device until it acks', async () => {
    const a = await FakeNode.connect(base, finn.dev.deviceToken)
    a.send({ t: 'env', to: [maya.dev.deviceId], env: sealed(2) })
    a.send({ t: 'env', to: [maya.dev.deviceId], env: sealed(3) })
    await sleep(100)

    // Maya's Mac wakes up: both arrive, in order. It acks only the first.
    const b = await FakeNode.connect(base, maya.dev.deviceToken)
    const e2 = await b.next((f) => f.t === 'env' && f.env.nonce === 'nonce2')
    const e3 = await b.next((f) => f.t === 'env' && f.env.nonce === 'nonce3')
    expect(e2.from).toBe(finn.dev.deviceId)
    b.send({ t: 'ack', id: e2.id })
    await sleep(50)
    await b.close()

    // Reconnecting brings back only the unacked one.
    const b2 = await FakeNode.connect(base, maya.dev.deviceToken)
    const again = await b2.next((f) => f.t === 'env')
    expect(again.id).toBe(e3.id)
    expect(again.env.nonce).toBe('nonce3')
    await sleep(50)
    expect(b2.frames.filter((f) => f.t === 'env')).toEqual([])
    b2.send({ t: 'ack', id: again.id })
    await sleep(50)
    const left = s.ctx.db.query('SELECT count(*) AS n FROM mailbox').get() as any
    expect(left.n).toBe(0)
    await Promise.all([a.close(), b2.close()])
  })

  test('strangers\' devices are refused', async () => {
    const x = await login(base, 'stranger@example.com')
    const xd = await linkDevice(base, x.cookie)
    const a = await FakeNode.connect(base, finn.dev.deviceToken)
    a.send({ t: 'env', to: [xd.deviceId, 'nope'], env: sealed(9) })
    const e = await a.next((f) => f.t === 'error')
    expect(e.code).toBe('not_allowed')
    expect(e.to).toEqual([xd.deviceId, 'nope'])
    await a.close()
  })
})

describe('gateway', () => {
  test('an RPC reaches the most recently active node and comes back', async () => {
    const node = await FakeNode.connect(base, finn.dev.deviceToken, (f) => {
      if (f.method === 'inbox') return [{ chat: 'dm:x', unread: 2 }]
      throw new Error('no such method')
    })
    expect(await s.ctx.hub.rpc(finn.user.id, 'inbox', {})).toEqual([{ chat: 'dm:x', unread: 2 }])
    // Not `await expect(p).rejects.toThrow()`: on Bun 1.4 that closes the
    // in-process WebSocket. Catch the error and look at it instead.
    const e: any = await s.ctx.hub.rpc(finn.user.id, 'nope', {}).then(() => null, (x) => x)
    expect(String(e?.message ?? e)).toContain('no such method')
    await node.close()
  })

  test('no node online: a clear error', async () => {
    await expect(s.ctx.hub.rpc(maya.user.id, 'inbox', {})).rejects.toThrow('Your yapping node is offline. Is your Mac asleep?')
  })

  test('a node that never answers times out', async () => {
    const node = await FakeNode.connect(base, maya.dev.deviceToken) // no RPC handler
    await expect(s.ctx.hub.rpc(maya.user.id, 'inbox', {})).rejects.toThrow('didn\'t answer in time')
    await node.close()
  })
})
