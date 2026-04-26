# @hou-tea/mcp-server

> Agent-app MCP server for [hou-tea.com](https://hou-tea.com) — let your AI agent browse, recommend, and **buy authentic Chinese tea with USDC** via the [x402 protocol](https://www.x402.org).

Designed for Claude Desktop, Cursor, Cline, Continue, Zed, and any [Model Context Protocol](https://modelcontextprotocol.io) compatible AI agent.

> **v0.3.0-beta** - server now ships as an *agent app layer*, not just a tool list:
> progressive tool discovery (core + extended), strict JSON Schemas, structured
> response/error envelopes (`ok`, `data`, `error`, `next_action`, `meta.request_id`),
> stable error codes, explicit hand-off hints to wallet MCPs, and MCP Apps UI
> metadata backed by the public `@hou-tea/agent-ui-contract` package. See
> [What changed in 0.3.0](#what-changed-in-030-beta) below.

---

## What it does

Exposes the [hou-tea agent API](https://hou-tea.com/.well-known/agent) as MCP tools so your AI assistant can shop on your behalf.

**Default `tools/list` (core + meta) — always visible:**

| Tool | What it does |
|---|---|
| `hou_tea_browse` | List tea catalog with filters (category, price, season, difficulty) |
| `hou_tea_recommend` | Natural-language recommendations: "warming tea for cold winter nights" |
| `hou_tea_explain` | Deep dive on one product: brewing guide, story, health info |
| `hou_tea_get_payment_requirements` | Initiate x402 payment intent (returns recipient + amount; auto `register_buyer_list_token` / `buyer_list_token` for buyer order history) |
| `hou_tea_check_order` | Poll order status after payment |
| `hou_tea_list_my_orders` | List your x402 orders by `buyer_list_token` (Bearer; uses `HOU_TEA_BUYER_LIST_TOKEN` env) |
| `hou_tea_discover_extended` | Reveal extended tools (compare / health-filter / agent-card) on demand |

**Extended (revealed after `hou_tea_discover_extended`):**

| Tool | What it does |
|---|---|
| `hou_tea_compare` | Side-by-side comparison of 2–4 candidates |
| `hou_tea_filter_by_health` | Filter by conditions: pregnant, insomnia, caffeine sensitive |
| `hou_tea_agent_card` | Fetch full agent capability descriptor (diagnostics) |

**Payment is handled by an x402-capable wallet MCP** (e.g. [`@coinbase/payments-mcp`](https://github.com/coinbase/payments-mcp)) — this server only emits payment intents, it never holds keys or signs transactions.

---

## Install

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "hou-tea": {
      "command": "npx",
      "args": ["-y", "@hou-tea/mcp-server@next"]
    },
    "coinbase-payments": {
      "command": "npx",
      "args": ["-y", "@coinbase/payments-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Restart Claude Desktop. You should see "hou-tea" listed under tools.

### Cursor

Add to `~/.cursor/mcp.json` or `<project>/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "hou-tea": {
      "command": "npx",
      "args": ["-y", "@hou-tea/mcp-server@next"]
    }
  }
}
```

### Cline / Continue / Zed

Same `npx -y @hou-tea/mcp-server@next` invocation in their MCP config.

### Wallet MCP pairing

Hou Tea emits x402 payment requirements, but it does not hold keys or sign
transactions. For agent-native checkout, pair this MCP with an x402-capable
wallet MCP such as `@coinbase/payments-mcp`:

```json
{
  "mcpServers": {
    "hou-tea": {
      "command": "npx",
      "args": ["-y", "@hou-tea/mcp-server@next"]
    },
    "coinbase-payments": {
      "command": "npx",
      "args": ["-y", "@coinbase/payments-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Fund the wallet with Base USDC before asking the agent to buy. After the first
successful purchase, copy the returned `buyer_list_token` into
`HOU_TEA_BUYER_LIST_TOKEN` so future order history queries stay scoped to the
same buyer identity.

---

## Try it

After install, ask your agent:

> *"Recommend a warming tea for winter nights, around $30."*

The agent will call `hou_tea_recommend`, return real products with prices and brewing notes, then offer to buy.

> *"I'll take the first one."*

The agent calls `hou_tea_get_payment_requirements`, gets back a 402 with the merchant's Base-chain USDC address and amount, plus a `buy_request_body` field (includes `register_buyer_list_token` or your saved `buyer_list_token`). The **retry POST to `/pay/api/v1/buy` after paying must use that exact JSON body** plus the `X-Payment` header — otherwise buyer grouping breaks. If you've also installed `@coinbase/payments-mcp` with a funded wallet, configure it to forward the same body. After the first successful purchase, copy `buyer_list_token` from the JSON response into MCP env `HOU_TEA_BUYER_LIST_TOKEN` so `hou_tea_list_my_orders` and future checkouts stay under one identity.

---

## Configuration

All settings via environment variables (optional):

| Env var | Default | Purpose |
|---|---|---|
| `HOU_TEA_API_BASE` | `https://hou-tea.com` | Override API host (e.g. for staging). |
| `HOU_TEA_PAY_BASE` | `https://hou-tea.com/pay` | Override x402 middleware host. |
| `HOU_TEA_STORE_ID` | `fengshui` | Default store_id. |
| `HOU_TEA_AGENT_KEY` | *(none)* | Optional `X-Agent-Key` for higher rate limits / private skills. Contact [support@hou-tea.com](mailto:support@hou-tea.com). |
| `HOU_TEA_BUYER_LIST_TOKEN` | *(none)* | After first successful `/buy`, paste the `buyer_list_token` from the response. Future `hou_tea_get_payment_requirements` calls send this as `buyer_list_token`; enables `hou_tea_list_my_orders`. |
| `HOU_TEA_AUTO_REGISTER_BUYER_LIST_TOKEN` | `true` | Set to `false` to stop sending `register_buyer_list_token` / `buyer_list_token` on `/buy` (legacy behavior). |

Most users need none of these — the public catalog and x402 buy endpoint are open. For **buyer order history**, set `HOU_TEA_BUYER_LIST_TOKEN` once you have it from a confirmed purchase.

---

## Agent UI and MCP Apps

The `next` beta exposes MCP Apps metadata for hosts that can render structured
tool results. The shared UI contract is public:

```bash
npm i @hou-tea/agent-ui-contract
```

The contract currently defines:

| Component | Used by |
|---|---|
| `TeaRecommendationGrid` | `hou_tea_browse`, `hou_tea_recommend` |
| `PaymentReviewCard` | `hou_tea_get_payment_requirements` |
| `OrderTimeline` | `hou_tea_check_order`, `hou_tea_list_my_orders` |

Tool descriptors include `_meta.ui.component`, `_meta.ui.schemaVersion`,
`_meta.ui.resourceUri`, and `_meta.ui.resultMappingId`. MCP hosts can read the
matching resource URI and inspect the embedded `agent-ui/v1` manifest.

Public discovery:

- Agent Card: `https://hou-tea.com/.well-known/agent`
- Agent App docs: `https://shop.hou-tea.com/agents`
- UI schema JSON: `https://shop.hou-tea.com/api/agent-ui-contract`

---

## Troubleshooting

- **Tools do not appear**: restart the host app after editing MCP config, then
  run `npx -y @hou-tea/mcp-server@next --help` in a terminal to confirm npm can
  download the package.
- **Payment fails**: confirm the wallet MCP is installed separately, the wallet
  has Base USDC, and the retry POST uses the exact `buy_request_body` returned
  by `hou_tea_get_payment_requirements`.
- **Order history is empty**: set `HOU_TEA_BUYER_LIST_TOKEN` from a confirmed
  purchase response. Without it, `hou_tea_list_my_orders` cannot scope the
  buyer safely.
- **Corporate network blocks npm**: install once with
  `npm i -g @hou-tea/mcp-server@next` and point the MCP config command to
  `hou-tea-mcp`.

---

## Architecture

```
┌─────────────────┐         ┌────────────────────┐
│ Claude / Cursor │         │  hou-tea.com       │
│                 │  HTTPS  │  /api/agent/*      │
│ ┌─────────────┐ │ ──────► │  (catalog/         │
│ │ hou-tea MCP │ │ ◄────── │   recommend/etc.)  │
│ └─────────────┘ │         └────────────────────┘
│                 │
│ ┌─────────────┐ │  HTTPS  ┌────────────────────┐
│ │ payments MCP│ │ ──────► │ /pay/api/v1/buy    │
│ │ (Coinbase)  │ │ ◄ 402 ─ │ x402-middleware    │
│ └─────────────┘ │         │                    │
│       │         │  Base   │   verifies on-     │
│       └─────────┼──────►──┤   chain tx, marks  │
│   USDC transfer │  chain  │   order confirmed  │
└─────────────────┘         └────────────────────┘
```

---

## Build from source

```bash
git clone https://github.com/hou-tea/hou-tea-mcp-server.git
cd hou-tea-mcp-server
npm install
npm run build
node dist/index.js          # speaks MCP over stdio

npm run test:unit           # offline unit tests (envelope + registry)
npm run test:smoke          # live HTTP smoke (hits hou-tea.com)
npm run test:mcp            # full MCP stdio smoke (build + spawn)
```

---

## What changed in 0.3.0-beta

This release adds the public Agent UI protocol layer:

1. **Public MCP Apps manifests.** Core buying tools now advertise UI metadata
   through `_meta.ui`, including component name, `agent-ui/v1` schema version,
   resource URI, and result mapping ID.

2. **Shared npm contract.** `@hou-tea/agent-ui-contract` is published as the
   single source of truth for component manifests, TypeScript types, MCP UI
   resource names, and result mappings.

3. **Manifest-backed UI resources.** MCP `resources/read` responses now embed
   the exact component manifest in HTML so compatible hosts can render product
   grids, payment review cards, and order timelines without scraping text.

4. **External discovery surfaces.** The Agent Card and public `/agents` page
   point agents and developers to npm packages, schema JSON, MCP install
   snippets, and wallet pairing instructions.

This is a `next`-tagged beta; install with:

```bash
npm i @hou-tea/mcp-server@next
# or, in MCP config: "args": ["-y", "@hou-tea/mcp-server@next"]
```

The 0.1.x line keeps working - tool names are unchanged, but the `next` beta
adds structured envelopes, progressive discovery, and UI metadata.

---

## What changed in 0.2.0-beta

Anthropic's Skills + MCP guidance pushes MCP servers from "a flat list of tools"
toward an **agent app layer**: progressive discovery, strict schemas,
program-friendly responses, and explicit hand-off to other MCPs.
This release brings that posture to `@hou-tea/mcp-server`:

1. **Progressive tool discovery.** Default `tools/list` returns 6 core tools
   + `hou_tea_discover_extended`. Extended tools (`hou_tea_compare`,
   `hou_tea_filter_by_health`, `hou_tea_agent_card`) are revealed on demand.
   Calling an extended tool before discovery returns a structured error:

   ```json
   { "ok": false,
     "error": { "code": "extended_not_revealed",
                "retryable": true,
                "hint": "Call hou_tea_discover_extended …" } }
   ```

2. **Structured envelope on every call.**

   ```json
   {
     "ok": true,
     "data": { /* tool payload */ },
     "next_action": [
       { "tool": "hou_tea_explain", "reason": "...", "args_hint": { "skill_id": "..." } }
     ],
     "meta": { "request_id": "req_…", "tool": "hou_tea_recommend",
               "took_ms": 412, "server_version": "0.2.0-beta.0" }
   }
   ```

   Errors share the same envelope with `ok: false` and a stable `error.code`
   (`bad_request`, `unauthorized`, `not_found`, `conflict`, `timeout`,
   `rate_limited`, `server_error`, `network_error`,
   `missing_buyer_list_token`, `extended_not_revealed`, `unknown_tool`,
   `internal_error`). Each error also carries `retryable` and a `hint`.

3. **Strict JSON Schema.** Every `inputSchema` sets
   `additionalProperties: false`, with `required`, `enum`, `pattern`,
   `minItems` / `maxItems` etc. — so agent-side validators can rely on it.

4. **Hand-off hints to wallet MCP.** `hou_tea_get_payment_requirements`
   returns the 402 `buy_request_body` plus a `next_action` block that points
   the agent to an x402 wallet MCP (e.g. `@coinbase/payments-mcp`) and then
   back to `hou_tea_check_order`.

5. **Traceability.** Every response carries `meta.request_id` so you can
   include it in support tickets / logs.

This is a `next`-tagged beta; install with:

```bash
npm i @hou-tea/mcp-server@next
# or, in MCP config: "args": ["-y", "@hou-tea/mcp-server@next"]
```

The 0.1.x line keeps working — tool names are unchanged, only the result
shape and the default `tools/list` size are different.

---

## Why this exists

Chinese tea has 1500+ years of cultural depth and a global market larger than coffee. But until now, AI agents either (a) hallucinated product names from training data, or (b) failed to scrape JavaScript-rendered storefronts. This MCP gives agents a **direct, authoritative, agent-native** path to a real catalog with real prices and real on-chain settlement.

If you're building an AI shopping agent, a tea recommendation app, or just want your Claude to be able to actually buy you tea — this is for you.

---

## License

MIT © hou-tea
