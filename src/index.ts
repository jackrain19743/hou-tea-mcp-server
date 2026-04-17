#!/usr/bin/env node
/**
 * hou-tea MCP server
 *
 * Wraps https://hou-tea.com/.well-known/agent — exposes browse / recommend /
 * explain / compare / buy as MCP tools so any MCP-compatible AI agent
 * (Claude Desktop, Cursor, Cline, Continue, Zed, etc.) can shop authentic
 * Chinese tea and pay with USDC via the x402 protocol.
 *
 * Pairs with @coinbase/payments-mcp (or any x402-capable wallet MCP) for
 * the actual on-chain USDC transfer. This MCP only handles browse + checkout
 * intent; the buyer wallet handles signing.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { houTea, config } from "./client.js";

const SERVER_NAME = "hou-tea";
const SERVER_VERSION = "0.1.0";

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools = [
  {
    name: "hou_tea_browse",
    description:
      "Browse the hou-tea Chinese tea catalog. Returns products with name, price (USD/USDC), images, taste profile, fermentation level, season, and a ready-to-render `card` object. Filter by category, price range, season, or brewing difficulty.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Optional category filter, e.g. 'green tea', 'oolong', 'pu-erh', 'white tea', 'black tea', 'yellow tea', 'dark tea'.",
        },
        price_min: { type: "number", description: "Minimum USD price." },
        price_max: { type: "number", description: "Maximum USD price." },
        season: {
          type: "string",
          description:
            "Optional season suitability: 'spring', 'summer', 'autumn', 'winter'.",
        },
        difficulty: {
          type: "string",
          enum: ["beginner", "intermediate", "advanced"],
          description: "Brewing difficulty level.",
        },
        per_page: {
          type: "integer",
          description: "Page size (default 20, max 100).",
        },
        page: { type: "integer", description: "Page number (1-indexed)." },
      },
    },
  },
  {
    name: "hou_tea_recommend",
    description:
      "Get curated tea recommendations from a natural-language query. The server parses intent, applies semantic match, and returns ranked products with explanation. Use this whenever the user asks 'recommend me a tea for X' or describes a mood/occasion/use-case.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description, e.g. 'a warming tea for cold winter nights', 'gift for a tea beginner', 'something to pair with dim sum'.",
        },
        budget_max: {
          type: "number",
          description: "Optional maximum USD price per item.",
        },
        occasion: {
          type: "string",
          description:
            "Optional occasion: 'gift', 'daily', 'meditation', 'dinner', 'office', 'study'.",
        },
        limit: {
          type: "integer",
          description: "Number of recommendations to return (default 3).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "hou_tea_explain",
    description:
      "Get a deep explainer for one product: origin story, brewing guide (water temp, steep time, ratio), health benefits, talking points, cultural context, and cross-sell suggestions. Use after the user shows interest in a specific product.",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: {
          type: "string",
          description:
            "The product's skill_id (returned as `card.id` from hou_tea_browse / hou_tea_recommend).",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "hou_tea_compare",
    description:
      "Side-by-side comparison of 2–4 products across sensory profile, price, brewing difficulty, season, and use-case. Use when the user is choosing between specific candidates.",
    inputSchema: {
      type: "object",
      properties: {
        skill_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
          description: "List of 2–4 product skill_ids to compare.",
        },
      },
      required: ["skill_ids"],
    },
  },
  {
    name: "hou_tea_filter_by_health",
    description:
      "Filter products by health constraints. Returns only teas safe under the given conditions (e.g. avoid caffeine for insomnia or pregnancy, avoid strong tannins for sensitive stomachs).",
    inputSchema: {
      type: "object",
      properties: {
        conditions: {
          type: "array",
          items: { type: "string" },
          description:
            "Health conditions or constraints, e.g. ['pregnant', 'insomnia', 'children', 'caffeine_sensitive'].",
        },
        limit: {
          type: "integer",
          description: "Max results (default 10).",
        },
      },
      required: ["conditions"],
    },
  },
  {
    name: "hou_tea_get_payment_requirements",
    description:
      "Initiate an x402 USDC payment intent for a product. Returns HTTP 402-style payment requirements (recipient address, amount, Base chain network). The agent should then use a wallet MCP (e.g. @coinbase/payments-mcp) to send USDC and complete the order. This tool does NOT sign or send transactions.",
    inputSchema: {
      type: "object",
      properties: {
        product_name: {
          type: "string",
          description:
            "Exact product name as returned by hou_tea_browse (use card.name).",
        },
        unit_price: {
          type: "string",
          description:
            "Unit price in USDC, decimal string e.g. '30.00'. Must match the catalog price; the merchant verifies on-chain.",
        },
        quantity: {
          type: "integer",
          description: "Number of units (default 1).",
        },
      },
      required: ["product_name", "unit_price"],
    },
  },
  {
    name: "hou_tea_check_order",
    description:
      "Poll the status of a previously created order. Status transitions: pending_payment → confirmed (after on-chain USDC settlement is verified).",
    inputSchema: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description:
            "Order ID returned by the merchant after a successful x402 payment, e.g. 'ord_abc123def456'.",
        },
      },
      required: ["order_id"],
    },
  },
  {
    name: "hou_tea_agent_card",
    description:
      "Fetch the full hou-tea agent capability descriptor (/.well-known/agent). Useful for discovering the latest API surface, payment recipient address, and supported networks. Call this if other tools behave unexpectedly.",
    inputSchema: { type: "object", properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `hou-tea MCP error: ${msg}`,
      },
    ],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "hou_tea_browse":
        return jsonResult(await houTea.catalog(args as Parameters<typeof houTea.catalog>[0]));

      case "hou_tea_recommend":
        return jsonResult(
          await houTea.recommend(args as unknown as Parameters<typeof houTea.recommend>[0])
        );

      case "hou_tea_explain": {
        const { skill_id } = args as { skill_id: string };
        return jsonResult(await houTea.explain(skill_id));
      }

      case "hou_tea_compare":
        return jsonResult(
          await houTea.compare(args as unknown as Parameters<typeof houTea.compare>[0])
        );

      case "hou_tea_filter_by_health": {
        const { conditions, limit } = args as { conditions: string[]; limit?: number };
        return jsonResult(await houTea.constraints({ conditions, limit }));
      }

      case "hou_tea_get_payment_requirements": {
        const { product_name, unit_price, quantity } = args as {
          product_name: string;
          unit_price: string;
          quantity?: number;
        };
        return jsonResult(
          await houTea.paymentRequirements(product_name, unit_price, quantity ?? 1)
        );
      }

      case "hou_tea_check_order": {
        const { order_id } = args as { order_id: string };
        return jsonResult(await houTea.orderStatus(order_id));
      }

      case "hou_tea_agent_card":
        return jsonResult(await houTea.agentCard());

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult(err);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers should not write to stdout (it's used by the protocol).
  // Logs go to stderr so Claude Desktop / Cursor can surface them.
  process.stderr.write(
    `[hou-tea-mcp v${SERVER_VERSION}] connected. apiBase=${config.apiBase} storeId=${config.storeId} agentKey=${config.hasAgentKey ? "set" : "none"}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[hou-tea-mcp] fatal: ${err}\n`);
  process.exit(1);
});
