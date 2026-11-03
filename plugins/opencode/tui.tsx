/** @jsxImportSource @opentui/solid */
// yapping — opencode v2 TUI plugin.
//
//   /yap  (or <leader>p)   full-screen yapping: chats, messages, composer
//   /yap-panel             the same as a side panel next to the current session
//   /yap-send finn hey     send without leaving the prompt
//   /yap-waiting           what opencode has ready for your approval
//   sidebar + prompt footer show unread counts and opencode's chibi when busy;
//   a toast pops when a message arrives or something is ready for you.
//
// People text people. opencode never posts: it shows up only as a tiny chibi
// of its logo under the message it's dealing with, in chats you let it see.
//
// `@opentui/solid`, `@opentui/core` and `solid-js` come from opencode's
// runtime plugin support, so this file has no install step.

import { TextAttributes, type InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import {
  agentLabel,
  applyEvent,
  assistFor,
  bridgeName,
  bridgeNote,
  busy,
  chatTitle,
  harnessName,
  harnessOf,
  LOCAL,
  messageText,
  pending,
  presence,
  relayClient,
  resolveChat,
  sees,
  sortedChats,
  time,
  totalUnread,
  unread,
  type Assist,
  type Chat,
  type Msg,
  type State,
} from "./lib/core.ts"

// PostHog-ish palette. A v2 plugin can only read the host theme (it can't
// install one), so yapping's own surfaces paint with these explicitly.
const PH = {
  beige: "#EEEFE9",
  beigeDim: "#E5E7E0",
  orange: "#F54E00",
  blue: "#1D4AFF",
  blueSoft: "#6E8BFF",
  yellow: "#F7A501",
  ink: "#23251D",
  gray: "#9EA096",
  line: "#4D4F46",
  white: "#FFFFFF",
}

// Chibi bodies: each harness's mark as a tiny face in three cells between two
// half blocks (▐ face ▌). opencode = dark rounded square with an orange bar.
const BODY: Record<string, { body: string; eye: string; mouth: string }> = {
  opencode: { body: "#3A3B36", eye: "#FFFFFF", mouth: "#F5A742" },
  claude: { body: "#D97757", eye: "#3D1F12", mouth: "#3D1F12" },
  pi: { body: "#5B6CF0", eye: "#FFFFFF", mouth: "#FFFFFF" },
  codex: { body: "#10A37F", eye: "#E8F7F1", mouth: "#E8F7F1" },
}
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const TALK = ["⠂", "⠆", "⠖", "⠶", "⠖", "⠆"]
const SETTLE_MS = 6000

type Ctx = any
type Look = "idle" | "reading" | "waiting" | "talking" | "working" | "ready" | "done" | "sleeping"

export default {
  id: "yapping",
  setup(ctx: Ctx) {
    const yap = relayClient(ctx.options ?? {})
    const [store, setStore] = createStore({
      s: undefined as State | undefined,
      mode: "connecting" as "connecting" | "live" | "offline",
      selected: "",
      viewing: "",
    })
    const [frame, setFrame] = createSignal(0)
    const ticker = setInterval(() => setFrame((f) => (f + 1) % 6000), 140)
    const settledAt = new Map<string, number>() // assist id → when we saw it finish
    const toasted = new Set<string>()

    // ── relay connection ─────────────────────────────────────────────────
    let ws: WebSocket | undefined
    let disposed = false
    let retry = 500
    const connect = () => {
      if (disposed) return
      try {
        ws = new WebSocket(yap.wsUrl(LOCAL))
      } catch {
        return schedule()
      }
      ws.onopen = () => (retry = 500)
      ws.onmessage = (e) => {
        let ev: any
        try {
          ev = JSON.parse(String(e.data))
        } catch {
          return
        }
        if (ev.type === "snapshot") {
          for (const a of Object.values(ev.state.assists as Record<string, Assist>)) if (a.state === "ready") toasted.add(a.id)
          setStore("s", ev.state)
          setStore("mode", "live")
          if (!store.selected || !ev.state.chats.some((c: Chat) => c.id === store.selected))
            setStore("selected", sortedChats(ev.state)[0]?.id ?? "")
          return
        }
        setStore(produce((draft) => void (draft.s && applyEvent(draft.s, ev))))
        if (ev.type === "message") onMessage(ev.message as Msg)
        if (ev.type === "assist") onAssist(ev.assist as Assist)
      }
      ws.onclose = () => {
        setStore("mode", "offline")
        schedule()
      }
      ws.onerror = () => ws?.close()
    }
    const schedule = () => {
      if (disposed) return
      setTimeout(connect, retry)
      retry = Math.min(retry * 2, 10_000)
    }
    connect()

    const onMessage = (m: Msg) => {
      const s = store.s
      if (!s || m.from === s.me || m.kind === "system") return
      const chat = s.chats.find((c) => c.id === m.chatId)
      if (!chat) return
      if (store.viewing === m.chatId) return void yap.action({ t: "read", chatId: m.chatId }).catch(() => {})
      const who = s.users[m.from]?.name ?? m.from
      const via = chat.transport === "yap" ? "" : ` · ${bridgeName(chat.transport)}`
      const title = `${who}${chat.kind === "dm" ? "" : ` in ${chatTitle(s, chat)}`}${via}`
      const text = messageText(s, m)
      ctx.ui.toast.show({ title, message: text.length > 140 ? text.slice(0, 139) + "…" : text, variant: "info", duration: 5000 })
      void ctx.attention?.notify({ title: `yapping · ${title}`, message: text, notification: { when: "blurred" }, sound: false }).catch(() => {})
    }

    const onAssist = (a: Assist) => {
      if ((a.state === "done" || a.state === "dismissed") && !settledAt.has(a.id)) settledAt.set(a.id, Date.now())
      if (a.state !== "ready" || !a.proposal || toasted.has(a.id)) return
      toasted.add(a.id)
      if (store.viewing === a.chatId) return // it's right there under the message
      ctx.ui.toast.show({
        title: `${LOCAL} has something ready`,
        message: `${a.proposal.label}  (/yap · ctrl+y)`,
        variant: "info",
        duration: 6000,
      })
    }

    // ── actions ──────────────────────────────────────────────────────────
    const act = (a: Record<string, unknown>) =>
      yap.action({ client: LOCAL, ...a }).then(
        (res: any) => (res?.error ? ctx.ui.toast.show({ variant: "warning", title: "yapping", message: res.error }) : res),
        (err: unknown) => ctx.ui.toast.show({ variant: "error", title: "yapping", message: String(err) }),
      )
    const currentChat = () => store.s?.chats.find((c) => c.id === store.selected)
    const select = (id: string) => setStore("selected", id)
    const move = (dir: number) => {
      if (!store.s) return
      const list = sortedChats(store.s)
      const i = list.findIndex((c) => c.id === store.selected)
      select(list[(i + dir + list.length) % list.length].id)
    }
    const latest = (list: Assist[]) => [...list].sort((a, b) => b.startedAt - a.startedAt)[0]
    const readyIn = (chatId: string) => (store.s ? latest(pending(store.s, chatId)) : undefined)
    const assistsIn = (chatId: string) => (store.s ? Object.values(store.s.assists).filter((a) => a.chatId === chatId) : [])
    const approve = (a?: Assist) => a && void act({ t: "approve", chatId: a.chatId, assistId: a.id })
    const dismiss = (a?: Assist) => a && void act({ t: "dismiss", chatId: a.chatId, assistId: a.id })
    const toggleSees = (chat?: Chat) => chat && store.s && void act({ t: "set_sees", chatId: chat.id, on: !sees(store.s, chat) })

    /** What the chibi should look like for an assist right now. */
    const look = (a: Assist): Look => {
      if (a.state === "done" || a.state === "dismissed") {
        frame()
        const at = settledAt.get(a.id) ?? 0
        return Date.now() - at < SETTLE_MS ? "done" : "idle"
      }
      return a.state as Look
    }

    // ── observation view ─────────────────────────────────────────────────
    const observe = (a?: Assist) => {
      if (!a) return ctx.ui.toast.show({ variant: "info", message: `${LOCAL} hasn't done anything in this chat yet` })
      ctx.ui.dialog.show(() => <Observe id={a.id} />)
      ctx.ui.dialog.set({ size: "large" })
    }

    // ── route: full-screen yapping ───────────────────────────────────────
    let previous: any = { type: "home" }
    const open = () => {
      const current = ctx.ui.router.current()
      if (current.type === "plugin" && current.name === "yap") return
      previous = { ...current }
      ctx.ui.dialog.clear()
      ctx.ui.router.navigate({ type: "plugin", name: "yap" })
    }
    ctx.ui.router.register({
      name: "yap",
      render: () => <YapView active={() => true} onClose={() => ctx.ui.router.navigate(previous)} />,
    })

    const reviewPending = async () => {
      const s = store.s
      if (!s) return
      const list = pending(s)
      if (!list.length) return ctx.ui.toast.show({ variant: "info", message: `Nothing waiting for you from ${LOCAL}` })
      const a = await ctx.ui.dialog.select({
        title: `${LOCAL} is waiting for you`,
        options: list.map((x) => ({
          title: x.proposal!.label,
          value: x,
          description: chatTitle(s, s.chats.find((c) => c.id === x.chatId)!),
          footer: x.proposal!.detail,
        })),
      })
      if (!a) return
      const what = await ctx.ui.dialog.select({
        title: a.proposal!.label,
        options: [
          { title: a.proposal!.action, value: "approve", description: a.proposal!.detail },
          { title: "Not now", value: "dismiss" },
          { title: `Watch what ${LOCAL} did`, value: "observe" },
        ],
      })
      if (what === "approve") approve(a)
      if (what === "dismiss") dismiss(a)
      if (what === "observe") observe(a)
    }

    // ── commands (slash, palette, keybind) ───────────────────────────────
    ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "yap.open",
              title: "yapping: open chats",
              description: "Message people without leaving opencode",
              group: "yapping",
              palette: true,
              slash: { name: "yap", aliases: ["yapping"], arguments: true },
              bind: "<leader>p",
              run(raw?: string) {
                const chat = raw?.trim() && store.s ? resolveChat(store.s, raw) : undefined
                if (chat) select(chat.id)
                open()
              },
            },
            {
              id: "yap.panel",
              title: "yapping: side panel",
              description: "Open yapping beside the current session",
              group: "yapping",
              palette: true,
              slash: { name: "yap-panel" },
              run() {
                if (ctx.ui.panel.current()?.name === "yap") return ctx.ui.panel.close()
                if (!ctx.ui.panel.open("yap")) {
                  ctx.ui.toast.show({ variant: "info", message: "The side panel needs an open session; opening /yap instead" })
                  open()
                }
              },
            },
            {
              id: "yap.waiting",
              title: "yapping: waiting for you",
              description: `What ${LOCAL} has ready for your approval`,
              group: "yapping",
              palette: true,
              slash: { name: "yap-waiting" },
              run: reviewPending,
            },
            {
              id: "yap.send",
              title: "yapping: quick send",
              description: "/yap-send <person> <message>",
              group: "yapping",
              palette: true,
              slash: { name: "yap-send", arguments: true },
              async run(raw?: string) {
                const s = store.s
                if (!s) return ctx.ui.toast.show({ variant: "warning", message: `yapping relay offline (${yap.relay})` })
                let text = (raw ?? "").trim()
                if (!text) text = (await ctx.ui.dialog.prompt({ title: "yap-send", placeholder: "finn running late, sorry!" })) ?? ""
                const [who, ...rest] = text.trim().split(/\s+/)
                const chat = who ? resolveChat(s, who) : undefined
                if (!chat || !rest.length) return ctx.ui.toast.show({ variant: "warning", message: "Usage: /yap-send <person> <message>" })
                await act({ t: "send", chatId: chat.id, text: rest.join(" ") })
                ctx.ui.toast.show({ variant: "success", title: `→ ${chatTitle(s, chat)}`, message: rest.join(" "), duration: 2500 })
              },
            },
          ],
        }))
        return null
      },
    })

    // ── side panel, sidebar, prompt footer ───────────────────────────────
    ctx.ui.slot({
      append: "session.panel",
      render: (input: any) => (
        <Show when={input.name === "yap" && ctx.ui.panel.current()?.name === "yap"}>
          <YapView compact={() => input.width < 72} active={() => input.focused} onClose={() => input.close()} panel />
        </Show>
      ),
    })
    ctx.ui.slot({ append: "sidebar.content", render: () => <YapSidebar /> })
    ctx.ui.slot({ append: "prompt.footer.status", render: () => <YapStatus /> })

    // ── components ───────────────────────────────────────────────────────

    /** A chibi in five cells: ▐°▂°▌, animated per state. */
    function Chibi(props: { harness: string; look: Look; phase?: number }) {
      const b = () => BODY[props.harness] ?? BODY.opencode
      const f = () => frame() + (props.phase ?? 0)
      const face = (): [string, string, string] => {
        switch (props.look) {
          case "reading":
            return f() % 8 < 4 ? ["•", "▂", "·"] : ["·", "▂", "•"] // eyes scan left/right
          case "talking":
            return ["°", f() % 2 ? "o" : "▂", "°"] // mouth moving
          case "ready":
            return ["°", "▿", "°"]
          case "done":
            return ["^", "▂", "^"]
          case "sleeping":
            return ["-", "▂", "-"]
          case "waiting":
            return f() % 24 === 0 ? ["-", "▂", "-"] : ["°", "▂", "°"] // blinks
          default:
            return ["°", "▂", "°"]
        }
      }
      const lead = () => {
        if (props.look === "talking") return f() % 4 < 2 ? "" : " " // jiggle
        if (props.look === "ready") return f() % 8 < 2 ? "" : " " // hop
        return ""
      }
      const trail = () => {
        if (props.look === "talking") return f() % 4 < 2 ? " " : ""
        if (props.look === "ready") return f() % 8 < 2 ? " " : ""
        return ""
      }
      const dim = () => props.look === "sleeping" || props.look === "idle"
      return (
        <span>
          {lead()}
          <span style={{ fg: dim() ? PH.line : b().body }}>▐</span>
          <span style={{ fg: dim() ? PH.gray : b().eye, bg: dim() ? PH.line : b().body }}>{face()[0]}</span>
          <span style={{ fg: dim() ? PH.gray : b().mouth, bg: dim() ? PH.line : b().body }}>{face()[1]}</span>
          <span style={{ fg: dim() ? PH.gray : b().eye, bg: dim() ? PH.line : b().body }}>{face()[2]}</span>
          <span style={{ fg: dim() ? PH.line : b().body }}>▌</span>
          {trail()}
        </span>
      )
    }

    function AssistRow(props: { a: Assist; indent: number }) {
      const s = () => store.s!
      const mine = () => props.a.agents.find((x) => x.owner === s().me) ?? props.a.agents[0]
      const theirs = () => props.a.agents.find((x) => x.owner !== s().me)
      const l = () => look(props.a)
      return (
        <box paddingLeft={props.indent} flexDirection="column" flexShrink={0} onMouseUp={() => observe(props.a)}>
          <Show
            when={l() !== "idle"}
            fallback={
              <text fg={PH.line} wrapMode="none">
                ◧
              </text>
            }
          >
            <text wrapMode="none" truncate>
              <Chibi harness={harnessOf(s(), mine())} look={l()} />
              <Show when={l() === "talking" && theirs()}>
                <span style={{ fg: PH.gray }}>{TALK[frame() % TALK.length]}</span>
                <Chibi harness={harnessOf(s(), theirs()!)} look="talking" phase={2} />
              </Show>
              <Show when={l() === "ready"}>
                <span style={{ fg: frame() % 8 < 4 ? PH.orange : PH.yellow }}>
                  <b>!</b>
                </span>
              </Show>
              <Show when={l() === "working"}>
                <span style={{ fg: PH.gray }}> {SPIN[frame() % SPIN.length]}</span>
              </Show>
              <Show
                when={l() === "ready" && props.a.proposal}
                fallback={
                  <span style={{ fg: l() === "done" ? PH.line : PH.gray }}>
                    {" "}
                    {props.a.line}
                    {l() === "waiting" ? "…" : ""}
                  </span>
                }
              >
                <span style={{ fg: PH.beige }}>
                  {" "}
                  <b>{props.a.proposal!.label}</b>
                </span>
              </Show>
            </text>
            <Show when={l() === "ready" && props.a.proposal}>
              <box paddingLeft={7} flexDirection="column">
                <Show when={props.a.proposal!.detail}>
                  <text fg={PH.gray} wrapMode="word">
                    {props.a.proposal!.detail}
                  </text>
                </Show>
                <box flexDirection="row" gap={2}>
                  <text fg={PH.white} bg={PH.orange} onMouseUp={() => approve(props.a)}>
                    {` ${props.a.proposal!.action} `}
                    <span style={{ fg: PH.beigeDim }}>ctrl+y </span>
                  </text>
                  <text fg={PH.beige} onMouseUp={() => dismiss(props.a)}>
                    Not now <span style={{ fg: PH.line }}>ctrl+n</span>
                  </text>
                  <text fg={PH.gray} onMouseUp={() => observe(props.a)}>
                    watch <span style={{ fg: PH.line }}>ctrl+l</span>
                  </text>
                </box>
              </box>
            </Show>
          </Show>
        </box>
      )
    }

    function Observe(props: { id: string }) {
      const s = () => store.s!
      const a = () => s()?.assists[props.id]
      const chat = () => s()?.chats.find((c) => c.id === a()?.chatId)
      const msg = () => (a() ? (s().messages[a()!.chatId] ?? []).find((m) => m.id === a()!.msgId) : undefined)
      return (
        <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} flexDirection="column">
          <Show when={a()} fallback={<text fg={PH.gray}>Gone.</text>}>
            <box flexDirection="row" justifyContent="space-between">
              <text>
                <Chibi harness={LOCAL} look={look(a()!) === "idle" ? "done" : look(a()!)} />
                <b>
                  <span style={{ fg: PH.beige }}> What your {LOCAL} is doing</span>
                </b>
                <span style={{ fg: PH.gray }}> · {chat() ? chatTitle(s(), chat()!) : ""}</span>
              </text>
              <text fg={PH.gray} onMouseUp={() => ctx.ui.dialog.clear()}>
                esc
              </text>
            </box>
            <Show when={msg()}>
              <text fg={PH.gray} wrapMode="word">
                re {msg()!.from === s().me ? "your" : `${s().users[msg()!.from]?.name}'s`} message at {time(msg()!.ts)}: "
                {messageText(s(), msg()!)}"
              </text>
            </Show>
            <box flexDirection="column">
              <For each={a()!.log} fallback={<text fg={PH.gray}>Nothing yet. {a()!.line}</text>}>
                {(entry) => (
                  <text wrapMode="word">
                    <span style={{ fg: PH.line }}>{time(entry.at)} </span>
                    <span style={{ fg: entry.who === "mine" ? PH.orange : PH.blueSoft }}>
                      {agentLabel(s(), a()!, entry.who)}
                    </span>
                    <span style={{ fg: PH.beige }}> {entry.text}</span>
                  </text>
                )}
              </For>
            </box>
            <text fg={PH.gray}>
              now: <span style={{ fg: PH.beige }}>{a()!.state === "ready" ? a()!.proposal?.label : a()!.line}</span>
            </text>
          </Show>
        </box>
      )
    }

    function MessageView(props: { m: Msg; compact: boolean; chat: Chat }) {
      const s = () => store.s!
      const user = () => s().users[props.m.from]
      const mine = () => props.m.from === s().me
      const indent = () => (props.compact ? 2 : 6)
      const assist = createMemo(() => (sees(s(), props.chat) ? assistFor(s(), props.m.id) : undefined))
      const reactions = () =>
        Object.entries(props.m.reactions ?? {})
          .map(([e, who]) => `${e}${(who as string[]).length > 1 ? (who as string[]).length : ""}`)
          .join(" ")
      const nameSpan = () => (
        <span style={{ fg: mine() ? PH.orange : (user()?.color ?? PH.beige) }}>
          <b>{mine() ? "you" : (user()?.name ?? props.m.from)}</b>
        </span>
      )
      return (
        <box flexDirection="column" flexShrink={0}>
          <Show when={props.m.kind === "system"}>
            <box flexDirection="row" justifyContent="center">
              <text fg={PH.line}>· {props.m.text} ·</text>
            </box>
          </Show>
          <Show when={props.m.kind === "text"}>
            <text wrapMode="word">
              <span style={{ fg: PH.line }}>{props.compact ? "" : time(props.m.ts) + " "}</span>
              {nameSpan()}
              <span style={{ fg: PH.beige }}> {props.m.text}</span>
              <Show when={reactions()}>
                <span style={{ fg: PH.gray }}> {reactions()}</span>
              </Show>
            </text>
          </Show>
          <Show when={props.m.kind === "attachment" && props.m.attachment}>
            <text wrapMode="none">
              <span style={{ fg: PH.line }}>{props.compact ? "" : time(props.m.ts) + " "}</span>
              {nameSpan()}
            </text>
            <box marginLeft={indent()} border={["left"]} borderColor={props.m.attachment!.type === "event" ? PH.blue : PH.yellow} paddingLeft={1}>
              <text fg={PH.beige} attributes={TextAttributes.BOLD} wrapMode="word">
                {messageText(s(), props.m).split(" · ")[0]}
              </text>
              <Show when={props.m.attachment!.subtitle}>
                <text fg={PH.gray} wrapMode="word">
                  {props.m.attachment!.subtitle}
                </text>
              </Show>
              <Show when={props.m.assistedBy}>
                <text fg={PH.line}>sent with {mine() ? LOCAL : harnessName(props.m.assistedBy!)}</text>
              </Show>
            </box>
          </Show>
          <Show when={assist()}>
            <AssistRow a={assist()!} indent={indent()} />
          </Show>
        </box>
      )
    }

    function ChatRow(props: { chat: Chat }) {
      const s = () => store.s!
      const sel = () => store.selected === props.chat.id
      const n = () => unread(s(), props.chat)
      const other = () => (props.chat.kind === "dm" ? (s().users[props.chat.members.find((m) => m !== s().me)!] as any) : undefined)
      const last = () => (s().messages[props.chat.id] ?? []).at(-1) as Msg | undefined
      const ready = () => pending(s(), props.chat.id).length
      const working = () => busy(s(), props.chat.id).length > 0
      return (
        <box
          flexDirection="column"
          flexShrink={0}
          backgroundColor={sel() ? PH.beige : undefined}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={() => select(props.chat.id)}
        >
          <box flexDirection="row" gap={1}>
            <text fg={sel() ? PH.ink : n() ? PH.beige : PH.gray} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
              <span style={{ fg: other()?.status === "online" ? PH.blueSoft : sel() ? PH.ink : PH.line }}>
                {props.chat.kind === "group" ? "#" : other()?.status === "online" ? "●" : "○"}
              </span>{" "}
              <Show when={n()} fallback={chatTitle(s(), props.chat)}>
                <b>{chatTitle(s(), props.chat)}</b>
              </Show>
              <Show when={props.chat.pinned}>
                <span style={{ fg: PH.orange }}> ◆</span>
              </Show>
            </text>
            <Show when={props.chat.transport !== "yap"}>
              <text flexShrink={0} fg={sel() ? PH.line : PH.line}>
                {bridgeName(props.chat.transport)}
              </text>
            </Show>
            <Show when={ready()}>
              <text flexShrink={0} fg={PH.orange}>
                <b>!</b>
              </text>
            </Show>
            <Show when={!ready() && working()}>
              <text flexShrink={0} fg={sel() ? PH.ink : PH.gray}>
                {SPIN[frame() % SPIN.length]}
              </text>
            </Show>
            <Show when={n()}>
              <text flexShrink={0} fg={PH.white} bg={PH.orange}>
                <b>{` ${n()} `}</b>
              </text>
            </Show>
          </box>
          <Show when={last()}>
            <box paddingLeft={2}>
              <text fg={sel() ? PH.line : PH.gray} wrapMode="none" truncate>
                {last()!.from === s().me ? "you: " : ""}
                {messageText(s(), last()!).replace(/\s+/g, " ")}
              </text>
            </box>
          </Show>
        </box>
      )
    }

    function YapView(props: { active: () => boolean; onClose: () => void; compact?: () => boolean; panel?: boolean }) {
      const dims = useTerminalDimensions()
      const compact = () => props.compact?.() ?? dims().width < 90
      const s = () => store.s
      const chat = () => currentChat()
      let input: InputRenderable | undefined
      let lastTyping = 0

      createEffect(() => {
        const c = chat()
        setStore("viewing", c?.id ?? "")
        if (c && s() && unread(s()!, c)) void act({ t: "read", chatId: c.id })
      })
      onCleanup(() => setStore("viewing", ""))
      createEffect(() => {
        if (props.active()) setTimeout(() => input && !input.isDestroyed && input.focus(), 1)
      })
      onMount(() => setTimeout(() => props.active() && input && !input.isDestroyed && input.focus(), 1))

      const send = (value: string) => {
        const c = chat()
        const text = value.trim()
        if (!c || !text) return
        void act({ t: "send", chatId: c.id, text })
        if (input) input.value = ""
      }

      ctx.keymap.layer(() => ({
        enabled: props.active,
        commands: [
          { bind: "escape", title: props.panel ? "close yapping" : "back", group: "yapping", run: props.onClose },
          { bind: "tab", title: "next chat", group: "yapping", run: () => move(1) },
          { bind: "shift+tab", title: "previous chat", group: "yapping", run: () => move(-1) },
          { bind: "ctrl+y", title: "approve", group: "yapping", run: () => approve(readyIn(store.selected)) },
          { bind: "ctrl+n", title: "not now", group: "yapping", run: () => dismiss(readyIn(store.selected)) },
          {
            bind: "ctrl+l",
            title: `watch ${LOCAL}`,
            group: "yapping",
            run: () => observe(readyIn(store.selected) ?? latest(assistsIn(store.selected))),
          },
          { bind: "ctrl+s", title: `${LOCAL} can see this chat`, group: "yapping", run: () => toggleSees(chat()) },
          {
            bind: "ctrl+b",
            title: "invite to yapping",
            group: "yapping",
            run: () => {
              const c = chat()
              if (c && c.transport !== "yap") void act({ t: "invite_p2p", chatId: c.id })
            },
          },
        ],
      }))

      const messages = createMemo(() => (chat() && s() ? (s()!.messages[chat()!.id] ?? []) : []))
      const typing = () => {
        frame()
        const c = chat()
        return c && s() ? helpersTyping(s()!, c.id) : []
      }
      const me = () => s()?.users[s()!.me]
      const canSee = () => (chat() && s() ? sees(s()!, chat()!) : false)

      return (
        <box flexDirection="column" width="100%" height="100%" backgroundColor={props.panel ? undefined : ctx.theme.background.base}>
          {/* header */}
          <box flexDirection="row" flexShrink={0} backgroundColor={PH.orange} paddingLeft={1} paddingRight={1} gap={1}>
            <text fg={PH.white} attributes={TextAttributes.BOLD} flexShrink={0}>
              yapping
            </text>
            <text fg={PH.beige} wrapMode="none" truncate flexGrow={1} minWidth={0}>
              {me() ? `${me()!.name} · in ${LOCAL}` : yap.relay}
            </text>
            <Show when={s() && pending(s()!).length}>
              <text fg={PH.ink} bg={PH.yellow} flexShrink={0}>
                <b>{` ${pending(s()!).length} waiting for you `}</b>
              </text>
            </Show>
            <Show when={totalUnread(s())}>
              <text fg={PH.ink} bg={PH.beige} flexShrink={0}>
                <b>{` ${totalUnread(s())} unread `}</b>
              </text>
            </Show>
            <text fg={store.mode === "live" ? PH.beige : PH.ink} flexShrink={0}>
              {store.mode === "live" ? "● live" : store.mode === "connecting" ? "◌ connecting" : "○ offline"}
            </text>
          </box>

          <Show
            when={s()}
            fallback={
              <box padding={2}>
                <text fg={PH.gray}>
                  {store.mode === "offline" ? `Can't reach the yapping relay at ${yap.relay}.` : "Connecting to yapping…"}
                </text>
              </box>
            }
          >
            <box flexDirection="row" flexGrow={1} minHeight={0}>
              {/* chat list */}
              <Show when={!compact()}>
                <box width={30} flexShrink={0} flexDirection="column" border={["right"]} borderColor={PH.line} paddingTop={1}>
                  <scrollbox flexGrow={1}>
                    <For each={sortedChats(s()!)}>{(c) => <ChatRow chat={c} />}</For>
                  </scrollbox>
                </box>
              </Show>

              {/* conversation */}
              <box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={1} paddingRight={1}>
                <Show when={compact()}>
                  <box flexDirection="row" flexShrink={0} gap={1} paddingTop={1} flexWrap="wrap">
                    <For each={sortedChats(s()!)}>
                      {(c) => (
                        <text
                          flexShrink={0}
                          fg={store.selected === c.id ? PH.ink : unread(s()!, c) ? PH.beige : PH.gray}
                          bg={store.selected === c.id ? PH.beige : undefined}
                          onMouseUp={() => select(c.id)}
                        >
                          {` ${chatTitle(s()!, c).split(" ")[0]}${unread(s()!, c) ? " " + unread(s()!, c) : ""}${pending(s()!, c.id).length ? " !" : ""} `}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
                <Show when={chat()}>
                  <box flexShrink={0} paddingTop={1} flexDirection="column">
                    <box flexDirection="row" gap={2}>
                      <text wrapMode="none" truncate flexGrow={1} minWidth={0}>
                        <b>
                          <span style={{ fg: PH.beige }}>{chatTitle(s()!, chat()!)}</span>
                        </b>
                        <span style={{ fg: PH.gray }}> · {presence(s()!, chat()!)}</span>
                        <Show when={chat()!.transport !== "yap" && chat()!.kind !== "dm"}>
                          <span style={{ fg: PH.line }}> · {bridgeName(chat()!.transport)}</span>
                        </Show>
                      </text>
                      <text flexShrink={0} wrapMode="none" onMouseUp={() => toggleSees(chat())}>
                        <Chibi harness={LOCAL} look={canSee() ? "idle" : "sleeping"} />
                        <Show
                          when={canSee()}
                          fallback={<span style={{ fg: PH.line }}> {LOCAL} can't see this chat</span>}
                        >
                          <span style={{ fg: PH.gray }}> {LOCAL} can see this chat</span>
                        </Show>
                        <span style={{ fg: PH.line }}> ctrl+s</span>
                      </text>
                    </box>
                    <Show when={chat()!.transport !== "yap" && bridgeNote(chat()!.transport)}>
                      <text fg={PH.line} wrapMode="word">
                        {bridgeNote(chat()!.transport)}{" "}
                        <span style={{ fg: PH.gray }} onMouseUp={() => act({ t: "invite_p2p", chatId: chat()!.id })}>
                          Invite to yapping
                        </span>{" "}
                        ctrl+b
                      </text>
                    </Show>
                  </box>
                </Show>

                <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" paddingTop={1}>
                  <For each={messages()}>{(m) => <MessageView m={m} compact={compact()} chat={chat()!} />}</For>
                </scrollbox>

                <Show when={typing().length}>
                  <text fg={PH.gray} flexShrink={0}>
                    {typing().join(", ")} is typing{".".repeat((frame() >> 2) % 4)}
                  </text>
                </Show>

                {/* composer */}
                <box flexShrink={0} border borderStyle="rounded" borderColor={props.active() ? PH.orange : PH.line} paddingLeft={1} paddingRight={1}>
                  <input
                    ref={(value: InputRenderable) => (input = value)}
                    placeholder={chat() ? `message ${chatTitle(s()!, chat()!)}…` : "pick a chat"}
                    placeholderColor={PH.line}
                    textColor={PH.beige}
                    focusedTextColor={PH.beige}
                    cursorColor={PH.orange}
                    onInput={() => {
                      const c = chat()
                      if (!c || Date.now() - lastTyping < 2500) return
                      lastTyping = Date.now()
                      void act({ t: "typing", chatId: c.id })
                    }}
                    onSubmit={(v: any) => send(typeof v === "string" ? v : (input?.value ?? ""))}
                  />
                </box>
              </box>
            </box>
          </Show>

          {/* key help */}
          <box flexDirection="row" flexShrink={0} paddingLeft={1}>
            <text fg={PH.gray} wrapMode="none" truncate>
              <span style={{ fg: PH.beige }}>tab</span> chats  <span style={{ fg: PH.beige }}>enter</span> send{"  "}
              <span style={{ fg: PH.beige }}>ctrl+y</span> approve  <span style={{ fg: PH.beige }}>ctrl+n</span> not now{"  "}
              <span style={{ fg: PH.beige }}>ctrl+l</span> watch  <span style={{ fg: PH.beige }}>ctrl+s</span> {LOCAL} sees{"  "}
              <span style={{ fg: PH.beige }}>esc</span> {props.panel ? "close" : "back"}
            </text>
          </box>
        </box>
      )
    }

    function YapSidebar() {
      const s = () => store.s
      const hot = createMemo(() => (s() ? sortedChats(s()!).filter((c) => unread(s()!, c) > 0) : []))
      const ready = createMemo(() => (s() ? pending(s()!) : []))
      const working = createMemo(() => (s() ? busy(s()!) : []))
      return (
        <box flexDirection="column" flexShrink={0}>
          <text onMouseUp={open}>
            <b>
              <span style={{ fg: PH.orange }}>yapping</span>
            </b>
            <span style={{ fg: PH.gray }}>
              {store.mode === "live" ? `  ${totalUnread(s())} unread` : store.mode === "offline" ? "  offline" : ""}
            </span>
          </text>
          <For each={hot().slice(0, 5)}>
            {(c) => (
              <box flexDirection="row" gap={1} onMouseUp={() => (select(c.id), open())}>
                <text fg={PH.beige} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                  {chatTitle(s()!, c)}
                  <Show when={c.transport !== "yap"}>
                    <span style={{ fg: PH.line }}> {bridgeName(c.transport)}</span>
                  </Show>
                </text>
                <text fg={PH.white} bg={PH.orange} flexShrink={0}>{` ${unread(s()!, c)} `}</text>
              </box>
            )}
          </For>
          <For each={ready().slice(0, 3)}>
            {(a) => (
              <text wrapMode="none" truncate onMouseUp={() => (select(a.chatId), open())}>
                <Chibi harness={LOCAL} look="ready" />
                <span style={{ fg: PH.orange }}>!</span>
                <span style={{ fg: PH.beige }}> {a.proposal?.label}</span>
              </text>
            )}
          </For>
          <Show when={!ready().length && working()[0]}>
            <text wrapMode="none" truncate>
              <Chibi harness={LOCAL} look={working()[0].state as Look} />
              <span style={{ fg: PH.gray }}> {working()[0].line}</span>
            </text>
          </Show>
        </box>
      )
    }

    function YapStatus() {
      const s = () => store.s
      const ready = createMemo(() => (s() ? pending(s()!).length : 0))
      const working = createMemo(() => (s() ? busy(s()!) : []))
      const n = () => totalUnread(s())
      return (
        <Show when={store.mode === "live" && (n() || ready() || working().length)}>
          <text flexShrink={0} wrapMode="none" onMouseUp={open}>
            <Show when={ready() || working().length}>
              <Chibi harness={LOCAL} look={ready() ? "ready" : (working()[0].state as Look)} />
              <Show when={ready()}>
                <span style={{ fg: PH.orange }}>! {ready()} </span>
              </Show>
              <span> </span>
            </Show>
            <Show when={n()}>
              <span style={{ fg: PH.white, bg: PH.orange }}>{` yap ${n()} `}</span>
            </Show>
          </text>
        </Show>
      )
    }

    function helpersTyping(state: State, chatId: string) {
      const t = state.typing?.[chatId] || {}
      const now = Date.now()
      return Object.entries(t)
        .filter(([u, until]) => until > now && u !== state.me)
        .map(([u]) => state.users[u]?.name ?? u)
    }

    return async () => {
      disposed = true
      clearInterval(ticker)
      try {
        ws?.close()
      } catch {}
    }
  },
}
