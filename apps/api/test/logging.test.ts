import { expect, it } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";

import {
  CENSOR,
  REDACTED_PATHS,
  REDACT_OPTIONS,
  SENSITIVE_LOG_KEYS,
  censorSensitiveKeys,
} from "../src/logging.js";

// Redaction is the point of K2.5. These tests log objects full of sensitive
// fields and assert none of the values appear anywhere in the output.
// Pino's redact wildcards only match at a fixed depth, so the recursive
// censor (wired as formatters.log, same as production) is what covers
// arbitrary nesting. If the deny-list stops covering a field, these fail.

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
      formatters: { log: censorSensitiveKeys },
    },
    stream,
  );

  logFn(logger);
  return output;
}

function expectNoSensitiveValues(output: string): void {
  for (const [key, value] of Object.entries(SENSITIVE_VALUES)) {
    expect(output, `Sensitive value for '${key}' (${value}) must not appear in logs`).not.toContain(
      value,
    );
  }
}

it("redacts sensitive fields at the top level", () => {
  const output = captureLogs((logger) => {
    logger.info(
      {
        phone: SENSITIVE_VALUES.phone,
        email: SENSITIVE_VALUES.email,
        requestId: "req-123",
      },
      "top-level",
    );
  });

  expectNoSensitiveValues(output);
  expect(output).toContain("top-level");
  expect(output).toContain("req-123");
  expect(output).toContain(CENSOR);
});

it("redacts sensitive fields one level deep", () => {
  const output = captureLogs((logger) => {
    logger.info(
      {
        user: {
          name: SENSITIVE_VALUES.name,
          email: SENSITIVE_VALUES.email,
        },
      },
      "one level",
    );
  });

  expectNoSensitiveValues(output);
  expect(output).toContain(CENSOR);
});

it("redacts sensitive fields three levels deep", () => {
  // Pino's "*.phone" wildcard does NOT cover this depth; the recursive
  // censor is the only layer that does.
  const output = captureLogs((logger) => {
    logger.info(
      {
        req: {
          body: {
            contact: { phoneNumber: SENSITIVE_VALUES.phoneNumber },
          },
        },
      },
      "three levels",
    );
  });

  expectNoSensitiveValues(output);
  expect(output).toContain(CENSOR);
});

it("redacts sensitive fields inside an array of objects", () => {
  const output = captureLogs((logger) => {
    logger.info(
      {
        recipients: [
          { accountId: SENSITIVE_VALUES.accountId, amount: SENSITIVE_VALUES.amount },
          {
            accountNumber: SENSITIVE_VALUES.accountNumber,
            firstName: SENSITIVE_VALUES.firstName,
            lastName: SENSITIVE_VALUES.lastName,
          },
        ],
      },
      "array",
    );
  });

  expectNoSensitiveValues(output);
  expect(output).toContain(CENSOR);
});

it("censorSensitiveKeys does not mutate its input", () => {
  const input = { user: { phone: SENSITIVE_VALUES.phone } };
  const snapshot = JSON.stringify(input);
  censorSensitiveKeys(input);
  expect(JSON.stringify(input)).toBe(snapshot);
});

it("censorSensitiveKeys preserves cycles instead of recursing forever", () => {
  const input: Record<string, unknown> = { phone: SENSITIVE_VALUES.phone };
  input.self = input;
  const censored = censorSensitiveKeys(input);
  expect(censored.phone).toBe(CENSOR);
  expect(censored.self).toBe(censored);
});

it("censorSensitiveKeys leaves non-plain objects intact", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  const censored = censorSensitiveKeys({ at: date, user: { phone: SENSITIVE_VALUES.phone } });
  expect(censored.at).toBe(date);
  expect(censored.user.phone).toBe(CENSOR);
});

it("exports the redaction paths, options, and key deny-list", () => {
  // Verify the logging module exports the deny-lists so tests and
  // reviewers can audit what's redacted.
  expect(REDACTED_PATHS).toContain("*.phone");
  expect(REDACTED_PATHS).toContain("*.email");
  expect(REDACTED_PATHS).toContain("*.amount");
  expect(REDACTED_PATHS).toContain("*.accountId");
  expect(REDACT_OPTIONS.censor).toBe(CENSOR);
  for (const key of Object.keys(SENSITIVE_VALUES)) {
    expect(SENSITIVE_LOG_KEYS).toContain(key);
  }
});
