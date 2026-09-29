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
