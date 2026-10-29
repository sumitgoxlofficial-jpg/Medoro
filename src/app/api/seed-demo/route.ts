import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { hash } from "@node-rs/argon2";

// One-shot demo seed endpoint. Only runs when SEED_DEMO=1 and correct token is provided.
export async function POST(req: NextRequest) {
  if (process.env.SEED_DEMO !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const { token } = await req.json().catch(() => ({}));
  if (token !== process.env.SETUP_TOKEN) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await db.tenant.findUnique({ where: { code: "DEMO" } });
  if (existing) return NextResponse.json({ ok: true, note: "already exists" });

  const pwHash = await hash("Demo@1234", { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  await db.$transaction(async tx => {
    const tenant = await tx.tenant.create({
      data: { code: "DEMO", name: "Demo Pharmacy", phone: "6207774673", settings: {} },
    });
    await tx.branch.create({
      data: { tenantId: tenant.id, name: "Main Branch", code: "MAIN", address: "Pune, Maharashtra" },
    });
    const role = await tx.role.create({
      data: { tenantId: tenant.id, name: "Owner", permissions: ["*"], locked: true },
    });
    await tx.user.create({
      data: {
        tenantId: tenant.id, name: "Demo Owner", email: "demo@medoro.in",
        passwordHash: pwHash, roleId: role.id, active: true,
        mfaRequired: false, mfaEnabled: false, tokenVersion: 0,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
