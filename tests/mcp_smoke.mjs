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

  const tools = await send("tools/list", {});
  console.log(`\u2713 tools/list: ${tools.tools.length} tools`);
  for (const t of tools.tools) console.log(`    - ${t.name}`);

  const browseRes = await send("tools/call", {
    name: "hou_tea_browse",
    arguments: { per_page: 2 },
  });
  if (browseRes?.content?.[0]?.text) {
    const data = JSON.parse(browseRes.content[0].text);
    const items = data?.items ?? data?.products ?? [];
    console.log(`\u2713 hou_tea_browse: ${items.length} items returned`);
  } else {
    throw new Error("hou_tea_browse: no content in response");
  }

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
