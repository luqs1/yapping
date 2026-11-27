export type User = {
  id: string
  name: string
  handle?: string
  color: string
  agent?: string
  harness?: string
  status?: string
  bridge?: string | null
}

// What a proposal sends once the person presses Send.
export type Payload = { kind: 'text' | 'link' | 'file' | 'event'; text?: string; title?: string; subtitle?: string; url?: string }

export type Attachment ={ type: 'link' | 'file' | 'event'; title: string; subtitle?: string; url?: string }

export type Msg = {
  id: string
  chatId: string
  from: string
  kind: 'text' | 'attachment' | 'system'
  text: string
  ts: number
  reactions: Record<string, string[]>
  via?: string
  attachment?: Attachment
  assistedBy?: string
}

export type Chat = {
  id: string
  kind: 'dm' | 'group'
  title: string
  transport: string
  members: string[]
  pinned?: boolean
  unread?: Record<string, number>
  sees?: Record<string, boolean>
}

export type AgentRef = { owner: string; harness: string }

export type Assist = {
  id: string
  chatId: string
  msgId: string
  owner: string
  agents: AgentRef[]
  state: 'reading' | 'waiting' | 'talking' | 'working' | 'ready' | 'done' | 'dismissed'
  line: string
  proposal?: { label: string; detail?: string; action: string; payload?: Payload }
  log: { who: 'mine' | 'them'; text: string; at: number }[]
  startedAt: number
}

export type Snap = {
  me: string
  seq: number
  users: Record<string, User>
  chats: Chat[]
  messages: Record<string, Msg[]>
  assists: Assist[]
  bridges: Record<string, { name: string; note?: string }>
}

export type View = { chat: string | null; open: string[]; band: string | null }

declare module 'claude-code' {
  interface PluginState {
    yapping: {
      snap: Shaped<Snap | null>
      view: Shaped<View>
      tick: number
      live: boolean
      closed: boolean
    }
  }
}
