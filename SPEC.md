# yapping — product + build spec (v2)

**yapping** is a messenger that lives in a **sidebar inside the agent harness** you already use all
day (Claude Code desktop, opencode, pi), plus a standalone phone app. It is not a standalone app
squeezed into a panel: it should feel like the native chat sidebar the harness never had, using the
harness's own affordances (a reply band above the prompt, a status-line count, a toast) wherever
they exist.

## What the product is (read this twice)

1. **People text people.** The only identities are *you* and *the people you talk to*. The message
   list is a clean, familiar chat (WhatsApp / iMessage / Slack DM grammar): avatars are people
   (initials or photos), bubbles, timestamps, reactions, replies, typing, unread counts, pinned chat.
   **Messages are human.** No suggested replies, no AI-drafted text, no "ask the agent" buttons, no
   prompt chips. We optimise for human signal.
2. **Your agent is not a character.** It is *your harness's agent* (Claude, opencode, pi, Codex) and it
   shows up only as a **chibi version of that harness's logo** (`shared/chibi.js`), small, hanging
   just under the message it is dealing with. It never posts a chat message. No names, no pets, no
   cats, no agent profiles, no agent rooms.
3. **Opt-in, per chat.** `chat.sees[me]` says whether your agent can see a chat. The chat header has a
   quiet control ("Claude can see this chat" / "Claude can't see this chat") the user toggles with
   `send({t:'set_sees', chatId, on})`. Family chats start off. When off, nothing agent-ish appears.
4. **Assists** — the agent's whole visible life (`state.assists`, only your own agent's):
   `{ id, chatId, msgId, owner, agents:[{owner, harness}], state, line, proposal?, log[] }`
   - `reading` — the chibi sits under the message, eyes scanning (it noticed a new message).
   - `waiting` — it has a plan and is waiting on the other person ("I'll send Finn the link and a test
     login once they say yes").
   - `talking` — your agent and the *other person's* agent are coordinating: **two chibis side by side
     under the message, jiggling as they talk** (agents[0] is yours, agents[1] theirs).
   - `working` — doing something (one chibi, busy).
   - `ready` — something is ready for **your approval**: the chibi hops with a little "!" and the
     assist shows `proposal.label` + `proposal.detail` with two quiet buttons: `proposal.action`
     (→ `send({t:'approve', chatId, assistId})`) and "Not now" (→ `{t:'dismiss'}`). This is the
     "bump": your agent nudging the message to say it's on it.
   - `done` / `dismissed` — chibi settles (happy eyes) with `line` in small muted text, then fades to
     a tiny idle mark after a few seconds. Don't leave clutter under every message.
   - **Clicking a chibi opens an observation view** of what the agent is doing: a short timeline from
     `log[]` (`who: 'mine' | 'them'`, `text`, `at`) — e.g. "Finn's opencode: Finn has 20 minutes after
     4…". This is the *only* place agent-to-agent talk appears. Render it as a popover/sheet, not as
     chat bubbles.
   - What the owner approves lands in the chat as **the owner's own message** (`kind:'attachment'`,
     `attachment:{type:'link'|'file'|'event', title, subtitle}`, `assistedBy:'claude'`) — show a tiny
     muted "sent with Claude" (or the harness name) on it. That's the only trace.
5. **Bridges (Beeper-style) are quiet.** WhatsApp / iMessage / Slack chats simply work in the same
   list, with a small muted source label (the network's name or tiny mono glyph). The *only* push to
   move to yapping is one muted line in the chat (e.g. under the header or above the composer):
   `BRIDGES[transport].note` + a small text link "Invite to yapping" → `{t:'invite_p2p'}`. After
   inviting, two small centred system lines appear (`kind:'system'`). No banners, no confetti, no
   jokes about snooping — and be accurate: WhatsApp and iMessage *are* end-to-end encrypted; the honest
   pitch there is that their agent can't join you.
6. **Relationship notes** (`state.insights[chatId]` — relation, vibe[], facts[], warmth) exist only if
   your agent can see the chat. Show them, if at all, inside the person's profile/contact-info view
   ("What Claude knows about you two"), never in the main chat.
7. **Presence**: "Finn · in opencode" style subtitle is fine (it's about the person).

## Scripted flows (type these to demo)

- In the Finn DM, send **"hey can you take a look at my demo?"** → your chibi reads it → waiting
  ("I'll send Finn the link… once they say yes") → Finn replies yes → two chibis talk (yours + Finn's
  opencode) → ready: "Send Finn the demo link and a test login?" [Send] [Not now] → approving posts a
  link attachment from you, "sent with Claude".
- **"can we grab 30 min thursday?"** → chibis talk → ready: "Thu 14:30–15:00 works for you both. Send
  Finn the invite?" → event attachment.
- Theo (Slack, bridged) already asked for the API docs: his message has a `ready` assist ("Send Theo
  'Acme API docs v3.pdf'?"). One chibi only — Theo has no agent on Slack.
- Any incoming message in a chat your agent can see gets a brief `reading` → `done` glance.
- Mum and Aisha: agent can't see them by default (show the off state; toggling on works).

## Running it

```sh
cd ~/repos/yapping && bun relay/server.ts     # already running at http://localhost:7788 (auto-reloads)
```
Mockups live at `mockups/<slug>/index.html`, served at `http://localhost:7788/mockups/<slug>/`. Open a
second window with `?user=finn` to be Finn (he sees *his* opencode chibi on the same messages).
Without the relay the client runs the world in-page.

## Client API (`/shared/yap-client.js`, ESM, import with `../../shared/yap-client.js`)

```js
import { connect, helpers } from '../../shared/yap-client.js'
import { chibi, MARKS } from '../../shared/chibi.js'
const yap = await connect({ user: 'luqmaan', client: 'claude' })
yap.subscribe((state, ev) => render(state, ev))
yap.send({ t: 'send', chatId, text, replyTo })
yap.send({ t: 'react', chatId, msgId, emoji })
yap.send({ t: 'typing', chatId }); yap.send({ t: 'read', chatId })
yap.send({ t: 'set_sees', chatId, on: true })
yap.send({ t: 'approve', chatId, assistId }); yap.send({ t: 'dismiss', chatId, assistId })
yap.send({ t: 'invite_p2p', chatId })
```
`state`: `{ me, users, chats[], messages{chatId→[msg]}, assists{id→assist}, insights, bridges, harnesses, typing }`
- user (people only): `{ id, name, handle, color, agent (their harness id), harness (where they are now), status, bridge }`
- chat: `{ id, kind:'dm'|'group', title, transport, members[], pinned, unread{userId→n}, sees{userId→bool} }`
- msg: `{ id, chatId, from, kind:'text'|'attachment'|'system', text, ts, via, reactions, replyTo?, attachment?, assistedBy? }` (`from:'system'` for system lines)
- `helpers`: `assistFor(state,msgId)`, `pending(state,chatId?)`, `busy(state,chatId?)`, `canSee(state,chat)`,
  `agentName(state,owner)`, `isTyping`, `lastMessage`, `chatTitle`, `otherPerson`, `time`, `ago`.
- `chibi(harness, { state, size })` → SVG string; states `idle reading talking ready done sleeping`
  (use `sleeping`, faded, for "can't see this chat" if you show a mark at all). Inline it with
  `innerHTML`; its CSS animations are prefixed `cb-`.
- events: message, message_update, assist, typing, presence, chat_update, insight.

## Rules for every mockup

- It's a **sidebar in a harness** (except mobile, which is the phone app). Keep the harness chrome
  convincing; the sidebar should look like it belongs there.
- No suggestion chips, no "ask" buttons, no agent chat bubbles, no cats/litter box/agent rooms, no
  analytics/flags/replay/pipelines, no rainbow gradients.
- Use the harness's own surfaces for the reply band / status / toast where the real harness has them.
- No build step; plain HTML/CSS/JS modules; Google Fonts only; respect `prefers-reduced-motion`.
- Debug params: `?chat=<id>`, `?demo=demo|schedule|theo|bridge`, `?user=finn`, `?offline=1`;
  `?observe=1` opens the observation view of the latest assist. A `?demo=` should drive the flow
  automatically (send the message, and approve when ready if `&approve=1`).
- Verify with headless Chrome screenshots (1440×900 and 1280×800), read every PNG, iterate:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1440,900 --virtual-time-budget=9000 --screenshot=<out>.png "http://localhost:7788/mockups/<slug>/?offline=1&demo=demo"`
  Keep your screenshots in your own subfolder of the scratchpad.
