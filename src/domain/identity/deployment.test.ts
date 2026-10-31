import { describe, expect, it } from "vitest";
import { databaseKind, deploymentMismatch, signupDeployment } from "./deployment";

describe("deployment choice", () => {
  it("classifies DATABASE_URL hosts", () => {
    expect(databaseKind("postgresql://u:p@127.0.0.1:5432/x")).toBe("local");
    expect(databaseKind("postgresql://u:p@db:5432/x")).toBe("local");
    expect(databaseKind("postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toBe("managed");
    expect(databaseKind("postgresql://u:p@10.0.0.5:5432/x")).toBe("other");
    expect(databaseKind(undefined)).toBe("unknown");
  });

  it("rejects a choice that contradicts the connected database", () => {
    expect(deploymentMismatch("hosted", "postgresql://u:p@localhost/x")).toMatch(/on this machine/);
    expect(deploymentMismatch("lan", "postgresql://u:p@db.abc.supabase.co/postgres")).toMatch(/Hosted PostgreSQL/);
    expect(deploymentMismatch("hosted", "postgresql://u:p@db.abc.supabase.co/postgres")).toBeNull();
    expect(deploymentMismatch("lan", "postgresql://u:p@localhost/x")).toBeNull();
  });

  it("records a self sign-up's deployment consistently with the server's database", () => {
    const supa = "postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", local = "postgresql://u:p@localhost/x";
    expect(signupDeployment("cloud", supa)).toBe("hosted");
    expect(signupDeployment("cloud", local)).toBe("cloud");
    expect(signupDeployment("hosted", local)).toBe("cloud");
    expect(signupDeployment("lan", local)).toBe("lan");
    expect(signupDeployment(undefined, local)).toBe("cloud");
    for (const u of [supa, local]) expect(deploymentMismatch(signupDeployment("cloud", u), u)).toBeNull();
  });
});
