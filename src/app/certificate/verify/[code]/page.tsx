import type { Metadata } from "next";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { MarketingShell } from "@/components/seo/blocks";
import { verifyCertificate } from "@/staff/hrms/training/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Certificate verification · Medoro", robots: { index: false, follow: false } };

const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Public check of a Medoro Sales Training Certificate, reached from the QR code printed on it. Shows only what the certificate itself shows. */
export default async function Verify({ params }: { params: Promise<{ code: string }> }) {
  const c = await verifyCertificate((await params).code);
  return (
    <MarketingShell crumbs={[["Certificate verification", "/certificate/verify"]]}>
      <section className="max-w-[720px] mx-auto px-6 max-[640px]:px-4 py-14">
        {!c ? (
          <div className="rounded-2xl border border-[#F3C5C0] bg-[#FFF6F5] p-6 flex gap-4">
            <ShieldAlert className="text-[#B3261E] flex-none" size={32} aria-hidden />
            <div><h1 className="text-[22px] font-bold m-0">Certificate not found</h1><p className="mt-2 text-[15px] text-[#475569]">This verification code doesn’t match any Medoro certificate. Check that the whole address from the QR code was opened.</p></div>
          </div>
        ) : (
          <div className={`rounded-2xl border p-6 flex gap-4 ${c.revoked ? "border-[#F3C5C0] bg-[#FFF6F5]" : "border-[#B7E4DD] bg-[#F0FBF9]"}`}>
            {c.revoked ? <ShieldAlert className="text-[#B3261E] flex-none" size={32} aria-hidden /> : <BadgeCheck className="text-[#0B5E5B] flex-none" size={32} aria-hidden />}
            <div className="flex-1">
              <h1 className="text-[22px] font-bold m-0">{c.revoked ? "This certificate has been revoked" : "Valid Medoro certificate"}</h1>
              <dl className="mt-4 grid grid-cols-[150px_1fr] max-[480px]:grid-cols-1 gap-y-2 text-[15px]">
                <dt className="text-[#64748B]">Name</dt><dd className="m-0 font-semibold">{c.name}</dd>
                <dt className="text-[#64748B]">Employee ID</dt><dd className="m-0">{c.empNo}</dd>
                <dt className="text-[#64748B]">Programme</dt><dd className="m-0">{c.programme}</dd>
                <dt className="text-[#64748B]">Completed on</dt><dd className="m-0">{fmt(c.completedOn)}</dd>
                <dt className="text-[#64748B]">Certificate ID</dt><dd className="m-0 font-mono">{c.certNo}</dd>
                {c.revoked ? <><dt className="text-[#64748B]">Reason</dt><dd className="m-0">{c.revokedReason}</dd></> : null}
              </dl>
              <p className="mt-4 text-[13px] text-[#64748B]">Issued by Medoro to a member of its own sales team after training, assessment and approval.</p>
            </div>
          </div>
        )}
      </section>
    </MarketingShell>
  );
}
