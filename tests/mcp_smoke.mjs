/**
 * Spawn the built MCP server and exchange JSON-RPC messages over stdio,
 * exactly like Claude Desktop would.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "..", "dist", "index.js");

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

const stderr = [];
child.stderr.on("data", (b) => stderr.push(b.toString()));

let buf = "";
const pending = new Map();
let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }
    }, 15000);
  });
}
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    } catch {
      // skip
    }
  }
});

async function main() {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  });
  console.log("\u2713 initialize");

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const initial = await send("tools/list", {});
  const initialNames = initial.tools.map((t) => t.name);
  console.log(`\u2713 tools/list: ${initial.tools.length} tools (default)`);
  for (const t of initial.tools) console.log(`    - ${t.name}`);

  // Default listing should hide extended tools.
  for (const ext of ["hou_tea_compare", "hou_tea_filter_by_health", "hou_tea_agent_card"]) {
    if (initialNames.includes(ext)) {
      throw new Error(`extended tool leaked into default tools/list: ${ext}`);
    }
  }
  if (!initialNames.includes("hou_tea_discover_extended")) {
    throw new Error("hou_tea_discover_extended must be present by default");
  }

  // Calling an extended tool before discovery should return a structured error.
  const blocked = await send("tools/call", {
    name: "hou_tea_compare",
    arguments: { skill_ids: ["a", "b"] },
  });
  const blockedEnv = JSON.parse(blocked.content[0].text);
  if (blockedEnv.ok !== false || blockedEnv.error.code !== "extended_not_revealed") {
    throw new Error(`expected extended_not_revealed, got: ${JSON.stringify(blockedEnv)}`);
  }
  console.log(`\u2713 extended tool blocked before discovery (${blockedEnv.error.code})`);

  // Discover extended tools.
  const disc = await send("tools/call", {
    name: "hou_tea_discover_extended",
    arguments: {},
  });
  const discEnv = JSON.parse(disc.content[0].text);
  if (!discEnv.ok || !Array.isArray(discEnv.data.revealed) || discEnv.data.revealed.length === 0) {
    throw new Error(`discover failed: ${JSON.stringify(discEnv)}`);
  }
  console.log(`\u2713 hou_tea_discover_extended revealed ${discEnv.data.revealed.length} tools`);

  const after = await send("tools/list", {});
  const afterNames = after.tools.map((t) => t.name);
  if (!afterNames.includes("hou_tea_compare")) {
    throw new Error("hou_tea_compare missing from tools/list after discovery");
  }

  // Real network call: browse should return ok envelope with items + meta.request_id.
  const browseRes = await send("tools/call", {
    name: "hou_tea_browse",
    arguments: { per_page: 2 },
  });
  const browseEnv = JSON.parse(browseRes.content[0].text);
  if (!browseEnv.ok) {
    throw new Error(
      `hou_tea_browse failed: ${browseEnv.error.code} ${browseEnv.error.message}`
    );
  }
  const items = browseEnv.data?.items ?? browseEnv.data?.products ?? browseEnv.data?.results ?? [];
  if (!browseEnv.meta?.request_id?.startsWith("req_")) {
    throw new Error("response.meta.request_id missing or malformed");
  }
  console.log(
    `\u2713 hou_tea_browse: ${items.length} items returned (request_id=${browseEnv.meta.request_id})`
  );

  child.kill();
  console.log("");
  console.log("MCP stdio smoke test passed.");
}

main().catch((err) => {
  console.error(`\u2717 ${err.message}`);
  console.error("stderr:\n" + stderr.join(""));
  child.kill();
  process.exit(1);
});
