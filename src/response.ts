/**
 * Programmatic response & error model for hou-tea MCP tools.
 *
 * Every tool result is a structured envelope so an Agent can branch
 * deterministically (no natural-language parsing of free-form errors).
 *
 *   {
 *     "ok": true,
 *     "data": <tool payload>,
 *     "next_action"?: [{ tool, reason, args_hint? }],
 *     "meta": { request_id, tool, took_ms, server_version }
 *   }
 *
 *   {
 *     "ok": false,
 *     "error": { code, message, retryable, hint?, http_status?, url? },
 *     "meta": { request_id, tool, took_ms, server_version }
 *   }
 */
import { randomUUID } from "node:crypto";

export const SERVER_NAME = "hou-tea";
export const SERVER_VERSION = "0.2.0-beta.0";

export interface NextAction {
  tool: string;
  reason: string;
  args_hint?: Record<string, unknown>;
}

export interface ResponseMeta {
  request_id: string;
  tool: string;
  took_ms: number;
  server_version: string;
}

export interface OkEnvelope<T = unknown> {
  ok: true;
  data: T;
  next_action?: NextAction[];
  meta: ResponseMeta;
}

export interface ErrEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    hint?: string;
    http_status?: number;
    url?: string;
  };
  meta: ResponseMeta;
}

export type Envelope<T = unknown> = OkEnvelope<T> | ErrEnvelope;

export class HouTeaHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodyExcerpt: string;
  constructor(status: number, url: string, bodyExcerpt: string) {
    super(`HTTP ${status} on ${url}: ${bodyExcerpt.slice(0, 200)}`);
    this.name = "HouTeaHttpError";
    this.status = status;
    this.url = url;
    this.bodyExcerpt = bodyExcerpt;
  }
}

export function newRequestId(): string {
  try {
    return `req_${randomUUID()}`;
  } catch {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function startCall(tool: string): { tool: string; request_id: string; t0: number } {
  return { tool, request_id: newRequestId(), t0: Date.now() };
}

function makeMeta(ctx: { tool: string; request_id: string; t0: number }): ResponseMeta {
  return {
    request_id: ctx.request_id,
    tool: ctx.tool,
    took_ms: Math.max(0, Date.now() - ctx.t0),
    server_version: SERVER_VERSION,
  };
}

export function wrapOk<T>(
  ctx: { tool: string; request_id: string; t0: number },
  data: T,
  next_action?: NextAction[]
): OkEnvelope<T> {
  return {
    ok: true,
    data,
    ...(next_action && next_action.length > 0 ? { next_action } : {}),
    meta: makeMeta(ctx),
  };
}

interface ErrSpec {
  code: string;
  message: string;
  retryable: boolean;
  hint?: string;
  http_status?: number;
  url?: string;
}

export function wrapErr(
  ctx: { tool: string; request_id: string; t0: number },
  spec: ErrSpec
): ErrEnvelope {
  return {
    ok: false,
    error: { ...spec },
    meta: makeMeta(ctx),
  };
}

/**
 * Map any thrown error from the HTTP client / runtime into a structured
 * `error` field. Used by the central call dispatcher in index.ts so every
 * tool returns the same envelope shape.
 */
export function classifyError(err: unknown): ErrSpec {
  if (err instanceof HouTeaHttpError) {
    const s = err.status;
    if (s === 400) {
      return {
        code: "bad_request",
        message: err.message,
        retryable: false,
        hint: "Check the input arguments against the tool's JSON Schema.",
        http_status: s,
        url: err.url,
      };
    }
    if (s === 401 || s === 403) {
      return {
        code: "unauthorized",
        message: err.message,
        retryable: false,
        hint:
          "Set HOU_TEA_AGENT_KEY env (X-Agent-Key) for higher rate limits, or pass a valid buyer_list_token for buyer-scoped endpoints.",
        http_status: s,
        url: err.url,
      };
    }
    if (s === 404) {
      return {
        code: "not_found",
        message: err.message,
        retryable: false,
        hint: "Verify skill_id / order_id from a recent recommend/browse/buy response.",
        http_status: s,
        url: err.url,
      };
    }
    if (s === 408 || s === 425) {
      return {
        code: "timeout",
        message: err.message,
        retryable: true,
        hint: "Retry once after 1–2s; if it persists, fall back to hou_tea_browse with smaller per_page.",
        http_status: s,
        url: err.url,
      };
    }
    if (s === 409) {
      return {
        code: "conflict",
        message: err.message,
        retryable: false,
        hint: "Likely an order/state conflict. Re-fetch order status with hou_tea_check_order before retrying.",
        http_status: s,
        url: err.url,
      };
    }
    if (s === 429) {
      return {
        code: "rate_limited",
        message: err.message,
        retryable: true,
        hint: "Back off (exponential, start ~2s). Set HOU_TEA_AGENT_KEY for higher quotas.",
        http_status: s,
        url: err.url,
      };
    }
    if (s >= 500) {
      return {
        code: "server_error",
        message: err.message,
        retryable: true,
        hint: "Retry with backoff. If it persists, contact support@hou-tea.com with this request_id.",
        http_status: s,
        url: err.url,
      };
    }
    return {
      code: "http_error",
      message: err.message,
      retryable: false,
      http_status: s,
      url: err.url,
    };
  }

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("network") ||
    lower.includes("socket")
  ) {
    return {
      code: "network_error",
      message: msg,
      retryable: true,
      hint: "Check internet / DNS. Retry after a few seconds.",
    };
  }
  if (lower.includes("buyer_list_token required")) {
    return {
      code: "missing_buyer_list_token",
      message: msg,
      retryable: false,
      hint:
        "After the first successful purchase, copy `buyer_list_token` from the response and either pass it to this tool or set env HOU_TEA_BUYER_LIST_TOKEN.",
    };
  }
  if (lower.includes("invalid_argument") || lower.includes("zod") || lower.includes("schema")) {
    return {
      code: "bad_request",
      message: msg,
      retryable: false,
      hint: "Validate the arguments against the tool's inputSchema.",
    };
  }
  return {
    code: "internal_error",
    message: msg,
    retryable: false,
  };
}
