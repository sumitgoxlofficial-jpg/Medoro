import "server-only";
import { cookies } from "next/headers";
import { tFor, type Lang, type TFn } from "@/lib/tr";

/** The language chosen on this browser (the `medoro_lang` cookie). */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get("medoro_lang")?.value === "hi" ? "hi" : "en";
}

/** t() for server components and server actions: `const t = await getT(); t("Saved.")`. */
export async function getT(): Promise<TFn> {
  return tFor(await getLang());
}
