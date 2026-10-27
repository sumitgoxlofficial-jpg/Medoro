import Link from "next/link";
import { Mark, Wordmark } from "@/components/brand";
import { ToastProvider } from "@/components/ui/toast";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-dvh bg-bg flex flex-col items-center gap-7 px-4 py-10">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <Mark size={36} />
          <Wordmark size={22} />
        </Link>
        {children}
      </div>
    </ToastProvider>
  );
}
