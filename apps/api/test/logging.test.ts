import { expect, it } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";

import { REDACTED_PATHS, REDACT_OPTIONS } from "../src/logging.js";

// Redaction is the point of K2.5. This test logs an object full of
// sensitive fields and asserts none of the values appear in the output.
// If pino's redact deny-list stops covering a field, this test fails.

const SENSITIVE_VALUES = {
  phone: "+15551234567",
  phoneNumber: "+50255512345",
  name: "María García",
  firstName: "María",
  lastName: "García",
  email: "maria.garcia@example.com",
  accountId: "acc_123456789",
  accountNumber: "1234567890",
  amount: "99999",
};

function captureLogs(logFn: (logger: pino.Logger) => void): string {
  let output = "";
  const stream = new Writable({
    write(chunk: unknown, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });

  // Create a logger writing to our capture stream, with the same
  // redaction config as the production logger.
  const logger = pino(
    {
      level: "info",
      redact: REDACT_OPTIONS,
    },
    stream,
  );

  logFn(logger);
  return output;
}

it("redacts sensitive fields from log output", () => {
  const output = captureLogs((logger) => {
    logger.info(
      {
        phone: SENSITIVE_VALUES.phone,
        user: {
          name: SENSITIVE_VALUES.name,
          email: SENSITIVE_VALUES.email,
        },
        transfer: {
          accountId: SENSITIVE_VALUES.accountId,
          amount: SENSITIVE_VALUES.amount,
        },
      },
      "transfer initiated",
    );
  });

  for (const [key, value] of Object.entries(SENSITIVE_VALUES)) {
    expect(output, `Sensitive value for '${key}' (${value}) must not appear in logs`).not.toContain(
      value,
    );
  }

  // The log line itself should still be there (not entirely redacted).
  expect(output).toContain("transfer initiated");
  // Redacted values should show the censor marker.
  expect(output).toContain("[Redacted]");
});

it("exports the redaction paths and options", () => {
  // Verify the logging module exports the deny-list so tests and
  // reviewers can audit what's redacted.
  expect(REDACTED_PATHS).toContain("*.phone");
  expect(REDACTED_PATHS).toContain("*.email");
  expect(REDACTED_PATHS).toContain("*.amount");
  expect(REDACTED_PATHS).toContain("*.accountId");
  expect(REDACT_OPTIONS.censor).toBe("[Redacted]");
});
