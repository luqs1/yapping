import { expect, mock, test } from 'claude-code/testing'

// A fresh account: one contact (Victor), no chats. Once create_chat runs, the
// node's state carries the new DM.
const ME = { id: 'me', name: 'Luqmaan Ahmed', color: '#0B7285', status: 'online', bridge: null, clients: [] }
const VICTOR = { id: 'vic', name: 'Victor', handle: 'victor@example.com', color: '#2F9E44', status: 'online', bridge: null, clients: [] }
const DM = { id: 'dm:me,vic', kind: 'dm', title: 'Victor', transport: 'yap', members: ['me', 'vic'], unread: {}, sees: {} }
const PANE = { plugin: 'yapping', component: 'Pane', requestId: 'yapping', props: { title: 'Chats', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const

test('a contact with no chat yet is listed, and tapping them opens a chat to type in', async ($, on) => {
  const sent: any[] = []
  let made = false
  mock.clock(on)
  on('http.fetch', (_: unknown, e: any) => {
    const req = JSON.parse(e.init.body)
    sent.push(req)
    if (req.method === 'create_chat') made = true
    const snap = { seq: 1, me: 'me', users: { me: ME, vic: VICTOR }, bridges: {}, chats: made ? [DM] : [], messages: made ? { [DM.id]: [] } : {}, assists: {} }
    const result = req.method === 'state' ? snap : req.method === 'sync' ? { seq: 1, events: [] } : req.method === 'create_chat' ? { chat: DM } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } }
  })
  on('fs.read', () => ({ value: 'tok' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('command.register', () => ({ value: { command: 'yap' } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__yapping__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Start a chat/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Victor$/ })).toBeDefined()
  await ui.press({ key: 'start-vic' })
  expect(sent.map(r => r.method)).toContain('create_chat')
  expect(sent.find(r => r.method === 'create_chat').params.members).toEqual(['vic'])
  await ui.input({ key: `compose-${DM.id}`, text: 'hey' })
  expect(sent.find(r => r.method === 'send').params).toMatchObject({ chat: DM.id, text: 'hey' })
  await ui.unmount()
})
