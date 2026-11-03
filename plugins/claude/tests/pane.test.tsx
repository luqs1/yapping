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
  on('http.fetch', (_: unknown, e: any) => {
    const url = String(e.url)
    if (e.init?.method === 'POST') sent.push(JSON.parse(e.init.body))
    const body = url.includes('/api/snapshot') ? SNAP : url.includes('/api/events') ? { seq: SNAP.seq, events: [] } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
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

test('the inbox lists people, the bridge, and what Claude has ready', async ($, on) => {
  await start($, on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Finn$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Acme API docs v3\.pdf/ })).toBeDefined()
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
    expect(sent).toContainEqual({ t: 'send', chatId: 'dm-finn', text: 'see you thursday', client: 'claude' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test("Theo's docs can be sent from the band above the prompt", async ($, on) => {
  await start($, on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Send Theo/ })).toBeDefined()
  await band.press({ key: 'band-send' })
  expect(sent).toContainEqual({ t: 'approve', chatId: 'br-theo', assistId: theo.id, client: 'claude' })
  await band.unmount()
})

test('a bridged chat says so quietly, and Claude can be let in or kept out', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-br-mum' })
  expect(await ui.find({ type: 'Text', text: /Hidden from Claude/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Their agent can't join you on WhatsApp/ })).toBeDefined()
  await ui.press({ key: 'sees' })
  expect(sent).toContainEqual({ t: 'set_sees', chatId: 'br-mum', on: true, client: 'claude' })
  await ui.press({ key: 'invite' })
  expect(sent).toContainEqual({ t: 'invite_p2p', chatId: 'br-mum', client: 'claude' })
  await ui.unmount()
})

test('Claude reads, sends and approves through its tools', async ($, on) => {
  await start($, on)
  const inbox = await $.tool.call({ tool: 'mcp__yapping__yap_inbox' } as any)
  expect(String((inbox as any).result)).toContain('ready for approval: Send Theo')
  const hidden = await $.tool.call({ tool: 'mcp__yapping__yap_read', chat: 'Mum' } as any)
  expect(String((hidden as any).result)).toContain("hasn't let Claude see")
  await $.tool.call({ tool: 'mcp__yapping__yap_send', chat: 'Finn', text: 'running 5 late' } as any)
  expect(sent).toContainEqual({ t: 'send', chatId: 'dm-finn', text: 'running 5 late', client: 'claude' })
  await $.tool.call({ tool: 'mcp__yapping__yap_approve', chat: 'Theo' } as any)
  expect(sent).toContainEqual({ t: 'approve', chatId: 'br-theo', assistId: theo.id, client: 'claude' })
})
