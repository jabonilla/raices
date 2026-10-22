import { describe, expect, it } from "vitest";

import { readEnv } from "../src/env.js";

describe("readEnv (K2.29)", () => {
  it("accepts a valid PORT and DATABASE_URL", () => {
    const env = readEnv({ PORT: "4000", DATABASE_URL: "postgresql://x" });
    expect(env.port).toBe(4000);
    expect(env.databaseUrl).toBe("postgresql://x");
  });

  it("defaults PORT to 3000", () => {
    const env = readEnv({ DATABASE_URL: "postgresql://x" });
    expect(env.port).toBe(3000);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => readEnv({ PORT: "3000" })).toThrow("DATABASE_URL is not set");
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => readEnv({ PORT: "3000", DATABASE_URL: "" })).toThrow("DATABASE_URL is not set");
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => readEnv({ PORT: "abc", DATABASE_URL: "postgresql://x" })).toThrow(
      "PORT must be an integer",
    );
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => readEnv({ PORT: "99999", DATABASE_URL: "postgresql://x" })).toThrow(
      "PORT must be an integer",
    );
    expect(() => readEnv({ PORT: "0", DATABASE_URL: "postgresql://x" })).toThrow(
      "PORT must be an integer",
    );
  });
});

describe("readEnv secrets (#136)", () => {
  const base = { DATABASE_URL: "postgres://localhost/raices" };
  const pepper = "x".repeat(32);
  const all = {
    IDENTITY_PEPPER: pepper,
    RECEIPT_PEPPER: pepper,
    INVITE_LIMIT_PEPPER: pepper,
  };

  it("reports no secrets when none are set", () => {
    expect(readEnv(base).secrets).toBeUndefined();
  });

  it("reads all three when all three are set", () => {
    expect(readEnv({ ...base, ...all }).secrets).toEqual({
      identityPepper: pepper,
      receiptPepper: pepper,
      invitePepper: pepper,
    });
  });

  it("refuses a half-configured set rather than starting without authentication", () => {
    // Two of three is the dangerous shape: the process starts, the routes
    // are absent, and nothing says why until someone cannot log in.
    for (const omitted of Object.keys(all)) {
      const partial = Object.fromEntries(Object.entries(all).filter(([name]) => name !== omitted));
      expect(() => readEnv({ ...base, ...partial })).toThrow(new RegExp(omitted, "u"));
    }
  });

  it("refuses a pepper too short to be a secret, without logging it", () => {
    const short = "too-short";
    expect(() => readEnv({ ...base, ...all, RECEIPT_PEPPER: short })).toThrow(
      /RECEIPT_PEPPER must be at least 32 bytes; got 9\./u,
    );
    try {
      readEnv({ ...base, ...all, RECEIPT_PEPPER: short });
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });

  it("treats an empty string as unset", () => {
    expect(readEnv({ ...base, IDENTITY_PEPPER: "" }).secrets).toBeUndefined();
  });
});
