// Redaction is the point of this module (K2.5). Phone numbers, names,
// emails, account identifiers, and amounts must never appear in logs.
//
// Two layers, defense in depth:
//
// 1. Pino's `redact` deny-lists fixed paths (REDACT_PATHS, bare top-level
//    plus one-level wildcards). Pino wildcards match at a FIXED depth, so
//    "*.phone" covers log({ user: { phone } }) but NOT log({ phone }) at
//    the top level (covered by the bare path) and NOT anything deeper,
//    e.g. log({ req: { body: { phone } } }).
// 2. censorSensitiveKeys, wired as pino's `formatters.log` hook in app.ts.
//    Pino serializers are keyed by top-level key name with no catch-all,
//    but formatters.log receives EVERY logged object and its return value
//    is what gets serialized, so it recursively censors deny-listed keys
//    at any depth, including inside arrays.
//
// Limitation: a sensitive value embedded inside a longer string (e.g.
// { note: "call +15551234567" }) cannot be caught by key-based redaction.

const REDACT_PATHS = [
  // Phone numbers (top-level and one level deep)
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

export const CENSOR = "[Redacted]";

// Paths redacted by the logger. Exported for the redaction test and for
// app.ts to configure Fastify's pino logger.
export const REDACTED_PATHS: readonly string[] = REDACT_PATHS;

// Pino redact options, shared between app.ts and tests.
export const REDACT_OPTIONS = {
  paths: [...REDACT_PATHS],
  censor: CENSOR,
};

// Key names censored at any depth by censorSensitiveKeys. Derived from
// REDACT_PATHS (stripping the "*." prefix) so the path list stays the
// single source of truth.
const SENSITIVE_KEY_NAMES: ReadonlySet<string> = new Set(
  REDACT_PATHS.map((path) => (path.startsWith("*.") ? path.slice(2) : path)),
);

// The deny-list of key names, exported so tests and reviewers can audit it.
export const SENSITIVE_LOG_KEYS: readonly string[] = [...SENSITIVE_KEY_NAMES];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Recursively copies `value`, replacing the value of any key in the
// deny-list with "[Redacted]" at any depth. Never mutates the input:
// mutating would corrupt the caller's objects (e.g. Fastify's request
// object). Arrays are walked element-wise. Non-plain objects (Date,
// Buffer, class instances) are returned as-is so their behavior is never
// altered. Cyclic structures are preserved via the memo map instead of
// recursing forever.
export function censorSensitiveKeys<T>(value: T, memo: Map<object, unknown> = new Map()): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const cached = memo.get(value);
  if (cached !== undefined) {
    return cached as T;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    memo.set(value, copy);
    for (const item of value) {
      copy.push(censorSensitiveKeys(item, memo));
    }
    return copy as unknown as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const copy: Record<string, unknown> = {};
  memo.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = SENSITIVE_KEY_NAMES.has(key) ? CENSOR : censorSensitiveKeys(entry, memo);
  }
  return copy as unknown as T;
}
