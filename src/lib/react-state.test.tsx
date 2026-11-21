import { describe, expect, it } from "vitest";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { useBrowserValue, useLocalStorage, useOnChange } from "./react-state";
import { istDay } from "./use-now";

function Resetting({ target }: { target: string }) {
  const [v, setV] = useState("stale");
  useOnChange([target], () => setV(`reset for ${target}`));
  return <p>{v}</p>;
}

function NotOnMount({ target }: { target: string }) {
  const [v, setV] = useState("initial");
  useOnChange([target], () => setV("changed"), false);
  return <p>{v}</p>;
}

function Browser() {
  const w = useBrowserValue(() => "client", "server");
  const [stored] = useLocalStorage("k");
  return <p>{w}|{stored ?? "none"}</p>;
}

describe("useOnChange", () => {
  it("applies the reset in the same render (no stale first paint), on mount by default", () => {
    expect(renderToString(<Resetting target="a" />)).toContain("reset for a");
  });
  it("can skip the mount", () => {
    expect(renderToString(<NotOnMount target="a" />)).toContain("initial");
  });
});

describe("browser values", () => {
  it("render the server value on the server, so hydration matches", () => {
    expect(renderToString(<Browser />).replace(/<!-- -->/g, "")).toContain("server|none");
  });
});

describe("istDay", () => {
  it("is the India date, also across midnight UTC", () => {
    expect(istDay(Date.UTC(2026, 10, 20, 19, 0))).toBe("2026-11-21"); // 00:30 IST next day
    expect(istDay(Date.UTC(2026, 10, 20, 10, 0), 180)).toBe("2027-05-19");
  });
});
