"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "./cn";

/** A password (or PIN) field with an eye button so people can check what they typed. */
export function PasswordInput({ className, ...p }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block w-full">
      <input {...p} type={show ? "text" : "password"} className={cn(className, "pr-11")} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        disabled={p.disabled}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        className="absolute right-1 top-1/2 -translate-y-1/2 size-9 inline-flex items-center justify-center rounded-md text-[#64748B] hover:text-[#0B5E5B] bg-transparent border-0 cursor-pointer disabled:opacity-40 disabled:cursor-default"
      >
        {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </span>
  );
}
