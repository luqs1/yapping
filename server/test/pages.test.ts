// The pages people see first: the front page, signing in from an invite,
// the account page, and the files served beside them.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { linkDevice, login, testServer, type TestServer } from './helpers'

// A made-up key whose Frontend API is example.clerk.accounts.dev.
const CLERK = { CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('example.clerk.accounts.dev$')}`, CLERK_SECRET_KEY: 'sk_test_fake' }
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

let s: TestServer
let base: string
beforeAll(() => { s = testServer(CLERK); base = s.url })
afterAll(() => s.close())

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, { headers, redirect: 'manual' })
  return { res, html: await res.text() }
}

describe('front page', () => {
  test('shows the product, with alt text, and the Mac download', async () => {
    const { html } = await get('/', { 'user-agent': MAC })
    expect(html).toContain('<html lang="en" data-platform="mac">')
    expect(html).toContain('src="/static/claude-desktop.jpg"')
    expect(html).toMatch(/alt="The Claude desktop app with a yapping Chats panel/)
    expect(html).toContain('href="/dl/yapping.mcpb"')
  })

  test('a phone is told to open it on a Mac, and gets the connector URL', async () => {
    const { html } = await get('/', { 'user-agent': IPHONE })
    expect(html).toContain('data-platform="other"')
    expect(html).toContain('yapping runs on your Mac.')
    expect(html).toContain(`${base}/mcp`)
  })

  test('the other places it works say what to install first', async () => {
    const { html } = await get('/')
    expect(html).toContain(`curl -fsSL ${base}/install.sh | sh`)
    expect(html).toContain('/plugin install yapping --marketplace luqs1/yapping')
    expect(html).toContain('codex mcp add yapping -- yap mcp')
  })

  test('the picture is served, and nothing outside static/ is', async () => {
    const img = await fetch(`${base}/static/claude-desktop.jpg`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/jpeg')
    expect((await fetch(`${base}/static/..%2Finstall.sh`)).status).toBe(404)
    expect((await fetch(`${base}/static/nope.jpg`)).status).toBe(404)
  })
})

describe('install.sh', () => {
  test('is the real installer from node/install.sh, not a placeholder', async () => {
    const served = await (await fetch(`${base}/install.sh`)).text()
    expect(served).toBe(readFileSync(join(import.meta.dir, '..', '..', 'node', 'install.sh'), 'utf8'))
    expect(served).toContain('/dl/yap-darwin-')
    expect(served).not.toContain("isn't ready yet")
  })
})

describe('signing in from an invite', () => {
  test('says who sent it, escaped', async () => {
    const inviter = await login(base, 'mallory@example.com', { name: 'Mal <b>Lory</b>' })
    const { url } = await (await fetch(`${base}/api/invites`, { method: 'POST', headers: { cookie: inviter.cookie } })).json() as any
    const path = new URL(url).pathname
    const anon = await get(path)
    expect(anon.res.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(path)}`)
    const { html } = await get(anon.res.headers.get('location')!)
    expect(html).toContain('Mal &lt;b&gt;Lory&lt;/b&gt; invited you to yapping')
    expect(html).not.toContain('<b>Lory</b>')
    expect(html).not.toContain('mallory@example.com')
  })

  test('a bad code says nothing', async () => {
    const { html } = await get(`/signin?next=${encodeURIComponent('/i/not-a-real-code')}`)
    expect(html).toContain('Sign in to yapping')
    expect(html).not.toContain('invited you')
  })
})

describe('account page', () => {
  test('lists contacts newest first, and opens your chats', async () => {
    const ann = await login(base, 'ann@example.com', { name: 'Ann' })
    const bo = await login(base, 'bo@example.com', { name: 'Bo' })
    const cy = await login(base, 'cy@example.com', { name: 'Cy' })
    let page = (await get('/account', { cookie: ann.cookie })).html
    expect(page).toContain('No contacts yet.')
    expect(page).not.toContain('Open my chats') // no Mac yet

    for (const who of [bo, cy]) {
      const { url } = await (await fetch(`${base}/api/invites`, { method: 'POST', headers: { cookie: ann.cookie } })).json() as any
      await fetch(`${base}/api/invites/${new URL(url).pathname.split('/').pop()}/accept`, { method: 'POST', headers: { cookie: who.cookie } })
      await Bun.sleep(5) // distinct created_at
    }
    await linkDevice(base, ann.cookie)
    page = (await get('/account', { cookie: ann.cookie, 'user-agent': MAC })).html
    expect(page).toContain('<h1 style="font-size:18px">Contacts</h1>')
    expect(page.indexOf('<b>Cy</b>')).toBeLessThan(page.indexOf('<b>Bo</b>'))
    expect(page).toContain('Joined')
    expect(page).toContain('No Mac linked yet')
    expect(page).toContain('Open my chats')
    expect(page).toContain('data-copy="yap open"')
  })
})
