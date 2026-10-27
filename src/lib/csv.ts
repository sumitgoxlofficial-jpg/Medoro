/** Builds a CSV in the browser and downloads it. Data never leaves the device. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const txt = rows.map((r) => r.map((v) => {
    const x = String(v ?? "");
    const safe = /^[=+\-@]/.test(x) && isNaN(Number(x)) ? "'" + x : x; // block spreadsheet formula injection
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" }));
  a.download = name + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
}
