// `yap service install|uninstall`: run `yap daemon` at login with launchd,
// restarted if it ever stops (KeepAlive).

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export const LABEL = 'dev.luqmaan.yapping'
export const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

// How to start ourselves: the compiled binary, or `bun cli.ts` from source.
export function selfCommand(): string[] {
  const exe = process.execPath
  if (basename(exe) === 'bun') return [exe, resolve(Bun.main)]
  return [exe]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function plist(o: { args: string[]; home: string; env?: Record<string, string> }): string {
  const env = Object.entries(o.env || {})
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${o.args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(join(o.home, 'daemon.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(join(o.home, 'daemon.log'))}</string>${
    env.length
      ? `\n  <key>EnvironmentVariables</key>\n  <dict>\n${env.map(([k, v]) => `    <key>${esc(k)}</key><string>${esc(v)}</string>`).join('\n')}\n  </dict>`
      : ''
  }
</dict>
</plist>
`
}

const uid = () => process.getuid?.() ?? 501
const launchctl = (...args: string[]) => Bun.spawnSync(['launchctl', ...args], { stdout: 'pipe', stderr: 'pipe' })

export function installService(home: string) {
  const path = plistPath()
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  const env: Record<string, string> = {}
  for (const k of ['YAP_HOME', 'YAP_SERVER', 'YAP_PORT', 'YAP_AGENT']) if (process.env[k]) env[k] = process.env[k]!
  // Reload cleanly if it was already there.
  if (existsSync(path)) launchctl('bootout', `gui/${uid()}/${LABEL}`)
  writeFileSync(path, plist({ args: [...selfCommand(), 'daemon'], home, env }))
  let r = launchctl('bootstrap', `gui/${uid()}`, path)
  if (r.exitCode !== 0) r = launchctl('load', '-w', path) // older macOS
  if (r.exitCode !== 0) throw new Error(`launchctl couldn't load ${path}: ${r.stderr.toString().trim()}`)
  return path
}

export function uninstallService() {
  const path = plistPath()
  launchctl('bootout', `gui/${uid()}/${LABEL}`)
  if (existsSync(path)) unlinkSync(path)
  return path
}
