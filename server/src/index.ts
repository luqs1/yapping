// yapping server. `bun run src/index.ts`; configuration is all in the
// environment (see README.md).

import { startServer } from './app'

const { ctx, server, stop } = startServer()
const { cfg } = ctx
console.log(`[yapping] listening on http://${cfg.host}:${server.port}, public at ${cfg.origin}`)
console.log(`[yapping] data in ${cfg.dataDir}; Google ${cfg.google ? 'on' : 'off'}; email ${cfg.mail ? 'via Resend' : 'links printed here'}${cfg.dev ? '; DEV MODE (/dev/login is open)' : ''}`)

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await stop()
    process.exit(0)
  })
