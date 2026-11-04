// Device keys and envelopes.
//
// Each node has two keypairs, made on first run:
//   box  (X25519)  so others can encrypt to this device
//   sign (Ed25519) so others know an event really came from this device
//
// An envelope is one event, signed inside, then boxed to one recipient
// device:  env = { from: senderDeviceId, nonce, box }  (base64).
// The server only ever sees env; the plaintext never leaves the two Macs.

import nacl from 'tweetnacl'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureHome, writePrivate } from './paths'

export type Keys = {
  box: { publicKey: Uint8Array; secretKey: Uint8Array }
  sign: { publicKey: Uint8Array; secretKey: Uint8Array }
}

export type Envelope = { from: string; nonce: string; box: string }

export const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
export const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

// Load ~/.yapping/keys.json, or make it (mode 600) the first time.
export function loadKeys(home: string): Keys {
  ensureHome(home)
  const path = join(home, 'keys.json')
  if (existsSync(path)) {
    const k = JSON.parse(readFileSync(path, 'utf8'))
    return {
      box: { publicKey: unb64(k.box.publicKey), secretKey: unb64(k.box.secretKey) },
      sign: { publicKey: unb64(k.sign.publicKey), secretKey: unb64(k.sign.secretKey) },
    }
  }
  const keys: Keys = { box: nacl.box.keyPair(), sign: nacl.sign.keyPair() }
  const out = {
    v: 0,
    box: { publicKey: b64(keys.box.publicKey), secretKey: b64(keys.box.secretKey) },
    sign: { publicKey: b64(keys.sign.publicKey), secretKey: b64(keys.sign.secretKey) },
  }
  writePrivate(path, JSON.stringify(out, null, 2))
  return keys
}

export const publicKeys = (k: Keys) => ({ boxPub: b64(k.box.publicKey), signPub: b64(k.sign.publicKey) })

// JSON with sorted keys and no undefineds, so both ends sign the same bytes.
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

const utf8 = (s: string) => new TextEncoder().encode(s)

// Sign an event: sig = Ed25519 over canonical(event without sig).
export function signEvent<T extends Record<string, unknown>>(ev: T, keys: Keys): T & { sig: string } {
  const { sig: _drop, ...body } = ev as T & { sig?: string }
  return { ...(body as T), sig: b64(nacl.sign.detached(utf8(canonical(body)), keys.sign.secretKey)) }
}

export function verifyEvent(ev: Record<string, unknown>, signPub: string): boolean {
  const { sig, ...body } = ev
  if (typeof sig !== 'string') return false
  try {
    return nacl.sign.detached.verify(utf8(canonical(body)), unb64(sig), unb64(signPub))
  } catch {
    return false
  }
}

// Box a (signed) event to one device.
export function seal(ev: object, fromDeviceId: string, toBoxPub: string, keys: Keys): Envelope {
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const box = nacl.box(utf8(JSON.stringify(ev)), nonce, unb64(toBoxPub), keys.box.secretKey)
  return { from: fromDeviceId, nonce: b64(nonce), box: b64(box) }
}

// Open an envelope from a device whose boxPub we know. Null if it's not for us.
export function open(env: Envelope, fromBoxPub: string, keys: Keys): Record<string, unknown> | null {
  try {
    const plain = nacl.box.open(unb64(env.box), unb64(env.nonce), unb64(fromBoxPub), keys.box.secretKey)
    if (!plain) return null
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}
