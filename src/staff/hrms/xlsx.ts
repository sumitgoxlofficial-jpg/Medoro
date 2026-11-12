import { strFromU8, unzipSync } from "fflate";

// A small reader for Excel (.xlsx) workbooks, which is what Google Sheets exports when asked for the whole spreadsheet:
// every tab by name, with its rows as text. Formulas, styles and charts are ignored; numbers come out as written.
export type Tab = { name: string; rows: string[][] };

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? "";
});
const textOf = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref: string) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "") n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const MAX_CELLS = 3_000_000;

export function readXlsx(bytes: Uint8Array): Tab[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) && f.originalSize < 60_000_000 }); }
  catch { throw new Error("That isn’t a spreadsheet file."); }
  const get = (n: string) => (files[n] ? strFromU8(files[n]) : "");
  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new Error("That isn’t a spreadsheet file.");
  const rels = new Map([...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1] ?? "", target = /\bTarget="([^"]*)"/.exec(m[0])?.[1] ?? "";
    return [id, target.replace(/^\/?(xl\/)?/, "xl/")] as const;
  }));
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  let cells = 0;
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].flatMap((m) => {
    const name = decode(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? ""), rid = /\br:id="([^"]*)"/.exec(m[0])?.[1] ?? "";
    const xml = get(rels.get(rid) ?? "");
    if (!xml) return [];
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\br="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (++cells > MAX_CELLS) throw new Error("The sheet is too large to read in one go.");
        const attrs = c[1], body = c[2] ?? "", t = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? "n", at = colIndex(/\br="([^"]*)"/.exec(attrs)?.[1] ?? "");
        let v = "";
        if (t === "s") v = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? "";
        else if (t === "inlineStr") v = textOf(body);
        else v = decode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        if (at >= 0) { while (row.length < at) row.push(""); row[at] = v; } else row.push(v);
      }
      const at = Number(r[1]) - 1;
      if (Number.isInteger(at) && at >= 0) { while (rows.length < at) rows.push([]); rows[at] = row; } else rows.push(row);
    }
    return [{ name, rows }];
  });
}
