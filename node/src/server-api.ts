// The server's HTTP API, from the node's side (docs/protocol.md).
// Nodes authenticate with `Authorization: Bearer <deviceToken>`.

import type { User } from './paths'

export type ServerDevice = { deviceId: string; boxPub: string; signPub: string; name?: string; lastSeen?: number | string }
export type Contact = { user: User; relationship?: Record<string, unknown> }

export class ServerError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function serverApi(base: string, token?: string) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: any
    try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
    if (!res.ok) throw Object.assign(new ServerError(res.status, data?.error?.message || data?.error || `${res.status} ${res.statusText}`), { data })
    return data as T
  }

  return {
    // Device-code sign-in (yap login).
    deviceStart: (b: { name: string; boxPub: string; signPub: string }) =>
      call<{ deviceCode: string; userCode: string; verifyUrl: string; interval?: number; expiresIn?: number }>('POST', '/api/device/start', b),
    devicePoll: (deviceCode: string) =>
      call<{ deviceToken?: string; user?: User; deviceId?: string; pending?: boolean; error?: string }>('POST', '/api/device/poll', { deviceCode }),

    me: () => call<{ user: User; devices: ServerDevice[] }>('GET', '/api/me'),
    contacts: () => call<Contact[]>('GET', '/api/contacts'),
    devices: (userId: string) => call<ServerDevice[]>('GET', `/api/users/${encodeURIComponent(userId)}/devices`),
    invite: () => call<{ code: string; url: string }>('POST', '/api/invites'),
    acceptInvite: (code: string) => call<unknown>('POST', `/api/invites/${encodeURIComponent(code)}/accept`),
  }
}

export type ServerApi = ReturnType<typeof serverApi>

// http(s)://host → ws(s)://host/ws/node
export function wsUrl(base: string) {
  return base.replace(/^http/, 'ws') + '/ws/node'
}
