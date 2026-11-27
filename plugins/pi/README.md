# yapping for pi

Chat with your friends without leaving [pi](https://pi.dev). This package adds a Discord-styled chat
view and four tools, so you can type "tell Finn I'm running late" in pi's prompt and your words get
sent. Your pi agent helps out quietly underneath messages, and only with chats you let it see.

## Install

```sh
pi install npm:pi-yapping          # once it's on npm
pi install ./plugins/pi            # today, from a yapping checkout
```

Both add one entry to `~/.pi/agent/settings.json` (`-l` puts it in the project's `.pi/settings.json`
instead). To remove it: `pi remove <same source>`.

To try it for one run without installing anything:

```sh
pi -e ./plugins/pi
```

It talks to yapping on this Mac (install it with `curl -fsSL https://yap.luqmaan.dev/install.sh | sh`),
finding the node's port and token in its folder by itself. For the demo world instead, run the demo relay
(`bun relay/server.ts`) and start pi with `YAP_RELAY=http://localhost:7788`.

## Use it

| | |
| --- | --- |
| `/yap` or **ctrl+q** | Open the chat view. `/yap finn` opens a specific chat. **Esc** closes it. |
| "tell Finn I'm running late" | The agent calls `yap_send` with your exact words (`I'm running late`). It never drafts or rewrites a message. |
| "anything on yapping?" | `yap_inbox` lists unread counts, last messages and presence. |
| "what did Mum say?" | `yap_read` returns recent messages, attachments and reactions, and marks the chat read. |
| "what's waiting on me?" | `yap_pending` lists what your agent is holding for your approval. It's read-only: you approve in `/yap`. |

A one-line widget above the editor shows your unread count and the latest message. When your agent
is busy, it shows a tiny chibi and what the agent is doing. When something is ready for you, it
shows the proposal. New messages and new proposals that arrive while the view is closed show up as
pi notifications.

### Inside the view

Messages are only ever from people. The only agent in the view is your own pi agent, drawn as a
tiny chibi: a 5×2-cell block of pi's mark with eyes, hanging under the message it's dealing with.

- `reading`: the eyes scan.
- `waiting`: the chibi blinks, next to its one line ("I'll send Finn the link… once they say yes").
- `talking`: two chibis jiggle side by side (yours, and the other person's harness), with the
  latest exchange in muted italics.
- `ready`: the chibi hops with a yellow "!", then shows the proposal and its detail with
  **y** (the proposal's action) and **n** (Not now).
- `done`: the chibi settles with happy eyes and its line. After a few seconds it fades to a tiny
  `▪✓` next to the message's timestamp.

**o** opens an observation popout of the assist's log ("Finn's opencode: Finn has 20 minutes after
4…"). It's the only place agent-to-agent talk appears. Approved things land as your own message
(a link, file or event embed) with a muted "sent with …".

Each chat has a toggle for whether the agent can see it: "◉ pi can see this chat" or "○ pi can't
see this chat", switched with ctrl+s. When it's off, nothing agent-related appears. Bridged chats
(WhatsApp, iMessage, Slack) get a muted source label and one muted line above the composer, the
network's honest note, plus "ctrl+p Invite to yapping".

| key | action |
| --- | --- |
| ⏎ | send |
| ↑ / ↓ | previous / next chat |
| tab / shift+tab | next / previous server (DMs, fall26, Bridges) |
| y / n | approve / not now. Only when the composer is empty; ctrl+y / ctrl+n work any time. |
| o (or ctrl+o) | observe what your agent did |
| ctrl+s | toggle whether pi can see this chat |
| ctrl+p | invite a bridged chat to yapping |
| ctrl+r | react 😂 to the last message |
| ctrl+t | toggle the profile panel |
| pgup / pgdn | scroll |
| esc | close (or close the popout) |

## Configure

| env | default | |
| --- | --- | --- |
| `YAP_RELAY` | `http://localhost:7788` | relay base URL |
| `YAP_USER` | `luqmaan` | who you are |
| `YAP_KEY` | `ctrl+q` | shortcut that opens the view |
| `YAP_NOTIFY` | `1` | set to `0` to turn off notifications |
| `YAP_REDUCED_MOTION` | `0` | set to `1` to keep the chibis still |

The default shortcut is ctrl+q because ctrl+y is pi's yank. Binding ctrl+y still works, but pi
shows a conflict warning at startup.

## How it works

- `index.ts` registers the tools, `/yap`, the shortcut, the widget and the notifications.
- `client.ts` handles the relay connection. In interactive mode it opens a WebSocket to
  `/ws?user=&client=pi` (which also puts you online in pi), takes the snapshot and folds events with
  `shared/sim.js#applyEvent`. The tools call `GET /api/snapshot` and `POST /api/action`, so they also
  work in `-p`, json and rpc modes, where no socket is opened.
- `view.ts` is the full-screen component. It's a pi overlay set to 100% width and height, anchored at
  the top left, with a pi-tui `Input` for the composer.
- `sim.js` is imported from `../../shared/` in a checkout. `npm pack` copies it into `vendor/`
  (`prepack`), so the published tarball has no dependency on the rest of the repo.

## Development

```sh
# the agent tools against the relay, at zero token cost
# (test/scripted-model.ts is a fake model that turns prompts into yap_* tool calls)
pi -ne -e ./plugins/pi -e ./plugins/pi/test/scripted-model.ts \
   --provider yap-test --model scripted --no-session -p "tell Finn I'm running late"

# render the view without pi (read-only) and check every row is exactly the terminal width
node plugins/pi/test/render-check.mjs 160 46 finn

# drive real pi in tmux through the demo flow (reading → waiting → talking → ready → y),
# the observation popout, servers, the sees toggle, Esc and a notification.
# The flow writes to the relay, so point it at a private one:
YAP_PORT=7799 bun relay/server.ts &
YAP_RELAY=http://localhost:7799 plugins/pi/test/tmux-capture.sh /tmp/yapcap 160 46
```
