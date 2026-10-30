import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { UserError } from "@/server/action";
import { tokenMatches } from "@/server/setup-gate";
import { createPharmacy, isSetupDone } from "@/domain/identity/service";
import { passwordSchema } from "@/domain/identity/contracts";

/**
 * One-shot demo seed for an empty installation. Needs SEED_DEMO=1 and the SETUP_TOKEN, and goes
 * through the same path as the setup wizard, so it can only ever create the first pharmacy.
 */
export async function POST(req: NextRequest) {
  if (process.env.SEED_DEMO !== "1" || !process.env.SETUP_TOKEN) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; password?: unknown; email?: unknown; phone?: unknown };
  if (typeof body.token !== "string" || !tokenMatches(body.token)) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (await isSetupDone()) return NextResponse.json({ error: "This installation is already set up." }, { status: 409 });

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const given = str(body.password);
  const password = given ?? randomBytes(18).toString("base64url");
  const backupKey = randomBytes(32).toString("base64url");
  const email = str(body.email) ?? "demo@medoro.in";
  try {
    passwordSchema.parse(password);
    const r = await createPharmacy({
      pharmacy: { name: "Demo Pharmacy", code: "DEMO", dl: "DEMO-DL-0001", address: "Pune, Maharashtra" },
      owner: { name: "Demo Owner", email, phone: str(body.phone) ?? "9000000000", password },
      deployment: "cloud",
      branches: [{ name: "Main Branch", counters: 1 }],
      invites: [],
      backupKey,
      kitAck: true,
    });
    // Generated secrets are shown once here and never stored in plain text.
    return NextResponse.json({ ok: true, tenantCode: r.tenantCode, email, ...(given ? {} : { password }), backupKey }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong. Nothing was saved." }, { status: 500 });
  }
}
