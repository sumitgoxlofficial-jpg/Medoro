"use client";
import { CountUp } from "@/components/welcome-banner";
import { inr0 } from "@/lib/money";

/** A rupee amount that counts up when it first shows, like the pharmacy dashboard's KPIs. */
export const RupeeCountUp = ({ paise }: { paise: number }) => <CountUp value={paise} format={inr0} />;
