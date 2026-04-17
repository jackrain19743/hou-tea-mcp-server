/**
 * Lightweight smoke test that exercises the HTTP client directly
 * (no MCP transport). Run with: npx tsx tests/smoke.ts
 */
import { houTea, config } from "../src/client.js";

const ok = (label: string) => console.log(`\u2713 ${label}`);
const fail = (label: string, err: unknown) => {
  console.error(`\u2717 ${label}: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
};

async function main() {
  console.log(`hou-tea-mcp smoke test`);
  console.log(`  apiBase=${config.apiBase}`);
  console.log(`  storeId=${config.storeId}`);
  console.log(`  agentKey=${config.hasAgentKey ? "set" : "none"}`);
  console.log("");

  try {
    const card: any = await houTea.agentCard();
    if (card?.name && card?.url) ok(`agent_card: ${card.name}`);
    else fail("agent_card", `unexpected shape: ${JSON.stringify(card).slice(0, 200)}`);
  } catch (err) {
    fail("agent_card", err);
  }

  try {
    const cat: any = await houTea.catalog({ per_page: 3 });
    const items = cat?.items ?? cat?.products ?? cat?.data ?? [];
    if (Array.isArray(items)) ok(`catalog: ${items.length} items`);
    else fail("catalog", `expected array, got ${typeof items}`);
  } catch (err) {
    fail("catalog", err);
  }

  try {
    const rec: any = await houTea.recommend({ query: "warming tea for winter", limit: 2 });
    const recs = rec?.recommendations ?? rec?.items ?? rec?.results ?? [];
    if (Array.isArray(recs)) ok(`recommend: ${recs.length} suggestions`);
    else fail("recommend", `expected array, got ${typeof recs}`);
  } catch (err) {
    fail("recommend", err);
  }

  console.log("");
  console.log("Smoke test complete.");
}

main();
