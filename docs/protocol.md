# yapping protocol (v0)

Three programs, one contract.

- **server**: Bun on `hetzner-arm`, at `https://yap.luqmaan.dev` via a Cloudflare tunnel. It holds identity, the contact book, relationships, and orchestration (presence, relay, mailbox, and a gateway for chat hosts). It **never holds message content**: what passes through it is end-to-end encrypted.
- **node**: Bun, compiled to one binary, running on each person's Mac as a launchd agent. It holds that person's messages in local SQLite, their device keys and their bridges (WhatsApp first), and serves local clients.
- **ui**: the sidebar, one HTML/JS bundle. It runs as the MCP App inside claude.ai, Cowork, ChatGPT and the ChatGPT/Codex desktop app, and as a local page served by the node.

```
 Claude Code mod ─┐                          ┌─ claude.ai / Cowork / ChatGPT / Codex app
 Codex CLI (MCP) ─┤ http://127.0.0.1:7790     │      │ HTTPS /mcp (OAuth)
 local sidebar ───┤        │                  │      ▼
                  └──►  NODE (Mac) ◄══ wss ══► SERVER ◄══ wss ══► NODE (teammate's Mac)
                        SQLite, keys,  RPC +   auth, contacts,   (E2E envelopes,
                        WhatsApp bridge relay  relay, mailbox,    mailbox when asleep)
                                               gateway
```

## Identity and keys
- **Users** sign in to the server with Google (OIDC), an email magic link, or a passkey (WebAuthn, RP id `yap.luqmaan.dev`). The browser session is an httpOnly cookie.
- **Devices.** Each node generates a NaCl box keypair (X25519) and a signing keypair (Ed25519) on first run and stores them in `~/.yapping/keys.json` (mode 600). Public keys are registered with the server when the device is linked.
- **Linking a device** (`yap login`, a device-code flow):
  1. The node calls `POST /api/device/start {name, boxPub, signPub}` and gets back `{deviceCode, userCode, verifyUrl}`.
  2. The node opens `verifyUrl`. The user signs in and approves.
  3. The node polls `POST /api/device/poll {deviceCode}` until it gets `{deviceToken, user}`.
- **Teams.** Users on the same Google Workspace domain are suggested to each other. Anyone can create an invite link, `POST /api/invites` → `{url}`, and opening it while signed in adds a mutual contact.

## Server HTTP API (JSON; `Authorization: Bearer <deviceToken>` for nodes, cookie for browsers)
- `GET /api/me` → `{user, devices}`
- `GET /api/contacts` → `[{user:{id,name,email,avatar}, relationship}]`
- `PUT /api/relationships/:userId` `{relation?, tags?, notes?}`. This is the owner's private view of the relationship.
- `GET /api/users/:id/devices` → `[{deviceId, boxPub, signPub, name, lastSeen}]`. Only for contacts.
- `POST /api/invites` → `{code, url}`. `POST /api/invites/:code/accept`.

## Node ⇄ server WebSocket: `wss://yap.luqmaan.dev/ws/node` (Bearer deviceToken)
Frames are JSON:
- node → server `{t:'env', to:[deviceId…], env:{from, nonce, box}}`. The server delivers to online devices and puts the rest in the mailbox.
- server → node `{t:'env', from:deviceId, env:{…}}`. The node acks with `{t:'ack', id}`. Mailbox items are deleted on ack.
- server → node `{t:'presence', userId, online}` for contacts.
- server → node `{t:'rpc', id, method, params}`. This is the gateway: a chat host called `/mcp` as this user. The node answers `{t:'rpc_result', id, result}` or `{…, error}`.

An envelope plaintext (`nacl.box` to the recipient device's boxPub, signed inside) is one **event**:
`{v:0, kind:'message'|'reaction'|'read'|'typing', chat:{id, kind:'dm'|'group', members:[userId…], title?}, id, from:userId, ts, text?, attachment?, emoji?, msgId?, assistedBy?, sig}`.
A chat id is `dm:<sortedUserIds>` for DMs and a uuid for groups. Each sender fans out one envelope per member device.

## Chat hosts: `https://yap.luqmaan.dev/mcp` (Streamable HTTP, OAuth 2.1)
- **OAuth:** discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. It supports CIMD (a URL client_id), DCR at `/oauth/register`, PKCE S256, refresh tokens (`offline_access`), and loopback redirects on any port for Codex. The consent page is behind the same sign-in.
- **Tools** each become a gateway RPC to the user's most recently active online node. If the user has none: "Your yapping node is offline. Is your Mac asleep?"
  - model-visible: `yap_inbox`, `yap_read {chat}`, `yap_send {chat, text}` (exact words only), `yap_propose {chat, msgId?, label, detail?, action, payload}`.
  - app-only (`_meta.ui.visibility:['app']`): `yap_sync {since}`, `yap_approve {id}`, `yap_dismiss {id}`, `yap_set_sees {chat, on}`, `yap_react`, `yap_mark_read`, `yap_bridge {op}`.
- **UI resource:** `ui://yapping/sidebar`, `text/html;profile=mcp-app`. `_meta.ui.csp.connectDomains: ['https://yap.luqmaan.dev']`. ChatGPT also gets `openai/ui` entrypoints `[{type:'thread'},{type:'global'}]`. The UI live-updates by calling `yap_sync` every 2s, which works on every host.

## Node RPC (the same methods everywhere)
Locally the methods are `POST http://127.0.0.1:7790/rpc {method, params}` and `GET /events` (SSE), with header `x-yap-token` read from `~/.yapping/local-token`. Remotely they arrive through the gateway.

| method | params → result |
|---|---|
| `state` | → full UI snapshot `{me, users, chats, messages, assists, bridges, seq}` |
| `sync` | `{since}` → `{seq, events}` (UI events: message, message_update, assist, chat_update, presence, bridge) |
| `inbox` | → chats with unread, last message, pending proposals, `sees` |
| `read` | `{chat, limit}` → messages; refused if `sees` is off. A read records a `reading` assist on the newest message, so the agent's chibi glances at it |
| `send` | `{chat, text, replyTo?}`. Routes over our network or the chat's bridge |
| `propose` | `{chat, msgId?, label, detail?, action, payload:{kind:'text'|'link'|'file'|'event', …}}` → assist `ready` |
| `approve` / `dismiss` | `{id}`. Approving sends the payload as the owner's message with `assistedBy` |
| `set_sees` | `{chat, on}` |
| `react`, `mark_read` | as named |
| `bridge` | `{op:'status'|'link'|'unlink', network:'whatsapp'|'slack'}`. `link` returns a QR code payload for WhatsApp |

**UI data shapes** match `shared/sim.js` (chats with `transport`, messages, assists with `state/line/proposal/log`, `sees`) so the mockups' rendering carries over. Bridged chats carry `transport:'whatsapp'|'slack'` and the UI labels them unmistakably.

## Ports and paths
- node local API: `127.0.0.1:7790`
- node data: `~/.yapping/` (`keys.json`, `node.db`, `local-token`, `bridges/`)
- server data: `/var/lib/yapping/server.db`
- install: `curl -fsSL https://yap.luqmaan.dev/install.sh | sh` puts in the node binary and the launchd agent, then opens sign-in.
