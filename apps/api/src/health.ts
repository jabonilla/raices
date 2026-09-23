import type pg from "pg";

// Timeout for the readiness DB probe. If Postgres doesn't respond within
// this window, /ready reports 503 rather than hanging the request.
const READY_TIMEOUT_MS = 2000;

export interface ReadyCheckResult {
  readonly ok: boolean;
}

/**
 * Check if Postgres is reachable. Uses a simple SELECT 1 with a timeout.
 * Never throws — returns { ok: false } on any failure, and never includes
 * connection strings or driver error details in the result.
 */
export async function checkDatabaseReady(
  pool: pg.Pool,
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<ReadyCheckResult> {
  const client = await pool.connect().catch(() => null);
  if (client === null) {
    return { ok: false };
  }

  try {
    const query = client.query("SELECT 1");
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, timeoutMs);
    });
    const result = await Promise.race([query, timeout]);
    return { ok: result !== null };
  } catch {
    // Never leak driver errors. The caller logs them; the response stays generic.
    return { ok: false };
  } finally {
    client.release();
  }
}
