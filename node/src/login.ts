// `yap login`: link this Mac to a yapping account (device-code flow).
//
//   1. POST /api/device/start {name, boxPub, signPub} → {deviceCode, userCode, verifyUrl}
//   2. open verifyUrl; the person signs in and approves this device
//   3. POST /api/device/poll {deviceCode} until {deviceToken, deviceId, user}
//      (428 authorization_pending while we wait; 403/410/400 are final)

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

export function openInBrowser(url: string) {
  try { Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' }) } catch {}
}

export async function login(o: LoginOpts): Promise<Config> {
  const say = o.say || ((l) => console.log(l))
  const keys = loadKeys(o.home)
  const cfg = loadConfig(o.home)
  const api = serverApi(cfg.server)
  const name = cfg.deviceName || deviceName()

  const start = await api.deviceStart({ name, ...publicKeys(keys) })
  say(`Opening ${start.verifyUrl}`)
  say(`If the page asks, your code is ${start.userCode}`)
  ;(o.openUrl || openInBrowser)(start.verifyUrl)

  const every = o.intervalMs ?? Math.max(1000, (start.interval || 2) * 1000)
  const deadline = Date.now() + (o.timeoutMs ?? (start.expiresIn ? start.expiresIn * 1000 : 10 * 60_000))
  while (Date.now() < deadline) {
    await Bun.sleep(every)
    let res
    try {
      res = await api.devicePoll(start.deviceCode)
    } catch (e) {
      const err = e as ServerError & { data?: any }
      const code = err.data?.error
      if (err.status === 428 || code === 'authorization_pending' || code === 'slow_down') continue
      if (code === 'access_denied') throw new Error('Sign-in was declined.')
      if (code === 'expired_token') throw new Error('That sign-in link expired. Run `yap login` again.')
      if (err instanceof ServerError && err.status >= 500) continue
      throw e
    }
    if (!res.deviceToken || !res.user) continue // pending, said politely
    const next: Config = { ...cfg, deviceName: name, deviceToken: res.deviceToken, deviceId: res.deviceId ?? cfg.deviceId, user: res.user }
    // The token belongs to this server, so remember which one it was.
    saveConfig(o.home, next)
    return next
  }
  throw new Error('Timed out waiting for you to approve this Mac. Run `yap login` again.')
}

export function logout(home: string) {
  const cfg = loadConfig(home)
  delete cfg.deviceToken
  delete cfg.deviceId
  delete cfg.user
  saveConfig(home, cfg)
}
