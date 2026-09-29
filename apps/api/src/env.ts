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
  return { port, databaseUrl };
}
