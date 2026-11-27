// yapping — opencode v2 server plugin.
//
// Tools for the opencode agent: yap_inbox, yap_read, yap_send, yap_pending.
// The agent only reads chats the user has let opencode see (chat.sees[me]);
// sending is always the user's own words, exactly as asked.
//
// Relay: default http://localhost:7788, override with YAP_RELAY / YAP_USER or
// plugin options { relay, user }. Plain object default export = the v2
// Promise plugin shape (`Plugin.define` is the identity function), so this
// file needs no dependencies.

import {
  agentLabel,
  assistFor,
  bridgeName,
  chatTitle,
  LOCAL,
  messageText,
  name,
  pending,
  presence,
  relayClient,
  resolveChat,
  sees,
  sortedChats,
  time,
  totalUnread,
  unread,
  type Chat,
  type Msg,
  type State,
} from "./lib/core.ts"

type ToolContext = { progress?: (m: Record<string, any>) => Promise<void> }
type ToolEditor = { add: (tool: any) => void }
type Context = {
  options: Record<string, any>
  tool: { transform: (fn: (editor: ToolEditor) => void) => Promise<unknown> }
}

const object = (properties: Record<string, any>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const CHAT_ARG = { type: "string", description: 'Chat id or person/group name, e.g. "Finn", "dm-finn", "cohort", "Theo".' }

function header(state: State, chat: Chat) {
  const via = chat.transport === "yap" ? "yapping" : bridgeName(chat.transport)
  return `${chatTitle(state, chat)} [${chat.id}] · ${chat.transport === "yap" ? `yapping · ${presence(state, chat)}` : `via ${via}`}`
}

function line(state: State, m: Msg) {
  if (m.kind === "system") return `${time(m.ts)} — ${m.text}`
  const sent = m.assistedBy ? ` (sent with ${m.from === state.me ? LOCAL : m.assistedBy})` : ""
  return `${time(m.ts)} ${name(state, m.from)}: ${messageText(state, m)}${sent}`
}

function render(state: State, chat: Chat, limit: number) {
  const out: string[] = []
  for (const m of (state.messages[chat.id] || []).slice(-limit)) {
    out.push(line(state, m))
    const a = assistFor(state, m.id)
    if (!a) continue
    if (a.state === "ready" && a.proposal)
      out.push(`      ↳ waiting for the user's OK: ${a.proposal.label} (${a.proposal.detail ?? ""}) [assist ${a.id}]`)
    else if (["reading", "waiting", "talking", "working"].includes(a.state)) out.push(`      ↳ ${LOCAL} is on it: ${a.line}`)
  }
  return out
}

const blind = (state: State, chat: Chat) =>
  `${chatTitle(state, chat)} [${chat.id}]: ${LOCAL} can't see this chat. The user can turn that on with /yap (ctrl+s in the chat).`

export default {
  id: "yapping",
  async setup(ctx: Context) {
    const yap = relayClient(ctx.options ?? {})
    await yap.presence("online").catch(() => {})

    const snapshot = async (): Promise<State | string> =>
      yap.snapshot().catch(
        (err: unknown) =>
          `${yap.relay} is not reachable (${err instanceof Error ? err.message : String(err)}).`,
      )

    await ctx.tool.transform((tools) => {
      tools.add({
        name: "yap_inbox",
        options: { codemode: false },
        description:
          "The user's yapping inbox: chats with people (DMs, groups, bridged WhatsApp/iMessage/Slack), unread first, " +
          "with the latest messages in each chat the user lets opencode see, and anything waiting for the user's approval.",
        input: object({ per_chat: { type: "number", description: "Recent messages per chat (default 3, max 10)." } }),
        async execute(input: { per_chat?: number }) {
          const state = await snapshot()
          if (typeof state === "string") return { content: state }
          const per = Math.max(1, Math.min(10, Math.round(input?.per_chat ?? 3)))
          const chats = sortedChats(state).sort((a, b) => unread(state, b) - unread(state, a))
          const total = totalUnread(state)
          const out = [`yapping inbox for ${state.users[state.me]?.name ?? state.me}: ${total} unread`, ""]
          for (const chat of chats) {
            const n = unread(state, chat)
            if (!sees(state, chat)) {
              out.push(`• ${header(state, chat)}${n ? ` · ${n} unread` : ""} · ${LOCAL} can't see this chat`)
              continue
            }
            out.push(`• ${header(state, chat)}${n ? ` · ${n} unread` : ""}`)
            for (const l of render(state, chat, n ? Math.max(per, Math.min(n, 10)) : per)) out.push(`    ${l}`)
          }
          const ready = pending(state)
          if (ready.length) out.push("", `${ready.length} thing(s) waiting for the user's approval (see yap_pending).`)
          return { content: out.join("\n"), metadata: { unread: total, pending: ready.length } }
        },
      })

      tools.add({
        name: "yap_read",
        options: { codemode: false },
        description:
          "Read the recent messages of one yapping chat the user lets opencode see, including attachments and system " +
          "lines, and whether something there is waiting for the user's approval. Marks the chat read.",
        input: object({ chat: CHAT_ARG, limit: { type: "number", description: "How many (default 15, max 50)." } }, ["chat"]),
        async execute(input: { chat: string; limit?: number }) {
          const state = await snapshot()
          if (typeof state === "string") return { content: state }
          const chat = resolveChat(state, input.chat)
          if (!chat)
            return { content: `No chat matches "${input.chat}". Chats: ${state.chats.map((c) => `${chatTitle(state, c)} (${c.id})`).join(", ")}` }
          if (!sees(state, chat)) return { content: blind(state, chat) }
          const limit = Math.max(1, Math.min(50, Math.round(input.limit ?? 15)))
          const out = [header(state, chat), "", ...render(state, chat, limit)]
          if (unread(state, chat)) await yap.action({ t: "read", chatId: chat.id }).catch(() => {})
          return { content: out.join("\n"), metadata: { chatId: chat.id } }
        },
      })

      tools.add({
        name: "yap_send",
        options: { codemode: false },
        description:
          "Send a message to a person or group on yapping, as the user. Only when the user asked you to message someone. " +
          "Send EXACTLY the words the user asked for: no embellishment, no added greetings, emoji, sign-offs or extra " +
          "sentences, no rephrasing beyond turning 'tell Finn I'm running late' into \"I'm running late\". " +
          "Messages on yapping are human; never compose a message on your own initiative.",
        input: object(
          { chat: CHAT_ARG, text: { type: "string", description: "The user's message, verbatim, as it should appear." } },
          ["chat", "text"],
        ),
        async execute(input: { chat: string; text: string }, context: ToolContext) {
          const state = await snapshot()
          if (typeof state === "string") return { content: state }
          const chat = resolveChat(state, input.chat)
          if (!chat)
            return { content: `No chat matches "${input.chat}". Chats: ${state.chats.map((c) => `${chatTitle(state, c)} (${c.id})`).join(", ")}` }
          const text = String(input.text ?? "").trim()
          if (!text) return { content: "Refusing to send an empty message." }
          await context?.progress?.({ title: `yapping → ${chatTitle(state, chat)}` }).catch(() => {})
          const res = await yap.action({ t: "send", chatId: chat.id, text, client: LOCAL, agent: true }).catch((err) => ({ error: String(err) }))
          if (res?.error) return { content: `Send failed: ${res.error}` }
          const via = chat.transport === "yap" ? "" : ` via ${bridgeName(chat.transport)}`
          return {
            content: `Sent to ${chatTitle(state, chat)}${via} at ${time(res.message?.ts ?? Date.now())}: "${text}"`,
            metadata: { chatId: chat.id, messageId: res.message?.id },
          }
        },
      })

      tools.add({
        name: "yap_pending",
        options: { codemode: false },
        description:
          "List what's waiting for the user's approval on yapping (e.g. 'Send Theo \"Acme API docs v3.pdf\"?'), so you " +
          "can tell them. Approving is the user's job: point them to /yap (ctrl+y approve, ctrl+n not now).",
        input: object({}),
        async execute() {
          const state = await snapshot()
          if (typeof state === "string") return { content: state }
          const ready = pending(state)
          if (!ready.length) return { content: "Nothing is waiting for the user's approval." }
          const out = [`${ready.length} waiting for the user's approval:`]
          for (const a of ready) {
            const chat = state.chats.find((c) => c.id === a.chatId)!
            const msg = (state.messages[a.chatId] || []).find((m) => m.id === a.msgId)
            out.push(`• ${chatTitle(state, chat)}: ${a.proposal?.label} — ${a.proposal?.detail ?? ""} [${a.proposal?.action}]`)
            if (msg) out.push(`    re: ${name(state, msg.from)} at ${time(msg.ts)}: "${messageText(state, msg)}"`)
            const talk = a.log.slice(-2).map((l) => `${agentLabel(state, a, l.who)}: ${l.text}`)
            if (talk.length) out.push(`    ${talk.join(" | ")}`)
          }
          out.push("", "The user approves in /yap: ctrl+y to approve, ctrl+n for not now.")
          return { content: out.join("\n"), metadata: { pending: ready.length } }
        },
      })
    })

    return async () => {
      await yap.presence("offline").catch(() => {})
    }
  },
}
