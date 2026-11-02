import { T } from "./i18n-client";

/** Plain text shown in the chosen language (through <T>); anything else unchanged. For shared UI pieces. */
export const tx = (n: React.ReactNode): React.ReactNode => (typeof n === "string" ? <T>{n}</T> : n);
