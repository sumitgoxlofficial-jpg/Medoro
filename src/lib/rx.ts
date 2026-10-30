/** Schedules whose sales go in the H1 register with patient, prescriber and registration number. */
export const H1_SCHEDULES = ["H1", "X", "NDPS"] as const;
export const isH1 = (schedule: string | null | undefined) => (H1_SCHEDULES as readonly string[]).includes(schedule ?? "");
