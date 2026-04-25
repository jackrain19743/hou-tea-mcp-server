/**
 * Tool registry — split into "core" (always exposed) and "extended"
 * (revealed by `hou_tea_discover_extended` to keep prompt token usage low).
 *
 * Every tool entry carries:
 *   - name, group, summary (short — for tools/list)
 *   - description (longer — for tools/list `description`)
 *   - inputSchema with `additionalProperties: false`
 *   - execute(args, ctx) — runs the call and returns raw `data`
 *   - nextAction(args, data) — optional hints the agent should follow next
 */
import { houTea } from "../client.js";
import type { NextAction } from "../response.js";

export type ToolGroup = "core" | "extended";

export interface ToolDef {
  name: string;
  group: ToolGroup;
  summary: string;
  description: string;
  inputSchema: Record<string, unknown>;
  uiResourceUri?: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  nextAction?: (args: Record<string, unknown>, data: unknown) => NextAction[] | undefined;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

function firstSkillId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const arrs = [d.recommendations, d.results, d.items, d.products, d.matches];
  for (const a of arrs) {
    if (Array.isArray(a) && a.length > 0) {
      const first = a[0] as Record<string, unknown> | undefined;
      const card = (first?.card ?? first) as Record<string, unknown> | undefined;
      const id = card?.id ?? card?.skill_id ?? first?.skill_id;
      if (typeof id === "string") return id;
    }
  }
  return undefined;
}

function priceOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const arrs = [d.recommendations, d.results, d.items, d.products, d.matches];
  for (const a of arrs) {
    if (Array.isArray(a) && a.length > 0) {
      const first = a[0] as Record<string, unknown> | undefined;
      const card = (first?.card ?? first) as Record<string, unknown> | undefined;
      const p = card?.price ?? card?.unit_price ?? first?.price;
      if (p !== undefined && p !== null) return String(p);
    }
  }
  return undefined;
}

function nameOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const arrs = [d.recommendations, d.results, d.items, d.products, d.matches];
  for (const a of arrs) {
    if (Array.isArray(a) && a.length > 0) {
      const first = a[0] as Record<string, unknown> | undefined;
      const card = (first?.card ?? first) as Record<string, unknown> | undefined;
      const n = card?.name ?? card?.title ?? first?.name;
      if (typeof n === "string") return n;
    }
  }
  return undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

const CORE_TOOLS: ToolDef[] = [
  {
    name: "hou_tea_browse",
    group: "core",
    summary: "Browse hou-tea catalog (filter by category / price / season / difficulty).",
    description:
      "Browse the hou-tea Chinese tea catalog. Returns products with name, price (USD/USDC), images, taste profile, fermentation level, season, and a ready-to-render `card` object.",
    uiResourceUri: "ui://hou-tea/tea-recommendation-grid.html",
    inputSchema: obj({
      category: { type: "string" },
      price_min: { type: "number", minimum: 0 },
      price_max: { type: "number", minimum: 0 },
      season: { type: "string", enum: ["spring", "summer", "autumn", "winter"] },
      difficulty: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
      per_page: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      page: { type: "integer", minimum: 1, default: 1 },
    }),
    execute: (args) => houTea.catalog(args as Parameters<typeof houTea.catalog>[0]),
    nextAction: (_args, data) => {
      const id = firstSkillId(data);
      if (!id) return undefined;
      return [
        {
          tool: "hou_tea_explain",
          reason: "Show a deep guide for the most relevant product.",
          args_hint: { skill_id: id },
        },
      ];
    },
  },
  {
    name: "hou_tea_recommend",
    group: "core",
    summary: "Natural-language recommendation (mood / use-case / budget).",
    description:
      "Get curated tea recommendations from a natural-language query. Returns ranked products with explanation. Best entry point when the user asks 'recommend me a tea for X' or describes a mood / occasion / use-case.",
    uiResourceUri: "ui://hou-tea/tea-recommendation-grid.html",
    inputSchema: obj(
      {
        query: { type: "string", minLength: 1 },
        budget_max: { type: "number", minimum: 0 },
        occasion: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 3 },
      },
      ["query"]
    ),
    execute: (args) =>
      houTea.recommend(args as unknown as Parameters<typeof houTea.recommend>[0]),
    nextAction: (_args, data) => {
      const id = firstSkillId(data);
      const price = priceOf(data);
      const name = nameOf(data);
      const out: NextAction[] = [];
      if (id) {
        out.push({
          tool: "hou_tea_explain",
          reason: "Show brewing guide & cultural context for the top recommendation.",
          args_hint: { skill_id: id },
        });
      }
      if (name && price) {
        out.push({
          tool: "hou_tea_get_payment_requirements",
          reason: "If the user wants to buy the top recommendation, fetch x402 payment requirements.",
          args_hint: { product_name: name, unit_price: String(price), quantity: 1 },
        });
      }
      return out.length > 0 ? out : undefined;
    },
  },
  {
    name: "hou_tea_explain",
    group: "core",
    summary: "Deep explainer for one product (brewing, benefits, story).",
    description:
      "Returns origin story, brewing guide (water temp, steep time, ratio), health benefits, talking points, cultural context, and cross-sell suggestions for one product.",
    inputSchema: obj({ skill_id: { type: "string", minLength: 1 } }, ["skill_id"]),
    execute: (args) => houTea.explain(String((args as Record<string, unknown>).skill_id)),
    nextAction: (args, data) => {
      const a = args as Record<string, unknown>;
      const skill = isObject(data) ? data : {};
      const card = isObject(skill.card) ? skill.card : skill;
      const name = (card.name ?? card.title) as string | undefined;
      const price = (card.price ?? card.unit_price) as string | number | undefined;
      if (!name || price === undefined) return undefined;
      return [
        {
          tool: "hou_tea_get_payment_requirements",
          reason: "User has read the explainer; offer to buy.",
          args_hint: {
            product_name: name,
            unit_price: String(price),
            quantity: 1,
          },
        },
        {
          tool: "hou_tea_compare",
          reason: "Compare with another candidate before committing.",
          args_hint: { skill_ids: [String(a.skill_id)] },
        },
      ];
    },
  },
  {
    name: "hou_tea_get_payment_requirements",
    group: "core",
    summary: "x402 buy intent → returns 402 requirements + buy_request_body.",
    description:
      "Initiate an x402 USDC payment intent for a product. Returns HTTP 402-style payment requirements (recipient address, amount, Base chain network). Auto-includes buyer order grouping (`register_buyer_list_token` or env HOU_TEA_BUYER_LIST_TOKEN). The wallet MCP MUST POST the identical `buy_request_body` on retry plus header `X-Payment`.",
    uiResourceUri: "ui://hou-tea/payment-review-card.html",
    inputSchema: obj(
      {
        product_name: { type: "string", minLength: 1 },
        unit_price: {
          type: "string",
          pattern: "^\\d+(\\.\\d{1,8})?$",
          description: "Decimal string e.g. '30.00'",
        },
        quantity: { type: "integer", minimum: 1, default: 1 },
      },
      ["product_name", "unit_price"]
    ),
    execute: (args) => {
      const a = args as { product_name: string; unit_price: string; quantity?: number };
      return houTea.paymentRequirements(a.product_name, a.unit_price, a.quantity ?? 1);
    },
    nextAction: (_args, data) => {
      if (!isObject(data)) return undefined;
      const status = data.status;
      if (status === 402) {
        return [
          {
            tool: "wallet:x402:pay",
            reason:
              "Use an x402-aware wallet MCP (e.g. @coinbase/payments-mcp) to send USDC to x_payment_requirements.accepts[0].to, then retry POST with header X-Payment and the SAME buy_request_body.",
          },
          {
            tool: "hou_tea_check_order",
            reason: "After wallet retry succeeds, poll order status to confirm settlement.",
          },
        ];
      }
      const orderId = (data as Record<string, unknown>).order_id;
      if (typeof orderId === "string") {
        return [
          {
            tool: "hou_tea_check_order",
            reason: "Order created; poll until status=confirmed.",
            args_hint: { order_id: orderId },
          },
        ];
      }
      return undefined;
    },
  },
  {
    name: "hou_tea_check_order",
    group: "core",
    summary: "Poll order status (pending_payment → confirmed).",
    description:
      "Poll the status of a previously created order. Status transitions: pending_payment → verifying → confirmed (after on-chain USDC settlement). Use exponential backoff (~2s, 4s, 8s …, max ~60s).",
    uiResourceUri: "ui://hou-tea/order-timeline.html",
    inputSchema: obj({ order_id: { type: "string", minLength: 1 } }, ["order_id"]),
    execute: (args) => houTea.orderStatus(String((args as Record<string, unknown>).order_id)),
    nextAction: (_args, data) => {
      if (!isObject(data)) return undefined;
      const status = (data.status ?? data.order_status) as string | undefined;
      if (status === "confirmed" || status === "settled") {
        return [
          {
            tool: "hou_tea_list_my_orders",
            reason: "Order confirmed; the buyer can now list / track their order history.",
          },
        ];
      }
      return undefined;
    },
  },
  {
    name: "hou_tea_list_my_orders",
    group: "core",
    summary: "List orders linked to buyer_list_token (Bearer auth).",
    description:
      "List USDC/x402 orders associated with the buyer_list_token (returned from a successful purchase or stored in env HOU_TEA_BUYER_LIST_TOKEN). No merchant API key required.",
    uiResourceUri: "ui://hou-tea/order-timeline.html",
    inputSchema: obj({
      buyer_list_token: { type: "string" },
      status: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      offset: { type: "integer", minimum: 0, default: 0 },
    }),
    execute: (args) =>
      houTea.listMyOrders(args as unknown as Parameters<typeof houTea.listMyOrders>[0]),
  },
];

const EXTENDED_TOOLS: ToolDef[] = [
  {
    name: "hou_tea_compare",
    group: "extended",
    summary: "Side-by-side compare 2–4 products.",
    description:
      "Compare 2–4 products across sensory profile, price, brewing difficulty, season, and use-case. Use when the user is choosing between specific candidates.",
    inputSchema: obj(
      {
        skill_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
          uniqueItems: true,
        },
      },
      ["skill_ids"]
    ),
    execute: (args) =>
      houTea.compare(args as unknown as Parameters<typeof houTea.compare>[0]),
  },
  {
    name: "hou_tea_filter_by_health",
    group: "extended",
    summary: "Filter teas by health constraints (pregnancy, insomnia, etc.).",
    description:
      "Filter products by health constraints. Returns only teas safe under the given conditions (e.g. avoid caffeine for insomnia or pregnancy, avoid strong tannins for sensitive stomachs).",
    inputSchema: obj(
      {
        conditions: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      ["conditions"]
    ),
    execute: (args) =>
      houTea.constraints(
        args as unknown as Parameters<typeof houTea.constraints>[0]
      ),
  },
  {
    name: "hou_tea_agent_card",
    group: "extended",
    summary: "Capability descriptor (/.well-known/agent) — diagnostics.",
    description:
      "Fetch the full hou-tea agent capability descriptor (/.well-known/agent). Useful for discovering the latest API surface, payment recipient address, and supported networks. Call this if other tools behave unexpectedly.",
    inputSchema: obj({}),
    execute: () => houTea.agentCard(),
  },
];

export const TOOLS: ToolDef[] = [...CORE_TOOLS, ...EXTENDED_TOOLS];

export function getToolDef(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export const CORE_TOOL_NAMES = new Set(CORE_TOOLS.map((t) => t.name));
export const EXTENDED_TOOL_NAMES = new Set(EXTENDED_TOOLS.map((t) => t.name));

export function listForMcp(includeExtended: Set<string>): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}> {
  const out: ToolDef[] = [];
  for (const t of CORE_TOOLS) out.push(t);
  for (const t of EXTENDED_TOOLS) {
    if (includeExtended.has(t.name)) out.push(t);
  }
  return out.map((t) => ({
    name: t.name,
    description: `[${t.group}] ${t.description}`,
    inputSchema: t.inputSchema,
    ...(t.uiResourceUri
      ? {
          _meta: {
            ui: {
              resourceUri: t.uiResourceUri,
              preferredSize: "inline",
            },
          },
        }
      : {}),
  }));
}

export function extendedSummary(): Array<{ name: string; summary: string }> {
  return EXTENDED_TOOLS.map((t) => ({ name: t.name, summary: t.summary }));
}
