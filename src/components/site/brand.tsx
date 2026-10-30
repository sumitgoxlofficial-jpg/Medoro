import Image from "next/image";

export const WA = "https://wa.me/916207774673";
export const WA_DEMO = `${WA}?text=${encodeURIComponent("Hi Medoro, I'd like a demo for my pharmacy.")}`;

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Image src="/site/mark.png" alt="" width={64} height={52} style={{ width: size * 1.3, height: "auto" }} className="block" />
      <span className="font-cond font-bold tracking-[.005em] leading-none" style={{ fontSize: size }}><span className="text-[#0B3A78]">Med</span><span className="text-[#0A8A73]">oro</span></span>
    </span>
  );
}
