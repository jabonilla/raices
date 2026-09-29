/**
 * One-command local demo (K2.30).
 *
 * Starts Postgres (docker compose), applies migrations, seeds fixture data,
 * and boots the API with the fake channel and mock settlement provider.
 *
 * Usage: pnpm demo
 *
 * The API runs with:
 * - FakeChannelAdapter / FakeSignatureVerifier (K2.28 defaults): webhooks
 *   are accepted at POST /webhooks/channel with the documented test signature.
 * - MockSettlementProvider is available to reconciliation; the API itself
 *   doesn't settle — see docs/demo.md for the product walkthrough.
 *
 * Prerequisites: Docker must be running (for the Postgres container).
 * The database name ends in _dev, so the db-guard allows migrate/seed.
 */
import { execFileSync, spawn } from "node:child_process";

const COMPOSE_DB_URL = "postgresql://raices:raices@localhost:5432/raices_dev";

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

function main(): void {
  // 1. Docker must be available for the Postgres container.
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.error("Docker is not running. Start Docker, then run `pnpm demo` again.");
    process.exit(1);
  }

  // 2. Start Postgres (idempotent — no-op if already running).
  console.log("→ starting Postgres (docker compose)…");
  run("docker", ["compose", "up", "-d", "db"]);

  // 3. Wait for Postgres to accept connections.
  console.log("→ waiting for Postgres…");
  for (let i = 0; i < 30; i += 1) {
    try {
      execFileSync(
        "docker",
        ["compose", "exec", "-T", "db", "pg_isready", "-U", "raices", "-d", "raices_dev"],
        {
          stdio: "ignore",
        },
      );
      break;
    } catch {
      if (i === 29) {
        console.error("Postgres did not become ready in time.");
        process.exit(1);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  // 4. Migrate and seed.
  console.log("→ applying migrations…");
  run("pnpm", ["db:migrate"], { DATABASE_URL: COMPOSE_DB_URL });
  console.log("→ seeding fixture data…");
  run("pnpm", ["db:seed"], { DATABASE_URL: COMPOSE_DB_URL });

  // 5. Boot the API. Fakes are the defaults in buildApp(); DATABASE_URL and
  //    PORT are validated at boot (K2.29).
  console.log("→ starting the API on http://localhost:3000 …");
  console.log("  walkthrough: docs/demo.md");
  const api = spawn("pnpm", ["--filter", "@raices/api", "dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: COMPOSE_DB_URL,
      PORT: "3000",
    },
  });
  api.on("exit", (code) => process.exit(code ?? 1));
}

main();
