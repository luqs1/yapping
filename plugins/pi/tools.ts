// Agent tools: yap_inbox, yap_read, yap_send, yap_pending.
// Messages are human: yap_send sends exactly the user's words, nothing drafted.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ago, canSee, chatTitle, messageText, otherHuman, pendingAssists, presence, resolveChat, timeOf, totalUnread, unread, type YapClient } from "./client.ts";

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });

function listChats(state: any) {
	return state.chats.map((c: any) => `${chatTitle(state, c)} [${c.id}]`).join(", ");
}

const sourceOf = (yap: YapClient, c: any) => (c.transport === "yap" ? "yapping" : (yap.sim.BRIDGES[c.transport]?.name ?? c.transport));

export function inboxText(yap: YapClient, state: any): string {
	const { sim } = yap;
	const me = state.users[state.me];
	const total = totalUnread(state);
	const n = state.chats.filter((c: any) => unread(state, c) > 0).length;
	const lines = [`yapping inbox for ${me?.name ?? state.me} — ${total ? `${total} unread in ${n} chat${n === 1 ? "" : "s"}` : "all caught up"}`];
	const lastTs = (c: any) => state.messages[c.id]?.at(-1)?.ts ?? 0;
	const chats = [...state.chats].sort((a: any, b: any) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || unread(state, b) - unread(state, a) || lastTs(b) - lastTs(a));
	for (const c of chats) {
		const last = (state.messages[c.id] || []).filter((m: any) => m.kind !== "system").at(-1);
		const bits = [c.kind === "group" ? `group, ${c.members.length} people` : "DM", sourceOf(yap, c)];
		if (c.pinned) bits.push("pinned");
		if (c.kind === "dm") bits.push(presence(state, sim, otherHuman(state, c)));
		bits.push(canSee(state, c) ? "your agent can see it" : "your agent can't see it");
		const u = unread(state, c);
		lines.push(`• ${chatTitle(state, c)} [${c.id}] — ${u ? `${u} unread` : "read"} — ${bits.join(", ")}`);
		if (last) lines.push(`    last (${ago(last.ts)}): ${state.users[last.from]?.name ?? last.from}: ${messageText(state, sim, last).slice(0, 140)}`);
		for (const a of pendingAssists(state, c.id)) lines.push(`    ⏳ waiting for the user's approval: ${a.proposal?.label ?? a.line}`);
	}
	return lines.join("\n");
}

export function readText(yap: YapClient, state: any, chat: any, limit: number): string {
	const { sim } = yap;
	const users = state.users;
	const name = (id: string) => (id === state.me ? `${users[id]?.name ?? id} (you)` : (users[id]?.name ?? id));
	const msgs: any[] = state.messages[chat.id] || [];
	const shown = msgs.slice(-limit);
	const other = chat.kind === "dm" ? otherHuman(state, chat) : undefined;
	const out = [
		`# ${chatTitle(state, chat)} [${chat.id}] · ${sourceOf(yap, chat)}${other ? ` · ${other.name} is ${presence(state, sim, other)}` : ""}`,
	];
	if (msgs.length > shown.length) out.push(`(${msgs.length - shown.length} earlier messages not shown)`);
	for (const m of shown) {
		if (m.kind === "system") {
			out.push(`  — ${m.text} —`);
			continue;
		}
		out.push(`[${timeOf(m.ts)}] ${name(m.from)}: ${messageText(state, sim, m)}`);
		const reacts = Object.entries(m.reactions || {}).filter(([, ids]: any) => ids.length);
		if (reacts.length) out.push(`    reactions: ${reacts.map(([e, ids]: any) => `${e}×${ids.length}`).join("  ")}`);
	}
	const typing = Object.entries(state.typing?.[chat.id] || {})
		.filter(([u, until]: any) => until > Date.now() && u !== state.me)
		.map(([u]) => users[u]?.name ?? u);
	if (typing.length) out.push(`${typing.join(", ")} typing…`);
	for (const a of pendingAssists(state, chat.id)) out.push(`⏳ Held for the user's approval (they approve it in /yap, not you): ${a.proposal?.label} ${a.proposal?.detail ?? ""}`);
	if (!canSee(state, chat) && chat.transport !== "yap") out.push(`(${sim.BRIDGES[chat.transport]?.note ?? ""})`);
	return out.join("\n");
}

export function registerTools(pi: ExtensionAPI, yap: YapClient) {
	pi.registerTool({
		name: "yap_inbox",
		label: "yap inbox",
		description:
			"List the user's yapping chats (messages with friends, including bridged WhatsApp/iMessage/Slack chats): unread counts, last message, presence, and anything held for the user's approval.",
		promptSnippet: "Check the user's yapping chat inbox (unread messages from friends)",
		promptGuidelines: ["Use yap_inbox when the user asks about their messages, chats, who messaged them, or what's unread on yapping."],
		parameters: Type.Object({}),
		async execute(_id, _params, signal) {
			const state = await yap.current(signal);
			return text(inboxText(yap, state), { unread: totalUnread(state), chats: state.chats.length });
		},
	});

	pi.registerTool({
		name: "yap_read",
		label: "yap read",
		description: "Read recent messages in one yapping chat (DM, group or bridged chat), with attachments and reactions. Marks the chat read.",
		promptSnippet: "Read a yapping chat by person or chat name",
		promptGuidelines: ["Use yap_read when the user asks what someone said on yapping."],
		parameters: Type.Object({
			chat: Type.String({ description: 'Person or chat: "Finn", "@finn", "dm-finn", "fall26", "Mum"' }),
			limit: Type.Optional(Type.Number({ description: "How many recent messages (default 15, max 60)" })),
		}),
		async execute(_id, params, signal) {
			const state = await yap.current(signal);
			const chat = resolveChat(state, params.chat);
			if (!chat) throw new Error(`No yapping chat matches "${params.chat}". Chats: ${listChats(state)}`);
			const limit = Math.max(1, Math.min(60, Math.floor(params.limit ?? 15)));
			const out = readText(yap, state, chat, limit);
			if (unread(state, chat)) yap.action({ t: "read", chatId: chat.id }, signal).catch(() => {});
			return text(out, { chatId: chat.id });
		},
	});

	pi.registerTool({
		name: "yap_send",
		label: "yap send",
		description:
			"Send a yapping message from the user. Sends EXACTLY the user's own words, verbatim: never draft, rephrase, expand, translate, add emoji or sign-offs. Only use when the user dictates what to say (\"tell Finn I'm running late\" → text \"I'm running late\").",
		promptSnippet: "Send the user's exact words to a friend on yapping",
		promptGuidelines: [
			"Use yap_send only when the user tells you what to say to someone (\"tell Finn I'm running late\"). Pass the user's own words verbatim as `text` (\"I'm running late\"); yap_send never sends anything you wrote yourself. If the user didn't say what to send, ask them instead of drafting it.",
		],
		parameters: Type.Object({
			to: Type.String({ description: 'Person or chat: "Finn", "dm-finn", "fall26", "Mum"' }),
			text: Type.String({ description: "The user's exact words, verbatim" }),
		}),
		async execute(_id, params, signal) {
			const state = await yap.current(signal);
			const chat = resolveChat(state, params.to);
			if (!chat) throw new Error(`No yapping chat matches "${params.to}". Chats: ${listChats(state)}`);
			const body = String(params.text ?? "");
			if (!body.trim()) throw new Error("Empty message");
			const res = await yap.action({ t: "send", chatId: chat.id, text: body }, signal);
			return text(`Sent to ${chatTitle(state, chat)} [${chat.id}] via ${sourceOf(yap, chat)}: "${body}"`, { chatId: chat.id, messageId: res?.message?.id, text: body });
		},
	});

	pi.registerTool({
		name: "yap_pending",
		label: "yap pending",
		description:
			"List what the user's agent is holding for their approval on yapping (e.g. \"Send Theo 'Acme API docs v3.pdf'?\"). Read-only: the user approves or dismisses these themselves in /yap.",
		promptSnippet: "List yapping proposals waiting for the user's approval",
		promptGuidelines: ["Use yap_pending when the user asks what's waiting on them in yapping; tell them to approve with y in /yap."],
		parameters: Type.Object({}),
		async execute(_id, _params, signal) {
			const state = await yap.current(signal);
			const list = pendingAssists(state);
			const lines = list.length
				? list.map((a: any) => {
						const c = state.chats.find((x: any) => x.id === a.chatId);
						return `• ${c ? chatTitle(state, c) : a.chatId} [${a.chatId}]: ${a.proposal?.label}${a.proposal?.detail ? ` (${a.proposal.detail})` : ""}`;
					})
				: ["Nothing waiting for approval."];
			return text(lines.join("\n"), { count: list.length });
		},
	});
}
