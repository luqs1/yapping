// Which bridges this node has. WhatsApp, when its sidecar (yap-wa) is
// installed beside `yap` or named by $YAP_WA_BIN; Slack is next.
// The `bridge` RPC goes through here.

import type { Bridge, Network } from './types'
import { whatsappBridge, type WhatsAppOptions } from './whatsapp'

export type { Bridge, BridgeStatus, BridgedMessage, BridgedPerson, Network } from './types'
export { WHATSAPP_WARNING } from './whatsapp'

export const NETWORKS: Network[] = ['whatsapp', 'slack']

export type BridgeOptions = {
  home: string
  log?: (...a: unknown[]) => void
  // false turns WhatsApp off; an object overrides how its sidecar runs.
  whatsapp?: Partial<Omit<WhatsAppOptions, 'home' | 'log'>> | false
}

export function createBridges(opts?: BridgeOptions): Map<Network, Bridge> {
  const bridges = new Map<Network, Bridge>()
  if (opts && opts.whatsapp !== false) {
    const wa = whatsappBridge({ home: opts.home, log: opts.log, ...(opts.whatsapp || {}) })
    if (wa) bridges.set('whatsapp', wa)
  }
  return bridges
}

// Plain English for "this bridge doesn't exist yet".
export function notSetUp(network: string) {
  const name = network === 'whatsapp' ? 'WhatsApp' : network === 'slack' ? 'Slack' : network
  return { code: 'not_set_up', message: `${name} bridging isn't set up yet.` }
}
