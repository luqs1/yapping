// yapping — chat with your friends inside pi; your pi agent helps underneath, quietly.
//
//   pi -e ./plugins/pi               # load for one run
//   /yap [who]   or  ctrl+q          # Discord-styled chat view (esc closes)
//   "tell Finn I'm running late"     # the agent uses yap_send (your exact words)
//
// Env: YAP_RELAY (default http://localhost:7788), YAP_USER (default luqmaan),
//      YAP_KEY (default ctrl+q), YAP_REDUCED_MOTION=1, YAP_NOTIFY=0.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { canSee, chatTitle, loadSim, messageText, pendingAssists, resolveChat, totalUnread, YapClient } from "./client.ts";
import { registerTools } from "./tools.ts";
import { C, bg, chibi, fill, paint, YapView } from "./view.ts";

export default async function yapping(pi: ExtensionAPI) {
	const sim = await loadSim();
	const env = process.env;
	const yap = new YapClient({ relay: env.YAP_RELAY || "http://localhost:7788", user: env.YAP_USER || "luqmaan", client: "pi" }, sim);
	const KEY = (env.YAP_KEY || "ctrl+q") as any;
	const reducedMotion = env.YAP_REDUCED_MOTION === "1";

	registerTools(pi, yap);

	let ui: ExtensionContext | null = null;
	let viewOpen = false;
	let widgetTui: TUI | null = null;
	let widgetTimer: ReturnType<typeof setInterval> | null = null;
	let tick = 0;

	async function openView(ctx: ExtensionContext, initialChat?: string) {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("yapping's chat view needs interactive mode; the yap_* tools work everywhere.", "warning");
			return;
		}
		if (viewOpen) return;
		viewOpen = true;
		yap.start();
		try {
			await ctx.ui.custom<void>(
				(tui, _theme, _kb, done) => new YapView(tui, yap, { initialChat, reducedMotion, onClose: () => done() }),
				{
					overlay: true,
					overlayOptions: { anchor: "top-left", row: 0, col: 0, width: "100%", maxHeight: "100%", margin: 0 },
				},
			);
		} finally {
			viewOpen = false;
			widgetTui?.requestRender();
		}
	}

	pi.registerCommand("yap", {
		description: "Open yapping (Discord-style chat with your friends). /yap finn opens that chat.",
		getArgumentCompletions(prefix: string) {
			const st = yap.state;
			if (!st) return null;
			const items = st.chats.map((c: any) => ({ value: c.kind === "dm" ? chatTitle(st, c).toLowerCase() : c.id, label: chatTitle(st, c), description: c.id }));
			const f = items.filter((i: any) => i.value.startsWith(prefix.toLowerCase()));
			return f.length ? f : null;
		},
		handler: async (args, ctx) => openView(ctx, args?.trim() || undefined),
	});

	pi.registerShortcut(KEY, {
		description: "Open yapping chat",
		handler: async (ctx) => openView(ctx),
	});

	// ── always-on widget above the editor ────────────────────────────────────
	function widgetLine(width: number): string {
		const s = yap.state;
		const head = `${paint(C.blurple, "▌")}${paint(C.white, "\x1b[1m yap \x1b[22m")}`;
		const key = paint(C.dim, `/yap · ${KEY} `);
		if (!s) {
			const t = `${head} ${paint(C.muted, yap.mode === "offline" ? `relay offline (${yap.opts.relay})` : "connecting…")}`;
			return fill(t + " ".repeat(Math.max(1, width - visibleWidth(t) - visibleWidth(key))) + key, width, C.side);
		}
		const n = totalUnread(s);
		const badge = n ? `${bg(C.red)}${paint(C.white, `\x1b[1m ${n} unread \x1b[22m`)}\x1b[49m` : paint(C.muted, "all caught up");
		let tail = "";
		const ready = pendingAssists(s).filter((a: any) => canSee(s, s.chats.find((c: any) => c.id === a.chatId)));
		const busy = Object.values(s.assists || {}).filter((a: any) => ["reading", "talking", "working"].includes(a.state)) as any[];
		const mark = (state: string) => chibi("pi", state, tick, 0, reducedMotion)[0];
		if (ready.length) {
			const a = ready[0];
			const c = s.chats.find((x: any) => x.id === a.chatId);
			tail = `${mark("ready")} ${paint(C.idle, "!")} ${paint(C.text, a.proposal?.label ?? a.line)} ${paint(C.dim, `· /yap ${c?.kind === "dm" ? chatTitle(s, c).toLowerCase() : c?.id}, then y`)}`;
		} else if (busy.length) {
			const a = busy[0];
			tail = `${mark(a.state)} ${paint(C.muted, a.line ?? a.state)}`;
		} else {
			let latest: any = null;
			for (const c of s.chats) for (const m of s.messages[c.id] || []) if (m.kind !== "system" && m.from !== s.me && (!latest || m.ts > latest.ts)) latest = m;
			if (latest) {
				const c = s.chats.find((x: any) => x.id === latest.chatId);
				const u = s.users[latest.from];
				tail = `${paint(C.muted, c?.kind === "dm" ? "@" : "#")}${paint(C.muted, chatTitle(s, c))}  ${paint(u?.color ?? C.text, `\x1b[1m${u?.name ?? latest.from}\x1b[22m`)} ${paint(C.text, messageText(s, sim, latest).replace(/\s+/g, " "))}`;
			}
		}
		const left = `${head} ${badge}  ${tail}`;
		const room = width - visibleWidth(key) - 1;
		return fill(`${truncateToWidth(left, room, "…", true)} ${key}`, width, C.side);
	}

	function setWidget(ctx: ExtensionContext) {
		ctx.ui.setWidget("yapping", (tui) => {
			widgetTui = tui;
			return {
				render: (width: number) => [widgetLine(width)],
				invalidate() {},
				dispose() {
					if (widgetTui === tui) widgetTui = null;
				},
			};
		});
	}

	// ── notifications for new messages while the view is closed ─────────────
	const notifyOn = env.YAP_NOTIFY !== "0";
	const notifiedReady = new Set<string>();
	yap.subscribe((s, ev) => {
		widgetTui?.requestRender();
		if (!ui || viewOpen || !notifyOn) return;
		const c = s.chats.find((x: any) => x.id === ev?.chatId);
		if (!c) return;
		const slug = c.kind === "dm" ? chatTitle(s, c).toLowerCase() : c.id;
		if (ev.type === "message") {
			const m = ev.message;
			if (m.from === s.me || m.kind === "system") return;
			const where = c.kind === "dm" ? "" : ` in #${chatTitle(s, c)}`;
			ui.ui.notify(`💬 ${s.users[m.from]?.name ?? m.from}${where}: ${messageText(s, sim, m).slice(0, 120)}  (/yap ${slug})`, "info");
		} else if (ev.type === "assist" && ev.assist.state === "ready" && canSee(s, c) && !notifiedReady.has(ev.assist.id)) {
			notifiedReady.add(ev.assist.id);
			ui.ui.notify(`π ${ev.assist.proposal?.label ?? "Something is ready"}  (/yap ${slug}, then y)`, "info");
		}
	});

	pi.on("session_start", async (_e, ctx) => {
		if (ctx.mode !== "tui") return; // tools still work over plain HTTP in print/json/rpc mode
		ui = ctx;
		yap.start();
		setWidget(ctx);
		if (!widgetTimer) {
			widgetTimer = setInterval(() => {
				tick++;
				const s = yap.state;
				if (s && !viewOpen && Object.values(s.assists || {}).some((a: any) => ["reading", "talking", "working", "ready"].includes(a.state))) widgetTui?.requestRender();
			}, 200);
			(widgetTimer as any).unref?.();
		}
	});

	pi.on("session_shutdown", async () => {
		if (widgetTimer) clearInterval(widgetTimer);
		widgetTimer = null;
		yap.stop();
		ui = null;
	});

	// expose for tests
	(yapping as any).client = yap;
	(yapping as any).resolveChat = resolveChat;
}
