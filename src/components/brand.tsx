import Image from "next/image";

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="font-bold tracking-tight" style={{ fontSize: size }}>
      <span style={{ color: "#0B3A78" }}>Med</span><span style={{ color: "#0A9A80" }}>oro</span>
    </span>
  );
}

export function Mark({ size = 28 }: { size?: number }) {
  return <Image src="/medoro-mark.png" alt="Medoro" width={size} height={size} style={{ width: size, height: "auto" }} priority />;
}
