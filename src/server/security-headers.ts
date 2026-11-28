import { hrmsVideoOrigin } from "@/lib/hrms-video-origin";
export type HeaderOpts = { nonce: string; https: boolean; path: string; dev?: boolean };

/** Paths a Medoro page may embed in an iframe (the scanned-invoice preview). Everything else refuses framing. */
const FRAMEABLE = /^\/api\/documents\//;
/**
 * Pages of the signed-in app, where the Subscription page opens Razorpay Checkout, and /pay (desktop and self-hosted
 * installations paying Medoro) (a script that frames Razorpay and
 * may open bank popups). All of /app, because client-side navigation keeps the policy of the page first loaded.
 */
const CHECKOUT = /^\/(app|pay)(\/|$)/;
const RZP = "https://checkout.razorpay.com https://api.razorpay.com";
/**
 * The DriveDB device database worker and its SQLite build. A worker gets its own policy from its script's response:
 * it may compile the SQLite WebAssembly and talk to Google Drive directly, so pharmacy data never passes through us.
 */
const DRIVEDB = /^\/drivedb\//;
/**
 * The live product tour on the homepage: the design prototype built by scripts/build-tour.mjs. Its runtime compiles
 * the prototype's templates with `new Function`, so it needs 'unsafe-eval'. To keep that away from the app, the
 * policy sandboxes it into an opaque origin (no cookies, no storage, no same-origin access to Medoro) and lets only
 * our own pages frame it. Its fonts are then cross-origin requests, hence CORS on these files.
 */
const TOUR = /^\/tour\//;
/**
 * The tour videos on /videos may play from YouTube (privacy-enhanced embed). Allowed on every page, because a visitor
 * who lands elsewhere and follows a link keeps the policy of the page first loaded (client-side navigation).
 */
const YOUTUBE = "https://www.youtube-nocookie.com https://www.youtube.com";

/** The origin of NEXT_PUBLIC_VIDEO_BASE_URL when it is on another host, for media-src. */
function videoOrigin(): string {
  try { const u = new URL(process.env.NEXT_PUBLIC_VIDEO_BASE_URL ?? ""); return u.protocol === "https:" ? u.origin : ""; } catch { return ""; }
}

export const hrmsVoicePath = (path: string) => path.startsWith("/staff/hrms") || path.startsWith("/staff/employee");

export function contentSecurityPolicy({ nonce, https, path, dev }: HeaderOpts): string {
  if (DRIVEDB.test(path)) {
    return ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "connect-src 'self' https://www.googleapis.com", "worker-src 'self'", "base-uri 'none'", "frame-ancestors 'none'"].join("; ");
  }
  if (TOUR.test(path)) {
    return [
      "default-src 'none'", "script-src 'self' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "font-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
      "sandbox allow-scripts allow-downloads",
    ].join("; ");
  }
  const frameable = FRAMEABLE.test(path), checkout = CHECKOUT.test(path);
  // HRMS training videos play from signed links to a private storage bucket (lib/hrms-video-origin.ts).
  const hrv = path.startsWith("/staff/hrms") && hrmsVideoOrigin() ? ` ${hrmsVideoOrigin()}` : "";
  // The HRMS's AI HR Assistant runs speech recognition in the browser (Whisper through transformers.js): the model
  // files come from Hugging Face and the ONNX runtime's WebAssembly from jsDelivr. Audio never leaves the device.
  // Includes the employee sign-in page: it opens the HRMS with a client-side navigation, so its policy carries over.
  const hrms = hrmsVoicePath(path);
  const aiSpeech = hrms ? " https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net" : "";
  const d: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${nonce}' 'strict-dynamic'${hrms ? " 'wasm-unsafe-eval' https://cdn.jsdelivr.net" : ""}${dev ? " 'unsafe-eval'" : ""}`],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", `'self' data: blob:${checkout ? " https://*.razorpay.com" : ""}${hrv}`],
    ["font-src", "'self' data:"],
    // Product videos (/videos) may be served from a storage bucket or CDN set in NEXT_PUBLIC_VIDEO_BASE_URL.
    ["media-src", `'self' blob:${videoOrigin() ? ` ${videoOrigin()}` : ""}${hrv}`],
    ["connect-src", `${dev ? "'self' ws: wss:" : "'self'"}${checkout ? " https://*.razorpay.com" : ""}${aiSpeech}`],
    ["worker-src", `'self'${hrms ? " blob:" : ""}`],
    ["manifest-src", "'self'"],
    ["frame-src", `'self'${checkout ? ` ${RZP}` : ""} ${YOUTUBE}`],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    // Google sign-in for Drive backups is a top-level redirect started from our own pages.
    ["form-action", "'self' https://accounts.google.com"],
    ["frame-ancestors", frameable ? "'self'" : "'none'"],
  ];
  if (https) d.push(["upgrade-insecure-requests", ""]);
  return d.map(([k, v]) => (v ? `${k} ${v}` : k)).join("; ");
}

const OFFER_SIGN = /^\/(offer\/sign\/|staff\/(hrms|employee)(\/|$))/; // where documents are e-signed
export function securityHeaders(o: HeaderOpts): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(o),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Microphone only on HRMS pages (AI HR Assistant voice answers); location only where documents are e-signed (a
    // candidate's offer, an employee's joining letters, recorded with the signature). The browser still asks the person.
    "Permissions-Policy": `camera=(self), microphone=(${hrmsVoicePath(o.path) ? "self" : ""}), geolocation=${OFFER_SIGN.test(o.path) ? "(self)" : "()"}, payment=(), usb=(), browsing-topics=()`,
    "X-Frame-Options": FRAMEABLE.test(o.path) || TOUR.test(o.path) ? "SAMEORIGIN" : "DENY",
    "Cross-Origin-Opener-Policy": CHECKOUT.test(o.path) ? "same-origin-allow-popups" : "same-origin",
  };
  if (TOUR.test(o.path)) h["Access-Control-Allow-Origin"] = "*";
  if (o.https && process.env.DISABLE_HSTS !== "1") h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return h;
}
