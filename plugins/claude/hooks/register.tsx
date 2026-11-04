// yapping for Claude Code: a messenger in the side pane. People text people;
// Claude shows up only as a small chibi under a message it is handling, in
// chats you let it see, and nothing it prepares is sent until you say so.
// Drawn in the host's own colours so it reads as part of Claude.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assist, Chat, Msg, Snap, User, View } from '../types'
import { chibi } from './chibi'

const PANE = 'yapping'
const snapA = atom({ plugin: 'yapping', key: 'snap' } as const, null, { shape: 'snap-2' })
const viewA = atom({ plugin: 'yapping', key: 'view' } as const, { chat: null, open: [], band: null }, { shape: 'view-2' })
const tickA = atom({ plugin: 'yapping', key: 'tick' } as const, 0)
const liveA = atom({ plugin: 'yapping', key: 'live' } as const, false)

const ACTIVE = ['reading', 'waiting', 'talking', 'working']
const ATTACH_ICON: Record<string, string> = { link: '🔗', file: '📄', event: '📅' }

type $ = EngineInterface

let base = 'http://localhost:7788'
let me = 'luqmaan'
let seq = 0
let busy = false

async function fetchJSON($: $, path: string, body?: unknown) {
  const r = await $.http.fetch(`${base}${path}${path.includes('?') ? '&' : '?'}user=${me}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`relay ${r.status}`)
  return JSON.parse(r.text)
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

const unreadOf = (snap: Snap) => snap.chats.reduce((n, c) => n + (c.unread?.[me] ?? 0), 0)
const readyOf = (snap: Snap) => snap.assists.filter(a => a.state === 'ready')

async function refresh($: $) {
  const snap = trim(await fetchJSON($, '/api/snapshot'))
  seq = snap.seq
  await update($, snapA, () => snap)
  await update($, liveA, () => true)
  const unread = unreadOf(snap)
  const ready = readyOf(snap).length
  const parts = [unread ? `${unread} unread` : '', ready ? `Claude has ${ready} ready for you` : ''].filter(Boolean)
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
  return snap
}

async function poll($: $) {
  if (busy) return
  busy = true
  try {
    const { events } = await fetchJSON($, `/api/events?since=${seq}`)
    if (!events.length) return
    const snap = await read($, snapA)
    for (const ev of events) {
      if (ev.type === 'message' && ev.message.from !== me && ev.message.kind === 'text') {
        $.ui.toast(`${snap?.users[ev.message.from]?.name ?? ev.message.from}: ${ev.message.text.slice(0, 80)}`)
        await update($, viewA, v => ({ ...v, band: ev.message.id }))
      }
      if (ev.type === 'assist' && ev.assist.state === 'ready' && !snap?.assists.some(a => a.id === ev.assist.id && a.state === 'ready')) {
        $.ui.toast(ev.assist.proposal?.label ?? 'Claude has something ready')
      }
    }
    await refresh($)
  } catch {
    await update($, liveA, () => false)
  } finally {
    busy = false
  }
}

// A press while the relay is down says so instead of throwing.
async function offlineNotice($: $) {
  await update($, liveA, () => false)
  $.ui.toast("Chats are offline, so that didn't go through")
}

async function send($: $, chatId: string, text: string) {
  try {
    await fetchJSON($, '/api/action', { t: 'send', chatId, text, client: 'claude' })
    await refresh($)
  } catch {
    await offlineNotice($)
  }
}

async function act($: $, action: Record<string, unknown>) {
  try {
    await fetchJSON($, '/api/action', { ...action, client: 'claude' })
    await refresh($)
  } catch {
    await offlineNotice($)
  }
}

async function select($: $, chatId: string | null) {
  await update($, viewA, v => ({ ...v, chat: chatId, band: chatId ? null : v.band }))
  if (chatId) await fetchJSON($, '/api/action', { t: 'read', chatId }).catch(() => {})
  await refresh($).catch(() => {})
}

async function toggle($: $, id: string) {
  await update($, viewA, v => ({ ...v, open: v.open.includes(id) ? v.open.filter(x => x !== id) : [...v.open, id] }))
}

async function openPane($: $, chatId?: string) {
  if (chatId) await select($, chatId)
  await $.ui.open({ id: PANE, title: 'Chats', focus: true, columns: 52 })
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
  base = String(options.relay ?? 'http://localhost:7788').replace(/\/$/, '')
  me = String(options.user ?? 'luqmaan')

  // ── lifecycle ────────────────────────────────────────────────────────
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'yap', description: 'Open your chats', argumentHint: '[person]' })
    await $.tool.register({
      name: 'yap_inbox',
      description: "List the user's chats with unread counts, the latest message in each, and anything you (Claude) have ready for their approval.",
      isDeferred: false,
    })
    await $.tool.register({
      name: 'yap_read',
      description: 'Read recent messages of one chat. `chat` is a chat id or a name like "Finn", "Mum", "fall26 cohort". Only chats the user lets Claude see.',
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
      name: 'yap_approve',
      description: 'Approve something you have ready in a chat (a link, file or invite waiting for the user). Only after the user explicitly says yes to it. `chat` is a chat id or name.',
      inputSchema: { type: 'object', properties: { chat: { type: 'string' } }, required: ['chat'] },
      isDeferred: false,
    })
    await fetchJSON($, '/api/presence', { status: 'online', client: 'claude' }).catch(() => {})
    await refresh($).catch(() => update($, liveA, () => false))
    $.clock.every(1500, () => void poll($))
    $.clock.every(400, async () => {
      const snap = await read($, snapA)
      if (snap?.assists.some(a => ACTIVE.includes(a.state))) await update($, tickA, t => (t + 1) % 1000)
    })
    void $.ui.open({ id: PANE, title: 'Chats', columns: 52 })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await fetchJSON($, '/api/presence', { status: 'offline', client: 'claude' }).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'yap' }, async ($, e) => {
    const chat = e.args ? resolveChat(await read($, snapA), String(e.args).trim()) : undefined
    await openPane($, chat?.id)
    return { text: chat ? `Opened ${chat.title}` : 'Opened your chats' }
  })

  // ── tools for Claude ────────────────────────────────────────────────
  on('tool.call', { tool: 'mcp__yapping__yap_inbox' }, async $ => {
    const snap = await refresh($)
    const lines = snap.chats.map(c => {
      const last = snap.messages[c.id]?.filter(m => m.kind !== 'system').at(-1)
      const n = c.unread?.[me] ?? 0
      const ready = snap.assists.find(a => a.chatId === c.id && a.state === 'ready')
      const seen = sees(snap, c)
      return `${c.id} — ${c.title}${c.transport !== 'yap' ? ` (via ${bridgeName(snap, c.transport)})` : ''}${n ? ` · ${n} unread` : ''}${seen ? '' : ' · hidden from Claude'}${seen && last ? `\n   last: ${snap.users[last.from]?.name}: ${last.text || last.attachment?.title}` : ''}${ready ? `\n   ready for approval: ${ready.proposal?.label}` : ''}`
    })
    return { result: lines.join('\n') }
  })

  on('tool.call', { tool: 'mcp__yapping__yap_read' }, async ($, e) => {
    const input = e as unknown as { chat: string; limit?: number }
    const snap = await refresh($)
    const chat = resolveChat(snap, input.chat)
    if (!chat) return { result: `No chat matches "${input.chat}". Chats: ${snap.chats.map(c => c.title).join(', ')}` }
    if (!sees(snap, chat)) return { result: `The user hasn't let Claude see their chat with ${chat.title}. They can turn it on from the chat header.` }
    const msgs = (snap.messages[chat.id] ?? []).slice(-(input.limit ?? 15))
    return { result: msgs.map(m => `[${time(m.ts)}] ${m.from === 'system' ? '·' : snap.users[m.from]?.name}: ${m.text || `<${m.attachment?.type}: ${m.attachment?.title}>`}`).join('\n') }
  })

  on('tool.call', { tool: 'mcp__yapping__yap_send' }, async ($, e) => {
    const input = e as unknown as { chat: string; text: string }
    const chat = resolveChat(await read($, snapA), input.chat)
    if (!chat) return { result: `No chat matches "${input.chat}".` }
    await send($, chat.id, input.text)
    return { result: `Sent to ${chat.title}.` }
  })

  on('tool.call', { tool: 'mcp__yapping__yap_approve' }, async ($, e) => {
    const input = e as unknown as { chat: string }
    const snap = await refresh($)
    const chat = resolveChat(snap, input.chat)
    const a = chat && snap.assists.find(x => x.chatId === chat.id && x.state === 'ready')
    if (!chat || !a) return { result: `Nothing is waiting for approval${chat ? ` in ${chat.title}` : ''}.` }
    await act($, { t: 'approve', chatId: chat.id, assistId: a.id })
    return { result: `Approved: ${a.proposal?.label}` }
  })

  // ── the band above the prompt ───────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapA)
    if (!snap || e.props.hasSurvey) return next(e)
    const view = await read($, viewA)
    const { Box, Text, Button } = $.ui.resolve(e)
    const ready = readyOf(snap)[0]
    if (ready) {
      const chat = snap.chats.find(c => c.id === ready.chatId)
      return (
        <Box flexDirection="row" gap={1}>
          <Text color="claude" bold>✳ {chat?.title}</Text>
          <Text wrap="truncate-end">{ready.proposal?.label}</Text>
          <Button key="band-send" label={ready.proposal?.action ?? 'Send'} variant="primary" onPress={() => act($, { t: 'approve', chatId: ready.chatId, assistId: ready.id })} />
          <Button key="band-open" label="Open" onPress={() => openPane($, ready.chatId)} />
          <Button key="band-skip" label="×" plain onPress={() => act($, { t: 'dismiss', chatId: ready.chatId, assistId: ready.id })} />
        </Box>
      )
    }
    const m = view.band ? Object.values(snap.messages).flat().find(x => x.id === view.band) : undefined
    if (!m) return next(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text bold>{snap.users[m.from]?.name}</Text>
        <Text wrap="truncate-end">{m.text}</Text>
        <Button key="band-reply" label="Reply" variant="primary" onPress={() => openPane($, m.chatId)} />
        <Button key="band-hide" label="×" plain onPress={() => update($, viewA, v => ({ ...v, band: null }))} />
      </Box>
    )
  })

  // ── the pane ────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapA)
    const view = await read($, viewA)
    const tick = await read($, tickA)
    const live = await read($, liveA)
    const els = $.ui.resolve(e) as any
    const ctx: Ctx = { els, snap, view, tick, live, isTerminal: e.surface === 'terminal', hasSvg: e.surface !== 'terminal' && !!els.Svg }
    if (!snap) return offline(ctx)
    const chat = view.chat ? snap.chats.find(c => c.id === view.chat) : undefined
    return chat ? conversation($, ctx, snap, chat) : inbox($, ctx, snap)
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

function offline(ctx: Ctx) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text bold>Chats are offline</Text>
      <Text dimColor>Start the relay and they'll come back:</Text>
      <Text color="claude">bun ~/repos/yapping/relay/server.ts</Text>
    </Box>
  )
}

function inbox($: $, ctx: Ctx, snap: Snap) {
  const { Box, Text, Button, Svg } = ctx.els
  const chats = [...snap.chats].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (snap.messages[b.id]?.at(-1)?.ts ?? 0) - (snap.messages[a.id]?.at(-1)?.ts ?? 0))
  return (
    <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'xs'}>
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
                {c.transport !== 'yap' ? <Text dimColor>  {bridgeName(snap, c.transport)}</Text> : ''}
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
  const presence = who ? (who.bridge ? `on ${bridgeName(snap, chat.transport)}` : who.status === 'online' ? `in ${who.harness ?? 'yapping'}` : 'away') : `${chat.members.length} people`

  return (
    <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'sm'}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="back" label="‹" plain onPress={() => select($, null)} />
        {ctx.hasSvg ? <Svg source={avatar(who ?? { id: chat.id, name: chat.title, color: '#495057' }, 30)} alt={chat.title} width={30} height={30} /> : null}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text bold>{chat.title}</Text>
          <Text dimColor>{presence}</Text>
        </Box>
        <Button key="sees" plain onPress={() => act($, { t: 'set_sees', chatId: chat.id, on: !seen })}>
          <Text color={seen ? 'claude' : undefined} dimColor={!seen}>{seen ? '✳ Claude can see this chat' : '○ Hidden from Claude'}</Text>
        </Button>
      </Box>

      <Box flexDirection="column" gap={ctx.isTerminal ? 0 : 'sm'}>
        {msgs.map(m => message($, ctx, snap, chat, m, seen, m.id === msgs.at(-1)?.id))}
      </Box>

      {bridge?.note ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>via {bridge.name}. {bridge.note}</Text>
          <Button key="invite" plain onPress={() => act($, { t: 'invite_p2p', chatId: chat.id })}><Text color="claude">Invite to yapping</Text></Button>
        </Box>
      ) : null}
      {Input ? <Input key={`compose-${chat.id}`} placeholder={`Message ${who?.name ?? chat.title}`} submitLabel="Send" onSubmit={(v: string) => v.trim() && send($, chat.id, v)} /> : null}
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
      {a.state === 'ready' && a.proposal ? (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {a.proposal.detail ? <Text dimColor>{a.proposal.detail}</Text> : null}
          <Button key={`ok-${a.id}`} label={a.proposal.action} variant="primary" onPress={() => act($, { t: 'approve', chatId: a.chatId, assistId: a.id })} />
          <Button key={`no-${a.id}`} label="Not now" onPress={() => act($, { t: 'dismiss', chatId: a.chatId, assistId: a.id })} />
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
