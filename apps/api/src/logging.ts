// Redaction is the point of this module (K2.5). Phone numbers, names,
// emails, account identifiers, and amounts must never appear in logs.
// Pino's `redact` uses a deny-list of paths; any object logged with these
// keys (at any nesting level via the wildcard, plus top-level) gets [Redacted].
// This list is used by apps/api/src/app.ts when configuring Fastify's logger.

const REDACT_PATHS = [
  // Phone numbers (top-level and nested)
  "phone",
  "*.phone",
  "phoneNumber",
  "*.phoneNumber",
  "msisdn",
  "*.msisdn",
  // Names
  "name",
  "*.name",
  "firstName",
  "*.firstName",
  "lastName",
  "*.lastName",
  "fullName",
  "*.fullName",
  "recipientName",
  "*.recipientName",
  "senderName",
  "*.senderName",
  // Emails
  "email",
  "*.email",
  "emailAddress",
  "*.emailAddress",
  // Account identifiers
  "accountId",
  "*.accountId",
  "accountNumber",
  "*.accountNumber",
  "iban",
  "*.iban",
  "clabe",
  "*.clabe",
  "userId",
  "*.userId",
  // Amounts (money is bigint minor units; never log the raw value)
  "amount",
  "*.amount",
  "amountMinor",
  "*.amountMinor",
  "balance",
  "*.balance",
];

// Paths redacted by the logger. Exported for the redaction test and for
// app.ts to configure Fastify's pino logger.
export const REDACTED_PATHS: readonly string[] = REDACT_PATHS;

// Pino redact options, shared between app.ts and tests.
export const REDACT_OPTIONS = {
  paths: [...REDACT_PATHS],
  censor: "[Redacted]",
};
