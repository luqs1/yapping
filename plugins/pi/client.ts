// yapping relay client for the pi extension.
//
// One live connection per pi process: a snapshot, then events folded in with the
// shared reducer (shared/sim.js#applyEvent). Tools fall back to plain HTTP so they
// also work in print/json/rpc mode where we never open a socket.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The relay when asked for, else this Mac's node: its URL and the token it
// wrote for local clients.
export function where(env: Record<string, string | undefined>): { relay?: string; node?: string; token?: string } {
	if (env.YAP_RELAY) return { relay: env.YAP_RELAY };
	const home = env.YAP_HOME || join(homedir(), ".yapping");
	const read = (f: string) => {
		try {
			return readFileSync(join(home, f), "utf8");
		} catch {
			return "";
		}
	};
	let port = 7790;
	try {
		port = Number(JSON.parse(read("api.json")).port) || 7790;
	} catch {}
	return { node: (env.YAP_NODE || `http://127.0.0.1:${port}`).replace(/\/$/, ""), token: read("local-token").trim() };
}

export type Sim = {
	applyEvent: (state: any, ev: any) => any;
	HARNESSES: Record<string, { name: string; color: string }>;
	BRIDGES: Record<string, { name: string; note?: string }>;
	helpers: any;
};

/** Load shared/sim.js from a packed tarball (vendor/) or from the repo checkout. */
export async function loadSim(): Promise<Sim> {
	const errors: string[] = [];
	for (const spec of ["./vendor/sim.js", "../../shared/sim.js"]) {
		try {
			return (await import(spec)) as Sim;
		} catch (e) {
			errors.push(`${spec}: ${(e as Error).message}`);
		}
	}
	throw new Error(`yapping: could not load sim.js (${errors.join("; ")})`);
}

export interface YapOptions {
	/** The demo relay (http://localhost:7788). Unset: talk to the yapping node on this Mac. */
	relay?: string;
	/** The node's local API (http://127.0.0.1:7790) and its token, when not using the relay. */
	node?: string;
	token?: string;
	user: string; // luqmaan (relay only; a node knows who you are)
	client: string; // pi
}

// The relay speaks sim.js actions; the node speaks RPC. Same shapes otherwise:
// the node's `state` is a sim snapshot and its events fold in with applyEvent.
function toRpc(a: Record<string, any>): [string, Record<string, unknown>] | null {
	switch (a.t) {
		case "send":
			return ["send", { chat: a.chatId, text: a.text, ...(a.replyTo ? { replyTo: a.replyTo } : {}), ...(a.agent ? { agent: true } : {}) }];
		case "read":
			return ["mark_read", { chat: a.chatId }];
		case "react":
			return ["react", { chat: a.chatId, msgId: a.msgId, emoji: a.emoji }];
		case "typing":
			return ["typing", { chat: a.chatId }];
		case "set_sees":
			return ["set_sees", { chat: a.chatId, on: !!a.on }];
		case "approve":
			return ["approve", { id: a.assistId }];
		case "dismiss":
			return ["dismiss", { id: a.assistId }];
		case "invite_p2p":
			return ["invite", {}];
		default:
			return null;
	}
}

type Listener = (state: any, ev: any) => void;

export class YapClient {
	state: any = null;
	mode: "idle" | "connecting" | "live" | "offline" = "idle";
	private ws: WebSocket | null = null;
	private listeners = new Set<Listener>();
	private stopped = true;
	private retry = 0;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		readonly opts: YapOptions,
		readonly sim: Sim,
	) {}

	get user() {
		return this.state?.me ?? this.opts.user;
	}

	/** Where we're talking to, for messages: the relay or the node. */
	get where() {
		return this.opts.relay ? `relay ${this.opts.relay}` : `yapping on this Mac (${this.opts.node})`;
	}

	private get viaNode() {
		return !this.opts.relay;
	}

	private async rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
		const res = await fetch(`${this.opts.node}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-yap-token": this.opts.token ?? "" },
			body: JSON.stringify({ method, params: { ...params, harness: this.opts.client } }),
			signal: signal ?? AbortSignal.timeout(6000),
		});
		const out: any = await res.json().catch(() => ({}));
		if (!res.ok || out?.error) throw new Error(out?.error?.message || `yapping node ${res.status}`);
		return out.result;
	}

	subscribe(fn: Listener) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private fire(ev: any) {
		for (const fn of this.listeners) {
			try {
				fn(this.state, ev);
			} catch {
				// a broken listener must never take the socket down
			}
		}
	}

	private url(path: string) {
		return `${this.opts.relay.replace(/\/$/, "")}${path}${path.includes("?") ? "&" : "?"}user=${encodeURIComponent(this.opts.user)}`;
	}

	async snapshot(signal?: AbortSignal): Promise<any> {
		if (this.viaNode) {
			const s = await this.rpc("state", {}, signal);
			s.typing ||= {};
			return s;
		}
		const res = await fetch(this.url("/api/snapshot"), { signal: signal ?? AbortSignal.timeout(4000) });
		if (!res.ok) throw new Error(`relay ${res.status} on /api/snapshot`);
		const s = await res.json();
		s.typing ||= {};
		return s;
	}

	/** Fresh state: the live one if the socket is up, otherwise a snapshot over HTTP. */
	async current(signal?: AbortSignal): Promise<any> {
		if (this.mode === "live" && this.state) return this.state;
		return this.snapshot(signal);
	}

	async action(action: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
		if (this.viaNode) {
			const call = toRpc(action);
			if (!call) throw new Error(`yapping: ${String(action.t)} isn't something the node does`);
			return this.rpc(call[0], call[1], signal);
		}
		const res = await fetch(this.url("/api/action"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...action, client: this.opts.client }),
			signal: signal ?? AbortSignal.timeout(4000),
		});
		if (!res.ok) throw new Error(`relay ${res.status} on /api/action`);
		const out = await res.json();
		if (out?.error) throw new Error(`relay: ${out.error}`);
		return out;
	}

	/** Fire-and-forget over the socket when live (cheap), HTTP otherwise. */
	send(action: Record<string, unknown>) {
		if (this.viaNode) return void this.action(action).catch(() => {});
		if (this.ws &&this.ws.readyState === 1) this.ws.send(JSON.stringify({ ...action, client: this.opts.client }));
		else this.action(action).catch(() => {});
	}

	/** Open the live socket (TUI mode only). Reconnects with backoff. */
	start() {
		if (!this.stopped) return;
		this.stopped = false;
		this.open();
	}

	stop() {
		this.stopped = true;
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
		this.sse?.abort();
		this.sse = null;
		try {
			this.ws?.close();
		} catch {}
		this.ws = null;
		this.mode = "idle";
	}

	// The node: a snapshot, then its server-sent events from that snapshot's seq,
	// so nothing falls in the gap. Reconnects with the same backoff.
	private sse: AbortController | null = null;
	private async openNode() {
		this.mode = "connecting";
		const ctl = new AbortController();
		this.sse = ctl;
		try {
			const state = await this.snapshot();
			if (ctl.signal.aborted) return;
			this.state = state;
			this.mode = "live";
			this.retry = 0;
			this.fire({ type: "snapshot" });
			const res = await fetch(`${this.opts.node}/events?since=${state.seq ?? 0}`, { headers: { "x-yap-token": this.opts.token ?? "" }, signal: ctl.signal });
			if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let buf = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				let i: number;
				while ((i = buf.indexOf("\n\n")) >= 0) {
					const frame = buf.slice(0, i);
					buf = buf.slice(i + 2);
					const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
					if (!data || !this.state) continue;
					let ev: any;
					try {
						ev = JSON.parse(data);
					} catch {
						continue;
					}
					const before = this.state.seq;
					this.sim.applyEvent(this.state, ev);
					if (this.state.seq !== before || !ev.seq) this.fire(ev);
				}
			}
		} catch {
			// fall through to reconnect
		}
		if (this.sse !== ctl || ctl.signal.aborted) return;
		this.sse = null;
		const wasLive = this.mode === "live";
		this.mode = "offline";
		if (wasLive) this.fire({ type: "disconnected" });
		this.schedule();
	}

	private open() {
		if (this.stopped) return;
		if (this.viaNode) return void this.openNode();
		if (typeof WebSocket === "undefined") {
			this.mode = "offline";
			return;
		}
		this.mode = "connecting";
		const wsUrl = `${this.opts.relay.replace(/^http/, "ws").replace(/\/$/, "")}/ws?user=${encodeURIComponent(this.opts.user)}&client=${encodeURIComponent(this.opts.client)}`;
		let ws: WebSocket;
		try {
			ws = new WebSocket(wsUrl);
		} catch {
			this.schedule();
			return;
		}
		this.ws = ws;
		ws.onmessage = (e) => {
			let ev: any;
			try {
				ev = JSON.parse(String(e.data));
			} catch {
				return;
			}
			if (ev.type === "snapshot") {
				this.state = ev.state;
				this.state.typing ||= {};
				this.mode = "live";
				this.retry = 0;
				this.fire({ type: "snapshot" });
			} else if (this.state) {
				const before = this.state.seq;
				this.sim.applyEvent(this.state, ev);
				if (this.state.seq !== before || !ev.seq) this.fire(ev);
			}
		};
		ws.onclose = () => {
			if (this.ws !== ws) return;
			this.ws = null;
			const wasLive = this.mode === "live";
			this.mode = "offline";
			if (wasLive) this.fire({ type: "disconnected" });
			this.schedule();
		};
		ws.onerror = () => {
			// onclose follows
		};
	}

	private schedule() {
		if (this.stopped) return;
		const ms = Math.min(15000, 500 * 2 ** this.retry++);
		this.retryTimer = setTimeout(() => this.open(), ms);
		(this.retryTimer as any).unref?.();
	}
}

// ── helpers shared by tools, widget and view ─────────────────────────────────

export function chatTitle(state: any, chat: any): string {
	if (chat.kind !== "dm") return chat.title;
	const other = chat.members.find((id: string) => id !== state.me);
	return state.users[other]?.name || chat.title;
}

export function otherHuman(state: any, chat: any) {
	const id = chat.members.find((x: string) => x !== state.me);
	return id ? state.users[id] : undefined;
}

export function unread(state: any, chat: any): number {
	return chat.unread?.[state.me] || 0;
}

export function totalUnread(state: any): number {
	return state.chats.reduce((n: number, c: any) => n + unread(state, c), 0);
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/^[@#]/, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

/** "Finn", "@finn", "dm-finn", "fall26", "#fall26-cohort", "mum" → chat. */
export function resolveChat(state: any, query: string): any | undefined {
	const q = norm(query);
	if (!q) return undefined;
	const chats: any[] = state.chats;
	const exact = chats.find((c) => c.id === query.trim());
	if (exact) return exact;
	const scored = chats
		.map((c) => {
			const other = c.kind === "dm" ? otherHuman(state, c) : undefined;
			const names = [c.id, c.title, chatTitle(state, c), other?.name, other?.handle, other?.id].filter(Boolean).map((s) => norm(String(s)));
			let score = 0;
			for (const n of names) {
				if (n === q) score = Math.max(score, 100);
				else if (n.startsWith(q)) score = Math.max(score, 60);
				else if (n.split(" ").includes(q)) score = Math.max(score, 50);
				else if (n.includes(q)) score = Math.max(score, 30);
			}
			if (score && c.kind === "dm") score += 5; // "Finn" means the DM, not a group Finn is in
			return { c, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score);
	return scored[0]?.c;
}

export function timeOf(ts: number) {
	const d = new Date(ts);
	const hm = d.toTimeString().slice(0, 5);
	return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${hm}`;
}

export function ago(ts: number) {
	const s = Math.round((Date.now() - ts) / 1000);
	if (s < 60) return "now";
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

export function presence(state: any, sim: Sim, user: any): string {
	if (!user) return "";
	if (user.bridge) return `on ${sim.BRIDGES[user.bridge]?.name ?? user.bridge}`;
	// A real node may not know which harness someone is in yet: say what we know.
	const h = sim.HARNESSES[user.harness]?.name ?? user.harness;
	if (!h) return user.status === "online" ? "online" : "away";
	return user.status === "online" ? `in ${h}` : `away · usually in ${h}`;
}

/** Display name for an agent: yours is this harness ("pi"); theirs is "Finn's opencode". */
export function agentLabel(state: any, sim: Sim, agent: { owner: string; harness: string }, myHarness: string): string {
	if (agent.owner === state.me) return sim.HARNESSES[myHarness]?.name ?? myHarness;
	return `${state.users[agent.owner]?.name ?? agent.owner}'s ${sim.HARNESSES[agent.harness]?.name ?? agent.harness}`;
}

export function attachmentText(state: any, sim: Sim, m: any): string {
	const a = m.attachment || {};
	const icon = a.type === "event" ? "📅" : a.type === "file" ? "📎" : "🔗";
	const by = m.assistedBy ? ` (sent with ${sim.HARNESSES[m.assistedBy]?.name ?? m.assistedBy})` : "";
	return `${icon} ${a.title ?? a.type}${a.subtitle ? ` — ${a.subtitle}` : ""}${by}`;
}

export function messageText(state: any, sim: Sim, m: any): string {
	if (m.kind === "attachment") return attachmentText(state, sim, m);
	return m.text || "";
}

/** Proposals your agent is holding for your approval (assist.state === "ready"). */
export function pendingAssists(state: any, chatId?: string): any[] {
	return Object.values(state.assists || {}).filter((a: any) => a.state === "ready" && (!chatId || a.chatId === chatId));
}

export function canSee(state: any, chat: any): boolean {
	return !!chat?.sees?.[state.me];
}
