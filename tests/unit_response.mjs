/**
 * Pure-unit tests for the response envelope and error classifier.
 * No network. Run: node tests/unit_response.mjs
 */
import assert from "node:assert/strict";
import {
  HouTeaHttpError,
  SERVER_VERSION,
  classifyError,
  startCall,
  wrapErr,
  wrapOk,
} from "../dist/response.js";

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

test("wrapOk returns shape with meta + optional next_action", () => {
  const ctx = startCall("hou_tea_recommend");
  const env = wrapOk(ctx, { recommendations: [] }, [
    { tool: "hou_tea_explain", reason: "show details" },
  ]);
  assert.equal(env.ok, true);
  assert.deepEqual(env.data, { recommendations: [] });
  assert.equal(env.next_action.length, 1);
  assert.equal(env.meta.tool, "hou_tea_recommend");
  assert.equal(env.meta.server_version, SERVER_VERSION);
  assert.match(env.meta.request_id, /^req_/);
  assert.equal(typeof env.meta.took_ms, "number");
});

test("wrapOk omits next_action when none provided", () => {
  const env = wrapOk(startCall("x"), { hi: 1 });
  assert.equal(env.ok, true);
  assert.equal("next_action" in env, false);
});

test("wrapErr serializes error fields", () => {
  const env = wrapErr(startCall("hou_tea_explain"), {
    code: "not_found",
    message: "nope",
    retryable: false,
    hint: "check skill_id",
  });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, "not_found");
  assert.equal(env.error.retryable, false);
  assert.equal(env.error.hint, "check skill_id");
});

test("classifyError maps HouTeaHttpError(404) → not_found", () => {
  const err = new HouTeaHttpError(404, "https://hou-tea.com/api/agent/explain/x", "");
  const spec = classifyError(err);
  assert.equal(spec.code, "not_found");
  assert.equal(spec.retryable, false);
  assert.equal(spec.http_status, 404);
});

test("classifyError maps 429 → rate_limited (retryable)", () => {
  const spec = classifyError(new HouTeaHttpError(429, "u", "rate"));
  assert.equal(spec.code, "rate_limited");
  assert.equal(spec.retryable, true);
});

test("classifyError maps 500 → server_error (retryable)", () => {
  const spec = classifyError(new HouTeaHttpError(503, "u", "x"));
  assert.equal(spec.code, "server_error");
  assert.equal(spec.retryable, true);
});

test("classifyError maps missing buyer_list_token error", () => {
  const spec = classifyError(new Error("buyer_list_token required: set env ..."));
  assert.equal(spec.code, "missing_buyer_list_token");
  assert.equal(spec.retryable, false);
});

test("classifyError maps fetch failures → network_error", () => {
  const spec = classifyError(new Error("fetch failed: ECONNREFUSED"));
  assert.equal(spec.code, "network_error");
  assert.equal(spec.retryable, true);
});

if (failures > 0) {
  console.error(`\n${failures} unit test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll unit tests passed.");
}
