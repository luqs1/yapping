# yapping as an MCP App in Claude and ChatGPT: feasibility

Researched 2026-11-03. **[F]** marks a verified fact (sources at the end). **[I]** marks my inference.

## Verdict

- **ChatGPT: feasible, and the closest fit.** Since DevDay (2026-09-29) a plugin can open as a **conversation panel** (a tab beside the chat) and as a **sidebar app** (an entry in the global sidebar that opens fullscreen) [F]. MCP Events lets ChatGPT react to `message.created` webhooks [F]. The limits:
  - On the web, the panel and sidebar extensions work only in **Work** chats, not classic ChatGPT. They are "coming soon" for Free and Go [F].
  - Event-triggered tasks run only in Work chats [F].
  - The public directory rejects "unofficial connectors to third-party services" [F], which rules out the WhatsApp and iMessage bridges there.
- **Claude: feasible as an inbox card plus tools, not as a sidebar.** Claude renders MCP Apps as an **inline card**, an **inline carousel** or **fullscreen**, on web, desktop, iOS and Android [F]. `pip` appears in the spec, but Claude's guidelines do not list it [F], so treat it as unsupported until tested. Claude has no resource subscriptions and no MCP Events [F], so it cannot react to a new message without a user turn. The persistent surface on Claude stays the existing **Claude Code plugin** [I].

## What each host gives you (2026-11)

| | Claude (claude.ai, Desktop, mobile) | ChatGPT (plugins / Apps SDK) |
|---|---|---|
| Mechanism | MCP Apps: `ui://` resource, `text/html;profile=mcp-app`, sandboxed iframe (a native WebView on mobile) [F] | The same MCP Apps standard, plus optional `window.openai` and `openai/ui` extensions [F] |
| Placement | Inline card or carousel, fullscreen with the composer still visible. Every tool call mounts a **new iframe**, and earlier copies stay live [F] | Inline and fullscreen. **Thread entrypoint** opens a side-panel tab, one instance per thread. **Global entrypoint** opens a fullscreen sidebar app. The extensions spec says `pip` is unsupported, which contradicts the older UI guidelines [F] |
| Network | `_meta.ui.csp.connectDomains` maps to `connect-src`, which the spec says covers fetch, XHR and WebSocket [F]. On iOS, allow-list requests by `Origin`, not `Referer` [F] | Same field. OpenAI's reference mentions only fetch and XHR, so **WebSocket is untested** [F/I] |
| UI to host | `tools/call` to own-server tools, `ui/message`, `ui/update-model-context` (the host may hold it until the next user message), `ui/open-link` [F] | Same, plus `ui/message` targets `new` or `active` and can open a draft without sending (`send:false`), `setWidgetState`, `requestModal` [F] |
| Background or push | None. No resource subscriptions or events in chat [F]. A Claude Code scheduled task with an **API trigger** (research preview) can start a cloud session on a POST [F] | **MCP Events** (webhook): ChatGPT subscribes and runs the user's instruction in the subscribed chat (Work only) [F] |
| Badges or notifications outside the UI | No API found [I] | No badge API found. The sidebar entry exists, but has no counter [I] |
| Confirmation | `destructiveHint` tools always prompt; read-only tools can run without asking [F] | Annotations drive the safeguards. Irreversible sends count as destructive and need human confirmation [F] |
| Auth and state | OAuth on remote MCP. Any plan can add a custom connector by URL (Free: one) [F]. Durable state lives on your server [I] | OAuth 2.1 + PKCE, with CIMD or DCR [F]. `widgetState` is "not a source of truth" [F] |
| Distribution | Connectors Directory: scanned, then Community or Verified. The policy requires that you "own or control" every endpoint [F] | Plugin directory, with verified developers and a country allow-list. EU-data-residency projects can't submit [F] |

## Feature mapping

| yapping feature | Claude | ChatGPT |
|---|---|---|
| Chat list | **Compromise**: an inline card when a tool runs, and it scrolls away. Fullscreen on request | **Works**: a sidebar app (global) or a conversation panel (thread) |
| Live conversation | **Works while mounted**: WebSocket or polling inside the iframe, no model turn needed | **Works while mounted**. The panel stays beside the chat |
| Chibi assists under messages | **Works inside the widget** (SVG/CSS); it cannot annotate Claude's own transcript | Same |
| Send / Not now | **Works**: a button calls an app-only `approve` tool. The host may add its own confirm step | **Works**, with the same caveat |
| "Agent can see" switch per chat | **Works**: an app-only tool (the model can't flip it), enforced by the server | **Works** |
| Agent notices a new message unprompted | **Not possible in chat**. Compromise: the relay POSTs to a scheduled-task API trigger, which runs in a separate cloud session | **Compromise**: MCP Events (Work chats, plugin must be installed) |
| Talking to the other person's agent | **Compromise**: the host model acts only during a turn, so negotiation has to run on the relay (or in the harness plugins). The widget shows the log | Same |
| The model can see chats | **Works**: `yap_read` plus `update-model-context`, limited to the chats the user has switched on | **Works** |
| Bridged WhatsApp, iMessage, Slack | **Compromise**: technically fine as a custom connector. Directory listing is doubtful | **Works only as a private or workspace plugin**. The public directory rejects unofficial connectors |
| Unread badge, status line, toasts | **Not possible** outside the widget | **Not possible** |
| Mobile | **Works** inline and fullscreen in a WebView. Add the connector on web or desktop first. No camera or mic | **Works**: thread and global entrypoints are supported on iOS and Android |

## Recommended architecture

1. **The MCP server is the relay's front door.** It runs over Streamable HTTP with OAuth (CIMD + DCR) and one account per user. It exposes these tools:
   - Model-visible: `yap_inbox`, `yap_read` (read-only, and only returns chats the user switched on), `yap_send` (destructive, takes the user's exact words) and `yap_propose`.
   - App-only (`visibility:["app"]`): `approve`, `dismiss` and `set_sees`. The model can never approve its own proposal or widen its own view.
2. **One UI resource, `ui://yapping/inbox`.** A compact inbox with approval cards, which expands to fullscreen for a conversation. It opens `wss://relay…` (listed in `connectDomains`) while mounted. It pushes a short summary of the user's switched-on chats through `update-model-context`. On Claude it uses the supersession pattern so that only the newest card stays live.
3. **ChatGPT extras.** Add the `openai/ui` entrypoints `[{type:"global"},{type:"thread"}]` to get the sidebar inbox and the beside-chat panel. Publish MCP Events (`message.created`, `assist.ready`) so the user can say "watch my Finn chat".
4. **Claude extras.** Keep the Claude Code plugin as the always-on surface. In claude.ai, the card appears when the user asks ("what's waiting?"). Optionally, a scheduled-task API trigger handles background assists.
5. **Agent-to-agent negotiation runs on the relay or in the harness plugins.** It never depends on a chat host being awake. Each proposal waits as an assist until the user approves it in any surface.
6. **Bridges ship as a separate, privately installed connector.** That keeps the core plugin listable in both directories.

## Open questions (test before building)

1. Does any Claude surface report `pip` in `hostContext.availableDisplayModes`?
2. Does an off-screen or backgrounded iframe keep its WebSocket open, especially on mobile?
3. Does ChatGPT's CSP allow `wss:`?
4. Does the ChatGPT thread panel stay open across turns, and does the global app keep running after you navigate away?
5. Do *app-initiated* calls to a destructive tool trigger the host's confirmation, or only calls from the model?
6. Will either directory list a person-to-person messenger at all? Does a "chibi" of the Claude or ChatGPT logo break their brand rules?
7. How do we handle prompt injection? Other people's messages enter the model's context. Mark them `audience:["assistant"]` and keep sends gated on approval.
8. When, if ever, will Claude support MCP Events? (No signal found.)

## Sources (retrieved 2026-11-03)

- MCP Apps SEP-1865: [stable spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), [draft (commits through 2026-10-27)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx), [ext-apps v2.0.0 (2026-09-08)](https://github.com/modelcontextprotocol/ext-apps/releases/tag/v2.0.0)
- Anthropic launch, [Interactive connectors](https://claude.com/blog/interactive-tools-in-claude) (2026-01-26). Support article: [Use interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude) (web, desktop, Cowork, iOS and Android; 2026)
- Claude docs (undated, current): [MCP Apps getting started](https://claude.com/docs/connectors/building/mcp-apps/getting-started), [design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines), [instance supersession](https://claude.com/docs/connectors/building/mcp-apps/instance-supersession), [troubleshooting](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting), [build an MCP server: limits and unsupported features](https://claude.com/docs/connectors/building/index), [review criteria](https://claude.com/docs/connectors/building/review-criteria), [add unlisted connector](https://claude.com/docs/connectors/custom/add-unlisted), [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [scheduled tasks (research preview)](https://code.claude.com/docs/en/routines)
- OpenAI: [MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt/), [Plugin Extensions](https://developers.openai.com/plugins/build/extensions), [openai/mcp-extensions spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md) (repo created 2026-09-29, updated 2026-10-30), [MCP Events](https://developers.openai.com/plugins/build/mcp-events), [Reference](https://developers.openai.com/plugins/reference), [Auth](https://developers.openai.com/plugins/build/auth), [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), [App review](https://developers.openai.com/plugins/deploy/app-review), [Help: Plugins in ChatGPT](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt) (updated about 2026-10-28)
- Press: [TechCrunch, DevDay plugin extensions and MCP Events](https://techcrunch.com/2026/09/29/openai-expands-chatgpts-plugins-with-app-like-interfaces-and-automations/) (2026-09-29)
