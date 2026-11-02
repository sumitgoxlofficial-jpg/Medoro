/**
 * Connectors Medoro knows about. Every entry starts with `adapter: null` and the honest label from providers.ts; an
 * entry gets an adapter only when the provider's agreement is signed and the adapter is built from its
 * documentation. Nothing here pretends to connect.
 */
import { SOURCES } from "../providers";
import type { ConnectorAdapter, ConnectorDef } from "./types";

const caps = { webhook: false, minPollMin: null, historyDays: 0, consent: false };
const label = (sourceId: string) => SOURCES.find((s) => s.id === sourceId)!.label;

const BUILT_IN: ConnectorDef[] = [
  { id: "aa", kind: "aa", sourceId: "aa", name: "Account Aggregator (through a regulated partner)", label: label("aa"), capabilities: { ...caps, consent: true }, adapter: null },
  { id: "bank:icici", kind: "bank", sourceId: "bank-api", name: "ICICI Bank", label: label("bank-api"), capabilities: caps, adapter: null },
  { id: "bank:axis", kind: "bank", sourceId: "bank-api", name: "Axis Bank", label: label("bank-api"), capabilities: caps, adapter: null },
  { id: "bank:hdfc", kind: "bank", sourceId: "bank-api", name: "HDFC Bank", label: label("bank-api"), capabilities: caps, adapter: null },
  { id: "phonepe", kind: "provider", sourceId: "phonepe", name: "PhonePe Business", label: label("phonepe"), capabilities: caps, adapter: null },
  { id: "paytm", kind: "provider", sourceId: "paytm", name: "Paytm for Business", label: label("paytm"), capabilities: caps, adapter: null },
  { id: "bharatpe", kind: "provider", sourceId: "bharatpe", name: "BharatPe", label: label("bharatpe"), capabilities: caps, adapter: null },
];

const extra = new Map<string, ConnectorDef>();

export function connectors(): ConnectorDef[] {
  return [...BUILT_IN.filter((c) => !extra.has(c.id)), ...extra.values()];
}
export const connector = (id: string) => connectors().find((c) => c.id === id) ?? null;

/** Can a pharmacy connect this now? Needs an adapter, and "available" (or "sandbox" on a non-production server). */
export function connectable(c: ConnectorDef, env: NodeJS.ProcessEnv = process.env) {
  if (!c.adapter) return false;
  if (c.label === "available") return true;
  return c.label === "sandbox" && env.FIN_SANDBOX === "1" && env.NODE_ENV !== "production";
}

/** Tests only: adds or replaces a connector (a simulated provider). Refuses to run anywhere else. */
export function registerTestConnector(def: Omit<ConnectorDef, "adapter"> & { adapter: ConnectorAdapter }) {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) throw new Error("Test connectors can only be registered in tests.");
  extra.set(def.id, def);
  return () => { extra.delete(def.id); };
}
