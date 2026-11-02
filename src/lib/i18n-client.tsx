"use client";
/**
 * The chosen language for screens running in the browser. The root layout reads the `medoro_lang` cookie and puts
 * <LangProvider> around every page, so `useT()` and <T> work everywhere (app, counter, sign-in, offline page).
 */
import { createContext, use, useContext, useMemo } from "react";
import { hindiLoaded, loadHindi, tFor, type Lang, type TFn, type Vars } from "./tr";

const LangCtx = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  // In the browser the Hindi lines arrive as their own file; wait for it so the page never flashes English.
  if (lang === "hi" && !hindiLoaded()) use(loadHindi());
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);

/** `const t = useT(); t("Save")`. */
export function useT(): TFn {
  const lang = useLang();
  return useMemo(() => tFor(lang), [lang]);
}

/**
 * Text in the chosen language, for places that can't call a hook (server components, shared UI pieces):
 * `<T>Save</T>` or `<T vars={{ n }}>{"Only {n} left"}</T>`. Anything that isn't plain text is shown as it is.
 */
export function T({ children, vars }: { children?: React.ReactNode; vars?: Vars }) {
  const t = useT();
  if (typeof children === "string") return <>{t(children, vars)}</>;
  if (Array.isArray(children) && children.every((c) => typeof c === "string" || typeof c === "number")) return <>{t(children.join(""), vars)}</>;
  return <>{children}</>;
}

