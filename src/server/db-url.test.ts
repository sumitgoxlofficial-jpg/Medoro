import { describe, expect, it } from "vitest";
import { withConnectionLimit } from "./db-url";

describe("withConnectionLimit", () => {
  it("replaces or adds connection_limit", () => {
    expect(withConnectionLimit("postgres://h:6543/db?pgbouncer=true&connection_limit=1&sslmode=require", "5")).toBe("postgres://h:6543/db?pgbouncer=true&connection_limit=5&sslmode=require");
    expect(withConnectionLimit("postgres://h/db?pgbouncer=true", "5")).toBe("postgres://h/db?pgbouncer=true&connection_limit=5");
    expect(withConnectionLimit("postgres://h/db", "5")).toBe("postgres://h/db?connection_limit=5");
  });
  it("leaves the URL alone without a valid limit", () => {
    for (const l of [undefined, "", "0", "abc", "2.5"]) expect(withConnectionLimit("postgres://h/db?connection_limit=1", l)).toBe("postgres://h/db?connection_limit=1");
  });
});
