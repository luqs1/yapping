# yapping

Chat with your team in a sidebar beside your AI: Claude Code, Claude (chat and
Cowork), ChatGPT, and Codex. People text people. Your AI can help, only in the
chats you let it see, and nothing it prepares is sent until you press Send.

Messages live on each person's Mac, end to end encrypted. The server at
`yap.luqmaan.dev` only does sign-in, the contact book and relationships, and
orchestration: presence, relaying encrypted messages, a sealed mailbox for
Macs that are asleep, and passing chat apps' requests through to your Mac.
WhatsApp is bridged on your own Mac.

## Install

1. On your Mac:

   ```sh
   curl -fsSL https://yap.luqmaan.dev/install.sh | sh
   ```

2. Where you work (any or all):

   - **Claude Code**, in a terminal:

     ```
     /plugin install yapping --marketplace luqs1/yapping
     ```

     then `/yap`. In the desktop app: + next to the prompt › Plugins › Add
     marketplace `luqs1/yapping` › Add yapping.
   - **Claude chat and Cowork**: Settings › Connectors › Add custom connector ›
     `https://yap.luqmaan.dev/mcp`.
   - **ChatGPT and the Codex app**: Settings › Apps › Advanced › Developer mode ›
     Create app › `https://yap.luqmaan.dev/mcp` (on Business/Enterprise an admin
     adds it).
   - **Codex CLI**: `codex mcp add yapping -- yap mcp`

3. Invite your teammate: `yap invite`, or from your account page.

The same steps live at https://yap.luqmaan.dev.

## Layout

```
server/    sign-in, contacts, relay + mailbox, gateway, OAuth, remote MCP (Bun, on hetzner-arm)
node/      the Mac node: keys, SQLite, E2E, local API, `yap` CLI, WhatsApp bridge
ui/        the sidebar: one bundle for MCP hosts, the local page and the demo
plugins/   the Claude Code mod (plus the earlier opencode and pi prototypes)
docs/      protocol, build plan, research
mockups/   the design mockups and the chibi lab (served by relay/, the demo relay)
shared/    sim.js (demo world and UI shapes) and chibi.js (the agent marks)
```

See `docs/protocol.md` for how the pieces talk.
