import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hkdfSync, randomBytes } from "node:crypto";
import { decrypt, embeddedResults, embeddedSend, encrypt, hasLink, noteReply, whatsappDir } from "./embedded";
import { builtIn, connectorMissing } from "./connector";

// The WhatsApp link built into Medoro (taken from FITRON for Windows). Nothing here talks to WhatsApp.
describe("built-in WhatsApp link", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "medoro-wa-"));
    vi.stubEnv("WA_DATA_DIR", dir);
    vi.stubEnv("WA_CONNECTOR_URL", "");
    vi.stubEnv("WA_CONNECTOR_KEY", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("HOST_KEY", "k".repeat(40));
  });
  afterAll(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it("is used when no connector is set and the server keeps running, never on Vercel", () => {
    expect(builtIn()).toBe(true);
    expect(connectorMissing()).toBeNull();
    vi.stubEnv("VERCEL", "1");
    expect(builtIn()).toBe(false);
    expect(connectorMissing()).toMatch(/stays on/);
    vi.stubEnv("VERCEL", "");
  });

  it("encrypts the link's files", () => {
    const key = randomBytes(32);
    const box = encrypt('{"me":{"id":"91x"}}', key);
    expect(box.includes(Buffer.from("91x"))).toBe(false);
    expect(decrypt(box, key)).toBe('{"me":{"id":"91x"}}');
    expect(() => decrypt(box, randomBytes(32))).toThrow();
  });

  it("keeps nothing until a phone is linked, then queues messages in the outbox", () => {
    expect(hasLink("t1")).toBe(false);
    expect(embeddedSend("t1", { localId: "m1:1", to: "919822041736", body: "Hi" })).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    // A saved login, as Baileys writes it after the QR is scanned (encrypted with the key from HOST_KEY).
    const key = Buffer.from(hkdfSync("sha256", "k".repeat(40), "medoro-whatsapp", "session-files", 32));
    mkdirSync(path.join(whatsappDir("t1"), "session"), { recursive: true });
    writeFileSync(path.join(whatsappDir("t1"), "session", "creds.json"), encrypt(JSON.stringify({ me: { id: "919822000555:1@s.whatsapp.net" } }), key));
    expect(hasLink("t1")).toBe(true);
    // Write straight to the outbox (embeddedSend would also start the connection to WhatsApp).
    mkdirSync(path.join(whatsappDir("t1"), "outbox"), { recursive: true });
    writeFileSync(path.join(whatsappDir("t1"), "outbox", "0-m1_1.json"), JSON.stringify({ localId: "m1:1", to: "919822041736", body: "Hi", at: new Date().toISOString(), attempts: 0 }));
    writeFileSync(path.join(whatsappDir("t1"), "results.json"), JSON.stringify({ "m0:1": { status: "Delivered", at: new Date().toISOString() } }));
    expect(embeddedResults("t1", ["m0:1", "m1:1", "other"])).toEqual({ "m0:1": { status: "Delivered" }, "m1:1": { status: "Queued" } });
  });

  it("remembers STOP and START replies", () => {
    noteReply("t1", "919822041736", "stop");
    noteReply("t1", "919822000111", "thanks");
    expect(JSON.parse(readFileSync(path.join(whatsappDir("t1"), "stopped.json"), "utf8"))).toEqual(["919822041736"]);
    noteReply("t1", "919822041736", "START");
    expect(JSON.parse(readFileSync(path.join(whatsappDir("t1"), "stopped.json"), "utf8"))).toEqual([]);
  });
});
