# Build plan: the plain sidebar, for real (Claude + ChatGPT/Codex)

Scope: the interface and installation. Teammates who both have yapping, chatting on our network, with WhatsApp (then Slack) bridged in and clearly labelled. Dynamic agent permissions come later; for now an agent sees a chat only if its owner switches it on.

## What each surface gets

| Surface | UI | Docked? | Install |
|---|---|---|---|
| Claude Code terminal | Mod pane + hint-line count under the prompt | Yes (pane) | `/plugin marketplace add <repo>` → install → `/yap login` |
| Claude Code desktop | Same mod, drawn in the right-hand pane area | Yes (pane; whether it gets an icon in the top-right row is to be tested, the API has no icon hook) | Same plugin |
| claude.ai chat + Cowork (web, desktop) | MCP App: compact inbox card, fullscreen chat | No (card scrolls away) | Customize › Connectors › Add custom connector › paste URL; Team/Enterprise: owner adds, members Connect. Optional Claude plugin bundling the connector + a skill |
| ChatGPT Work chats + desktop app (incl. former Codex app) | Same MCP App, plus right-side **thread panel** and **global sidebar** entrypoints | Yes (panel) | Business: admin adds the app; Enterprise/Edu: admin or granted role. Directory listing later unlocks Plus+ |
| ChatGPT non-Work chats | Inline card + fullscreen | No | As above |
| Codex CLI | Tools only + `SessionStart`/`UserPromptSubmit` hooks injecting unread counts; a `yap` terminal client for a tmux split | Via tmux split | `codex mcp add`-style `[mcp_servers.yapping] url=…` + `codex mcp login` |

ChatGPT plan reality (see `surfaces-and-install.md`): Business/Enterprise/Edu get everything; Pro gets read-only custom tools; Plus write access unconfirmed (test); Free/Go can't add custom servers.

## Pieces

1. **Server on `hetzner-arm`** (cax31, Ubuntu 26.04, Bun under systemd, SQLite):
   - accounts and teams, joined by invite link;
   - our network's messaging (WebSocket + HTTP, history in SQLite);
   - OAuth 2.1 (PKCE, CIMD first, DCR fallback, refresh tokens, loopback redirects for Codex);
   - remote MCP at `/mcp`: model tools `yap_inbox`, `yap_read`, `yap_send` (exact words), `yap_propose`; app-only tools `approve`, `dismiss`, `set_sees`; resource `ui://yapping/sidebar`.
2. **One sidebar UI** (the plain Claude-desktop mockup, tightened), used by the MCP App and as a web page:
   - It adapts to inline, fullscreen and panel layouts.
   - Proposals live **only** inside it, never in a band above the prompt or a toast.
   - Bridged chats show an unmistakable network chip in the list, header and composer ("Message Mum on WhatsApp").
3. **Claude Code mod**, rebuilt on the hosted server:
   - device-code sign-in;
   - docked pane;
   - unread count on the terminal hint line;
   - no proposal band or toasts.
4. **Bridges.**
   - **WhatsApp** comes first. It uses whatsmeow, as in `~/repos/whatsapp-mcp`, and links by scanning a QR code inside the sidebar.
   - **Slack** comes second. It uses a user token from an internal Slack app per workspace.
5. **Install polish:** one URL per host, a GitHub marketplace for the Claude plugin, a Codex config snippet, and a test with two real accounts end to end.

## Decisions needed before building

- **Where the WhatsApp bridge runs.**
  - *On the server:* scan a QR code in the sidebar, done. But our box holds each user's WhatsApp session.
  - *On the user's Mac:* a small companion app. Safer, one more install step.
  - Either way it's an unofficial client: WhatsApp's terms forbid it and accounts can be banned.
- **Public HTTPS.**
  - *Tailscale Funnel on hetzner-arm:* no DNS. You enable Funnel for the node in the tailnet policy.
  - *A subdomain such as `yap.luqmaan.dev`:* Caddy on the box.
- **Where the code lives:** a GitHub repo (public or private) for the Claude plugin marketplace and Codex config.

Later: agent-to-agent assists driven by real agents, dynamic permissions, and the peer-to-peer transport.
