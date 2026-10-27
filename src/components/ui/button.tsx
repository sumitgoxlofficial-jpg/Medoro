import { forwardRef } from "react";
import { cn } from "./cn";

type Variant = "primary" | "outline" | "ghost" | "danger" | "danger-outline" | "soft";
type Size = "sm" | "md" | "lg";

const V: Record<Variant, string> = {
  primary: "bg-teal text-white border border-teal hover:bg-teal-hover shadow-card",
  outline: "bg-white text-ink border border-line hover:bg-page hover:border-input shadow-card",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-chip",
  danger: "bg-bad text-white border border-bad hover:brightness-110",
  "danger-outline": "bg-white text-bad border border-[#F0C8C3] hover:bg-bad-bg",
  soft: "bg-teal-tint text-teal border border-teal-line hover:bg-[#d3ebe8]",
};
const S: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12.5px] rounded-md gap-1.5",
  md: "h-[34px] px-3 text-[13px] rounded-lg gap-1.5",
  lg: "h-11 px-4 text-[15px] rounded-lg gap-2",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", className, type = "button", ...p }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap cursor-pointer transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        V[variant], S[size], variant === "primary" && "font-semibold", className,
      )}
      {...p}
    />
  );
});
