// The seam for bridges (WhatsApp first, Slack second).
//
// A bridge carries one outside network's chats into the node. It turns that
// network's messages into ordinary yapping messages on chats whose
// `transport` is the network's name, and sends our replies back out. The
// WhatsApp bridge will be a whatsmeow (Go) sidecar the node starts and talks
// to; none of that exists yet. This file is the contract it will meet.

export type Network = 'whatsapp' | 'slack'

export type BridgeStatus = {
  network: Network
  // 'unlinked' until the person scans the QR code, 'linking' while the
  // sidecar waits for the scan, 'linked' once messages flow.
  status: 'unlinked' | 'linking' | 'linked'
  account?: string // e.g. the WhatsApp phone number, once linked
}

// What a bridge hands the node when something arrives from outside.
export type BridgedMessage = {
  network: Network
  chat: { id: string; kind: 'dm' | 'group'; title: string; members: { id: string; name: string; handle?: string }[] }
  id: string
  from: string // a bridged person's id, or the owner's own user id for messages sent from the phone
  ts: number
  text?: string
  attachment?: { type: 'link' | 'file' | 'event'; title: string; subtitle?: string; url?: string }
}

export interface Bridge {
  readonly network: Network
  status(): Promise<BridgeStatus>
  // Start linking. Returns the raw QR payload the sidebar draws.
  link(): Promise<{ qr: string; expiresAt?: number }>
  unlink(): Promise<void>
  // Send the owner's message into a bridged chat.
  send(chatId: string, text: string, opts?: { replyTo?: string }): Promise<{ id: string; ts: number }>
  // Called for every inbound message; returns an unsubscribe function.
  onMessage(fn: (m: BridgedMessage) => void): () => void
}
