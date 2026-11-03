// Shared by the server plugin (agent tools) and the TUI plugin (sidebar/route).
// Talks to the yapping relay over plain HTTP/WebSocket and folds events with
// the same reducer every yapping client uses (lib/sim.js is a copy of
// shared/sim.js so the plugin folder is self-contained).

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

export type YapOptions = { relay?: string; user?: string }

export function settings(options: YapOptions = {}) {
  const relay = (options.relay || process.env.YAP_RELAY || "http://localhost:7788").replace(/\/$/, "")
  const user = options.user || process.env.YAP_USER || "luqmaan"
  return { relay, user }
}

export function relayClient(options: YapOptions = {}) {
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
    wsUrl: (client: string) => `${relay.replace(/^http/, "ws")}/ws?${q}&client=${encodeURIComponent(client)}`,
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
