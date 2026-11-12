"use client";
import { useRouter } from "next/navigation";
import { importPreview, importRun, importTemplate } from "@/app/app/import-actions";
import type { ImportKind } from "@/domain/imports/columns";
import { ImportDialogCore, type ImportApi } from "./import-core";

const fd = (kind: ImportKind, f: File) => { const d = new FormData(); d.set("kind", kind); d.set("file", f); return d; };

/** Upload → check every row → import, on the online app (checked and saved on the server). */
export function ImportDialog({ kind, open, onClose }: { kind: ImportKind; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const api: ImportApi = { preview: (f) => importPreview(fd(kind, f)), run: (f) => importRun(fd(kind, f)), template: () => importTemplate(kind), done: () => router.refresh() };
  return <ImportDialogCore kind={kind} open={open} onClose={onClose} api={api} />;
}
