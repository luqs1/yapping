// The seam for bridges (WhatsApp first, Slack second).
//
// A bridge carries one outside network's chats into the node. It turns that
// network's messages into ordinary yapping messages on chats whose
// `transport` is the network's name, and sends our replies back out. The
// WhatsApp bridge (./whatsapp.ts) is a whatsmeow (Go) sidecar the node
// starts and talks to over stdio. This file is the contract it meets.

export type Network = 'whatsapp' | 'slack'

export type BridgeStatus = {
  network: Network
  // 'unlinked' until the person scans the QR code, 'linking' while the
  // sidecar waits for the scan, 'linked' once messages flow.
  status: 'unlinked' | 'linking' | 'linked'
  account?: string | null // e.g. the WhatsApp phone number, once linked
  accountName?: string | null // the name on that account, if known
  connected?: boolean // linked and online right now
  warning?: string // what linking risks, shown before the person links
  error?: { code: string; message: string } | null // the last thing that went wrong, if any
  reason?: string // why it became unlinked (e.g. 'logged_out' when the phone removed it)
}

// A person on the other network, as the node keeps them:
// {id:'wa:<jid>', name, handle: phone, bridge: network}.
export type BridgedPerson = { id: string; name: string; handle?: string }

// What a bridge hands the node when something arrives from outside.
export type BridgedMessage = {
  network: Network
  chat: { id: string; kind: 'dm' | 'group'; title: string; members: BridgedPerson[] }
  id: string
  from: string // a bridged person's id; '' when fromMe
  fromMe?: boolean // the owner wrote it (on their phone, or through us)
  sender?: BridgedPerson // who wrote it, for groups where they may be new
  ts: number
  text?: string
  replyTo?: string
  history?: boolean // part of the first import, not a new arrival
  attachment?: { type: 'link' | 'file' | 'event'; title: string; subtitle?: string; url?: string }
}

export interface Bridge {
  readonly network: Network
  status(): Promise<BridgeStatus>
  // The last known status, without asking the sidecar (for `state`).
  current?(): BridgeStatus
  // Start linking. Returns the raw QR payload the sidebar draws, or
  // {status:'linked'} if it already is.
  link(): Promise<{ qr?: string; expiresAt?: number; status?: string; account?: string | null; warning?: string }>
  unlink(): Promise<void>
  // Send the owner's message into a bridged chat.
  send(chatId: string, text: string, opts?: { replyTo?: string }): Promise<{ id: string; ts: number }>
  // Called for every inbound message; returns an unsubscribe function.
  onMessage(fn: (m: BridgedMessage) => void): () => void
  // Called whenever the status (or account) changes.
  onStatus?(fn: (s: BridgeStatus) => void): () => void
  // Begin work if there is a session already; stop everything.
  start?(): void
  stop?(): Promise<void>
}
