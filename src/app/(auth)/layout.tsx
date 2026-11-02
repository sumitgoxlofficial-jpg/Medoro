import Link from "next/link";
import { Mark, Wordmark } from "@/components/brand";
import { ToastProvider } from "@/components/ui/toast";
import { LangSwitch } from "@/components/lang-switch";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="relative min-h-dvh bg-bg flex flex-col items-center gap-7 px-4 py-10">
        {/* Before sign-in there is no header, so the language is picked here. */}
        <LangSwitch className="absolute top-3 right-3" />
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <Mark size={36} />
          <Wordmark size={22} />
        </Link>
        {children}
      </div>
    </ToastProvider>
  );
}
