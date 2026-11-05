// Linking this Mac to a yapping account (the device-code flow).
//
//   1. POST /api/device/start {name, boxPub, signPub} → {deviceCode, userCode, verifyUrl}
//   2. open verifyUrl; the person signs in (Clerk) and clicks "Link this Mac"
//   3. POST /api/device/poll {deviceCode} until {deviceToken, deviceId, user}
//      (428 authorization_pending while we wait; 403/410/400 are final)
//
// beginLogin() starts a flow and polls in the background; the node uses it
// to sign in on first run with nobody at a terminal. login() is the same
// thing, waited on, for `yap login`.

import { loadKeys, publicKeys } from './crypto'
import { deviceName, loadConfig, saveConfig, type Config } from './paths'
import { serverApi, ServerError } from './server-api'

export type LoginOpts = {
  home: string
  openUrl?: (url: string) => void
  say?: (line: string) => void
  intervalMs?: number
  timeoutMs?: number
}

export type PendingLogin = {
  verifyUrl: string
  userCode: string
  expiresAt: number
  done: Promise<Config> // resolves once linked (config.json is saved by then)
  cancel: () => void
}

export function openInBrowser(url: string) {
  // Tests and headless runs say YAP_NO_BROWSER=1.
  if (process.env.YAP_NO_BROWSER) return
  try { Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' }) } catch {}
}

// Ask the server for a sign-in link and start waiting for approval.
export async function beginLogin(o: Omit<LoginOpts, 'openUrl' | 'say'>): Promise<PendingLogin> {
  const keys = loadKeys(o.home)
  const cfg = loadConfig(o.home)
  const api = serverApi(cfg.server)
  const name = cfg.deviceName || deviceName()
  const start = await api.deviceStart({ name, ...publicKeys(keys) })

  const every = o.intervalMs ?? Math.max(1000, (start.interval || 2) * 1000)
  const expiresAt = Date.now() + (o.timeoutMs ?? (start.expiresIn ? start.expiresIn * 1000 : 10 * 60_000))
  let cancelled = false

  const done = (async () => {
    while (Date.now() < expiresAt) {
      await Bun.sleep(every)
      if (cancelled) throw new Error('Sign-in was cancelled.')
      let res
      try {
        res = await api.devicePoll(start.deviceCode)
      } catch (e) {
        const err = e as ServerError & { data?: any }
        const code = err.data?.error
        if (err.status === 428 || code === 'authorization_pending' || code === 'slow_down') continue
        if (code === 'access_denied') throw new Error('Sign-in was declined.')
        if (code === 'expired_token') throw new Error('That sign-in link expired.')
        // The server or the network hiccuped: keep waiting.
        if (!(err instanceof ServerError) || err.status >= 500) continue
        throw e
      }
      if (!res.deviceToken || !res.user) continue // pending, said politely
      // Re-read: something else may have changed config.json meanwhile.
      const now = loadConfig(o.home)
      const next: Config = { ...now, server: cfg.server, deviceName: name, deviceToken: res.deviceToken, deviceId: res.deviceId ?? now.deviceId, user: res.user }
      saveConfig(o.home, next)
      return next
    }
    throw new Error('Timed out waiting for you to approve this Mac.')
  })()
  done.catch(() => {}) // callers that don't wait shouldn't see an unhandled rejection

  return { verifyUrl: start.verifyUrl, userCode: start.userCode, expiresAt, done, cancel: () => { cancelled = true } }
}

// `yap login`: open the link and wait.
export async function login(o: LoginOpts): Promise<Config> {
  const say = o.say || ((l) => console.log(l))
  const p = await beginLogin(o)
  say(`Opening ${p.verifyUrl}`)
  say(`If the page asks, your code is ${p.userCode}`)
  ;(o.openUrl || openInBrowser)(p.verifyUrl)
  return p.done
}

export function logout(home: string) {
  const cfg = loadConfig(home)
  delete cfg.deviceToken
  delete cfg.deviceId
  delete cfg.user
  saveConfig(home, cfg)
}
