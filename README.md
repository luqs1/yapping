# yapping

A messenger that lives in the sidebar of the agent harness you already use all
day (Claude Code, opencode, pi), plus an app for your phone.

People text people. Your agent (the harness you're in) can see the chats you
let it see, one switch per chat. It never posts in the chat: it shows up as a
small chibi of its own logo under the message it's handling. It reads, talks to
the other person's agent when there's something to sort out, and when it has
something ready (a link, a file, an invite) it asks: **Send** or **Not now**.
What you approve goes out as your message.

Chats from WhatsApp, iMessage and Slack sit in the same list, with one honest
line about what you'd gain by moving them over.

## Run it

```sh
bun relay/server.ts          # http://localhost:7788 serves the gallery and every mockup
```

Open a mockup twice, the second time with `?user=finn`, and the two windows
chat through the relay; Finn sees his own agent on the same messages. Without
the relay a mockup runs everything in the page.

In Finn's chat try "hey can you take a look at my demo?" or "can we grab 30 min
thursday?". Theo's Slack chat has the API docs ready to send. Mum's chat is
hidden from the agent until you switch it on.

## The mockups

| Harness | Design language | Path |
| --- | --- | --- |
| Claude Code desktop | Claude's own | `mockups/claude-desktop/` |
| opencode | PostHog's art style | `mockups/opencode/` |
| pi | Discord, in a terminal | `mockups/pi/` |
| Phone (installable web app) | WhatsApp | `mockups/mobile/` |

Each takes `?demo=demo|schedule|theo|bridge` (add `&approve=1`), `?observe=1`,
`?chat=<id>` and `?offline=1`.

## The plugins

Each gives the agent tools to read the inbox and a chat, send the user's exact
words, and (Claude, pi) see or approve what's waiting.

- **Claude Code** (`plugins/claude/`): the Chats pane in Claude's own theme,
  proposals in the band above the prompt, counts in the status line, toasts,
  `/yap`, and `yap_inbox`, `yap_read`, `yap_send`, `yap_approve`.
  `claude --plugin-dir plugins/claude`
- **opencode v2** (`plugins/opencode/`): a `/yap` page and session side panel in
  PostHog colours. `cd plugins/opencode/demo && opencode --standalone`
- **pi** (`plugins/pi/`): a Discord-style overlay on ctrl+q or `/yap`, a widget
  above the editor. `pi -e plugins/pi`

## Layout

```
relay/server.ts       stand-in control plane: WebSocket + HTTP long-poll, static files
shared/sim.js         people, chats, assists and the scripted flows; one reducer for every client
shared/chibi.js       the chibi harness marks (reading, talking, ready, done, sleeping)
shared/yap-client.js  browser/Node client; falls back to running sim.js in the page
mockups/              the gallery and the four mockups
plugins/              the Claude Code, opencode and pi plugins
SPEC.md               the product rules every surface follows
```

The relay stands in for a real peer-to-peer control plane (the agentbus/iroh
layer) so the product could be designed first.
