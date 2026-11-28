// Prints the conversation for scenario ids: pnpm tsx scripts/ai-hr/show.ts traffic-03 busy-01
import { runScenario } from "../../src/staff/hrms/ai-hr/evaluate";
import { scenarios } from "../../src/staff/hrms/ai-hr/scenarios";
import { understand } from "../../src/staff/hrms/ai-hr/nlu";
const all = scenarios();
for (const id of process.argv.slice(2)) {
  const s = all.find((x) => x.id === id); if (!s) { console.log("no", id); continue; }
  const r = runScenario(s);
  console.log(`\n${id} ${r.pass ? "PASS" : "FAIL"} expect=${JSON.stringify(s.expect)}`);
  for (const t of r.transcript) console.log(`  ${t.who === "ai" ? "AI" : "E "}: ${t.text}${t.who === "employee" ? "   " + JSON.stringify(understand(t.text, 620).intents) : ""}`);
  console.log("  failed:", r.checks.filter((c) => !c.ok).map((c) => c.name).join(","));
}
