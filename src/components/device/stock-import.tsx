"use client";
import { useMemo } from "react";
import { ImportDialogCore, type ImportApi } from "@/components/import-core";
import { deviceDb } from "@/drivedb/device";
import { readTable } from "@/domain/imports/parse";
import { TEMPLATE_EXAMPLE, templateHeader } from "@/domain/imports/columns";
import { errText, type Cfg } from "./ui";

/** Stock list import on the counter: the file is read and checked on this device and saved to this device's records. */
export function StockImport({ cfg, userId, open, onClose, onDone }: { cfg: Cfg; userId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const api = useMemo<ImportApi>(() => {
    const dev = deviceDb();
    const table = async (f: File) => {
      if (f.size > 25 * 1024 * 1024) throw new Error("The file is over 25 MB. Split it and import in parts.");
      try { return readTable(f.name, new Uint8Array(await f.arrayBuffer())); } catch (e) { throw new Error(e instanceof Error ? e.message : "Couldn’t read the file."); }
    };
    return {
      preview: async (f) => { try { return { ok: true, data: await dev.call("previewStockSheet", cfg.branchId, await table(f)) }; } catch (e) { return { ok: false, error: errText(e) }; } },
      run: async (f) => { try { return { ok: true, data: { ...(await dev.call("importStockSheet", { branchId: cfg.branchId, userId: userId, table: await table(f) })), failed: [] } }; } catch (e) { return { ok: false, error: errText(e) }; } },
      template: async () => ({ ok: true, data: [templateHeader("medicines"), TEMPLATE_EXAMPLE.medicines] }),
      done: onDone,
    };
  }, [cfg.branchId, userId, onDone]);
  return <ImportDialogCore kind="medicines" open={open} onClose={onClose} api={api} />;
}
