#!/usr/bin/env node
/**
 * hou-tea MCP server
 *
 * Wraps https://hou-tea.com/.well-known/agent — exposes browse / recommend /
 * explain / buy / list-orders as MCP tools so any MCP-compatible AI agent
 * (Claude Desktop, Cursor, Cline, Continue, Zed, …) can shop authentic
 * Chinese tea and pay with USDC via the x402 protocol.
 *
 * Pairs with @coinbase/payments-mcp (or any x402-capable wallet MCP) for
 * the actual on-chain USDC transfer. This MCP only handles browse + checkout
 * intent; the buyer wallet handles signing.
 *
 * v0.2.0 highlights (programmatic / agent-app surface):
 *   - Tools split into core (always visible) + extended (revealed via
 *     `hou_tea_discover_extended`) so default `tools/list` stays small.
 *   - Strict JSON Schema (`additionalProperties: false`).
 *   - Unified envelope: { ok, data?, error?, next_action?, meta }.
 *   - Stable error codes (bad_request, unauthorized, not_found, conflict,
 *     timeout, rate_limited, server_error, network_error, missing_buyer_list_token, …).
 *   - `meta.request_id` on every response for traceability.
 *   - `next_action[]` hints (e.g. recommend → explain → get_payment_requirements
 *     → check_order → list_my_orders).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./client.js";
import {
  classifyError,
  SERVER_NAME,
  SERVER_VERSION,
  startCall,
  wrapErr,
  wrapOk,
} from "./response.js";
import {
  EXTENDED_TOOL_NAMES,
  extendedSummary,
  getToolDef,
  listForMcp,
} from "./tools/registry.js";

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
  }
);

const revealedExtended = new Set<string>();

const DISCOVERY_TOOL_NAME = "hou_tea_discover_extended";
const DISCOVERY_TOOL = {
  name: DISCOVERY_TOOL_NAME,
  description:
    "[meta] Reveal extended tools (compare / health-filter / agent-card) by adding them to tools/list. Optionally filter by `groups` or specific `tools`. Call this when the core 6 tools aren't enough for the user's intent. Idempotent.",
  inputSchema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        items: { type: "string", enum: ["extended"] },
        description: "Reveal all tools in these groups. Default: ['extended'].",
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "Reveal a specific subset of extended tools by name.",
      },
    },
    additionalProperties: false,
  },
};

function listTools() {
  return [...listForMcp(revealedExtended), DISCOVERY_TOOL];
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: listTools() };
});

function jsonResult(envelope: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(envelope, null, 2),
      },
    ],
    ...(typeof envelope === "object" && envelope !== null && (envelope as Record<string, unknown>).ok === false
      ? { isError: true }
      : {}),
  };
}

async function handleDiscover(args: Record<string, unknown>) {
  const ctx = startCall(DISCOVERY_TOOL_NAME);
  const groups = Array.isArray(args.groups) ? (args.groups as string[]) : ["extended"];
  const explicit = Array.isArray(args.tools) ? (args.tools as string[]) : undefined;

  const before = new Set(revealedExtended);
  if (groups.includes("extended")) {
    if (explicit && explicit.length > 0) {
      for (const n of explicit) {
        if (EXTENDED_TOOL_NAMES.has(n)) revealedExtended.add(n);
      }
    } else {
      for (const n of EXTENDED_TOOL_NAMES) revealedExtended.add(n);
    }
  }
  const newlyRevealed = [...revealedExtended].filter((n) => !before.has(n));

  // Notify any listening MCP clients that the tool list changed.
  if (newlyRevealed.length > 0) {
    try {
      await server.sendToolListChanged();
    } catch {
      // notification is best-effort; older clients may not subscribe.
    }
  }

  return jsonResult(
    wrapOk(
      ctx,
      {
        revealed: [...revealedExtended],
        newly_revealed: newlyRevealed,
        available_extended: extendedSummary(),
      },
      newlyRevealed.length > 0
        ? [
            {
              tool: "tools/list",
              reason: "Re-list tools to see the newly revealed extended tools.",
            },
          ]
        : undefined
    )
  );
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs = {} } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  if (name === DISCOVERY_TOOL_NAME) {
    return handleDiscover(args);
  }

  const def = getToolDef(name);
  if (!def) {
    const ctx = startCall(name);
    return jsonResult(
      wrapErr(ctx, {
        code: "unknown_tool",
        message: `Unknown tool: ${name}`,
        retryable: false,
        hint: `Call tools/list (and ${DISCOVERY_TOOL_NAME} for extended tools) to see available names.`,
      })
    );
  }

  if (def.group === "extended" && !revealedExtended.has(def.name)) {
    const ctx = startCall(name);
    return jsonResult(
      wrapErr(ctx, {
        code: "extended_not_revealed",
        message: `Tool ${name} is in the 'extended' group and must be revealed first.`,
        retryable: true,
        hint: `Call ${DISCOVERY_TOOL_NAME} (with no args, or tools=['${name}']) to enable it, then retry.`,
      })
    );
  }

  const ctx = startCall(name);
  try {
    const data = await def.execute(args);
    const next = def.nextAction ? def.nextAction(args, data) : undefined;
    return jsonResult(wrapOk(ctx, data, next));
  } catch (err) {
    return jsonResult(wrapErr(ctx, classifyError(err)));
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers must not write to stdout (it's the protocol channel).
  // Logs go to stderr so Claude Desktop / Cursor can surface them.
  process.stderr.write(
    `[${SERVER_NAME}-mcp v${SERVER_VERSION}] connected. apiBase=${config.apiBase} ` +
      `payBase=${config.payBase} storeId=${config.storeId} agentKey=${
        config.hasAgentKey ? "set" : "none"
      } buyerListToken=${config.hasBuyerListToken ? "set" : "none"} autoBuyerList=${
        config.autoRegisterBuyerListToken ? "on" : "off"
      }\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[${SERVER_NAME}-mcp] fatal: ${err}\n`);
  process.exit(1);
});
