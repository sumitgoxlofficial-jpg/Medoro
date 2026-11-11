// Creates (or resets) a Medoro super admin who signs in to the HRMS with a one-time password.
//   DATABASE_URL=... node scripts/create-super-admin.mjs <email> <one-time-password> ["Full Name"] ["9876543210"]
// The one-time password works for a single sign-in within 7 days; the HRMS then forces a new password (12+ characters).
// Run `pnpm prisma migrate deploy` first. Never commit the password: pass it on the command line only.
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const [email, otp, name = "", phone = ""] = process.argv.slice(2);
if (!email || !otp) { console.error('Usage: node scripts/create-super-admin.mjs <email> <one-time-password> ["Full Name"] ["10-digit mobile"]'); process.exit(1); }
const e = email.trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { console.error("That doesn't look like an email."); process.exit(1); }
if (otp.length < 8) { console.error("Use a one-time password of at least 8 characters."); process.exit(1); }

const db = new PrismaClient();
try {
  const otpHash = await hash(otp, { memoryCost: 19456, timeCost: 2, parallelism: 1 }); // same settings as the app
  const otpExpiresAt = new Date(Date.now() + 7 * 86400_000);
  const have = await db.staffUser.findUnique({ where: { email_kind: { email: e, kind: "team" } } });
  let id = have?.id, empNo = have?.empNo;
  if (have) {
    await db.staffUser.update({ where: { id: have.id }, data: { role: "super_admin", status: "active", tokenVersion: { increment: 1 } } });
  } else {
    // Next free employee ID (MS-###), counted the way the app does.
    for (;;) {
      const [{ next }] = await db.$queryRaw`INSERT INTO "Sequence" ("tenantId","key","next") VALUES ('_cp','EMP',2) ON CONFLICT ("tenantId","key") DO UPDATE SET "next" = "Sequence"."next" + 1 RETURNING "next" - 1 AS next`;
      empNo = "MS-" + String(Number(next)).padStart(3, "0");
      if (!(await db.staffUser.findUnique({ where: { empNo } }))) break;
    }
    const mobile = phone.replace(/\D/g, "").slice(-10);
    const u = await db.staffUser.create({ data: { empNo, name: name || e.split("@")[0], email: e, kind: "team", phone: /^[6-9]\d{9}$/.test(mobile) ? mobile : "9000000000", role: "super_admin", status: "active" } });
    id = u.id;
  }
  const data = { role: "admin", otpHash, otpExpiresAt, mustChangePassword: true, profileDone: true };
  await db.hrProfile.upsert({ where: { staffId: id }, update: data, create: { staffId: id, ...data, designation: "Super Admin" } });
  console.log(`Super admin ready.\n  Employee ID: ${empNo}\n  Email:       ${e}\nSign in at /staff/employee with either, using the one-time password. It works once, for 7 days, then you set a new password.`);
} finally { await db.$disconnect(); }
