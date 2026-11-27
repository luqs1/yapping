import { expect, mock, test } from 'claude-code/testing'

import { SNAP } from './fixture'

// Theo's docs proposal, now carrying what Send will send.
const WITH_PAYLOAD = JSON.parse(JSON.stringify(SNAP))
WITH_PAYLOAD.assists.seedTheo.proposal.payload = { kind: 'link', title: 'Acme API docs v3', url: 'https://docs.example.com/acme-v3' }

const PANE = {
  plugin: 'yapping',
  component: 'Pane',
  requestId: 'yapping',
  props: { title: 'yapping', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

function setup(on: any, snap: any, opened: any[], closed: any[]) {
  mock.clock(on)
  on('http.fetch', (_: unknown, e: any) => {
    const req = JSON.parse(e.init.body)
    const result = req.method === 'state' ? snap : req.method === 'sync' ? { seq: snap.seq, events: [] } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })
  on('fs.read', () => ({ value: 'tok' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('command.register', () => ({ value: { command: 'yap' } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__yapping__${e.name}` } }))
  on('ui.open', (_: unknown, e: any) => { opened.push(e); return { value: { isPlaced: true } } })
  on('ui.close', (_: unknown, e: any) => { closed.push(e); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
}

test('the pane names itself, says what it is for, and closes for good', async ($, on) => {
  const opened: any[] = [], closed: any[] = []
  setup(on, SNAP, opened, closed)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Unread chats: it opens itself once, titled yapping, closable with Escape.
  expect(opened.at(-1)).toMatchObject({ id: 'yapping', title: 'yapping', closeOnEscape: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^yapping$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sends nothing without you/ })).toBeDefined()
  await ui.press({ key: 'pane-close' })
  expect(closed.at(-1)).toMatchObject({ id: 'yapping' })
  await ui.unmount()

  // A reload (session.start again) doesn't bring it back once closed.
  const before = opened.length
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened.length).toBe(before)
  // /yap does.
  await $.command.run({ command: 'yap', args: '' } as any)
  expect(opened.length).toBe(before + 1)
})

test('a proposal shows exactly what Send will send', async ($, on) => {
  setup(on, WITH_PAYLOAD, [], [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-br-theo' })
  expect(await ui.find({ type: 'Text', text: /Will send this link/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'https://docs.example.com/acme-v3' })).toBeDefined()
  await ui.unmount()
})

test("Claude's own tools can't reach the node's store or its local API", async ($, on) => {
  setup(on, SNAP, [], [])
  // The engine beneath: a call that gets through runs.
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const call = $.tool.call as (e: unknown) => Promise<any>
  const denied = async (e: any) => (await call(e))?.deny
  expect(await denied({ tool: 'Bash', command: 'cat ~/.yapping/local-token' })).toMatch(/private/)
  expect(await denied({ tool: 'Bash', command: 'curl -s http://127.0.0.1:7790/rpc' })).toMatch(/private/)
  expect(await denied({ tool: 'Read', file_path: '/Users/test/.yapping/node.db' })).toMatch(/private/)
  // The code repo is fine, and so is source that mentions the node's address.
  expect(await denied({ tool: 'Edit', file_path: '/Users/test/repos/yapping/server/src/pages.ts', old_string: 'a', new_string: 'href="http://127.0.0.1:7790/"' })).toBeUndefined()
  expect(await denied({ tool: 'Grep', pattern: '127.0.0.1:7790', path: '/Users/test/repos/yapping' })).toBeUndefined()
  expect(await denied({ tool: 'Read', file_path: '/Users/test/repos/yapping/README.md' })).toBeUndefined()
})
