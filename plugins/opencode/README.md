# yapping for opencode

Message people without leaving opencode. Ask *"tell Finn I'm running late"* and opencode sends exactly that.
In the chats you let it see, opencode quietly helps under the messages (sending a demo link, booking a call),
and nothing goes out until you say yes.

## Install (one line)

```sh
opencode plugin add opencode-yapping
```

Then open opencode and type `/yap` (or press `ctrl+x` then `p`).

> Needs opencode 2.x and a yapping relay. The demo relay runs at `http://localhost:7788`
> (`bun relay/server.ts` in this repo). To use another one, set `YAP_RELAY=https://…` and `YAP_USER=yourname`.

## What you get

**Tools for the agent** (`server.ts`). They only read chats you've let opencode see.

| tool | what it does |
| --- | --- |
| `yap_inbox` | unread first, the latest messages per chat, and how many things are waiting for your OK |
| `yap_read` | recent messages in one chat (`"Finn"`, `"cohort"`, `"Theo"` or an id), including attachments and system lines. Marks it read |
| `yap_send` | sends **exactly** the words you asked for, as you. No embellishment |
| `yap_pending` | what's waiting for your approval (e.g. *Send Theo "Acme API docs v3.pdf"?*) so opencode can tell you |

**The TUI** (`tui.tsx`)

- `/yap` (or `/yap theo`, or `<leader>p`) opens yapping full screen: chats with unread counts and a muted
  source tag (WhatsApp / iMessage / Slack), human messages, attachments and a composer.
- opencode shows up only as a tiny chibi of its logo, under the message it's dealing with:
  - `▐·▂•▌ Reading`: its eyes scan.
  - `▐°▂°▌ I'll send Finn the link… once they say yes…`: waiting.
  - `▐°o°▌⠆▐°o°▌ Talking to Finn's opencode`: two chibis jiggle side by side.
  - `▐°▿°▌! Send Finn the demo link and a test login?`: ready. `ctrl+y` sends it, `ctrl+n` is not now.
  - `▐^▂^▌ Sent…`: done. It then settles to a tiny `◧`.
- `ctrl+l` (or clicking a chibi) opens the observation view: what your opencode and theirs said to each other.
- The chat header has the per-chat toggle *opencode can / can't see this chat* (`ctrl+s`). Family chats start off,
  and when a chat is off nothing agent-ish appears in it.
- Bridged chats show one muted line from the bridge (e.g. *Their agent can't join you on WhatsApp.*) and
  *Invite to yapping* (`ctrl+b`).
- `/yap-panel` opens the same view as a side panel next to your session. `/yap-waiting` reviews pending approvals
  in a dialog. `/yap-send finn on my way` sends straight from the prompt.
- The session sidebar lists unread chats and pending approvals. The prompt footer shows `▐°▿°▌! 2  yap 3`.
  A toast pops up when a message arrives or when something becomes ready.

## Develop locally

The plugin is a folder with `server.ts` and `tui.tsx` and nothing to install. opencode's runtime supplies
`@opentui/solid`, `@opentui/core` and `solid-js`. `lib/sim.js` is a copy of `shared/sim.js` (the event reducer
and helpers), so the folder is self-contained and publishable as is.

```sh
cd plugins/opencode/demo          # its opencode.json says  { "plugins": ["../"] }
opencode --standalone             # TUI; type /yap
opencode run --standalone "use yap_inbox and summarise"
opencode run --standalone "tell Finn I'm running late"
```

- `--standalone` uses a private server, so your background opencode service isn't involved.
- Your global `~/.config/opencode` is never touched. The demo folder's `opencode.json` is the only config that
  loads the plugin.
- Edits hot-reload. opencode watches local plugin sources, so you can save `tui.tsx` and the panel redraws.
- To use the plugin in any project, add `"plugins": ["/abs/path/to/yapping/plugins/opencode"]` to that project's
  `opencode.json`. You can also symlink the folder into `.opencode/plugins/yapping`.
- Plugin options: `{ "package": "opencode-yapping", "options": { "relay": "http://…", "user": "finn" } }`.
  The env vars `YAP_RELAY` and `YAP_USER` work too.
