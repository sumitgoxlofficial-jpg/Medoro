import { strToU8, zipSync } from "fflate";

/** Builds a minimal .xlsx with one sheet, like Excel saves it. */
export function xlsx(rows: (string | number)[][]) {
  const shared: string[] = [];
  const col = (i: number) => String.fromCharCode(65 + i);
  const xmlRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    shared.push(v); return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
  }).join("")}</row>`).join("");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return zipSync({
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xmlRows}</sheetData></worksheet>`),
  });
}
