/**
 * Pure-unit tests for the tool registry: core/extended split, schema strictness,
 * next_action builders. No network.
 */
import assert from "node:assert/strict";
import {
  CORE_TOOL_NAMES,
  EXTENDED_TOOL_NAMES,
  TOOLS,
  extendedSummary,
  getToolDef,
  listForMcp,
} from "../dist/tools/registry.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`\u2713 ${name}`);
  } catch (err) {
    failures++;
    console.error(`\u2717 ${name}\n  ${err && err.message ? err.message : err}`);
  }
}

test("core tools cover the buyer journey", () => {
  for (const n of [
    "hou_tea_browse",
    "hou_tea_recommend",
    "hou_tea_explain",
    "hou_tea_get_payment_requirements",
    "hou_tea_check_order",
    "hou_tea_list_my_orders",
  ]) {
    assert.ok(CORE_TOOL_NAMES.has(n), `missing core tool: ${n}`);
  }
});

test("extended tools are discoverable but not in core", () => {
  for (const n of ["hou_tea_compare", "hou_tea_filter_by_health", "hou_tea_agent_card"]) {
    assert.ok(EXTENDED_TOOL_NAMES.has(n), `missing extended tool: ${n}`);
    assert.ok(!CORE_TOOL_NAMES.has(n), `extended tool leaked into core: ${n}`);
  }
});

test("every tool's inputSchema is strict (additionalProperties=false)", () => {
  for (const t of TOOLS) {
    assert.equal(
      t.inputSchema.additionalProperties,
      false,
      `tool ${t.name} schema must set additionalProperties: false`
    );
    assert.equal(t.inputSchema.type, "object");
  }
});

test("listForMcp by default exposes only core tools", () => {
  const list = listForMcp(new Set());
  const names = list.map((t) => t.name);
  for (const n of CORE_TOOL_NAMES) assert.ok(names.includes(n), `missing ${n}`);
  for (const n of EXTENDED_TOOL_NAMES) assert.ok(!names.includes(n), `leaked ${n}`);
});

test("listForMcp reveals only the requested extended tools", () => {
  const list = listForMcp(new Set(["hou_tea_compare"]));
  const names = list.map((t) => t.name);
  assert.ok(names.includes("hou_tea_compare"));
  assert.ok(!names.includes("hou_tea_filter_by_health"));
  assert.ok(!names.includes("hou_tea_agent_card"));
});

test("recommend.nextAction proposes explain + payment when data has a card", () => {
  const def = getToolDef("hou_tea_recommend");
  assert.ok(def?.nextAction);
  const data = {
    recommendations: [
      { card: { id: "skill_xy", name: "Tongcao Tea", price: "30.00" } },
    ],
  };
  const next = def.nextAction({ query: "warming" }, data);
  assert.ok(Array.isArray(next));
  const tools = next.map((n) => n.tool);
  assert.ok(tools.includes("hou_tea_explain"));
  assert.ok(tools.includes("hou_tea_get_payment_requirements"));
});

test("get_payment_requirements.nextAction handles 402 vs created order", () => {
  const def = getToolDef("hou_tea_get_payment_requirements");
  const fourOTwo = def.nextAction({}, { status: 402, buy_request_body: {} });
  assert.ok(fourOTwo.some((n) => n.tool === "wallet:x402:pay"));
  assert.ok(fourOTwo.some((n) => n.tool === "hou_tea_check_order"));
  const created = def.nextAction({}, { order_id: "ord_abc" });
  assert.equal(created[0].tool, "hou_tea_check_order");
  assert.equal(created[0].args_hint.order_id, "ord_abc");
});

test("check_order.nextAction proposes list_my_orders only when confirmed/settled", () => {
  const def = getToolDef("hou_tea_check_order");
  assert.equal(def.nextAction({}, { status: "pending_payment" }), undefined);
  const done = def.nextAction({}, { status: "confirmed" });
  assert.equal(done[0].tool, "hou_tea_list_my_orders");
});

test("extendedSummary lists all extended tools with summary", () => {
  const sum = extendedSummary();
  assert.equal(sum.length, EXTENDED_TOOL_NAMES.size);
  for (const e of sum) {
    assert.equal(typeof e.summary, "string");
    assert.ok(e.summary.length > 5);
  }
});

if (failures > 0) {
  console.error(`\n${failures} registry unit test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll registry tests passed.");
}
