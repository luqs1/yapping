# yapping server

The hosted half of yapping, at `https://yap.luqmaan.dev`. It holds identity
(users, sessions, linked Macs and their public keys), the contact book, and
orchestration: presence, relaying end-to-end-encrypted envelopes between
nodes, a mailbox for Macs that are asleep, and the gateway that turns a chat
host's `/mcp` call into an RPC to the person's own node. It never sees
message text. The contract is [`docs/protocol.md`](../docs/protocol.md).

Bun + TypeScript, one SQLite file (`$YAP_DATA/server.db`), no build step.

## Run it

```sh
cd server
bun install
YAP_DEV=1 bun run src/index.ts       # http://localhost:8787
bun test                              # starts real servers on random ports
```

With `YAP_DEV=1`, `/dev/login?email=you@example.com` signs you in with no
checks, and sign-in links are printed to stdout when `RESEND_API_KEY` is
unset.

## Environment

| Variable | Default | |
|---|---|---|
| `YAP_ORIGIN` | `http://localhost:$PORT` | The public URL. Every absolute URL (OAuth issuer, MCP resource, links, passkey RP id and origin) comes from this, never from the request. Set it to `https://yap.luqmaan.dev` in production. |
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` | Loopback only: cloudflared fronts it. |
| `YAP_DATA` | `/var/lib/yapping` (`server/.data` in dev) | `server.db` and `dl/` (binaries served at `/dl/*`). |
| `YAP_DEV` | unset | `1` opens `/dev/login`, allows plain-http CIMD documents on loopback, logs MCP errors. Never in production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Google sign-in. The button is hidden when unset. Redirect URI: `$YAP_ORIGIN/auth/google/callback`. |
| `RESEND_API_KEY` | unset | Email sign-in links. When unset, links go to stdout. |
| `YAP_MAIL_FROM` | `yapping <hello@yap.luqmaan.dev>` | The sender, on a domain verified in Resend. |
| `YAP_UI_DIST` | `../ui/dist/sidebar.html` | The sidebar bundle served as `ui://yapping/sidebar`. Read on every request, so a rebuild needs no restart. A placeholder is served if it's missing. |
| `YAP_RPC_TIMEOUT_MS` | `20000` | How long the gateway waits for a node. |

## Deploy (hetzner-arm)

Cloudflare tunnel → `http://127.0.0.1:8787`.

```sh
sudo useradd --system --home /var/lib/yapping --shell /usr/sbin/nologin yapping
sudo mkdir -p /opt/yapping /var/lib/yapping/dl /etc/yapping
sudo chown yapping:yapping /var/lib/yapping
# put the repo's server/ (and ui/dist/) under /opt/yapping, then:
cd /opt/yapping/server && sudo -u yapping /usr/local/bin/bun install --production
sudo cp deploy/env.example /etc/yapping/env && sudo chmod 600 /etc/yapping/env   # fill it in
sudo cp deploy/yapping.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now yapping
curl -s localhost:8787/healthz
```

Node binaries go in `/var/lib/yapping/dl/` and are served at `/dl/<name>`.
`public/install.sh` is served at `/install.sh`.

## What's where

| | |
|---|---|
| `src/index.ts` | entry point |
| `src/app.ts` | every route, one `Bun.serve` |
| `src/config.ts` | environment |
| `src/db.ts` | schema |
| `src/users.ts` | users, sessions, device tokens, contacts |
| `src/auth.ts` | sign-in page, Google, email links, passkeys, `/dev/login`, account page |
| `src/device.ts` | `yap login`'s device-code flow and the `/link` page |
| `src/directory.ts` | `/api/me`, contacts, suggestions, relationships, devices, invites |
| `src/hub.ts` | `/ws/node`: presence, relay + mailbox, gateway RPC |
| `src/oauth.ts` | OAuth 2.1 authorization server for chat hosts |
| `src/mcp.ts` | `/mcp`: tools, the sidebar resource |
| `src/pages.ts` | the HTML look |

## Wire details beyond `docs/protocol.md`

- **`/api/device/poll`:**
  - `428 {error:'authorization_pending'}` while waiting;
  - `200 {deviceToken, deviceId, user}` exactly once;
  - `403 access_denied` and `410 expired_token` are final.
- **`/ws/node` frames:**
  - Server → node envelopes carry the mailbox id, `{t:'env', id, from, env}`, and the node acks that `id`. Every envelope is stored first and pushed if the device is online, so anything unacked comes back on the next connect. Nodes should dedupe by event id.
  - The server overwrites `env.from` with the sending socket's device.
  - Envelopes go only to your own devices or your contacts' devices. Anything else gets `{t:'error', code:'not_allowed', to}`.
  - On connect, the node gets `{t:'presence'}` for every contact, then its mailbox.
  - Extra frames: `{t:'contact_added', user}` and `{t:'ping'}` → `{t:'pong'}`.
- **Gateway RPC:**
  - `{t:'rpc', id, method, params, via:{client, harness}}`.
  - `send`, `propose` and `approve` also get `params.harness` (`claude`, `chatgpt` or `codex`) when the OAuth client is recognisable.
- **MCP results:**
  - `structuredContent` is the node's result. Arrays come back as `{items}` and scalars as `{value}`, because MCP requires an object.
  - `yap_sync {since:0}` calls the node's `state` and returns `{seq, state}`.
- **Extra directory routes:**
  - `GET /api/suggestions` lists same-Workspace-domain users who aren't contacts yet.
  - `POST /api/contacts/:userId` adds one of them as a mutual contact, same domain only.
