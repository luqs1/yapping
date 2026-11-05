// Sign-in, linking a Mac, and the directory.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { befriend, key, linkDevice, login, testServer, type TestServer } from './helpers'

let s: TestServer
let base: string
beforeAll(() => { s = testServer(); base = s.url })
afterAll(() => s.close())

describe('sign in', () => {
  test('dev login makes a user and a session cookie', async () => {
    const { cookie, user } = await login(base, 'Ada@Example.com')
    expect(user.email).toBe('ada@example.com')
    expect(user.name).toBe('Ada')
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json() as any
    expect(me.user.id).toBe(user.id)
    expect(me.devices).toEqual([])
  })

  test('the session cookie is httpOnly', async () => {
    const res = await fetch(`${base}/dev/login?email=c@example.com`)
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
  })

  test('no session, no API', async () => {
    expect((await fetch(`${base}/api/me`)).status).toBe(401)
  })

  // A made-up key whose Frontend API is example.clerk.accounts.dev.
  const CLERK = { CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('example.clerk.accounts.dev$')}`, CLERK_SECRET_KEY: 'sk_test_fake' }

  test('the sign-in page mounts Clerk from the key\'s Frontend API', async () => {
    const c = testServer(CLERK)
    try {
      const html = await (await fetch(`${c.url}/signin?next=/account`)).text()
      expect(html).toContain('https://example.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js')
      expect(html).toContain(`data-clerk-publishable-key="${CLERK.CLERK_PUBLISHABLE_KEY}"`)
      expect(html).toContain('mountSignIn')
      expect(html).toContain('"/account"')
    } finally { await c.close() }
  })

  test('without Clerk keys the sign-in page says so', async () => {
    expect((await fetch(`${base}/signin`)).status).toBe(503)
  })

  test('/auth/clerk refuses a token that is not Clerk\'s', async () => {
    const c = testServer(CLERK)
    try {
      const res = await fetch(`${c.url}/auth/clerk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'not-a-jwt', next: '/account' }) })
      expect(res.status).toBe(401)
      expect(res.headers.get('set-cookie')).toBeNull()
    } finally { await c.close() }
  })

  test('/dev/login is off without YAP_DEV', async () => {
    const prod = testServer({ YAP_DEV: '0' })
    try { expect((await fetch(`${prod.url}/dev/login?email=x@y.z`)).status).toBe(404) } finally { await prod.close() }
  })
})

describe('linking a Mac (device code)', () => {
  test('start → approve → poll gives a device token once', async () => {
    const { cookie, user } = await login(base, 'mac@example.com')
    const start = await (await fetch(`${base}/api/device/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada’s MacBook', boxPub: key(), signPub: key() }),
    })).json() as any
    expect(start.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/)
    expect(start.verifyUrl).toBe(`${base}/link?code=${start.userCode}`)

    const poll = () => fetch(`${base}/api/device/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: start.deviceCode }) })
    const pending = await poll()
    expect(pending.status).toBe(428)
    expect((await pending.json() as any).error).toBe('authorization_pending')

    // Not signed in: the approve page sends you to sign in first.
    const anon = await fetch(start.verifyUrl, { redirect: 'manual' })
    expect(anon.status).toBe(302)
    expect(anon.headers.get('location')).toStartWith('/signin?next=')
    // Signed in: it shows the Mac and the code.
    const pageHtml = await (await fetch(start.verifyUrl, { headers: { cookie } })).text()
    expect(pageHtml).toContain('Ada’s MacBook')
    expect(pageHtml).toContain(start.userCode)

    await fetch(`${base}/link`, { method: 'POST', headers: { cookie, origin: base }, body: new URLSearchParams({ code: start.userCode, decision: 'approve' }) })
    const done = await poll()
    expect(done.status).toBe(200)
    const got = await done.json() as any
    expect(got.deviceToken).toStartWith('ydt_')
    expect(got.user.id).toBe(user.id)
    expect(got.deviceId).toBeString()
    expect((await poll()).status).toBe(400) // only once

    const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${got.deviceToken}` } })).json() as any
    expect(me.user.id).toBe(user.id)
    expect(me.deviceId).toBe(got.deviceId)
    expect(me.devices[0]).toMatchObject({ deviceId: got.deviceId, name: 'Ada’s MacBook' })
  })

  test('cancelling is final', async () => {
    const { cookie } = await login(base, 'deny@example.com')
    const start = await (await fetch(`${base}/api/device/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', boxPub: key(), signPub: key() }) })).json() as any
    await fetch(`${base}/link`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ code: start.userCode, decision: 'deny' }) })
    const res = await fetch(`${base}/api/device/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: start.deviceCode }) })
    expect(res.status).toBe(403)
  })

  test('bad keys are refused', async () => {
    const res = await fetch(`${base}/api/device/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', boxPub: 'nope', signPub: key() }) })
    expect(res.status).toBe(400)
  })
})

describe('directory', () => {
  test('an invite makes two people contacts, both ways', async () => {
    const a = await login(base, 'finn@example.com', { name: 'Finn' })
    const b = await login(base, 'maya@example.com', { name: 'Maya' })
    const dev = await linkDevice(base, b.cookie, 'Maya’s Mac')

    // Before: not contacts, so Maya's devices are hidden from Finn.
    expect((await fetch(`${base}/api/users/${b.user.id}/devices`, { headers: { cookie: a.cookie } })).status).toBe(403)

    const inv = await (await fetch(`${base}/api/invites`, { method: 'POST', headers: { cookie: a.cookie, origin: base } })).json() as any
    expect(inv.url).toBe(`${base}/i/${inv.code}`)
    // The invite page works for the invitee.
    expect(await (await fetch(inv.url, { headers: { cookie: b.cookie } })).text()).toContain('Finn invited you')
    const acc = await fetch(`${base}/api/invites/${inv.code}/accept`, { method: 'POST', headers: { cookie: b.cookie, origin: base } })
    expect(acc.status).toBe(200)
    expect((await acc.json() as any).user.id).toBe(a.user.id)

    const ca = await (await fetch(`${base}/api/contacts`, { headers: { cookie: a.cookie } })).json() as any[]
    const cb = await (await fetch(`${base}/api/contacts`, { headers: { cookie: b.cookie } })).json() as any[]
    expect(ca.map((c) => c.user.id)).toEqual([b.user.id])
    expect(cb.map((c) => c.user.id)).toEqual([a.user.id])
    expect(ca[0].relationship).toEqual({ relation: null, tags: [], notes: null })

    // Now Finn sees Maya's Mac and its keys.
    const devs = await (await fetch(`${base}/api/users/${b.user.id}/devices`, { headers: { cookie: a.cookie } })).json() as any[]
    expect(devs).toHaveLength(1)
    expect(devs[0]).toMatchObject({ deviceId: dev.deviceId, name: 'Maya’s Mac' })
    expect(devs[0].boxPub).toBeString()

    // The relationship is Finn's private view.
    const put = await fetch(`${base}/api/relationships/${b.user.id}`, {
      method: 'PUT', headers: { cookie: a.cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ relation: 'cohort-mate', tags: ['ef'], notes: 'demo Thursday' }),
    })
    expect(await put.json()).toEqual({ relation: 'cohort-mate', tags: ['ef'], notes: 'demo Thursday' })
    const cb2 = await (await fetch(`${base}/api/contacts`, { headers: { cookie: b.cookie } })).json() as any[]
    expect(cb2[0].relationship.relation).toBeNull()
  })

  test('your own invite does nothing', async () => {
    const a = await login(base, 'solo@example.com')
    const inv = await (await fetch(`${base}/api/invites`, { method: 'POST', headers: { cookie: a.cookie } })).json() as any
    expect((await fetch(`${base}/api/invites/${inv.code}/accept`, { method: 'POST', headers: { cookie: a.cookie } })).status).toBe(400)
  })

  test('cookie writes from another site are refused', async () => {
    const a = await login(base, 'csrf@example.com')
    expect((await fetch(`${base}/api/invites`, { method: 'POST', headers: { cookie: a.cookie, origin: 'https://evil.example' } })).status).toBe(401)
  })

  test('Workspace teammates are suggested, and can be added', async () => {
    const a = await login(base, 'one@acme.com', { domain: 'acme.com' })
    const b = await login(base, 'two@acme.com', { domain: 'acme.com' })
    const c = await login(base, 'three@other.com', { domain: 'other.com' })
    const sug = await (await fetch(`${base}/api/suggestions`, { headers: { cookie: a.cookie } })).json() as any[]
    expect(sug.map((x) => x.user.id)).toEqual([b.user.id])
    expect((await fetch(`${base}/api/contacts/${c.user.id}`, { method: 'POST', headers: { cookie: a.cookie } })).status).toBe(403)
    expect((await fetch(`${base}/api/contacts/${b.user.id}`, { method: 'POST', headers: { cookie: a.cookie } })).status).toBe(200)
    expect(await (await fetch(`${base}/api/suggestions`, { headers: { cookie: a.cookie } })).json()).toEqual([])
    const cb = await (await fetch(`${base}/api/contacts`, { headers: { cookie: b.cookie } })).json() as any[]
    expect(cb.map((x) => x.user.id)).toEqual([a.user.id])
  })

  test('befriend helper works', async () => {
    const a = await login(base, 'h1@example.com'), b = await login(base, 'h2@example.com')
    await befriend(base, a, b)
    expect((await (await fetch(`${base}/api/contacts`, { headers: { cookie: b.cookie } })).json() as any[]).length).toBe(1)
  })
})

describe('static', () => {
  test('healthz, install.sh, dl', async () => {
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: true })
    const sh = await fetch(`${base}/install.sh`)
    expect(sh.status).toBe(200)
    expect(await sh.text()).toStartWith('#!/bin/sh')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(`${s.dataDir}/dl`, { recursive: true })
    writeFileSync(`${s.dataDir}/dl/yap-darwin-arm64`, 'binary')
    expect(await (await fetch(`${base}/dl/yap-darwin-arm64`)).text()).toBe('binary')
    expect((await fetch(`${base}/dl/..%2Fserver.db`)).status).toBe(404)
  })
})
