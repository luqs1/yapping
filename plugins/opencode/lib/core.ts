// Shared by the server plugin (agent tools) and the TUI plugin (sidebar/route).
// Talks to the yapping node on this Mac (its local API) by default, or to the
// demo relay when YAP_RELAY is set, and folds events with the same reducer
// every yapping client uses (lib/sim.js is a copy of shared/sim.js so the
// plugin folder is self-contained).

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
// @ts-ignore -- plain ESM, no types
import { applyEvent, helpers, HARNESSES, BRIDGES } from "./sim.js"

export { applyEvent, helpers, HARNESSES, BRIDGES }

/** Inside opencode, "your agent" is opencode. */
export const LOCAL = "opencode"

export type Attachment = { type: "link" | "file" | "event"; title: string; subtitle?: string; url?: string }
export type Msg = {
  id: string
  chatId: string
  from: string
  kind: "text" | "attachment" | "system"
  text: string
  ts: number
  via?: string
  reactions?: Record<string, string[]>
  replyTo?: string
  attachment?: Attachment
  assistedBy?: string
}
export type Chat = {
  id: string
  kind: "dm" | "group"
  title: string
  transport: string
  members: string[]
  pinned?: boolean
  unread?: Record<string, number>
  sees?: Record<string, boolean>
}
export type Assist = {
  id: string
  chatId: string
  msgId: string
  owner: string
  agents: { owner: string; harness: string }[]
  state: "reading" | "waiting" | "talking" | "working" | "ready" | "done" | "dismissed"
  line: string
  proposal?: { label: string; detail?: string; action: string }
  log: { who: "mine" | "them"; text: string; at: number }[]
  startedAt: number
}
export type State = {
  seq: number
  me: string
  users: Record<string, any>
  chats: Chat[]
  messages: Record<string, Msg[]>
  assists: Record<string, Assist>
  insights: Record<string, any>
  bridges: Record<string, any>
  harnesses: Record<string, any>
  typing?: Record<string, Record<string, number>>
}

export type YapOptions = { relay?: string; user?: string; node?: string; home?: string }

export function settings(options: YapOptions = {}) {
  const relay = (options.relay || process.env.YAP_RELAY || "").replace(/\/$/, "")
  const user = options.user || process.env.YAP_USER || "luqmaan"
  return { relay, user }
}

/** A socket-shaped live feed, so the TUI doesn't care which one it has. */
export type Feed = { onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void; close(): void }

/** The relay when asked for (YAP_RELAY or `relay`), else this Mac's yapping node. */
export function relayClient(options: YapOptions = {}) {
  return settings(options).relay ? relayOnly(options) : nodeClient(options)
}

// The relay speaks sim.js actions; the node speaks RPC with the same shapes.
function toRpc(a: Record<string, any>): [string, Record<string, unknown>] | null {
  switch (a.t) {
    case "send": return ["send", { chat: a.chatId, text: a.text, ...(a.replyTo ? { replyTo: a.replyTo } : {}), ...(a.agent ? { agent: true } : {}) }]
    case "read": return ["mark_read", { chat: a.chatId }]
    case "react": return ["react", { chat: a.chatId, msgId: a.msgId, emoji: a.emoji }]
    case "typing": return ["typing", { chat: a.chatId }]
    case "set_sees": return ["set_sees", { chat: a.chatId, on: !!a.on }]
    case "approve": return ["approve", { id: a.assistId }]
    case "dismiss": return ["dismiss", { id: a.assistId }]
    case "invite_p2p": return ["invite", {}]
    default: return null
  }
}

export function nodeClient(options: YapOptions = {}) {
  const home = options.home || process.env.YAP_HOME || join(homedir(), ".yapping")
  const read = (f: string) => { try { return readFileSync(join(home, f), "utf8") } catch { return "" } }
  let port = 7790
  try { port = Number(JSON.parse(read("api.json")).port) || 7790 } catch {}
  const node = (options.node || process.env.YAP_NODE || `http://127.0.0.1:${port}`).replace(/\/$/, "")
  const token = () => read("local-token").trim()
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${node}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-yap-token": token() },
      body: JSON.stringify({ method, params: { ...params, harness: LOCAL } }),
    })
    const out: any = await res.json().catch(() => ({}))
    if (!res.ok || out?.error) throw new Error(out?.error?.message || `yapping node → HTTP ${res.status}`)
    return out.result
  }
  // A snapshot, then the node's events from its seq: delivered like socket messages.
  const connect = (): Feed => {
    const ctl = new AbortController()
    const feed: Feed = { close: () => { ctl.abort(); feed.onclose?.() } }
    ;(async () => {
      try {
        const state = await rpc("state")
        state.typing ||= {}
        feed.onopen?.()
        feed.onmessage?.({ data: JSON.stringify({ type: "snapshot", state }) })
        const res = await fetch(`${node}/events?since=${state.seq ?? 0}`, { headers: { "x-yap-token": token() }, signal: ctl.signal })
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ""
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const data = buf.slice(0, i).split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n")
            buf = buf.slice(i + 2)
            if (data) feed.onmessage?.({ data })
          }
        }
      } catch {}
      if (!ctl.signal.aborted) { ctl.abort(); feed.onclose?.() }
    })()
    return feed
  }
  return {
    relay: `yapping on this Mac (${node})`,
    user: "",
    connect,
    snapshot: async (): Promise<State> => { const s = await rpc("state"); s.typing ||= {}; return s },
    action: async (action: Record<string, unknown>) => {
      const call = toRpc(action)
      if (!call) return { error: `${String(action.t)} isn't something the node does` }
      return rpc(call[0], call[1])
    },
    presence: async (_status: "online" | "offline", _client = LOCAL) => ({ ok: true }), // the node keeps its own presence
  }
}

function relayOnly(options: YapOptions = {}) {
  const { relay, user } = settings(options)
  const q = `user=${encodeURIComponent(user)}`
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${relay}${path}`, init)
    if (!res.ok) throw new Error(`yapping relay ${path} → HTTP ${res.status}`)
    return res.json()
  }
  const post = (path: string, body: unknown) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return {
    relay,
    user,
    connect: (client: string): Feed => new WebSocket(`${relay.replace(/^http/, "ws")}/ws?${q}&client=${encodeURIComponent(client)}`) as unknown as Feed,
    snapshot: (): Promise<State> => call(`/api/snapshot?${q}`),
    action: (action: Record<string, unknown>) => post(`/api/action?${q}`, action),
    presence: (status: "online" | "offline", client = LOCAL) => post(`/api/presence?${q}`, { status, client }),
  }
}

// ── naming ────────────────────────────────────────────────────────────────

export function name(state: State, id: string) {
  if (id === state.me) return "you"
  return state.users[id]?.name || id
}

export function chatTitle(state: State, chat: Chat): string {
  return helpers.chatTitle(state, chat)
}

export function unread(state: State, chat: Chat) {
  return chat.unread?.[state.me] || 0
}

export function sees(state: State, chat: Chat) {
  return helpers.canSee(state, chat) as boolean
}

export function bridgeName(transport: string) {
  return transport === "yap" ? "" : (BRIDGES as any)[transport]?.name || transport
}

export function bridgeNote(transport: string): string {
  return (BRIDGES as any)[transport]?.note || ""
}

/** The harness shown for an agent: your own agent is the harness you're in. */
export function harnessOf(state: State, agent: { owner: string; harness: string }) {
  return agent.owner === state.me ? LOCAL : agent.harness
}

export function harnessName(harness: string) {
  return (HARNESSES as any)[harness]?.name || harness
}

/** "Your opencode" / "Finn's opencode" */
export function agentLabel(state: State, a: Assist, who: "mine" | "them") {
  if (who === "mine") return `Your ${LOCAL}`
  const them = a.agents.find((x) => x.owner !== state.me)
  return them ? `${state.users[them.owner]?.name}'s ${harnessName(them.harness)}` : "Their agent"
}

export function presence(state: State, chat: Chat) {
  if (chat.kind !== "dm") return `${chat.members.length} people`
  const other = helpers.otherPerson(state, chat)
  if (!other) return ""
  if (other.bridge) return `on ${bridgeName(other.bridge)}`
  // A real node may not know which harness someone is in yet: say what we know.
  if (!other.harness) return other.status === "online" ? "online" : "away"
  const h = harnessName(other.harness)
  return other.status === "online" ? `in ${h}` : `away · usually ${h}`
}

/** Resolve "Finn", "dm-finn", "cohort", "mum" … to a chat. */
export function resolveChat(state: State, query: string): Chat | undefined {
  const q = query.trim().toLowerCase().replace(/^@/, "")
  if (!q) return undefined
  const rows = state.chats.map((c) => ({ c, keys: [c.id, c.title, chatTitle(state, c)].map((k) => k.toLowerCase()) }))
  return (
    rows.find((r) => r.keys.includes(q))?.c ||
    rows.find((r) => r.keys.some((k) => k.startsWith(q)))?.c ||
    rows.find((r) => r.keys.some((k) => k.includes(q)))?.c ||
    state.chats.find((c) => c.members.some((m) => m !== state.me && state.users[m]?.name?.toLowerCase() === q))
  )
}

export function sortedChats(state: State) {
  return [...state.chats].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1
    const la = helpers.lastMessage(state, a.id)?.ts || 0
    const lb = helpers.lastMessage(state, b.id)?.ts || 0
    return lb - la
  })
}

// ── messages and assists ─────────────────────────────────────────────────

const ICON: Record<string, string> = { link: "🔗", file: "📎", event: "📅" }

export function attachmentLine(a: Attachment) {
  return `${ICON[a.type] ?? "📎"} ${a.title}${a.subtitle ? ` · ${a.subtitle}` : ""}`
}

export function messageText(state: State, m: Msg) {
  if (m.kind === "attachment" && m.attachment) return attachmentLine(m.attachment)
  return m.text
}

export function assistFor(state: State, msgId: string): Assist | undefined {
  return helpers.assistFor(state, msgId)
}

export function pending(state: State, chatId?: string): Assist[] {
  return helpers.pending(state, chatId)
}

export function busy(state: State, chatId?: string): Assist[] {
  return helpers.busy(state, chatId)
}

export function time(ts: number) {
  return helpers.time(ts)
}

export function totalUnread(state: State | undefined) {
  if (!state) return 0
  return state.chats.reduce((n, c) => n + unread(state, c), 0)
}
