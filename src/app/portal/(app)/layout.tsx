import Link from "next/link";
import { redirect } from "next/navigation";
import { readPortalAccount } from "@/domain/distribution/portal";
import { signOutAction } from "../actions";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const a = await readPortalAccount();
  if (!a) redirect("/portal/signin");
  return (
    <>
      <header className="bg-[#0B2545] text-white">
        <div className="max-w-[1100px] mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/portal" className="text-white hover:text-white font-semibold">MEDORO <span className="font-normal text-[#8FA6C6]">Chemist Portal</span></Link>
          <span className="ml-auto text-[13px] text-[#C3CFDF] hidden sm:inline">{a.firmName}</span>
          <form action={signOutAction}><button className="text-[13px] text-[#C3CFDF] hover:text-white">Sign out</button></form>
        </div>
      </header>
      <main className="max-w-[1100px] mx-auto px-4 py-6">{children}</main>
    </>
  );
}
