// yapping for pi — a Discord-styled full-screen chat view.
//
//  ┌rail┬──── channels ────┬──────────── messages ──────────────┬─ profile ─┐
//  │ 💬 │ Find a convo     │ @ Finn · in opencode  ◉ pi sees it │ banner    │
//  │ ── │ DIRECT MESSAGES  │  F  Finn  Today at 18:02           │ Finn      │
//  │ f26│ ● Finn        2  │ ▀▀▀ can we grab 30 min thursday?   │ @finn     │
//  │ ⇄  │ ◐ Nikita         │      ▄▄▄▄▄ ▄▄▄▄▄  Talking to Finn… │ in opencode│
//  │    │                  │      • • ▀ • • ▀  …20 min after 4  │           │
//  │    │ Luqmaan · pi     │ ⊕ Message @Finn                    │           │
//  └────┴──────────────────┴────────────────────────────────────┴───────────┘
//
// The only agent in here is *your harness's agent*, drawn as a tiny chibi of
// its mark (see shared/chibi.js) hanging under the message it's dealing with.

import { type Component, type Focusable, Input, matchesKey, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { agentLabel, canSee, chatTitle, otherHuman, presence, resolveChat, timeOf, unread, type YapClient } from "./client.ts";

// ── Discord palette (truecolour) ─────────────────────────────────────────────
export const C = {
	rail: "#1E1F22",
	side: "#2B2D31",
	main: "#313338",
	panel: "#232428",
	input: "#383A40",
	selected: "#404249",
	embed: "#2B2D31",
	chip: "#2B2D31",
	chipMine: "#373B5C",
	text: "#DBDEE1",
	header: "#F2F3F5",
	white: "#FFFFFF",
	muted: "#949BA4",
	dim: "#6D6F78",
	rule: "#3F4147",
	blurple: "#5865F2",
	online: "#23A55A",
	idle: "#F0B232",
	offline: "#80848E",
	red: "#F23F43",
	link: "#00A8FC",
	green: "#57F287",
};

// Harness marks, as in shared/chibi.js (MARKS). Dark marks get inverted on Discord's dark grey.
const MARKS: Record<string, { color: string; ink: string }> = {
	claude: { color: "#D97757", ink: "#3D1F12" },
	opencode: { color: "#1A1A1A", ink: "#FFFFFF" },
	pi: { color: "#5B6CF0", ink: "#FFFFFF" },
	codex: { color: "#10A37F", ink: "#FFFFFF" },
};

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const fg = (h: string) => `\x1b[38;2;${rgb(h).join(";")}m`;
export const bg = (h: string) => `\x1b[48;2;${rgb(h).join(";")}m`;
const B = "\x1b[1m";
const NB = "\x1b[22m";
const I = "\x1b[3m";
const NI = "\x1b[23m";
const BG0 = "\x1b[49m"; // "back to the surrounding background" — rewritten by fill()
export const paint = (h: string, s: string) => `${fg(h)}${s}\x1b[39m`;
const bold = (s: string) => `${B}${s}${NB}`;

/** Exactly `width` columns on background `h`. Nested `\x1b[49m`/resets fall back to `h`. */
export function fill(content: string, width: number, h: string): string {
	if (width <= 0) return "";
	const b = bg(h);
	const body = truncateToWidth(content, width, "…", true);
	return b + body.split("\x1b[0m").join(`\x1b[0m${b}`).split(BG0).join(b);
}
/** An inline chip/tag with its own background, returning to the surrounding one. */
const chip = (s: string, h: string) => `${bg(h)}${s}${BG0}`;
const center = (s: string, w: number) => {
	const v = visibleWidth(s);
	if (v >= w) return s;
	const l = Math.floor((w - v) / 2);
	return " ".repeat(l) + s + " ".repeat(w - v - l);
};
const statusColor = (u: any) => (u?.bridge ? C.offline : u?.status === "online" ? C.online : u?.status === "away" ? C.idle : C.offline);
const dot = (u: any) => paint(statusColor(u), u?.status === "online" ? "●" : u?.bridge ? "◌" : "◐");
const lum = (h: string) => {
	const [r, g, b] = rgb(h);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const ATTACH_BAR: Record<string, string> = { link: C.link, file: C.blurple, event: C.green };
const SETTLE_MS = 6000;

// ── the chibi: a 5×2-cell block mark with eyes ───────────────────────────────
type Pose = "up" | "down";
const EYES = { center: " • • ", left: "• •  ", right: "  • •", blink: " - - ", happy: " ^ ^ ", sleepy: " ‑ ‑ " };

export function chibi(harness: string, state: string, tick: number, phase = 0, reduced = false): [string, string] {
	let { color, ink } = MARKS[harness] ?? { color: "#5B6CF0", ink: "#FFFFFF" };
	if (lum(color) < 0.18) [color, ink] = ["#E3E5E8", color]; // opencode's black mark on dark grey
	const t = tick + phase;
	let pose: Pose = "up";
	let eyes = EYES.center;
	if (!reduced) {
		switch (state) {
			case "reading":
				eyes = [EYES.left, EYES.left, EYES.center, EYES.right, EYES.right, EYES.center][t % 6];
				break;
			case "talking":
				pose = Math.floor(t / 2) % 2 ? "down" : "up"; // jiggle
				break;
			case "working":
				pose = Math.floor(t / 4) % 2 ? "down" : "up";
				eyes = Math.floor(t / 4) % 2 ? EYES.right : EYES.center;
				break;
			case "ready":
				pose = [0, 1, 1, 0, 0, 0][t % 6] ? "up" : "down"; // hop
				break;
			case "waiting":
				eyes = t % 18 === 0 ? EYES.blink : EYES.center;
				break;
		}
	}
	if (state === "done" || state === "dismissed") {
		pose = "down";
		eyes = EYES.happy;
	}
	if (state === "sleeping") {
		pose = "down";
		eyes = EYES.sleepy;
	}
	const face = `${bg(color)}${fg(ink)}${bold(eyes)}\x1b[39m${BG0}`;
	return pose === "up" ? [face, paint(color, "▀▀▀▀▀")] : [paint(color, "▄▄▄▄▄"), face];
}

type Server = { id: string; name: string; icon: string; chats: any[] };

function initials(title: string) {
	const w = String(title).split(/[\s-]+/)[0] ?? "";
	return (w[0] ?? "#") + (w.match(/\d+/)?.[0] ?? w.slice(1, 3));
}

export function serversOf(state: any): Server[] {
	const lastTs = (c: any) => state.messages[c.id]?.at(-1)?.ts ?? 0;
	const byRecent = (a: any, b: any) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || lastTs(b) - lastTs(a);
	const dms = state.chats.filter((c: any) => c.kind === "dm" && c.transport === "yap").sort(byRecent);
	const groups = state.chats.filter((c: any) => c.kind === "group");
	const bridged = state.chats.filter((c: any) => c.kind !== "group" && c.transport !== "yap").sort(byRecent);
	const out: Server[] = [{ id: "dms", name: "Direct Messages", icon: "💬", chats: dms }];
	for (const g of groups) out.push({ id: g.id, name: String(g.title).split(/\s+/)[0], icon: initials(g.title), chats: [g] });
	if (bridged.length) out.push({ id: "bridges", name: "Bridges", icon: "⇄", chats: bridged });
	return out;
}

export interface YapViewOptions {
	initialChat?: string;
	onClose: () => void;
	reducedMotion?: boolean;
	observe?: boolean;
}

export class YapView implements Component, Focusable {
	private input = new Input();
	private _focused = false;
	private chatId: string | null = null;
	private scroll = 0;
	private showProfile = true;
	private observing: string | null = null; // assist id shown in the observation popout
	private tick = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private unsub: () => void;
	private lastTyping = 0;
	private flash: { text: string; until: number } | null = null;
	private doneSeen = new Map<string, number>(); // assist id → when we first saw it settle

	/** Settled = done/dismissed for more than SETTLE_MS: fade to a tiny mark. */
	private settled(a: any): boolean {
		if (a.state !== "done" && a.state !== "dismissed") return false;
		if (!this.doneSeen.has(a.id)) this.doneSeen.set(a.id, Date.now());
		return Date.now() - this.doneSeen.get(a.id)! > SETTLE_MS;
	}

	get focused() {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.input.focused = v;
	}

	constructor(
		private tui: TUI,
		private yap: YapClient,
		private opts: YapViewOptions,
	) {
		this.unsub = yap.subscribe((state, ev) => this.onEvent(state, ev));
		if (yap.state) {
			for (const a of Object.values(yap.state.assists || {}) as any[]) if (a.state === "done" || a.state === "dismissed") this.doneSeen.set(a.id, 0);
			this.pickInitial(yap.state);
		}
		this.timer = setInterval(() => {
			this.tick++;
			if (this.animating()) this.tui.requestRender();
		}, 160);
	}

	private get me() {
		return this.yap.opts.client; // the harness this view lives in: your agent is pi here
	}

	// ── state ────────────────────────────────────────────────────────────────
	private get state() {
		return this.yap.state;
	}

	private pickInitial(state: any) {
		const want = this.opts.initialChat ? resolveChat(state, this.opts.initialChat) : undefined;
		const lastTs = (c: any) => state.messages[c.id]?.filter((m: any) => m.kind !== "system").at(-1)?.ts ?? 0;
		const unreadChat = state.chats.filter((c: any) => unread(state, c) > 0).sort((a: any, b: any) => lastTs(b) - lastTs(a))[0];
		const pinned = state.chats.find((c: any) => c.pinned);
		this.select((want ?? unreadChat ?? pinned ?? state.chats[0])?.id ?? null);
		if (this.opts.observe) {
			const a = this.latestAssist();
			if (a) this.observing = a.id;
		}
	}

	private select(chatId: string | null) {
		if (!chatId || chatId === this.chatId) return;
		this.chatId = chatId;
		this.scroll = 0;
		this.observing = null;
		this.markRead();
	}

	private get chat() {
		return this.state?.chats.find((c: any) => c.id === this.chatId);
	}

	private markRead() {
		const c = this.chat;
		if (c && unread(this.state, c) > 0) this.yap.send({ t: "read", chatId: c.id });
	}

	private onEvent(state: any, ev: any) {
		if (!this.chatId && state) this.pickInitial(state);
		if (ev?.type === "message" && ev.chatId === this.chatId && ev.message.from !== state.me) this.markRead();
		this.tui.requestRender();
	}

	private assistsIn(chatId: string): any[] {
		return Object.values(this.state?.assists || {}).filter((a: any) => a.chatId === chatId) as any[];
	}

	private latestAssist(): any {
		if (!this.chatId) return null;
		return this.assistsIn(this.chatId)
			.filter((a) => a.log?.length || a.state === "ready")
			.sort((a, b) => b.startedAt - a.startedAt)[0];
	}

	private readyHere(): any {
		const c = this.chat;
		if (!c || !canSee(this.state, c)) return null;
		return this.assistsIn(c.id)
			.filter((a) => a.state === "ready")
			.sort((a, b) => b.startedAt - a.startedAt)[0];
	}

	private animating() {
		const s = this.state;
		if (!s) return true;
		if (this.flash && this.flash.until > Date.now()) return true;
		if (this.chat && canSee(s, this.chat) && this.assistsIn(this.chatId!).some((a) => !this.settled(a) || Date.now() - (this.doneSeen.get(a.id) ?? 0) < SETTLE_MS + 1000)) return true;
		const t = s.typing?.[this.chatId ?? ""] || {};
		return Object.values(t).some((until: any) => until > Date.now());
	}

	private toast(text: string) {
		this.flash = { text, until: Date.now() + 2500 };
		this.tui.requestRender();
	}

	// ── input ────────────────────────────────────────────────────────────────
	handleInput(data: string): void {
		const s = this.state;
		if (this.observing) {
			if (matchesKey(data, "escape") || data === "o" || matchesKey(data, "ctrl+o") || matchesKey(data, "enter")) this.observing = null;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "escape") || (matchesKey(data, "ctrl+c") && !this.input.getValue())) {
			this.opts.onClose();
			return;
		}
		const empty = !this.input.getValue();
		const ready = s ? this.readyHere() : null;
		if (matchesKey(data, "ctrl+c")) {
			this.input.setValue("");
		} else if (!s) {
			return;
		} else if (matchesKey(data, "up") || matchesKey(data, "down")) {
			const flat = serversOf(s).flatMap((sv) => sv.chats);
			const i = flat.findIndex((c) => c.id === this.chatId);
			const next = flat[(i + (matchesKey(data, "up") ? -1 : 1) + flat.length) % flat.length];
			this.select(next?.id);
		} else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			const svs = serversOf(s);
			const i = svs.findIndex((sv) => sv.chats.some((c) => c.id === this.chatId));
			const next = svs[(i + (matchesKey(data, "tab") ? 1 : -1) + svs.length) % svs.length];
			this.select(next?.chats[0]?.id);
		} else if (matchesKey(data, "pageUp")) {
			this.scroll += 8;
		} else if (matchesKey(data, "pageDown")) {
			this.scroll = Math.max(0, this.scroll - 8);
		} else if (ready && ((empty && (data === "y" || data === "Y")) || matchesKey(data, "ctrl+y"))) {
			this.yap.send({ t: "approve", chatId: ready.chatId, assistId: ready.id });
			this.toast(`${ready.proposal?.action ?? "Approved"} ✓`);
		} else if (ready && ((empty && (data === "n" || data === "N")) || matchesKey(data, "ctrl+n"))) {
			this.yap.send({ t: "dismiss", chatId: ready.chatId, assistId: ready.id });
			this.toast("Not now");
		} else if ((empty && data === "o") || matchesKey(data, "ctrl+o")) {
			const a = this.latestAssist();
			if (a && canSee(s, this.chat)) this.observing = a.id;
			else this.toast(`nothing for ${s.harnesses?.[this.me]?.name ?? "your agent"} to show here`);
		} else if (matchesKey(data, "ctrl+s")) {
			const c = this.chat;
			if (c) {
				const on = !canSee(s, c);
				this.yap.send({ t: "set_sees", chatId: c.id, on });
				this.toast(`${s.harnesses?.[this.me]?.name ?? "pi"} ${on ? "can see" : "can't see"} this ${c.kind === "dm" ? "chat" : "channel"} now`);
			}
		} else if (matchesKey(data, "ctrl+p")) {
			const c = this.chat;
			if (c && c.transport !== "yap") {
				this.yap.send({ t: "invite_p2p", chatId: c.id });
				this.toast(`Invite sent to ${chatTitle(s, c)}`);
			}
		} else if (matchesKey(data, "ctrl+r")) {
			const m = (s.messages[this.chatId!] || []).filter((x: any) => x.kind !== "system" && x.from !== s.me).at(-1);
			if (m) this.yap.send({ t: "react", chatId: this.chatId, msgId: m.id, emoji: "😂" });
		} else if (matchesKey(data, "ctrl+t")) {
			this.showProfile = !this.showProfile;
		} else if (matchesKey(data, "enter")) {
			const text = this.input.getValue();
			const c = this.chat;
			if (text.trim() && c) {
				this.yap.send({ t: "send", chatId: c.id, text });
				this.input.setValue("");
				this.scroll = 0;
			}
		} else {
			const before = this.input.getValue();
			this.input.handleInput(data);
			const c = this.chat;
			if (c && this.input.getValue() !== before && Date.now() - this.lastTyping > 2500) {
				this.lastTyping = Date.now();
				this.yap.send({ t: "typing", chatId: c.id });
			}
		}
		this.tui.requestRender();
	}

	// ── render ───────────────────────────────────────────────────────────────
	render(width: number): string[] {
		const H = Math.max(12, this.tui.terminal.rows);
		const s = this.state;
		if (!s) return this.renderEmpty(width, H);
		if (!this.chat) this.pickInitial(s);

		const RW = width >= 50 ? 6 : 0;
		const SW = width >= 100 ? 26 : width >= 72 ? 22 : 0;
		const PW = this.showProfile && width >= 130 ? 30 : 0;
		const MW = width - RW - SW - PW;

		const rail = RW ? this.renderRail(s, H) : [];
		const side = SW ? this.renderSidebar(s, SW, H) : [];
		let main = this.renderMain(s, MW, H);
		if (this.observing) main = this.overlayObservation(s, main, MW, H);
		const panel = PW ? this.renderPanel(s, PW, H) : [];

		const out: string[] = [];
		for (let r = 0; r < H; r++) {
			out.push(
				(RW ? fill(rail[r] ?? "", RW, C.rail) : "") +
					(SW ? fill(side[r] ?? "", SW, r >= H - 2 ? C.panel : C.side) : "") +
					fill(main[r] ?? "", MW, C.main) +
					(PW ? fill(panel[r] ?? "", PW, C.panel) : ""),
			);
		}
		return out;
	}

	private renderEmpty(width: number, H: number) {
		const msg =
			this.yap.mode === "offline"
				? `relay offline at ${this.yap.opts.relay} — start it: bun relay/server.ts  (retrying…)`
				: `connecting to ${this.yap.opts.relay} as @${this.yap.user}…`;
		const lines: string[] = [];
		for (let r = 0; r < H; r++) {
			const t = r === Math.floor(H / 2) - 1 ? paint(C.header, bold(center("yapping", width))) : r === Math.floor(H / 2) ? paint(C.muted, center(msg, width)) : r === H - 1 ? paint(C.dim, " esc close") : "";
			lines.push(fill(t, width, C.main));
		}
		return lines;
	}

	private renderRail(s: any, H: number): string[] {
		const rows: string[] = [""];
		const svs = serversOf(s);
		const current = svs.find((sv) => sv.chats.some((c) => c.id === this.chatId));
		svs.forEach((sv, i) => {
			const sel = sv === current;
			const n = sv.chats.reduce((a, c) => a + unread(s, c), 0);
			const pill = sel ? paint(C.white, "▌") : n ? paint(C.white, "•") : " ";
			rows.push(`${pill}${chip(paint(C.white, bold(center(sv.icon, 4))), sel ? C.blurple : C.main)}`);
			rows.push(n ? `  ${chip(paint(C.white, bold(String(Math.min(n, 99)).padStart(2))), C.red)}` : "");
			if (i === 0) rows.push(paint(C.rule, "  ──"));
		});
		while (rows.length < H) rows.push("");
		return rows;
	}

	private renderSidebar(s: any, W: number, H: number): string[] {
		const rows: string[] = [];
		const svs = serversOf(s);
		const sv = svs.find((x) => x.chats.some((c) => c.id === this.chatId)) ?? svs[0];
		const users = s.users;
		const pi = MARKS[this.me]?.color ?? C.blurple;
		const item = (c: any, label: string, left: string) => {
			const sel = c.id === this.chatId;
			const n = unread(s, c);
			const pending = canSee(s, c) && this.assistsIn(c.id).some((a) => a.state === "ready");
			const name = sel || n ? paint(C.white, n ? bold(label) : label) : paint(C.muted, label);
			const badge = (pending ? `${paint(pi, bold("▪!"))} ` : "") + (n ? chip(paint(C.white, bold(` ${n} `)), C.red) : "");
			const room = W - 2 - visibleWidth(badge);
			const line = truncateToWidth(` ${left} ${name}`, room, "…", true) + badge;
			return sel ? `${bg(C.selected)}${truncateToWidth(line, W - 1, "…", true)}${BG0}` : line;
		};
		const header = (t: string) => rows.push(paint(C.muted, bold(` ${t.toUpperCase()}`)));
		const preview = (c: any) => {
			const last = (s.messages[c.id] || []).filter((m: any) => m.kind !== "system").at(-1);
			if (!last) return;
			const t = last.kind === "attachment" ? `${last.attachment?.title ?? "attachment"}` : last.text;
			rows.push(paint(C.dim, truncateToWidth(`    ${last.from === s.me ? "you: " : ""}${t}`, W - 1, "…")));
		};

		if (sv.id === "dms") {
			rows.push(` ${chip(paint(C.muted, truncateToWidth(" Find a conversation", W - 3, "…", true)), C.rail)}`);
			rows.push(paint(C.rail, "▔".repeat(W)));
			rows.push("");
			header("Direct Messages");
			for (const c of sv.chats) {
				rows.push(item(c, `${chatTitle(s, c)}${c.pinned ? " 📌" : ""}`, dot(otherHuman(s, c))));
				preview(c);
			}
		} else if (sv.id === "bridges") {
			rows.push(paint(C.header, bold(` ${sv.name}`)) + paint(C.muted, "  ⌄"));
			rows.push(paint(C.rail, "▔".repeat(W)));
			rows.push("");
			for (const c of sv.chats) {
				rows.push(item(c, chatTitle(s, c), dot(otherHuman(s, c))));
				rows.push(paint(C.dim, `    ${s.bridges?.[c.transport]?.name ?? c.transport}`));
			}
		} else {
			const chat = sv.chats[0];
			rows.push(paint(C.header, bold(` ${sv.name}`)) + paint(C.muted, "  ⌄"));
			rows.push(paint(C.rail, "▔".repeat(W)));
			rows.push("");
			header("Text channels");
			rows.push(item(chat, String(chat.title).replace(/\s+/g, "-"), paint(C.muted, "#")));
			rows.push("");
			const members = chat.members.map((id: string) => users[id]).filter(Boolean);
			header(`Members — ${members.length}`);
			for (const u of members) {
				const h = u.status === "online" ? s.harnesses?.[u.harness]?.name : null;
				rows.push(truncateToWidth(` ${dot(u)} ${paint(u.status === "online" ? C.text : C.muted, u.name)}${h ? paint(C.dim, ` · ${h}`) : ""}`, W - 1, "…"));
			}
		}
		// user panel (Discord's bottom-left)
		const me = users[s.me];
		const h = s.harnesses?.[this.me];
		while (rows.length < H - 2) rows.push("");
		rows.length = H - 2;
		rows.push(` ${chip(paint("#1E1F22", bold(` ${me?.name?.[0] ?? "?"} `)), me?.color ?? C.blurple)} ${paint(C.header, bold(me?.name ?? s.me))}`);
		const live = this.yap.mode === "live";
		rows.push(`     ${paint(live ? C.online : C.offline, live ? "●" : "○")} ${paint(C.muted, `${live ? "online" : this.yap.mode} in ${h?.name ?? this.me}`)}`);
		return rows;
	}

	private seesToggle(s: any, c: any): string {
		const name = s.harnesses?.[this.me]?.name ?? "pi";
		const where = c.kind === "dm" ? "chat" : "channel";
		return canSee(s, c)
			? `${paint(MARKS[this.me]?.color ?? C.blurple, "◉")} ${paint(C.muted, `${name} can see this ${where}`)}`
			: `${paint(C.dim, "○")} ${paint(C.dim, `${name} can't see this ${where}`)}`;
	}

	private renderMain(s: any, W: number, H: number): string[] {
		const c = this.chat;
		const rows: string[] = [];
		// header
		let head = "";
		if (c?.kind === "dm") {
			const o = otherHuman(s, c);
			const src = c.transport !== "yap" ? `  ${paint(C.rule, "│")} ${paint(C.dim, s.bridges?.[c.transport]?.name ?? c.transport)}` : "";
			head = ` ${paint(C.muted, "@")} ${paint(C.header, bold(chatTitle(s, c)))}  ${dot(o)} ${paint(C.muted, presence(s, this.yap.sim, o))}${src}`;
		} else if (c) {
			head = ` ${paint(C.muted, "#")} ${paint(C.header, bold(String(c.title).replace(/\s+/g, "-")))}  ${paint(C.rule, "│")} ${paint(C.muted, `${c.members.length} people`)}`;
		}
		const right = `${c ? this.seesToggle(s, c) : ""}  ${this.yap.mode === "live" ? paint(C.online, "● live") : paint(C.idle, `○ ${this.yap.mode}`)} `;
		rows.push(truncateToWidth(head, W - visibleWidth(right), "…", true) + right);
		rows.push(paint(C.rail, "▀".repeat(W)));

		// messages
		const bridgeLine = c && c.transport !== "yap" ? 1 : 0;
		const mh = H - 5 - bridgeLine;
		const lines = c ? this.messageLines(s, c, W) : [];
		const maxScroll = Math.max(0, lines.length - mh);
		if (this.scroll > maxScroll) this.scroll = maxScroll;
		const end = lines.length - this.scroll;
		const view = lines.slice(Math.max(0, end - mh), end);
		for (let i = view.length; i < mh; i++) rows.push("");
		rows.push(...view);

		// one quiet line for bridged chats
		if (bridgeLine) {
			const note = s.bridges?.[c.transport]?.note ?? "";
			rows.push(`  ${paint(C.dim, `${note}  `)}${paint(C.muted, "ctrl+p")} ${paint(C.link, "Invite to yapping")}`);
		}
		rows.push(this.statusLine(s, c, W));
		rows.push(this.inputLine(s, c, W));
		const ready = this.readyHere();
		const hints = [
			"⏎ send",
			"↑↓ chat",
			"tab server",
			...(ready ? ["y/n approve"] : []),
			"o observe",
			`ctrl+s ${s.harnesses?.[this.me]?.name ?? "pi"} sees`,
			...(c && c.transport !== "yap" ? ["ctrl+p invite"] : []),
			"ctrl+r 😂",
			"ctrl+t profile",
			"esc close",
		];
		rows.push(paint(C.dim, truncateToWidth(` ${hints.join(" · ")}${this.scroll ? `   ↑ ${this.scroll} lines up` : ""}`, W, "…")));
		return rows;
	}

	private statusLine(s: any, c: any, W: number): string {
		if (this.flash && this.flash.until > Date.now()) return `  ${paint(C.green, this.flash.text)}`;
		if (!c) return "";
		const typing = Object.entries(s.typing?.[c.id] || {})
			.filter(([u, until]: any) => until > Date.now() && u !== s.me)
			.map(([u]) => s.users[u]?.name ?? u);
		if (!typing.length) return "";
		const dots = ["•  ", "•• ", "•••", " ••", "  •", "   "][this.tick % 6];
		return truncateToWidth(`  ${paint(C.header, dots)} ${paint(C.text, bold(typing.join(", ")))} ${paint(C.muted, typing.length > 1 ? "are typing…" : "is typing…")}`, W, "…");
	}

	private inputLine(s: any, c: any, W: number): string {
		const inner = W - 4;
		let content = "";
		if (c) {
			const v = this.input.getValue();
			if (!v) {
				const ph = c.kind === "dm" ? `Message @${chatTitle(s, c)}` : `Message #${String(c.title).replace(/\s+/g, "-")}`;
				content = `${paint(C.muted, " ⊕  ")}${this._focused ? "\x1b[7m \x1b[27m" : ""}${paint(C.dim, ph)}`;
			} else {
				const rendered = this.input.render(inner - 4)[0] ?? "";
				content = `${paint(C.muted, " ⊕  ")}${paint(C.text, rendered.replace(/^> /, ""))}`;
			}
		}
		return `  ${chip(truncateToWidth(content, inner, "…", true), C.input)}`;
	}

	// ── message list ────────────────────────────────────────────────────────
	private messageLines(s: any, c: any, W: number): string[] {
		const out: string[] = [];
		const body = W - 6;
		const msgs: any[] = s.messages[c.id] || [];
		const sees = canSee(s, c);

		const title = c.kind === "dm" ? chatTitle(s, c) : String(c.title).replace(/\s+/g, "-");
		out.push("");
		out.push(` ${paint(C.header, bold(c.kind === "dm" ? title : `Welcome to #${title}!`))}`);
		const intro =
			c.kind === "dm"
				? `This is the beginning of your direct message history with @${title}.${c.transport !== "yap" ? ` Bridged from ${s.bridges?.[c.transport]?.name}.` : ""}`
				: `This is the start of the #${title} channel.`;
		for (const l of wrapTextWithAnsi(intro, W - 2)) out.push(` ${paint(C.muted, l)}`);
		out.push("");

		// latest assist per message (only your own agent's; only when it can see the chat)
		const byMsg = new Map<string, any>();
		if (sees) for (const a of this.assistsIn(c.id)) if (!byMsg.has(a.msgId) || byMsg.get(a.msgId).startedAt < a.startedAt) byMsg.set(a.msgId, a);

		let prev: any = null;
		let prevDay = "";
		for (const m of msgs) {
			const day = new Date(m.ts).toDateString();
			if (day !== prevDay) {
				const label = day === new Date().toDateString() ? "Today" : new Date(m.ts).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
				const side = Math.max(2, Math.floor((W - visibleWidth(label) - 4) / 2));
				out.push(paint(C.rule, ` ${"─".repeat(side - 1)} `) + paint(C.muted, bold(label)) + paint(C.rule, ` ${"─".repeat(side - 1)}`));
				prevDay = day;
				prev = null;
			}
			if (m.kind === "system") {
				out.push("");
				out.push(paint(C.muted, center(`— ${m.text} —`, W)));
				prev = null;
				continue;
			}
			const u = s.users[m.from];
			const a = byMsg.get(m.id);
			const settled = a && this.settled(a);
			const cont = prev && prev.from === m.from && m.kind === "text" && prev.kind === "text" && m.ts - prev.ts < 7 * 60000 && !(settled && a);
			const bodyLines: string[] = [];
			if (m.kind === "attachment") bodyLines.push(...this.attachment(s, m, Math.min(body - 1, 64)));
			else for (const l of wrapTextWithAnsi(m.text || "", body)) bodyLines.push(paint(C.text, l));
			if (!cont) {
				if (prev) out.push("");
				out.push(` ${this.avatarTop(u)} ${this.nameTag(s, u, m, settled ? a : null)}`);
				out.push(` ${this.avatarBottom(u)} ${bodyLines.shift() ?? ""}`);
			}
			for (const l of bodyLines) out.push(`      ${l}`);
			const reacts = Object.entries(m.reactions || {}).filter(([, ids]: any) => ids.length) as [string, string[]][];
			if (reacts.length) {
				out.push(
					`      ${reacts
						.map(([e, ids]) => {
							const mine = ids.includes(s.me);
							return chip(`${paint(C.muted, "[")}${e} ${paint(mine ? "#C9CDFB" : C.text, bold(String(ids.length)))}${paint(C.muted, "]")}`, mine ? C.chipMine : C.chip);
						})
						.join(" ")}`,
				);
			}
			if (a && !settled) out.push(...this.assistLines(s, a, body));
			prev = m;
		}
		out.push("");
		return out;
	}

	/** The chibi(s) hanging under a message, plus its one line (and a proposal when ready). */
	private assistLines(s: any, a: any, width: number): string[] {
		const reduced = !!this.opts.reducedMotion;
		const agents: any[] = a.agents?.length ? a.agents : [{ owner: s.me, harness: this.me }];
		const harnessOf = (ag: any) => (ag.owner === s.me ? this.me : ag.harness);
		const two = a.state === "talking" && agents.length > 1;
		const marks = (two ? agents.slice(0, 2) : agents.slice(0, 1)).map((ag, i) => chibi(harnessOf(ag), a.state, this.tick, i * 2, reduced));
		const top = marks.map((m) => m[0]).join(" ");
		const bot = marks.map((m) => m[1]).join(" ");
		const w = visibleWidth(top);
		const room = Math.max(0, width - w - 3);
		const pi = MARKS[this.me]?.color ?? C.blurple;
		const lastLog = a.log?.at(-1);
		let l1 = "";
		let l2 = "";
		const extra: string[] = [];
		if (a.state === "ready" && a.proposal) {
			const bang = !reduced && this.tick % 6 < 3 ? paint(C.idle, bold("!")) : paint(C.idle, "!");
			l1 = `${bang} ${paint(C.header, bold(a.proposal.label))}`;
			l2 = paint(C.muted, a.proposal.detail ?? "");
			extra.push(
				`      ${" ".repeat(w + 1)} ${chip(paint(C.white, bold(` y  ${a.proposal.action ?? "Approve"} `)), C.blurple)} ${chip(paint(C.text, " n  Not now "), C.selected)}  ${paint(C.dim, "o  what happened")}`,
			);
		} else if (a.state === "done" || a.state === "dismissed") {
			l1 = paint(C.muted, a.line ?? "");
		} else {
			const label = a.state === "talking" ? a.line : a.state === "waiting" ? a.line : a.line;
			l1 = `${paint(pi, "·")} ${paint(C.muted, label ?? a.state)}`;
			if (lastLog && (a.state === "talking" || a.state === "working")) {
				const who = lastLog.who === "mine" ? (s.harnesses?.[this.me]?.name ?? "pi") : agentLabel(s, this.yap.sim, agents[1] ?? agents[0], this.me);
				l2 = `${I}${paint(C.dim, `${who}: ${lastLog.text}`)}${NI}`;
			} else if (a.log?.length) l2 = paint(C.dim, "o  observe");
		}
		return [`      ${top}  ${truncateToWidth(l1, room, "…")}`, `      ${bot}  ${truncateToWidth(l2, room, "…")}`, ...extra];
	}

	private overlayObservation(s: any, main: string[], W: number, H: number): string[] {
		const a = s.assists?.[this.observing!];
		if (!a) {
			this.observing = null;
			return main;
		}
		const bw = Math.min(W - 6, 72);
		const inner = bw - 4;
		const lines: string[] = [];
		const name = s.harnesses?.[this.me]?.name ?? "pi";
		const [t1, t2] = chibi(this.me, a.state, this.tick, 0, !!this.opts.reducedMotion);
		lines.push(`${t1}  ${paint(C.header, bold(`What ${name} is doing`))}`);
		lines.push(`${t2}  ${paint(C.muted, truncateToWidth(a.line ?? a.state, inner - 8, "…"))}`);
		lines.push(paint(C.rule, "─".repeat(inner)));
		const agents: any[] = a.agents || [];
		const entries = a.log?.length ? a.log : [{ who: "mine", text: "Nothing to show yet", at: a.startedAt }];
		for (const e of entries) {
			const who = e.who === "mine" ? name : agentLabel(s, this.yap.sim, agents.find((x) => x.owner !== s.me) ?? { owner: "?", harness: "agent" }, this.me);
			const color = e.who === "mine" ? (MARKS[this.me]?.color ?? C.blurple) : C.idle;
			lines.push(`${paint(C.dim, timeOf(e.at))}  ${paint(color, bold(who))}`);
			for (const l of wrapTextWithAnsi(e.text, inner - 7)) lines.push(`       ${paint(C.text, l)}`);
		}
		if (a.proposal && a.state === "ready") {
			lines.push("");
			lines.push(`${paint(C.idle, "!")} ${paint(C.header, a.proposal.label)}`);
		}
		lines.push("");
		lines.push(paint(C.dim, "esc close · this is the only place agent-to-agent talk shows up"));
		const box = [
			chip(paint(C.rule, `╭${"─".repeat(bw - 2)}╮`), C.panel),
			...lines.slice(0, H - 8).map((l) => `${chip(`${paint(C.rule, "│")} ${truncateToWidth(l, inner, "…", true).split("\x1b[0m").join(`\x1b[0m${bg(C.panel)}`)} ${paint(C.rule, "│")}`, C.panel)}`),
			chip(paint(C.rule, `╰${"─".repeat(bw - 2)}╯`), C.panel),
		];
		const top = Math.max(2, Math.floor((H - box.length) / 2) - 1);
		const left = Math.floor((W - bw) / 2);
		const out = [...main];
		box.forEach((l, i) => {
			if (top + i < H - 3) out[top + i] = `${paint(C.main, "")}${" ".repeat(left)}${l}`;
		});
		return out;
	}

	private avatarTop(u: any): string {
		if (!u) return "   ";
		return chip(paint("#1E1F22", bold(` ${u.name[0]} `)), u.color);
	}
	private avatarBottom(u: any): string {
		return u ? paint(u.color, "▀▀▀") : "   ";
	}

	private nameTag(s: any, u: any, m: any, settled: any): string {
		const t = new Date(m.ts);
		const yday = new Date(Date.now() - 86400000).toDateString();
		const day = t.toDateString() === new Date().toDateString() ? "Today at" : t.toDateString() === yday ? "Yesterday at" : t.toLocaleDateString("en-GB");
		const when = paint(C.dim, `${day} ${t.toTimeString().slice(0, 5)}`);
		let tag = paint(u?.color ?? C.text, bold(u?.name ?? m.from));
		if (m.via && m.via !== "yap" && s.bridges?.[m.via]) tag += ` ${paint(C.dim, s.bridges[m.via].name)}`;
		// a settled assist fades to a tiny idle mark next to the timestamp
		const mark = settled ? `  ${paint(MARKS[this.me]?.color ?? C.blurple, "▪")}${paint(C.dim, settled.state === "dismissed" ? "" : "✓")}` : "";
		return `${tag}  ${when}${mark}`;
	}

	private attachment(s: any, m: any, W: number): string[] {
		const a = m.attachment || {};
		const bar = paint(ATTACH_BAR[a.type] ?? C.blurple, "▌");
		const icon = a.type === "event" ? "📅" : a.type === "file" ? "📎" : "🔗";
		const lines = [paint(a.type === "link" ? C.link : C.header, bold(`${icon}  ${a.title ?? a.type}`))];
		if (a.subtitle) lines.push(paint(C.muted, a.subtitle));
		const out = lines.map((l) => `${bar}${chip(truncateToWidth(` ${l}`, W - 1, "…", true).split("\x1b[0m").join(`\x1b[0m${bg(C.embed)}`), C.embed)}`);
		if (m.assistedBy) out.push(paint(C.dim, `sent with ${s.harnesses?.[m.assistedBy]?.name ?? m.assistedBy}`));
		return out;
	}

	// ── right panel: the person's profile ───────────────────────────────────
	private renderPanel(s: any, W: number, H: number): string[] {
		const c = this.chat;
		const rows: string[] = [];
		if (!c) return rows;
		const o = c.kind === "dm" ? otherHuman(s, c) : null;
		const bannerColor = o?.color ?? C.blurple;
		rows.push(chip(" ".repeat(W), bannerColor));
		rows.push(chip(" ".repeat(W), bannerColor));
		if (o) {
			rows.push(` ${chip(paint("#1E1F22", bold(` ${o.name[0]} `)), o.color)} ${dot(o)}`);
			rows.push(` ${paint(C.header, bold(o.name))}`);
			rows.push(` ${paint(C.muted, o.handle ?? "")}`);
			rows.push(` ${paint(C.text, presence(s, this.yap.sim, o))}`);
			if (c.transport !== "yap") rows.push(` ${paint(C.dim, `via ${s.bridges?.[c.transport]?.name}`)}`);
		} else {
			rows.push(` ${paint(C.header, bold(`# ${String(c.title).replace(/\s+/g, "-")}`))}`);
			rows.push(` ${paint(C.muted, `${c.members.length} people`)}`);
		}
		rows.push("");
		rows.push(paint(C.rule, ` ${"─".repeat(W - 2)}`));
		rows.push(` ${this.seesToggle(s, c)}`);
		rows.push(` ${paint(C.dim, "ctrl+s to change")}`);
		while (rows.length < H) rows.push("");
		return rows.slice(0, H);
	}

	invalidate(): void {}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.unsub();
	}
}
