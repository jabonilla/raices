import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, describe, expect, it } from "vitest";

import {
  UnsafeTestDatabaseError,
  assertUsableTestDatabase,
  startTestPostgres,
} from "../../../tests/pg.js";

describe("assertUsableTestDatabase", () => {
  it("accepts Postgres 16 on a database whose name ends in _test", () => {
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum: 160013, databaseName: "raices_test" });
    }).not.toThrow();
  });

  it.each([
    ["15.10", 150010],
    ["17.1", 170001],
    ["14.0", 140000],
  ])("refuses server_version_num outside 16xxxx (%s)", (_label, serverVersionNum) => {
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum, databaseName: "raices_test" });
    }).toThrow(UnsafeTestDatabaseError);
  });

  it.each([
    ["postgres"],
    ["raices"],
    ["raices_production"],
    // The Testcontainers default database is "test", which is NOT "_test".
    ["test"],
    ["test_raices"],
  ])("refuses a database named %s", (databaseName) => {
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum: 160013, databaseName });
    }).toThrow(UnsafeTestDatabaseError);
  });

  it("names the offending database and version in the message", () => {
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum: 150010, databaseName: "raices" });
    }).toThrow(/raices/);
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum: 150010, databaseName: "raices" });
    }).toThrow(/150010/);
  });

  it("accepts the boundary versions of the 16 series", () => {
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum: 160000, databaseName: "x_test" });
    }).not.toThrow();
    expect(() => {
      assertUsableTestDatabase({ serverVersionNum: 169999, databaseName: "x_test" });
    }).not.toThrow();
  });
});

/**
 * The unit tests above cover the decision; this one covers the wiring, by
 * pointing TEST_DATABASE_URL at a real database that fails the name check and
 * asserting startTestPostgres refuses before it can migrate anything.
 */
describe("startTestPostgres refuses an unsafe TEST_DATABASE_URL", () => {
  let container: StartedPostgreSqlContainer | undefined;

  afterAll(async () => {
    if (container !== undefined) await container.stop();
  });

  async function unsafeConnectionString(): Promise<string> {
    const existing = process.env["TEST_DATABASE_URL"];

    if (existing !== undefined && existing !== "") {
      // Same server, but point at "postgres", which cannot end in _test.
      const url = new URL(existing);
      url.pathname = "/postgres";
      return url.toString();
    }

    // No local database on offer, so use a container. Its default database is
    // "test", which the guard rejects.
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    return container.getConnectionUri();
  }

  it("throws UnsafeTestDatabaseError instead of migrating", async () => {
    const unsafe = await unsafeConnectionString();
    const previous = process.env["TEST_DATABASE_URL"];
    process.env["TEST_DATABASE_URL"] = unsafe;

    try {
      await expect(startTestPostgres()).rejects.toThrow(UnsafeTestDatabaseError);
    } finally {
      if (previous === undefined) {
        delete process.env["TEST_DATABASE_URL"];
      } else {
        process.env["TEST_DATABASE_URL"] = previous;
      }
    }
  });
});
