// yapping relay client for the pi extension.
//
// One live connection per pi process: a snapshot, then events folded in with the
// shared reducer (shared/sim.js#applyEvent). Tools fall back to plain HTTP so they
// also work in print/json/rpc mode where we never open a socket.

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
	relay: string; // http://localhost:7788
	user: string; // luqmaan
	client: string; // pi
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
		return this.opts.user;
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
		if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ ...action, client: this.opts.client }));
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
		try {
			this.ws?.close();
		} catch {}
		this.ws = null;
		this.mode = "idle";
	}

	private open() {
		if (this.stopped) return;
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
	const h = sim.HARNESSES[user.harness]?.name ?? user.harness;
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
