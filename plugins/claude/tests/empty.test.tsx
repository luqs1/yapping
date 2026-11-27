import { expect, mock, test } from 'claude-code/testing'
const EMPTY = { seq: 1, me: 'le5', users: { le5: { id: 'le5', name: 'Luqmaan Ahmed', color: '#E8590C', status: 'online', clients: [] } }, bridges: {}, chats: [], messages: {}, assists: {} }
const PANE = { plugin: 'yapping', component: 'Pane', requestId: 'yapping', props: { title: 'Chats', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
test('an empty inbox still draws, with an invite', async ($, on) => {
  mock.clock(on)
  on('http.fetch', (_: unknown, e: any) => { const req = JSON.parse(e.init.body); const result = req.method === 'state' ? EMPTY : { seq: 1, events: [] }; return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ result }) } } })
  on('fs.read', () => ({ value: 'tok' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('command.register', () => ({ value: { command: 'yap' } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__yapping__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text' })).toBeDefined()
})
