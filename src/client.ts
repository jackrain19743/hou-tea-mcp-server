/**
 * Thin HTTP client for the hou-tea agent API.
 * All endpoints are documented at https://hou-tea.com/.well-known/agent
 */

const DEFAULT_BASE = process.env.HOU_TEA_API_BASE ?? "https://hou-tea.com";
const DEFAULT_PAY_BASE = process.env.HOU_TEA_PAY_BASE ?? "https://hou-tea.com/pay";
const DEFAULT_STORE_ID = process.env.HOU_TEA_STORE_ID ?? "fengshui";
const AGENT_KEY = process.env.HOU_TEA_AGENT_KEY ?? "";

const USER_AGENT = "hou-tea-mcp/0.1.0 (+https://hou-tea.com)";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (AGENT_KEY) h["X-Agent-Key"] = AGENT_KEY;
  return h;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface CatalogParams {
  store_id?: string;
  category?: string;
  price_min?: number;
  price_max?: number;
  season?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  page?: number;
  per_page?: number;
}

export interface RecommendParams {
  query: string;
  store_id?: string;
  budget_max?: number;
  occasion?: string;
  limit?: number;
}

export interface CompareParams {
  skill_ids: string[];
  store_id?: string;
}

export interface ConstraintsParams {
  conditions: string[];
  store_id?: string;
  limit?: number;
}

export interface BundleParams {
  skill_id: string;
  store_id?: string;
}

function withDefaults<T extends { store_id?: string }>(params: T): T {
  return { ...params, store_id: params.store_id ?? DEFAULT_STORE_ID };
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const houTea = {
  catalog: async (p: CatalogParams = {}) => {
    const merged = withDefaults({ store_id: DEFAULT_STORE_ID, ...p });
    return getJson<unknown>(`${DEFAULT_BASE}/api/agent/catalog${qs(merged as Record<string, unknown>)}`);
  },

  recommend: async (p: RecommendParams) => {
    return postJson<unknown>(`${DEFAULT_BASE}/api/agent/recommend`, withDefaults(p));
  },

  explain: async (skill_id: string, store_id?: string) => {
    const merged = qs({ store_id: store_id ?? DEFAULT_STORE_ID });
    return getJson<unknown>(`${DEFAULT_BASE}/api/agent/explain/${encodeURIComponent(skill_id)}${merged}`);
  },

  compare: async (p: CompareParams) => {
    return postJson<unknown>(`${DEFAULT_BASE}/api/agent/compare`, withDefaults(p));
  },

  bundle: async (p: BundleParams) => {
    return postJson<unknown>(`${DEFAULT_BASE}/api/agent/bundle`, withDefaults(p));
  },

  constraints: async (p: ConstraintsParams) => {
    return postJson<unknown>(`${DEFAULT_BASE}/api/agent/constraints`, withDefaults(p));
  },

  /**
   * Initiate an x402 payment intent. Returns the HTTP 402 payment requirements
   * (recipient address, amount, network) that an x402-aware wallet (e.g.
   * @coinbase/payments-mcp) should fulfill on-chain. We do NOT sign or send
   * the transaction here — that is the buyer wallet MCP's job.
   */
  paymentRequirements: async (product_name: string, unit_price: string, quantity = 1) => {
    const url = `${DEFAULT_PAY_BASE}/api/v1/buy`;
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ product_name, unit_price, quantity, currency: "usdc" }),
    });
    if (res.status === 402) {
      const reqsRaw = res.headers.get("x-payment-requirements") ?? "";
      let requirements: unknown = reqsRaw;
      try {
        requirements = JSON.parse(reqsRaw);
      } catch {
        // keep raw string
      }
      return {
        status: 402,
        url,
        product_name,
        unit_price,
        quantity,
        currency: "usdc",
        x_payment_requirements: requirements,
        instructions:
          "Send USDC on Base chain to the recipient address inside x_payment_requirements.accepts[0].to. Then POST the same body to this URL again with header X-Payment: base64(JSON({x402Version:1, scheme:'exact', network:'base-mainnet', payload:{tx_hash:'0x...'}})).",
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST ${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  },

  orderStatus: async (order_id: string) => {
    return getJson<unknown>(`${DEFAULT_PAY_BASE}/api/v1/orders/${encodeURIComponent(order_id)}`);
  },

  agentCard: async () => {
    return getJson<unknown>(`${DEFAULT_BASE}/.well-known/agent`);
  },
};

export const config = {
  apiBase: DEFAULT_BASE,
  payBase: DEFAULT_PAY_BASE,
  storeId: DEFAULT_STORE_ID,
  hasAgentKey: Boolean(AGENT_KEY),
};
