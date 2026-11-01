"use client";
import { useRouter } from "next/navigation";
import { RestoreSetup } from "../setup/restore";

/** Sign-up: restore a returning pharmacy from its Google Drive backup instead of starting empty. */
export function RestoreFromDrive({ driveApp, driveAccount }: { driveApp: boolean; driveAccount: string | null }) {
  const router = useRouter();
  return <RestoreSetup signup driveApp={driveApp} driveAccount={driveAccount} onBack={() => router.push("/signup")} />;
}
