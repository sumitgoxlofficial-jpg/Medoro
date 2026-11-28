// What a signer submits when e-signing (an offer as a candidate, or a joining letter as an employee), checked the same way everywhere.
import { z } from "zod";
import { MOBILE_RE, digits } from "../constants";

const PNG_MAGIC = "iVBORw0KGgo";
export const signSchema = z.object({
  name: z.string().trim().min(3, "Enter your full name.").max(80),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter your 10-digit mobile number."),
  place: z.string().trim().min(2, "Enter the place (city or town) where you are signing.").max(80),
  lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).max(1_000_000),
  type: z.enum(["typed", "drawn"]),
  png: z.string().transform((v) => v.replace(/^data:image\/png;base64,/, "")).refine((v) => v.startsWith(PNG_MAGIC) && v.length < 400_000 && /^[A-Za-z0-9+/=]+$/.test(v), "Sign in the box first."),
  consent: z.literal(true, { error: "Tick the box to agree to sign electronically." }),
  dataConsent: z.literal(true, { error: "Tick the box to agree to the recording of your signing details." }),
});
/** The version of the disclosure and consent text the candidate agreed to (kept in the audit trail). */
export const DISCLOSURE_VERSION = "ERSD-IN-2026-11";
