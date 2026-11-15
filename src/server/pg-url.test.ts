import { describe, expect, it } from "vitest";
import { pgConnectionString } from "./pg-url";

describe("pgConnectionString", () => {
  it("gives sslmode=require its libpq meaning", () => {
    expect(pgConnectionString("postgres://u:p@h:5432/db?sslmode=require")).toBe("postgres://u:p@h:5432/db?sslmode=require&uselibpqcompat=true");
  });
  it("leaves stricter modes, explicit choices and plain URLs alone", () => {
    for (const u of ["postgres://h/db?sslmode=verify-full", "postgres://h/db?sslmode=require&uselibpqcompat=false", "postgres://h/db", undefined]) expect(pgConnectionString(u)).toBe(u);
  });
});
