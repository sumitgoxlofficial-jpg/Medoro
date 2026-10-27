import { cn } from "./cn";

export type Tone = "green" | "amber" | "red" | "blue" | "gray" | "teal" | "purple";
export const TONES: Record<Tone, [string, string]> = {
  green: ["#E6F4EC", "#1E7F4F"], amber: ["#FDF2E1", "#94570A"], red: ["#FBEAE8", "#B3261E"],
  blue: ["#EAF0FC", "#2459C9"], gray: ["#EEF0F2", "#4B535B"], teal: ["#E1F1EF", "#0B5E5B"], purple: ["#F1EEFB", "#5B45B0"],
};

export function Badge({ tone = "gray", className, style, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  const [bg, fg] = TONES[tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-[12px] font-medium whitespace-nowrap", className)}
      style={{ background: bg, color: fg, ...style }}
      {...p}
    />
  );
}
