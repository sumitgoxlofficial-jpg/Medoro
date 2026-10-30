"use client";
import { useState } from "react";
import { Wizard } from "./wizard";
import { RestoreSetup } from "./restore";
import type { Deployment as Dep } from "@/domain/identity/deployment";

/** First run: set up a new pharmacy, or restore one from a backup with the recovery kit. */
export function Start({ deployment, driveApp, driveAccount, restore }: { deployment: Dep; driveApp: boolean; driveAccount: string | null; restore: boolean }) {
  const [mode, setMode] = useState<"new" | "restore">(restore ? "restore" : "new");
  return mode === "restore"
    ? <RestoreSetup driveApp={driveApp} driveAccount={driveAccount} onBack={() => setMode("new")} />
    : <Wizard deployment={deployment} driveApp={driveApp} driveAccount={driveAccount} onRestore={() => setMode("restore")} />;
}
