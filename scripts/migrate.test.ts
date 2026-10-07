import { describe, expect, it } from "vitest";

import { UnsafeDatabaseError } from "./db-guard.js";
import { assertMigrationTarget } from "./migrate.js";

const CONNECTION_STRING = "postgres://raices:secret@db.internal:5432/railway";

describe("assertMigrationTarget", () => {
  it("refuses when MIGRATIONS_TARGET_DB is missing", () => {
    expect(() => assertMigrationTarget(CONNECTION_STRING, undefined)).toThrowError(
      /MIGRATIONS_TARGET_DB is not set/,
    );
  });

  it("refuses when MIGRATIONS_TARGET_DB is empty", () => {
    expect(() => assertMigrationTarget(CONNECTION_STRING, "")).toThrowError(
      /MIGRATIONS_TARGET_DB is not set/,
    );
  });

  it("refuses when MIGRATIONS_TARGET_DB does not match the database name", () => {
    expect(() => assertMigrationTarget(CONNECTION_STRING, "someone_else_db")).toThrowError(
      /MIGRATIONS_TARGET_DB is "someone_else_db"/,
    );
  });

  it("refuses when the connection string has no database name to compare", () => {
    expect(() => assertMigrationTarget("postgres://u:p@h:5432", "whatever")).toThrowError(
      UnsafeDatabaseError,
    );
  });

  it("passes when MIGRATIONS_TARGET_DB names the database exactly", () => {
    expect(() => assertMigrationTarget(CONNECTION_STRING, "railway")).not.toThrow();
  });
});
