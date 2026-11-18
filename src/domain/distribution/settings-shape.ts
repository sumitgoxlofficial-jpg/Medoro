// Distribution settings kept in Tenant.settings.dist. No server-only imports: the setup service uses the defaults.

export type DistSettings = {
  /** Shortest remaining shelf life (days) of stock sent to chemists. */
  minShelfDays: number;
  /** Purchase planning: days of stock to cover after a delivery, and safety days. */
  coverDays: number;
  safetyDays: number;
  /** Orders above the chemist's limit or terms: "hold" for approval (default) or "block". */
  creditMode: "hold" | "block";
  portal: {
    enabled: boolean;
    /** Listed in the portal's distributor search so chemists can ask to connect. */
    discoverable: boolean;
    /** What a chemist sees of stock: exact packs, a band (In stock / Low / Out), or nothing. */
    stock: "exact" | "band" | "none";
    showSchemes: boolean;
    showMrp: boolean;
    /** Smallest order accepted from the portal, paise. */
    minOrderPaise: number;
    /** Areas served, shown in discovery. */
    serviceArea: string;
  };
  invoicePrefix: string;
};

export const DIST_DEFAULT_SETTINGS: DistSettings = {
  minShelfDays: 60, coverDays: 15, safetyDays: 3, creditMode: "hold",
  portal: { enabled: true, discoverable: true, stock: "band", showSchemes: true, showMrp: true, minOrderPaise: 0, serviceArea: "" },
  invoicePrefix: "INV",
};

export function distSettingsOf(settings: unknown): DistSettings {
  const d = ((settings ?? {}) as { dist?: Partial<DistSettings> }).dist ?? {};
  return { ...DIST_DEFAULT_SETTINGS, ...d, portal: { ...DIST_DEFAULT_SETTINGS.portal, ...(d.portal ?? {}) } };
}
