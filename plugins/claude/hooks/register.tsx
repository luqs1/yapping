// yapping for Claude Code: a messenger in the side pane. People text people;
// Claude shows up only as a small chibi under a message it is handling, in
// chats you let it see, and nothing it prepares is sent until you say so.
// Drawn in the host's own colours so it reads as part of Claude.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assist, Chat, Msg, Payload, Snap, User, View } from '../types'
import { chibi } from './chibi'

const PANE = 'yapping'
const snapA = atom({ plugin: 'yapping', key: 'snap' } as const, null, { shape: 'snap-2' })
const viewA = atom({ plugin: 'yapping', key: 'view' } as const, { chat: null, open: [], band: null }, { shape: 'view-2' })
const tickA = atom({ plugin: 'yapping', key: 'tick' } as const, 0)
const liveA = atom({ plugin: 'yapping', key: 'live' } as const, false)
// The person closed the pane: it stays closed this session until /yap.
const closedA = atom({ plugin: 'yapping', key: 'closed' } as const, false)
// The node's home (~/.yapping: messages, keys, the local API token) and its
// local API port. ~/repos/yapping (no dot) is code, not data, and stays open.
const PRIVATE_PATH = /(^|[\s"'=/~])\.yapping(\/|\b)|local-token|node\.db/
// The node's local API ports (7790 and the next few it falls back to); the demo
// relay on 7788 holds no one's real chats and stays open.
const NODE_URL = /https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):779\d\b/
const TAGLINE ='Chat with people here. Claude helps only in chats you switch on, and sends nothing without you.'

const ACTIVE = ['reading', 'waiting', 'talking', 'working']
const ATTACH_ICON: Record<string, string> = { link: '🔗', file: '📄', event: '📅' }
// Each bridged network wears its own colour, so it's never mistaken for ours.
const NET_COLOR: Record<string, string> = { whatsapp: '#1FA855', slack: '#611F69', imessage: '#2F9E44', telegram: '#229ED9' }

type $ = EngineInterface

let base = 'http://127.0.0.1:7790'
let home = ''
let token = ''
let me = ''
let seq = 0
let busy = false

// The node on this Mac holds the messages; its local API is gated by a
// token it writes to ~/.yapping/local-token.
// The node may not be on its usual port (another app can hold 7790); it says
// which one in ~/.yapping/api.json. An explicit `node` option wins.
let pinned = false
async function nodeToken($: $) {
  if (token) return token
  const dir = home || `${(await $.env.get('HOME')) ?? ''}/.yapping`
  token = (await $.fs.read(`${dir}/local-token`)).trim()
  if (!pinned) {
    const port = await $.fs.read(`${dir}/api.json`).then((t) => Number(JSON.parse(t).port)).catch(() => 0)
    if (port > 0) base = `http://127.0.0.1:${port}`
  }
  return token
}

async function rpc($: $, method: string, params: Record<string, unknown> = {}) {
  const r = await $.http.fetch(`${base}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yap-token': await nodeToken($) },
    body: JSON.stringify({ method, params: { ...params, harness: 'claude' } }),
  })
  const out = JSON.parse(r.text || '{}')
  if (!r.ok || out.error) throw new Error(out.error?.message ?? `node ${r.status}`)
  return out.result
}

function trim(s: any): Snap {
  return {
    me: s.me,
    seq: s.seq,
    users: s.users,
    chats: s.chats,
    messages: Object.fromEntries(Object.entries(s.messages as Record<string, Msg[]>).map(([k, v]) => [k, v.slice(-40)])),
    assists: Object.values(s.assists as Record<string, Assist>),
    bridges: s.bridges,
  }
}

const unreadOf = (snap: Snap) => snap.chats.reduce((n, c) => n + (c.unread?.[snap.me] ?? 0), 0)
const readyOf = (snap: Snap) => snap.assists.filter(a => a.state === 'ready')

async function refresh($: $) {
  const snap = trim(await rpc($, 'state'))
  me = snap.me
  seq = snap.seq
  await update($, snapA, () => snap)
  await update($, liveA, () => true)
  const unread = unreadOf(snap)
  const ready = readyOf(snap).length
  const parts = [unread ? `${unread} unread` : '', ready ? `${ready} waiting for you` : ''].filter(Boolean)
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
  return snap
}

// New messages from people raise the reply band; proposals stay in the pane.
async function poll($: $) {
  if (busy) return
  busy = true
  try {
    const out = await rpc($, 'sync', { since: seq })
    const events: any[] = out.reset ? [] : out.events ?? []
    for (const ev of events) {
      if (ev.type === 'message' && ev.message.from !== me && ev.message.kind === 'text') {
        await update($, viewA, v => ({ ...v, band: ev.message.id }))
      }
    }
    if (out.reset || events.length) await refresh($)
    else await update($, liveA, () => true)
  } catch {
    token = ''
    await update($, liveA, () => false)
  } finally {
    busy = false
  }
}

// A press while the node is down says so instead of throwing.
async function offlineNotice($: $) {
  await update($, liveA, () => false)
  $.ui.toast("yapping isn't running on this Mac, so that didn't go through")
}

async function send($: $, chatId: string, text: string) {
  try {
    await rpc($, 'send', { chat: chatId, text })
    await refresh($)
  } catch {
    await offlineNotice($)
  }
}

async function act($: $, method: string, params: Record<string, unknown>) {
  try {
    await rpc($, method, params)
    await refresh($)
  } catch {
    await offlineNotice($)
  }
}

async function select($: $, chatId: string | null) {
  await update($, viewA, v => ({ ...v, chat: chatId, band: chatId ? null : v.band }))
  if (chatId) await rpc($, 'mark_read', { chat: chatId }).catch(() => {})
  await refresh($).catch(() => {})
}

// An invite link to send the person, copied for pasting into their app.
async function invite($: $, surface: 'terminal' | 'desktop') {
  try {
    const out = await rpc($, 'invite', {})
    const url = String(out?.url ?? out)
    await $.ui.copy({ text: url, surface }).catch(() => {})
    $.ui.toast(`Invite link copied: ${url}`)
  } catch {
    await offlineNotice($)
  }
}

// A tool's answer: the node's reply as JSON, or its refusal in words.
async function answer($: $, method: string, params: Record<string, unknown>) {
  try {
    return { result: JSON.stringify(await rpc($, method, params), null, 1) }
  } catch (err) {
    return { result: `yapping: ${(err as Error).message}` }
  }
}

// Contacts on yapping you have no DM with yet: tapping one starts it.
function people(snap: Snap): User[] {
  const withDm = new Set(snap.chats.filter(c => c.kind === 'dm').flatMap(c => c.members))
  return Object.values(snap.users)
    .filter(u => u.id !== snap.me && !u.bridge && !withDm.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// The node makes (or finds) the DM; the pane then opens it on the composer.
async function startChat($: $, userId: string) {
  try {
    const out = await rpc($, 'create_chat', { members: [userId] })
    await select($, out?.chat?.id ?? null)
  } catch {
    await offlineNotice($)
  }
}

async function toggle($: $, id: string) {
  await update($, viewA, v => ({ ...v, open: v.open.includes(id) ? v.open.filter(x => x !== id) : [...v.open, id] }))
}

async function openPane($: $, chatId?: string) {
  if (chatId) await select($, chatId)
  await update($, closedA, () => false)
  await $.ui.open({ id: PANE, title: 'yapping', focus: true, closeOnEscape: true, columns: 52 })
}

async function closePane($: $) {
  await update($, closedA, () => true)
  await $.ui.close({ id: PANE }).catch(() => {})
}

function resolveChat(snap: Snap | null, q: string): Chat | undefined {
  if (!snap) return
  const s = q.toLowerCase().replace(/^[#@]/, '')
  return snap.chats.find(c => c.id === q) ?? snap.chats.find(c => c.title.toLowerCase() === s) ?? snap.chats.find(c => c.title.toLowerCase().includes(s))
}

const other = (snap: Snap, chat: Chat): User | undefined => snap.users[chat.members.find(id => id !== snap.me) ?? '']
const sees = (snap: Snap, chat: Chat) => !!chat.sees?.[snap.me]
const bridgeName = (snap: Snap, t: string) => snap.bridges[t]?.name ?? t
const time = (ts: number) => new Date(ts).toTimeString().slice(0, 5)

export const register: Register = (on, options) => {
  pinned = !!options.node && options.node !== 'http://127.0.0.1:7790'
  base = String(options.node || 'http://127.0.0.1:7790').replace(/\/$/, '')
  home = String(options.home ?? '')

  // ── lifecycle ────────────────────────────────────────────────────────
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'yap', description: 'Open your chats', argumentHint: '[person]' })
    await $.tool.register({
      name: 'yap_inbox',
      description: "List the user's chats: who, which network (yapping, WhatsApp, Slack), unread counts, the latest message in chats the user lets you see, and anything you've proposed that's waiting for them.",
      isDeferred: false,
    })
    await $.tool.register({
      name: 'yap_read',
      description: 'Read recent messages of one chat. `chat` is a chat id or a person\'s name. Only works for chats the user has let you see; otherwise tell them they can switch it on in the chat header.',
      inputSchema: { type: 'object', properties: { chat: { type: 'string' }, limit: { type: 'number' } }, required: ['chat'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'yap_send',
      description: "Send a message as the user. Only when the user asked you to message someone, and send exactly the words they gave you (fix nothing, add nothing): messages between people stay human.",
      inputSchema: { type: 'object', properties: { chat: { type: 'string' }, text: { type: 'string' } }, required: ['chat', 'text'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'yap_propose',
      description: 'Offer to send something for the user in a chat you can see (a link, a file, an invite, a short text they dictated). It appears under the message in their sidebar with Send / Not now; nothing goes out until they press Send. `label` is the question, e.g. "Send Finn the demo link?".',
      inputSchema: {
        type: 'object',
        properties: {
          chat: { type: 'string' },
          msgId: { type: 'string', description: 'the message this is about (optional)' },
          label: { type: 'string' },
          detail: { type: 'string' },
          action: { type: 'string', description: 'button text, e.g. "Send"' },
          payload: { type: 'object', description: '{kind:"text"|"link"|"file"|"event", text?, title?, subtitle?, url?}' },
        },
        required: ['chat', 'label', 'payload'],
      },
      isDeferred: false,
    })
    const snap = await refresh($).catch(() => { void update($, liveA, () => false); return null })
    $.clock.every(1500, () => void poll($))
    $.clock.every(400, async () => {
      const snap = await read($, snapA)
      if (snap?.assists.some(a => ACTIVE.includes(a.state))) await update($, tickA, t => (t + 1) % 1000)
    })
    // Open on its own only when something is waiting, and never once the
    // person has closed it this session (a reload runs this again).
    if (snap && (unreadOf(snap) || readyOf(snap).length) && !(await read($, closedA))) {
      void $.ui.open({ id: PANE, title: 'yapping', closeOnEscape: true, columns: 52 })
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, closedA, () => true)
    return next(e)
  })

  on('command.run', { command: 'yap' }, async ($, e) => {
    const chat = e.args ? resolveChat(await read($, snapA), String(e.args).trim()) : undefined
    await openPane($, chat?.id)
    return { text: chat ? `Opened ${chat.title}` : 'Opened your chats' }
  })

  // ── tools for Claude: all answered by the node, which enforces "sees" ──
  on('tool.call', { tool: 'mcp__yapping__yap_inbox' }, async $ => answer($, 'inbox', {}))
  on('tool.call', { tool: 'mcp__yapping__yap_read' }, async ($, e) => {
    const input = e as unknown as { chat: string; limit?: number }
    return answer($, 'read', { chat: input.chat, limit: input.limit ?? 15 })
  })
  on('tool.call', { tool: 'mcp__yapping__yap_send' }, async ($, e) => {
    const input = e as unknown as { chat: string; text: string }
    const out = await answer($, 'send', { chat: input.chat, text: input.text, agent: true })
    await refresh($).catch(() => {})
    return out
  })
  on('tool.call', { tool: 'mcp__yapping__yap_propose' }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const { tool, tool_use_id, ...params } = input
    const out = await answer($, 'propose', { action: 'Send', ...params })
    await refresh($).catch(() => {})
    return out
  })

  // ── keep Claude's own tools out of the node's store ─────────────────
  // "Hidden from Claude" means more than the yap_* tools refusing: Claude's
  // shell and file tools mustn't reach the messages, keys or local API token
  // behind them either. A best-effort wall, not a sandbox.
  // Only where a call reaches (a path, a shell command), never what it
  // writes: source code that mentions the node's address is fine.
  const DENY = { deny: "yapping: your chats on this Mac are private. Use the yap_* tools, which only open chats the person has let Claude see." }
  on('tool.call', { tool: 'Bash' }, async ($, e, next) =>
    PRIVATE_PATH.test(e.command) || NODE_URL.test(e.command) ? DENY : next(e))
  for (const tool of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const where = e as unknown as { file_path?: string; path?: string; notebook_path?: string; pattern?: string }
      const paths = [where.file_path, where.path, where.notebook_path, tool === 'Glob' ? where.pattern : undefined]
      return paths.some(p => typeof p === 'string' && PRIVATE_PATH.test(p)) ? DENY : next(e)
    })
  }

  // ── the reply band above the prompt: new messages from people only ──
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapA)
    if (!snap || e.props.hasSurvey) return next(e)
    const view = await read($, viewA)
    const m = view.band ? Object.values(snap.messages).flat().find(x => x.id === view.band) : undefined
    if (!m) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const chat = snap.chats.find(c => c.id === m.chatId)
    const via = chat && chat.transport !== 'yap' ? ` on ${bridgeName(snap, chat.transport)}` : ''
    return (
      <Box flexDirection="row" gap={1}>
        <Text bold>{snap.users[m.from]?.name}{via}</Text>
        <Text wrap="truncate-end">{m.text}</Text>
        <Button key="band-reply" label="Reply" variant="primary" onPress={() => openPane($, m.chatId)} />
        <Button key="band-hide" label="×" plain onPress={() => update($, viewA, v => ({ ...v, band: null }))} />
      </Box>
    )
  })

  // ── the terminal's hint line under the prompt: an unread count ──────
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const snap = await read($, snapA)
    const n = snap ? unreadOf(snap) : 0
    return n ? next({ ...e, props: { ...e.props, tail: `· ${n} unread · /yap` } }) : next(e)
  })

  // ── the pane ────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapA)
    const view = await read($, viewA)
    const tick = await read($, tickA)
    const live = await read($, liveA)
    const els = $.ui.resolve(e) as any
    const ctx: Ctx = { els, snap, view, tick, live, isTerminal: e.surface === 'terminal', hasSvg: e.surface !== 'terminal' && !!els.Svg }
    const chat = snap && view.chat ? snap.chats.find(c => c.id === view.chat) : undefined
    const body = !snap ? offline(ctx) : chat ? conversation($, ctx, snap, chat) : inbox($, ctx, snap)
    return frame($, ctx, body, !chat)
  })
}

type Ctx = { els: any; snap: Snap | null; view: View; tick: number; live: boolean; isTerminal: boolean; hasSvg: boolean }

// A person's round avatar: their initial on their colour.
function avatar(u: User | undefined, size = 30) {
  const r = size / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="${u?.color ?? '#868E96'}"/><text x="${r}" y="${r + size * 0.17}" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="${size * 0.46}" font-weight="600" fill="#fff">${(u?.name ?? '?').slice(0, 1)}</text></svg>`
}

// The terminal's chibi: the spark with a face, its eyes moving with the tick.
function glyph(state: string, tick: number) {
  const eyes = state === 'reading' ? ['•‿• ', ' •‿•'][tick % 2] : state === 'talking' ? ['°o° ', ' °o°'][tick % 2] : state === 'ready' ? '•ᴗ•!' : state === 'done' ? '^‿^ ' : '•‿• '
  return `✳${eyes}`
}

// The pane's own header: the app draws no title for a lone pane, so name it,
// say what it is for, and give it a way out.
function frame($: $, ctx: Ctx, body: any, withTagline: boolean) {
  const { Box, Text, Button } = ctx.els
  return (
    <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'sm'}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color="claude" bold>✳</Text>
        <Box flexGrow={1} flexShrink={1}><Text bold>yapping</Text></Box>
        <Button key="pane-close" label="×" plain onPress={() => closePane($)} />
      </Box>
      {withTagline ? <Text dimColor>{TAGLINE}</Text> : null}
      {body}
    </Box>
  )
}

function offline(ctx: Ctx) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text bold>yapping isn't running on this Mac</Text>
      <Text dimColor>Start it, and sign in if you haven't yet:</Text>
      <Text color="claude">yap service install</Text>
      <Text color="claude">yap login</Text>
    </Box>
  )
}

// Exactly what Send will send, so nothing goes out unseen.
function preview(ctx: Ctx, p: Payload | undefined) {
  const { Box, Text } = ctx.els
  if (!p) return null
  const lines =
    p.kind === 'text' ? [p.text ?? ''] :
    p.kind === 'link' ? [p.title ?? '', p.url ?? ''] :
    [p.title ?? '', p.subtitle ?? '']
  const shown = lines.filter(Boolean)
  if (!shown.length) return null
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="inactive">
      <Text dimColor>{p.kind === 'text' ? 'Will send' : `Will send this ${p.kind}`}</Text>
      {shown.map((l, i) => <Text key={`pv-${i}`} bold={i === 0 && p.kind !== 'text'}>{l}</Text>)}
    </Box>
  )
}

function inbox($: $, ctx: Ctx, snap: Snap) {
  const { Box, Text, Button, Svg } = ctx.els
  const chats = [...snap.chats].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (snap.messages[b.id]?.at(-1)?.ts ?? 0) - (snap.messages[a.id]?.at(-1)?.ts ?? 0))
  const fresh = people(snap)
  // No chats and no one to start one with: an empty tree counts as not drawn,
  // so say so and offer an invite.
  if (!chats.length && !fresh.length) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold>No chats yet</Text>
        <Text dimColor>Invite someone and your chat with them shows up here.</Text>
        <Button key="invite-first" label="Copy an invite link" variant="primary" onPress={() => invite($, ctx.isTerminal ? 'terminal' : 'desktop')} />
        {ctx.live ? null : <Text dimColor>offline: showing what you had</Text>}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'xs'}>
      {fresh.length ? (
        <Box key="people" flexDirection="column" gap={ctx.isTerminal ? 0 : 'xs'}>
          <Text dimColor bold>{chats.length ? 'Start a chat' : 'Start a chat with'}</Text>
          {fresh.map(u => (
            <Box key={`person-${u.id}`} flexDirection="row" gap={1} alignItems="center">
              {ctx.hasSvg ? <Svg source={avatar(u, 34)} alt={u.name} width={34} height={34} /> : null}
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Button key={`start-${u.id}`} plain onPress={() => startChat($, u.id)}>
                  <Text bold>{u.name}</Text>
                  <Text dimColor>  {u.status === 'online' ? 'online' : 'away'}</Text>
                </Button>
                <Text dimColor wrap="truncate-end">{u.handle ?? ''}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      {chats.map(c => {
        const last = snap.messages[c.id]?.filter(m => m.kind !== 'system').at(-1)
        const n = c.unread?.[snap.me] ?? 0
        const who = c.kind === 'dm' ? other(snap, c) : undefined
        const ready = snap.assists.find(a => a.chatId === c.id && a.state === 'ready')
        const preview = last ? `${last.from === snap.me ? 'You: ' : c.kind === 'group' ? `${snap.users[last.from]?.name}: ` : ''}${last.text || last.attachment?.title || ''}` : ''
        return (
          <Box key={`row-${c.id}`} flexDirection="row" gap={1} alignItems="center">
            {ctx.hasSvg ? <Svg source={avatar(who ?? { id: c.id, name: c.title, color: '#495057' }, 34)} alt={c.title} width={34} height={34} /> : null}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Button key={`chat-${c.id}`} plain onPress={() => select($, c.id)}>
                <Text bold={n > 0}>{c.title}</Text>
                {c.transport !== 'yap' ? <Text color="#FFFFFF" backgroundColor={NET_COLOR[c.transport] ?? '#495057'} bold>{` ${bridgeName(snap, c.transport)} `}</Text> : ''}
                <Text dimColor>  {last ? time(last.ts) : ''}</Text>
                {n ? <Text color="claude" bold>  {String(n)}</Text> : ''}
              </Button>
              <Text dimColor wrap="truncate-end">{ready ? `✳ ${ready.proposal?.label}` : preview}</Text>
            </Box>
          </Box>
        )
      })}
      {ctx.live ? null : <Text dimColor>offline: showing what you had</Text>}
    </Box>
  )
}

function conversation($: $, ctx: Ctx, snap: Snap, chat: Chat) {
  const { Box, Text, Button, Input, Svg } = ctx.els
  const who = chat.kind === 'dm' ? other(snap, chat) : undefined
  const seen = sees(snap, chat)
  const msgs = (snap.messages[chat.id] ?? []).slice(-16)
  const bridge = chat.transport !== 'yap' ? snap.bridges[chat.transport] : undefined
  const net = chat.transport !== 'yap' ? bridgeName(snap, chat.transport) : ''
  const presence = net ? `on ${net}${who?.handle ? ` · ${who.handle}` : ''}` : who ? (who.status === 'online' ? `in ${who.harness ?? 'yapping'}` : 'away') : `${chat.members.length} people`

  return (
    <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'sm'}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="back" label="‹" plain onPress={() => select($, null)} />
        {ctx.hasSvg ? <Svg source={avatar(who ?? { id: chat.id, name: chat.title, color: '#495057' }, 30)} alt={chat.title} width={30} height={30} /> : null}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text bold>{chat.title}</Text>
          {net ? <Text color={NET_COLOR[chat.transport]} bold>{presence}</Text> : <Text dimColor>{presence}</Text>}
        </Box>
        <Button key="sees" plain onPress={() => act($, 'set_sees', { chat: chat.id, on: !seen })}>
          <Text color={seen ? 'claude' : undefined} dimColor={!seen}>{seen ? '✳ Claude can see this chat' : '○ Hidden from Claude'}</Text>
        </Button>
      </Box>

      <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'sm'}>
        {msgs.map(m => message($, ctx, snap, chat, m, seen, m.id === msgs.at(-1)?.id))}
      </Box>

      {bridge?.note ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{bridge.note}</Text>
          <Button key="invite" plain onPress={() => invite($, ctx.isTerminal ? 'terminal' : 'desktop')}><Text color="claude">Invite to yapping</Text></Button>
        </Box>
      ) : null}
      {Input ? <Input key={`compose-${chat.id}`} placeholder={`Message ${who?.name ?? chat.title}${net ? ` on ${net}` : ''}`} submitLabel="Send" onSubmit={(v: string) => v.trim() && send($, chat.id, v)} /> : null}
    </Box>
  )
}

function message($: $, ctx: Ctx, snap: Snap, chat: Chat, m: Msg, seen: boolean, isLast: boolean) {
  const { Box, Text } = ctx.els
  if (m.kind === 'system') {
    return <Box key={`m-${m.id}`} justifyContent="center"><Text dimColor italic>{m.text}</Text></Box>
  }
  const mine = m.from === snap.me
  const u = snap.users[m.from]
  const reacts = Object.entries(m.reactions ?? {}).map(([k, v]) => `${k} ${v.length}`).join('  ')
  const body =
    m.kind === 'attachment' && m.attachment ? (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="promptBorder">
        <Text bold>{ATTACH_ICON[m.attachment.type] ?? '📎'} {m.attachment.title}</Text>
        {m.attachment.subtitle ? <Text dimColor>{m.attachment.subtitle}</Text> : null}
      </Box>
    ) : (
      <Box paddingX={1} borderStyle="round" borderColor={mine ? 'claude' : 'promptBorder'}>
        <Text>{m.text}</Text>
      </Box>
    )
  const found = seen ? latestAssist(snap, m.id) : undefined
  // A glance that found nothing to do only lingers under the newest message.
  const assist = found && found.state === 'done' && !found.log.length && !isLast ? undefined : found
  return (
    <Box key={`m-${m.id}`} flexDirection="column" alignItems={mine ? 'flex-end' : 'flex-start'}>
      {chat.kind === 'group' && !mine ? <Text bold color={u?.color}>{u?.name}</Text> : null}
      {body}
      <Text dimColor>
        {time(m.ts)}
        {m.assistedBy ? ' · sent with Claude' : ''}
        {reacts ? `   ${reacts}` : ''}
      </Text>
      {assist ? assistRow($, ctx, snap, assist, mine) : null}
    </Box>
  )
}

function latestAssist(snap: Snap, msgId: string) {
  return snap.assists.filter(a => a.msgId === msgId && a.state !== 'dismissed').sort((a, b) => b.startedAt - a.startedAt)[0]
}

// Under a message: the chibi (two while the agents talk), what it's doing,
// and, when something is ready, the two quiet buttons. Pressing the line
// opens what Claude has been up to.
function assistRow($: $, ctx: Ctx, snap: Snap, a: Assist, mine: boolean) {
  const { Box, Text, Button, Svg } = ctx.els
  const open = ctx.view.open.includes(a.id)
  const state = a.state === 'working' || a.state === 'waiting' ? 'reading' : a.state
  const peer = a.agents[1]
  const peerName = peer ? `${snap.users[peer.owner]?.name}'s ${peer.harness}` : ''
  const marks = ctx.hasSvg ? (
    <Box flexDirection="row">
      <Svg source={chibi(a.agents[0]?.harness ?? 'claude', { state, size: 26 })} alt={`Claude ${a.state}`} width={26} height={26} isInteractive />
      {a.state === 'talking' && peer ? <Svg source={chibi(peer.harness, { state: 'talking', size: 26, turn: 1 })} alt={peerName} width={26} height={26} isInteractive /> : null}
    </Box>
  ) : (
    <Text color="claude">{glyph(a.state, ctx.tick)}{a.state === 'talking' && peer ? ` ${peer.harness === 'opencode' ? '◧' : peer.harness === 'pi' ? 'π' : '◎'}${['°o°', ' °o°'][ctx.tick % 2]}` : ''}</Text>
  )
  return (
    <Box key={`as-${a.id}`} flexDirection="column" alignItems={mine ? 'flex-end' : 'flex-start'}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        {marks}
        <Button key={`obs-${a.id}`} plain onPress={() => toggle($, a.id)}>
          <Text dimColor={a.state !== 'ready'} italic={a.state !== 'ready'}>{a.state === 'ready' ? a.proposal?.label ?? a.line : a.line}{a.log.length ? (open ? ' ▾' : ' ▸') : ''}</Text>
        </Button>
      </Box>
      {a.state === 'ready' && a.proposal ? preview(ctx, a.proposal.payload) : null}
      {a.state === 'ready' && a.proposal ? (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {a.proposal.detail ? <Text dimColor>{a.proposal.detail}</Text> : null}
          <Button key={`ok-${a.id}`} label={a.proposal.action} variant="primary" onPress={() => act($, 'approve', { id: a.id })} />
          <Button key={`no-${a.id}`} label="Not now" onPress={() => act($, 'dismiss', { id: a.id })} />
        </Box>
      ) : null}
      {open ? (
        <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="inactive">
          <Text dimColor>What Claude did here</Text>
          {a.log.map((l, i) => (
            <Text key={`log-${a.id}-${i}`}>
              <Text color={l.who === 'mine' ? 'claude' : undefined} bold>{l.who === 'mine' ? 'Claude' : peerName}</Text>
              <Text> {l.text}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
