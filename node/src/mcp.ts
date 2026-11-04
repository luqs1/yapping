// `yap mcp`: yapping as a stdio MCP server, for Claude Code and the Codex
// CLI on this Mac. No OAuth: it just calls the local node's API.
//
// Only the model-visible tools live here (docs/protocol.md):
//   yap_inbox, yap_read, yap_send (exact words only), yap_propose.
// Approving, dismissing and switching `sees` are the owner's, in the sidebar.
//
//   claude mcp add yapping -- yap mcp
//   codex mcp add yapping -- yap mcp

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { localClient } from './client'
import { VERSION } from './node'

// Which harness is talking to us, from the MCP client's name.
function harnessFrom(clientName = ''): string | undefined {
  const n = clientName.toLowerCase()
  if (n.includes('codex')) return 'codex'
  if (n.includes('claude')) return 'claude'
  if (n.includes('opencode')) return 'opencode'
  if (n === 'pi' || n.startsWith('pi-') || n.includes('pi-agent')) return 'pi'
  return process.env.YAP_AGENT || undefined
}

export function createMcpServer(opts: { home?: string; base?: string } = {}) {
  const local = localClient(opts)
  const server = new McpServer({ name: 'yapping', version: VERSION })
  const harness = () => harnessFrom(server.server.getClientVersion()?.name)

  // Every tool answers with JSON text, or a plain-English error.
  const run = async (method: string, params: Record<string, unknown>) => {
    try {
      const result = await local.rpc(method, params)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] }
    }
  }

  server.registerTool(
    'yap_inbox',
    {
      title: 'yapping inbox',
      description: "List the owner's yapping chats: unread counts, the last message and pending proposals. Chats the owner hasn't let you see show only their name.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run('inbox', {}),
  )

  server.registerTool(
    'yap_read',
    {
      title: 'Read a yapping chat',
      description: "Read recent messages in one chat (by chat id, or a person's name). Refused if the owner hasn't let you see that chat.",
      inputSchema: { chat: z.string().describe('Chat id from yap_inbox, or a contact name'), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ chat, limit }) => run('read', { chat, limit, harness: harness() }),
  )

  server.registerTool(
    'yap_send',
    {
      title: 'Send a yapping message',
      description:
        "Send a message as the owner. Use ONLY when the owner has told you the exact words to send; pass those words unchanged. Never write, improve or summarise a message yourself; if you have something to offer, use yap_propose so the owner can approve it.",
      inputSchema: { chat: z.string().describe('Chat id, or a contact name'), text: z.string().min(1).describe("The owner's exact words") },
    },
    ({ chat, text }) => run('send', { chat, text, harness: harness() }),
  )

  server.registerTool(
    'yap_propose',
    {
      title: 'Propose something for the owner to approve',
      description:
        'Hang a proposal under a message (a link, file, event or reply the owner might send). It shows in the sidebar with your label and a button; nothing is sent unless the owner approves it.',
      inputSchema: {
        chat: z.string(),
        msgId: z.string().optional().describe('The message this is about; defaults to the newest'),
        label: z.string().describe('One line the owner reads, e.g. "Send Finn the demo link?"'),
        detail: z.string().optional(),
        action: z.string().describe('Button text, e.g. "Send" or "Send invite"'),
        payload: z.object({
          kind: z.enum(['text', 'link', 'file', 'event']),
          text: z.string().optional().describe('For kind text'),
          title: z.string().optional().describe('For link, file and event'),
          subtitle: z.string().optional(),
          url: z.string().optional(),
          when: z.string().optional().describe('For events: ISO start time'),
        }),
      },
    },
    (args) => run('propose', { ...args, harness: harness() }),
  )

  return server
}

export async function runMcp() {
  const server = createMcpServer()
  await server.connect(new StdioServerTransport())
}
