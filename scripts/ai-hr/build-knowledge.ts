// Extracts Medoro HRMS product knowledge into src/staff/hrms/ai-hr/knowledge-seed.json:
//  * every screen in SCREENS (purpose, who can open it), from src/staff/hrms/constants.ts
//  * docs/HRMS.md and the Enterprise HRMS phase reports, split by heading and paragraph/bullet into short records.
// Run: pnpm tsx scripts/ai-hr/build-knowledge.ts   (deterministic; commit the JSON).
import { readFileSync, writeFileSync } from "node:fs";
import { SCREENS, MODULES, HR_ROLE_LABEL } from "../../src/staff/hrms/constants";

type Doc = { key: string; kind: "module" | "faq" | "procedure" | "rule"; title: string; body: string; source: string };
const out: Doc[] = [];
const roleNames = (r?: string[]) => (r ?? []).map((x) => HR_ROLE_LABEL[x as keyof typeof HR_ROLE_LABEL]).join(", ");
for (const s of SCREENS) {
  const who = s.roles?.length ? `It opens for: ${roleNames(s.roles)}.` : "";
  const mod = s.module ? `It opens for anyone holding the ${MODULES.find((m) => m.id === s.module)?.label} module (Roles & Permissions).` : "";
  out.push({ key: `screen.${s.id}`, kind: "module", title: `${s.label} screen`, body: `The ${s.title} screen in the Medoro HRMS (menu ${s.group ?? "account menu"}): ${s.sub || s.title}. ${who} ${mod}`.replace(/\s+/g, " ").trim(), source: `src/staff/hrms/constants.ts#SCREENS.${s.id}` });
}
const clean = (t: string) => t.replace(/\*\*/g, "").replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
function md(path: string, prefix: string) {
  const text = readFileSync(path, "utf8");
  let h1 = "", h2 = "", n = 0;
  const blocks = text.split(/\n(?=#{1,3} )|\n\s*\n|\n(?=\* |- |\d+\. )/);
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    const head = b.match(/^(#{1,3}) (.+)$/m);
    if (head && b.startsWith("#")) { if (head[1].length <= 1) h1 = clean(head[2]); else h2 = clean(head[2]); const rest = b.slice(b.indexOf("\n") + 1).trim(); if (!rest || rest === b) continue; }
    if (/^\|/.test(b)) { // table rows become one record each
      for (const row of b.split("\n").filter((r) => /^\|/.test(r) && !/^\|[-\s|]+\|$/.test(r))) {
        const cells = row.split("|").map((c) => clean(c)).filter(Boolean);
        if (cells.length >= 2 && !/^(Role|Area|Path|Migration|Variable|Data|Check|#)$/.test(cells[0])) out.push({ key: `${prefix}.${++n}`, kind: "rule", title: `${h2 || h1}: ${cells[0]}`.slice(0, 120), body: cells.slice(1).join(". ").slice(0, 900), source: `${path}#${h2 || h1}` });
      }
      continue;
    }
    const body = clean(b.replace(/^#{1,3} .+\n?/, "").replace(/^[*-] |^\d+\. /gm, ""));
    if (body.length < 60) continue;
    const lead = body.match(/^([A-Z][\w &/'-]{2,40})[.:] /)?.[1];
    for (let i = 0; i < body.length; i += 850) out.push({ key: `${prefix}.${++n}`, kind: "rule", title: `${h2 || h1}${lead ? ": " + lead : ""}`.slice(0, 120), body: body.slice(i, i + 900), source: `${path}#${h2 || h1}` });
  }
}
md("docs/HRMS.md", "hrms");
for (const f of ["PHASE_6_SHIFTS_PAYROLL_OPS", "PHASE_7_LEARNING_ENGAGEMENT_ALLY", "PHASE_3_RBAC_APPROVALS", "PHASE_2_ORG"]) md(`docs/enterprise-hrms/${f}.md`, f.toLowerCase());
writeFileSync("src/staff/hrms/ai-hr/knowledge-seed.json", JSON.stringify(out, null, 1) + "\n");
console.log(`knowledge-seed.json: ${out.length} records (${out.filter((d) => d.kind === "module").length} screens)`);
