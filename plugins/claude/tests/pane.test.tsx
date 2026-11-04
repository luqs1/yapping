import { expect, mock, test } from 'claude-code/testing'

import { SNAP } from './fixture'

// The fixture: Finn's DM mid-way through the demo flow (Claude talking to
// Finn's opencode) and Theo's request with the docs ready to send.
const PANE = {
  plugin: 'yapping',
  component: 'Pane',
  requestId: 'yapping',
  props: { title: 'Chats', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const BAND = { plugin: 'yapping', component: 'AbovePrompt', props: { hasSurvey: false } } as const

const sent: any[] = []
const theo = Object.values(SNAP.assists).find((a: any) => a.chatId === 'br-theo')!

function relay(on: any) {
  mock.clock(on)
  // The node's local API: /rpc answers by method; state is the fixture.
  on('http.fetch', (_: unknown, e: any) => {
    const req = e.init?.body ? JSON.parse(e.init.body) : {}
    sent.push(req)
    const result = req.method === 'state' ? SNAP : req.method === 'sync' ? { seq: SNAP.seq, events: [] } : req.method === 'invite' ? { url: 'https://yap.luqmaan.dev/i/abc' } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })
  on('fs.read', () => ({ value: 'local-token-for-tests' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('command.register', () => ({ value: { command: 'yap' } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__yapping__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
}

async function start($: any, on: any) {
  sent.length = 0
  relay(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

const call = (method: string, params: Record<string, unknown>) => ({ method, params: { ...params, harness: 'claude' } })

test('the inbox lists people, the bridge, and what Claude has ready', async ($, on) => {
  await start($, on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Finn$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Acme API docs v3\.pdf/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /WhatsApp/ })).toBeDefined()
    await ui.unmount()
  }
})

test('opening Finn shows the chat, the agents talking, and sends human words', async ($, on) => {
  await start($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'chat-dm-finn' })
    expect(await ui.find({ type: 'Text', text: /alt-tab to whatsapp/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Talking to Finn's opencode/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude can see this chat/ })).toBeDefined()
    await ui.input({ key: 'compose-dm-finn', text: 'see you thursday' })
    expect(sent).toContainEqual(call('send', { chat: 'dm-finn', text: 'see you thursday' }))
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test("a proposal lives only in the pane: Theo's docs are approved there, never from the band", async ($, on) => {
  // The engine's own band, beneath the plugin: registered before the session starts.
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await start($, on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Send Theo/ })).toBeUndefined()
  await band.unmount()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-br-theo' })
  await ui.press({ key: `ok-${theo.id}` })
  expect(sent).toContainEqual(call('approve', { id: theo.id }))
  await ui.unmount()
})

test('a bridged chat says which network it is on, and Claude can be let in or kept out', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-br-mum' })
  expect(await ui.find({ type: 'Text', text: /^on WhatsApp/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Hidden from Claude/ })).toBeDefined()
  await ui.press({ key: 'sees' })
  expect(sent).toContainEqual(call('set_sees', { chat: 'br-mum', on: true }))
  await ui.press({ key: 'invite' })
  expect(sent).toContainEqual(call('invite', {}))
  await ui.unmount()
})

test('Claude reads, sends and proposes through the node', async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: 'mcp__yapping__yap_inbox' } as any)
  expect(sent).toContainEqual(call('inbox', {}))
  await $.tool.call({ tool: 'mcp__yapping__yap_read', chat: 'Mum' } as any)
  expect(sent).toContainEqual(call('read', { chat: 'Mum', limit: 15 }))
  await $.tool.call({ tool: 'mcp__yapping__yap_send', chat: 'Finn', text: 'running 5 late' } as any)
  expect(sent).toContainEqual(call('send', { chat: 'Finn', text: 'running 5 late' }))
  await $.tool.call({ tool: 'mcp__yapping__yap_propose', chat: 'Finn', label: 'Send Finn the deck?', payload: { kind: 'file', title: 'deck.pdf' } } as any)
  expect(sent.some(s => s.method === 'propose' && s.params.label === 'Send Finn the deck?')).toBe(true)
})
