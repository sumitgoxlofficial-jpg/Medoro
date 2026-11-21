"use client";
import { useCallback, useState, useSyncExternalStore } from "react";

const changed = (a: readonly unknown[] | null, b: readonly unknown[]) => !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

/**
 * Runs `onChange` while rendering whenever a value in `deps` changes (and on mount unless `onMount` is false): the
 * render-time form of `useEffect(() => { setX(...) }, deps)` that React recommends for resetting a component's own
 * state from its props. The state is right in the same render, without an extra commit showing stale values.
 * `onChange` may only set this component's state: do fetches and other side effects in an effect.
 */
export function useOnChange(deps: readonly unknown[], onChange: () => void, onMount = true) {
  const [prev, setPrev] = useState<readonly unknown[] | null>(onMount ? null : deps);
  if (changed(prev, deps)) {
    setPrev(deps);
    onChange();
  }
}

const noSubscribe = () => () => {};

/** A value only the browser knows (window, navigator, document), read without a mismatch on the server render. */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}

const LS_EVENT = "medoro:local-storage";
const lsSubscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(LS_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(LS_EVENT, cb); };
};
const lsRead = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/**
 * A localStorage entry as React state: read on the client (null on the server, so hydration matches), updated in every
 * component and tab that uses it when it is written through the returned setter. Private windows behave as empty.
 */
export function useLocalStorage(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(lsSubscribe, () => lsRead(key), () => null);
  const set = useCallback((v: string | null) => {
    try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* private window */ }
    window.dispatchEvent(new Event(LS_EVENT));
  }, [key]);
  return [value, set];
}
