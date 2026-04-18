# @hou-tea/mcp-server

> MCP server for [hou-tea.com](https://hou-tea.com) — let your AI agent browse, recommend, and **buy authentic Chinese tea with USDC** via the [x402 protocol](https://www.x402.org).

Designed for Claude Desktop, Cursor, Cline, Continue, Zed, and any [Model Context Protocol](https://modelcontextprotocol.io) compatible AI agent.

---

## What it does

Exposes the [hou-tea agent API](https://hou-tea.com/.well-known/agent) as MCP tools so your AI assistant can shop on your behalf:

| Tool | What it does |
|---|---|
| `hou_tea_browse` | List tea catalog with filters (category, price, season, difficulty) |
| `hou_tea_recommend` | Natural-language recommendations: "warming tea for cold winter nights" |
| `hou_tea_explain` | Deep dive on one product: brewing guide, story, health info |
| `hou_tea_compare` | Side-by-side comparison of 2–4 candidates |
| `hou_tea_filter_by_health` | Filter by conditions: pregnant, insomnia, caffeine sensitive |
| `hou_tea_get_payment_requirements` | Initiate x402 payment intent (returns recipient + amount; auto `register_buyer_list_token` / `buyer_list_token` for buyer order history) |
| `hou_tea_list_my_orders` | List your x402 orders by `buyer_list_token` (Bearer; uses `HOU_TEA_BUYER_LIST_TOKEN` env) |
| `hou_tea_check_order` | Poll order status after payment |
| `hou_tea_agent_card` | Fetch full agent capability descriptor |

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
      "args": ["-y", "@hou-tea/mcp-server"]
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
      "args": ["-y", "@hou-tea/mcp-server"]
    }
  }
}
```

### Cline / Continue / Zed

Same `npx -y @hou-tea/mcp-server` invocation in their MCP config.

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
```

---

## Why this exists

Chinese tea has 1500+ years of cultural depth and a global market larger than coffee. But until now, AI agents either (a) hallucinated product names from training data, or (b) failed to scrape JavaScript-rendered storefronts. This MCP gives agents a **direct, authoritative, agent-native** path to a real catalog with real prices and real on-chain settlement.

If you're building an AI shopping agent, a tea recommendation app, or just want your Claude to be able to actually buy you tea — this is for you.

---

## License

MIT © hou-tea
