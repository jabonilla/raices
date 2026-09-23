import { describe, expect, it } from "vitest";

import { assertSafeDatabase, databaseNameFromUrl, UnsafeDatabaseError } from "./db-guard.js";

describe("db-guard", () => {
  it("accepts names ending in _dev", () => {
    expect(() => {
      assertSafeDatabase("postgres://raices:raices@localhost:5432/raices_dev");
    }).not.toThrow();
  });

  it("accepts names ending in _test", () => {
    expect(() => {
      assertSafeDatabase("postgres://raices:raices@localhost:5432/raices_test");
    }).not.toThrow();
  });

  it("refuses a production-looking name", () => {
    expect(() => {
      assertSafeDatabase("postgres://u:p@db.example.com:5432/raices");
    }).toThrow(UnsafeDatabaseError);
  });

  it("refuses a name that merely contains _dev", () => {
    expect(() => {
      assertSafeDatabase("postgres://u:p@h:5432/raices_dev_backup");
    }).toThrow(UnsafeDatabaseError);
  });

  it("refuses the default postgres database", () => {
    expect(() => {
      assertSafeDatabase("postgres://u:p@h:5432/postgres");
    }).toThrow(UnsafeDatabaseError);
  });

  it("handles query strings and keyword/value forms", () => {
    expect(databaseNameFromUrl("postgres://u:p@h:5432/raices_dev?sslmode=require")).toBe(
      "raices_dev",
    );
    expect(databaseNameFromUrl("host=h dbname=raices_dev user=u")).toBe("raices_dev");
  });

  it("throws when no database name can be found", () => {
    expect(() => databaseNameFromUrl("not-a-connection-string")).toThrow(UnsafeDatabaseError);
  });
});
