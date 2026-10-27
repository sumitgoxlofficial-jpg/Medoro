import { toCsv } from "./csv-format";

/** Builds a CSV in the browser and downloads it. Data never leaves the device. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  a.download = name + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
}
