// Writes src-tauri/tauri.ci.conf.json for CI builds. Updater artifacts and Windows signing are
// switched on only when their secrets are present, so unsigned builds keep working without them.
import { writeFileSync } from "node:fs";

const env = process.env;
const conf = {};
const bundle = {};
const notes = [];

if (env.HAS_UPDATER_KEY === "true") {
  bundle.createUpdaterArtifacts = true;
  notes.push("updater artifacts: signed");
  if (env.TAURI_UPDATER_PUBKEY) {
    conf.plugins = { updater: { pubkey: env.TAURI_UPDATER_PUBKEY.trim() } };
    notes.push("updater pubkey: from TAURI_UPDATER_PUBKEY");
  }
} else notes.push("updater artifacts: off (no TAURI_SIGNING_PRIVATE_KEY)");

if (env.RUNNER_OS === "Windows") {
  if (env.WINDOWS_CERT_THUMBPRINT) {
    bundle.windows = { certificateThumbprint: env.WINDOWS_CERT_THUMBPRINT, digestAlgorithm: "sha256", timestampUrl: env.WINDOWS_TIMESTAMP_URL || "http://timestamp.digicert.com" };
    notes.push("windows: Authenticode certificate");
  } else if (env.HAS_TRUSTED_SIGNING === "true") {
    const { AZURE_TRUSTED_SIGNING_ENDPOINT: e, AZURE_TRUSTED_SIGNING_ACCOUNT: a, AZURE_TRUSTED_SIGNING_PROFILE: p } = env;
    bundle.windows = { signCommand: `trusted-signing-cli -e ${e} -a ${a} -c ${p} -d Medoro %1` };
    notes.push("windows: Azure Trusted Signing");
  } else notes.push("windows: unsigned");
}

if (Object.keys(bundle).length) conf.bundle = bundle;
writeFileSync(new URL("../src-tauri/tauri.ci.conf.json", import.meta.url), JSON.stringify(conf, null, 2) + "\n");
console.log(notes.join("\n"));
