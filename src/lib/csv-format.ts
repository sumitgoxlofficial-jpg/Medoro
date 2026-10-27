/** CSV text with a UTF-8 BOM (Excel-friendly). Cells starting with = + - @ are prefixed to block formula injection. */
export function toCsv(rows: (string | number | null | undefined)[][]) {
  return "﻿" + rows.map((r) => r.map((v) => {
    const x = String(v ?? "");
    const safe = /^[=+\-@]/.test(x) && isNaN(Number(x)) ? "'" + x : x;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }).join(",")).join("\n");
}
