// Which bridges this node has. None yet: the WhatsApp sidecar is next phase.
// The `bridge` RPC goes through here, so wiring one in is one line below.

import type { Bridge, Network } from './types'

export type { Bridge, BridgeStatus, BridgedMessage, Network } from './types'

export const NETWORKS: Network[] = ['whatsapp', 'slack']

export function createBridges(): Map<Network, Bridge> {
  const bridges = new Map<Network, Bridge>()
  // bridges.set('whatsapp', whatsappBridge({ home }))  ← next phase
  return bridges
}

// Plain English for "this bridge doesn't exist yet".
export function notSetUp(network: string) {
  const name = network === 'whatsapp' ? 'WhatsApp' : network === 'slack' ? 'Slack' : network
  return { code: 'not_set_up', message: `${name} bridging isn't set up yet.` }
}
