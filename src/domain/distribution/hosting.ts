import { driveRequired } from "@/domain/system/drive-state";

/**
 * Where MEDORO Distribution may keep its records. The distribution ERP is a server-database product (stock, ledgers,
 * shared chemist portal); it has no Google-Drive-only device mode like MEDORO Pharmacy's counters.
 *
 *  - A distributor's own server / own database (self-hosted, LAN, its own Supabase): always allowed.
 *  - MEDORO's own hosted multi-tenant server (PUBLIC_SIGNUP=1), whose policy is that tenant records live in each
 *    tenant's Google Drive: allowed only when the operator sets DIST_HOSTED=1, a deliberate decision to keep
 *    distributor records on that server (update the privacy notice first). Otherwise distributor sign-up is closed
 *    there and existing distributor records stay read-only, exactly like pharmacies that have not moved to Drive.
 */
export const distHostingAllowed = (env: Record<string, string | undefined> = process.env) => env.PUBLIC_SIGNUP !== "1" || env.DIST_HOSTED === "1";

/**
 * MEDORO Distribution in Drive mode (docs/DIST_DRIVE_PLAN.md): on the hosted server, a new distributor keeps its
 * records on its devices and in its own Google Drive, as a pharmacy does. Off until the operator sets DIST_DRIVE=1,
 * which waits for the distribution screens on the device (phase D4).
 */
export const distDriveSignup = (env: Record<string, string | undefined> = process.env) => env.PUBLIC_SIGNUP === "1" && env.DIST_DRIVE === "1";
/** Distributor sign-up is open: on its own server, where the operator allows records here, or in Drive mode. */
export const distSignupAllowed = (env: Record<string, string | undefined> = process.env) => distHostingAllowed(env) || distDriveSignup(env);

/** A distribution context is exempt from the pharmacy "move to Google Drive" lock only where hosting is allowed. */
export const distMustMove = (env: Record<string, string | undefined> = process.env) => driveRequired() && !distHostingAllowed(env);
