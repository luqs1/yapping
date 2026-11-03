// Test-only pi extension: a zero-cost "model" that turns prompts into yap_* tool
// calls, so the real pi agent loop (tool schema validation, execute, result)
// can be exercised against the relay without spending tokens.
//
//   pi -ne -e ./plugins/pi -e ./plugins/pi/test/scripted-model.ts \
//      --provider yap-test --model scripted --no-session -p "tell Finn I'm running late"
//
// "tell <who> <text>" → yap_send   "inbox" → yap_inbox   "read <who>" → yap_read   "pending" → yap_pending
// After a tool result it answers with the tool output so print mode shows it.
// YAP_TEST_DUMP=/path.json writes the context pi sent (system prompt + tool list).

import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

function plan(prompt: string): { name: string; arguments: Record<string, unknown> } | null {
	const p = prompt.trim();
	let m = p.match(/^(?:tell|message|text|ping)\s+@?(\w[\w-]*)\s+(?:that\s+)?(.+)$/i);
	// yap_send must carry the user's exact words: pass them through untouched
	if (m) return { name: "yap_send", arguments: { to: m[1], text: m[2] } };
	if (/pending|approv|waiting on me/i.test(p)) return { name: "yap_pending", arguments: {} };
	if (/inbox|unread|messages/i.test(p)) return { name: "yap_inbox", arguments: {} };
	m = p.match(/^read\s+(.+)$/i);
	if (m) return { name: "yap_read", arguments: { chat: m[1], limit: 8 } };
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("yap-test", {
		baseUrl: "http://localhost:0",
		apiKey: "scripted",
		api: "yap-scripted" as any,
		models: [
			{
				id: "scripted",
				name: "Scripted (yapping tests)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 4096,
			},
		],
		streamSimple(model, context) {
			if (process.env.YAP_TEST_DUMP) writeFileSync(process.env.YAP_TEST_DUMP, JSON.stringify(context, null, 1));
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			};
			queueMicrotask(() => {
				try {
				stream.push({ type: "start", partial: output });
				const last = (context.messages as any[]).filter((m) => m.role !== "system").at(-1);
				// pi 1.0.x carries the system prompt and tool list as role:"system" messages with toolsAdded
				const toolNames = (context.messages as any[])
					.flatMap((m) => (m.role === "system" ? (m.toolsAdded ?? []) : []))
					.map((t: any) => (typeof t === "string" ? t : (t?.name ?? JSON.stringify(t).slice(0, 80))))
					.filter((n: string) => String(n).startsWith("yap_"));
				if (last?.role === "toolResult") {
					const body = last.content.map((c: any) => c.text ?? "").join("\n");
					const text = `${last.isError ? "tool error" : "done"} (${last.toolName}):\n${body}`;
					output.content.push({ type: "text", text });
					stream.push({ type: "text_start", contentIndex: 0, partial: output });
					stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
					stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
					stream.push({ type: "done", reason: "stop", message: output });
				} else {
					const prompt = typeof last?.content === "string" ? last.content : (last?.content || []).map((c: any) => c.text ?? "").join(" ");
					const call = plan(prompt);
					if (!call) {
						const text = `scripted model: no plan for "${prompt}". yap tools visible to the model: ${toolNames.join(", ")}`;
						output.content.push({ type: "text", text });
						stream.push({ type: "text_start", contentIndex: 0, partial: output });
						stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
						stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
						stream.push({ type: "done", reason: "stop", message: output });
					} else {
						const toolCall = { type: "toolCall" as const, id: `call_${Date.now()}`, name: call.name, arguments: call.arguments };
						output.content.push(toolCall);
						output.stopReason = "toolUse";
						stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
						stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(call.arguments), partial: output });
						stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
						stream.push({ type: "done", reason: "toolUse", message: output });
					}
				}
				} catch (e) {
					output.stopReason = "error";
					output.errorMessage = String((e as Error)?.stack ?? e);
					stream.push({ type: "error", reason: "error", error: output });
				}
				stream.end();
			});
			return stream;
		},
	});
}
