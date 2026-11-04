# Bridged WhatsApp/Slack/iMessage/Telegram/Signal inside the Claude and ChatGPT MCP apps

Researched 2026-11-03, following up [mcp-apps-feasibility.md](mcp-apps-feasibility.md). **[F]** = verified fact (sources at the end). **[I]** = my inference. This is not legal advice. ⚖ marks the places where a lawyer's read matters.

## Short answer

The MCP App can **render** a bridged inbox in both hosts. Each network's terms decide whether we **may**, and so does where the bridge runs. Neither directory will list a bridge [F]. A private install escapes the host's **review** but not the host's **terms**: OpenAI's App Developer Terms also cover developer-mode custom connectors and forbid accessing third-party services "in any unauthorized manner" [F]. Only Slack (official OAuth) and Telegram (official third-party-client API) have a sanctioned route. WhatsApp, iMessage and Signal are on-device and at the user's own risk, or nothing.

## Verdict

| Network (route) | ChatGPT | Claude |
|---|---|---|
| **Slack**, official user-token OAuth | **Works privately only.** Public distribution must go through the Slack Marketplace, which rejects "third-party Slack clients" [F]. Not listable in the ChatGPT directory ("unofficial connectors… pass-through") [F] | **Works privately only.** Same Slack limits, and fails Anthropic's "own or control" rule, since `slack.com` isn't ours [F] |
| **Telegram**, MTProto user API with our own `api_id` | **Works privately.** Listing is uncertain [I]. AI use needs consent from everyone in the chat ⚖ [F] | Same |
| **iMessage**, the user's own Mac (Messages/`chat.db`, BlueBubbles-style) | **Works privately only** (a Mac must be on) [F/I] | Same |
| **iMessage**, Beeper Mini-style protocol emulation | **Not possible**: Apple blocks it [F] | Same |
| **WhatsApp**, linked-device client (whatsmeow, Baileys, mautrix) | **Technically possible but against terms**: ban risk [F] | Same |
| **WhatsApp**, Cloud/Business API | **Not possible** for personal chats (business numbers only) [F] | Same |
| **WhatsApp**, EU DMA interop | **Not possible as a bridge.** Only possible if yapping becomes its own EU messenger [F/I] | Same |
| **Signal**, linked device via libsignal (signal-cli, mautrix-signal) | **Technically possible but against terms** (gray ⚖) [F/I] | Same |
| *Agent help on Slack via the host's own Slack connector* | **Works**, but outside yapping's UI [F] | **Works**: Slack's MCP server is built into Claude [F] |

## Per network

**WhatsApp.**
- **Official API.** The Cloud API serves a business number from a Meta business portfolio. It can't read a person's own chats [F]. Since 2026-01-15 its terms bar "AI Providers" whose primary function is a general-purpose assistant [F]. On 2026-06-09 the EU ordered free access restored in the EEA as an interim measure [F].
- **Third-party agents (beta since 2026-09).** WhatsApp's new **third-party agents** let a user plug their own agent into **one dedicated chat** with an API key. The agent "can't… access other chats", and those chats aren't end-to-end encrypted [F]. That's useful for "talk to my agent in WhatsApp", but it can't bridge an inbox [I].
- **DMA interop.** Interop is live with BirdyChat and Haiket since 2025-11. It is EU-only and opt-in for WhatsApp users, and the partner must match WhatsApp's E2EE (Signal protocol or equivalent) [F]. It connects *networks*, not *accounts*: yapping users could message EU WhatsApp users, but the user's existing WhatsApp history would not appear [I]. The specs are under NDA [F].
- **Unofficial clients.** Linking to unofficial apps "violates our Terms of Service" and risks a temporary or permanent ban [F]. Reports of the "unauthorized tools" warning hitting whatsmeow and Baileys users have been rising since 2025-05 [F]. **Restricted chat** lets the *other* participant block linked devices, which WhatsApp says is meant to stop "unofficial clients or AI agents" [F]. A bridge must therefore expect per-chat refusals [I].

**Slack.**
- **Tokens.** A user token (`xoxp`, `oauth.v2.user.access`) acts *as the user*. Marketplace review allows it only when the action must come from the user's perspective [F]. Bot tokens can't read the user's DMs [I].
- **2025 terms changes.**
  - Since 2025-05-29, commercially distributed apps outside the Marketplace get `conversations.history`/`replies` at **1 request/min and 15 messages** per call [F].
  - The Marketplace is "the only appropriate channel" for commercial distribution, which includes "a free App that connects to a paid product" [F].
  - API data may not train LLMs or be bulk-exported [F].
  - Unlisted apps can't use Slack's MCP server [F].
  - The Marketplace lists as unsuitable any app that "replicate[s] Slack client functionality", "embed[s] Slack into another site", or is "only an MCP server" [F].
- **Allowed routes.** Internal (single-workspace, customer-built) apps keep Tier 3 limits [F], so the allowed route is bring-your-own internal app per workspace. ⚖ Whether that counts as Commercial Distribution if yapping is paid.
- **Unsanctioned route.** mautrix-slack's cookie login (`xoxc` and `d` lifted from the browser) works, but it's unsanctioned [F/I].

**iMessage.**
- **Apple's stance.** Apple killed Beeper Mini in 2023-12 for using "fake credentials" [F]. The EU declined to designate iMessage under the DMA, and the General Court confirmed on 2026-07-08 that no DMA obligations apply [F]. DOJ v. Apple is still pending in D.N.J. [F].
- **What remains.** The only durable route is the user's own Mac: BlueBubbles (AppleScript plus `chat.db`) or Beeper's Mac-only on-device iMessage [F]. It's low risk because it automates the user's own client [I].

**Telegram.**
- **Terms.** Third-party clients are explicitly welcome, with your own `api_id`, disclosure, and no "Telegram" in the name [F]. Clients must not act "without the user's knowledge and consent" [F]. Accounts on unofficial clients are "under observation", and spam is a permanent ban [F].
- **AI clause.** The Content Licensing terms forbid using platform data to "deploy" AI unless **all relevant users** in that chat give "explicit, informed, affirmative" consent [F]. This hits the "agent can see this chat" feature directly ⚖.

**Signal.**
- **Technical route.** Linked-device bridges work, and the bridge decrypts everything [F].
- **Terms and stance.** The ToS bar access "in unauthorized manners" and auto-messaging [F]. Signal's president calls AI agents an "existential threat" to secure messaging [F]. There is no API and no sanctioned path, so expect hostility [I].

**Beeper and Texts today.**
- **Acquisitions.** Automattic bought Texts.com (2023-10, $50M) and Beeper (2024-04, $125M), and merged them under Beeper [F].
- **Architecture.** Since 2025-07 Beeper runs **on-device connections**: the app talks to each network directly and keeps E2EE. Beeper Cloud, the old server-side Matrix bridges, is being deprecated [F].
- **Desktop API.** Beeper Desktop exposes a **local API plus an MCP server** (`localhost:23373`) and recommends "personal use only", warning that the networks may suspend accounts [F]. Its "Remote Access" mode tunnels it to ChatGPT or Claude.ai "at your own risk" [F].

## Fit with the MCP hosts

- **Network path.** The widget can open `wss://relay.yapping…` if it's listed in `connectDomains` [F]. The widget→relay→bridge path works [I].
  - Custom connectors are called **from the host's cloud**, so the MCP server must be public [F].
  - An on-device bridge must **dial out** to our relay (or be tunnelled, as Beeper does) [F/I].
  - Reaching `localhost` from the widget is untested, and impossible on mobile [I].
- **Where the bridge runs.**
  - **Our cloud** (mautrix-style): we hold every user's session keys and plaintext. That carries the most ToS, ban, breach and GDPR exposure, and is what Beeper is moving away from [F/I].
  - **On-device** (harness plugin or desktop helper): the user's own client. The relay sees only what it forwards, and it can be end-to-end encrypted between device and widget [I].
  - **Self-hosted**: fine for power users, not as a product [I].
- **What E2EE means here.** A cloud bridge *is* an endpoint, so "end-to-end" ends on our server [F]. Once the agent reads a chat, the plaintext also goes to OpenAI or Anthropic:
  - Consumer ChatGPT trains on it unless the user opts out [F].
  - Consumer Claude trains only if the user allows it in privacy settings, and excludes raw connector/MCP content (unless it's copied into the chat) [F].
  - Business plans don't train by default [F].
- **Extra policy problems.** The counterparty never agreed to have their messages sent to a US AI host ⚖ (GDPR).
  - **Slack**: the no-LLM-training rule [F] could be breached indirectly if the host trains [I] ⚖.
  - **Telegram**: needs every participant's consent [F].
  - **WhatsApp**: built Restricted chat specifically against this [F].
- **Directory versus private installs.**
  - **OpenAI.** The ban on "unofficial connectors" is a directory rule [F]. Private installs need developer mode: on Business, Enterprise and Edu, admins publish "custom" apps that are "not verified by OpenAI" [F]. The App Developer Terms still apply there [F].
  - **Anthropic.** Custom connectors get no review and show as "unverified" [F]. "Own or control" binds only the directory [F]. The AUP and consumer terms still apply [I].

## Recommended path

1. **Keep the listed yapping app bridge-free** (person-to-person only), so it stays listable in both directories [F/I].
2. **Put the bridges on the user's device, inside the harness plugins** (Claude Code, opencode, pi) or a small desktop helper, never in our cloud.
   - Prefer **integrating Beeper Desktop's local API/MCP** when the user already runs Beeper, over writing our own bridges. Beeper carries the network maintenance, and the user's own client carries the risk [I].
   - The cloud MCP app shows bridged chats only through an outbound, user-authorized, ideally end-to-end-encrypted relay link, shipped as a **separate, unlisted "yapping bridges" connector** [I].
3. **Slack**: official OAuth user token through a bring-your-own **internal app** per workspace, read in real time, no storing (zero-copy) [F/I]. For agent help, defer to the host's official Slack connector. No public Slack distribution unless Slack agrees ⚖.
4. **WhatsApp**: on-device only, opt-in, with a plain ban warning. Honour Restricted chat and never auto-send. Longer term, apply for **DMA interop as yapping-the-network** (EU, Signal-protocol E2EE). That matches the "Invite to yapping" pitch [I].
5. **Telegram**: on-device MTProto with our own `api_id`. The agent's "sees" switch stays off until **every participant** consents [F/I].
6. **iMessage**: only via the user's Mac (macOS harness plugin). **Signal**: don't ship [I].

## Open questions

1. Can an MCP App iframe reach `localhost` (Chrome Local Network Access) in claude.ai or chatgpt.com, and does a `connectDomains` entry for it survive review? [I]
2. Does ChatGPT or Claude still offer developer mode or custom connectors on *personal* plans in 2026-11? Can a Business workspace install an app that bridges members' *personal* accounts?
3. ⚖ Does a per-workspace internal Slack app that feeds a paid yapping service count as "Commercial Distribution"?
4. ⚖ What is the GDPR lawful basis for sending counterparties' messages to the host model? Does "sees = on" need the other person's consent everywhere, not just on Telegram?
5. Could WhatsApp's third-party-agent channel (the user forwards a chat to their agent) carry the "agent helps" half legally? Its terms need a full read.
6. Would Beeper license the Desktop API for a commercial integration? (Contact: partnerships@beeper.com.)

## Sources (retrieved 2026-11-03; dates are publication or effective dates)

- **WhatsApp/Meta:**
  - Business: [Business Solution Terms, AI Providers](https://www.whatsapp.com/legal/business-solution-terms); [AI Providers pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers) (2026-10-15); [TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/) (2025-10-18); [EC interim measures](https://competition-cases.ec.europa.eu/cases/AT.41034) (2026-06-09).
  - Help Center: [unofficial apps](https://faq.whatsapp.com/general/security-and-privacy/about-unofficial-apps); [Restricted chat](https://faq.whatsapp.com/715385484388016); [third-party agents](https://faq.whatsapp.com/1050934623978152); [NDTV on the agents beta](https://www.ndtv.com/artificial-intelligence/whatsapp-brings-third-party-ai-agents-to-android-what-you-need-to-know-12005254) (2026-09-05).
  - DMA interop: [Meta Messaging Interoperability](https://developers.facebook.com/m/messaging-interoperability); [Meta newsroom](https://about.fb.com/news/2025/11/messaging-interoperability-whatsapp-enables-third-party-chats-for-users-in-europe) (2025-11-14); [EC DMA interop page](https://digital-markets-act.ec.europa.eu/businesses-portal/messaging-interoperability_en) (2026-08-03); [BEREC opinion](https://www.berec.europa.eu/system/files/2025-03/BoR%20%2825%29%2021%20BEREC%20Opinion%20on%20Meta%27s%20reference%20offers.pdf) (2025-03-03).
  - Unofficial clients: [whatsmeow #810](https://github.com/tulir/whatsmeow/issues/810) (2025-05-09).
- **Slack:** [API Terms](https://slack.com/terms-of-service/api) (eff. 2025-10-10); [rate-limit changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps) (2025-05-29); [Marketplace guidelines](https://api.slack.com/slack-marketplace/guidelines); [Slack MCP server](https://docs.slack.dev/ai/slack-mcp-server); [mautrix-slack auth](https://docs.mau.fi/bridges/go/slack/authentication.html).
- **Apple:**
  - Beeper Mini block: [TechCrunch, Apple statement](https://techcrunch.com/2023/12/08/apple-cuts-off-beeper-minis-access-after-launch-of-service-that-brought-imessage-to-android) (2023-12-09).
  - DMA: [General Court T-1079/23](https://curia.europa.eu/site/upload/docs/application/pdf/2026-07/cp260096en.pdf) (2026-07-08).
  - DOJ case: [DOJ v. Apple docket](https://www.courtlistener.com/docket/68362334/united-states-of-america-v-apple-inc) (activity to 2026-07-31).
  - BlueBubbles: [BlueBubbles server](https://docs.bluebubbles.app/server).
- **Telegram:** [API Terms](https://core.telegram.org/api/terms); [obtaining api_id](https://core.telegram.org/api/obtaining_api_id); [Content Licensing and AI](https://telegram.org/tos/content-licensing).
- **Signal:** [Terms](https://signal.org/legal/); [TechCrunch, Whittaker on agents](https://techcrunch.com/2025/03/07/signal-president-meredith-whittaker-calls-out-agentic-ai-as-having-profound-security-and-privacy-issues/) (2025-03-07); [Fortune](https://fortune.com/2025/11/27/ai-agents-are-an-existential-threat-to-secure-messaging-signals-president-whittaker-says) (2025-11-27); [mautrix-signal notes](https://matrixdocs.github.io/docs/bridges/signal).
- **Beeper:** [joins Automattic](http://blog.beeper.com/2024/04/09/beeper-is-joining-automattic) (2024-04-09); [The New Beeper (on-device)](https://blog.beeper.com/2025/07/16/the-new-beeper/) (2025-07-16); [TechCrunch relaunch](https://techcrunch.com/2025/07/16/beepers-all-in-one-messaging-app-relaunches-with-an-on-device-model-and-premium-upgrades) (2025-07-16); [Desktop API](https://developers.beeper.com/desktop-api/index.md); [Desktop MCP](https://developers.beeper.com/desktop-api/mcp); [Remote Access](https://developers.beeper.com/desktop-api/advanced/remote-access); [FAQ](https://www.beeper.com/faq).
- **OpenAI:** [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines); [App Developer Terms](https://openai.com/policies/developer-apps-terms) (2026-09-28); [Developer mode](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps); [data use](https://openai.com/policies/how-your-data-is-used-to-improve-model-performance) (2026-03-13).
- **Anthropic:** [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy); [directory vs custom](https://claude.com/docs/connectors/building/directory-vs-custom); [custom connectors](https://support.claude.com/en/articles/11175166); [consumer training](https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training) (2026-03-16).
