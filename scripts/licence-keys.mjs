#!/usr/bin/env node
// Generates the Ed25519 key pair for Medoro licences.
//   LICENSE_SIGNING_KEY goes only into Medoro's own deployment (the staff console / licence server).
//   LICENSE_PUBLIC_KEY goes into every pharmacy installation that checks in with it.
// Usage: node scripts/licence-keys.mjs
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const priv = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");

console.log("# Licence server only (keep secret, keep an offline copy):");
console.log(`LICENSE_SIGNING_KEY=${priv}`);
console.log("");
console.log("# Every pharmacy installation:");
console.log(`LICENSE_PUBLIC_KEY=${pub}`);
