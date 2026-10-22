/**
 * Required environment, validated at boot (K2.29).
 *
 * Fails fast with a clear message instead of starting half-configured.
 * DATABASE_URL is required: the API cannot serve its purpose without
 * Postgres, and /ready would report 503 forever.
 */
export interface ApiEnv {
  readonly port: number;
  readonly databaseUrl: string;
  /**
   * The three server-side secrets the authenticated routes need, or
   * undefined when none of them are set.
   *
   * Optional because the API is deployed and useful without them (health,
   * readiness, the contract, the webhook) and because turning identity on
   * is a deliberate act. All three or none: a process holding two of them
   * is the half-configured start this module exists to refuse.
   */
  readonly secrets: ApiSecrets | undefined;
}

export interface ApiSecrets {
  readonly identityPepper: string;
  readonly receiptPepper: string;
  readonly invitePepper: string;
}

const SECRET_VARS = {
  identityPepper: "IDENTITY_PEPPER",
  receiptPepper: "RECEIPT_PEPPER",
  invitePepper: "INVITE_LIMIT_PEPPER",
} as const;

/** Shortest pepper the services below will accept, in bytes. */
const MIN_PEPPER_BYTES = 32;

function readSecrets(env: Record<string, string | undefined>): ApiSecrets | undefined {
  const present = Object.entries(SECRET_VARS).filter(
    ([, variable]) => (env[variable] ?? "") !== "",
  );
  if (present.length === 0) return undefined;
  const missing = Object.values(SECRET_VARS).filter((variable) => (env[variable] ?? "") === "");
  if (missing.length > 0) {
    throw new Error(
      `Set all of ${Object.values(SECRET_VARS).join(", ")} or none of them; ` +
        `missing ${missing.join(", ")}. Starting with some of them configures ` +
        `authentication that cannot work.`,
    );
  }
  const secrets = Object.fromEntries(
    Object.entries(SECRET_VARS).map(([field, variable]) => [field, env[variable] as string]),
  ) as unknown as ApiSecrets;
  for (const [field, variable] of Object.entries(SECRET_VARS)) {
    const value = secrets[field as keyof ApiSecrets];
    if (Buffer.byteLength(value) < MIN_PEPPER_BYTES) {
      // The length, never the value: this message goes to the log.
      throw new Error(
        `${variable} must be at least ${String(MIN_PEPPER_BYTES)} bytes; ` +
          `got ${String(Buffer.byteLength(value))}.`,
      );
    }
  }
  return secrets;
}

export function readEnv(env: Record<string, string | undefined> = process.env): ApiEnv {
  const portRaw = env["PORT"] ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${JSON.stringify(portRaw)}.`);
  }
  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is not set. Copy .env.example and fill it in.");
  }
  return { port, databaseUrl, secrets: readSecrets(env) };
}
