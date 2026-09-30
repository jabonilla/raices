import { createHash, createHmac } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.js";
import { withSerializableTx } from "../db/serializable.js";
import { ApiError, ConflictError, ServiceUnavailableError, type ApiErrorCode } from "../errors.js";

export interface ReceiptInput {
  actorId: string;
  key: string;
  requestHash: string;
}
export interface DurableReceiptStore {
  run<T>(input: ReceiptInput, operation: () => Promise<T>): Promise<T>;
}
interface Outcome {
  ok: boolean;
  value?: unknown;
  error?: { code: ApiErrorCode; statusCode: number; message: string };
}
interface Receipt {
  request_hash: string;
  state: "started" | "completed";
  outcome: Outcome | null;
}
export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Durable at-most-once admission around existing domain transactions.
 * An ambiguous crash stays started; replay returns 503 and never retries the
 * mutation. Owner reconciliation is required. No false exactly-once claim.
 */
export class PostgresReceiptStore implements DurableReceiptStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly pepper: string,
  ) {
    if (Buffer.byteLength(pepper) < 32)
      throw new Error("Receipt pepper must have at least 32 bytes");
  }
  async run<T>(input: ReceiptInput, operation: () => Promise<T>): Promise<T> {
    const scope = createHmac("sha256", this.pepper)
      .update(JSON.stringify([input.actorId, input.key]))
      .digest("hex");
    const admitted = await withSerializableTx(this.db, async (trx) => {
      const insert = await sql<{
        scope_hash: string;
      }>`insert into http_request_receipt(scope_hash,request_hash,state)
        values (${scope},${input.requestHash},'started') on conflict do nothing returning scope_hash`.execute(
        trx,
      );
      if (insert.rows.length === 1) return { created: true, row: undefined };
      const existing =
        await sql<Receipt>`select request_hash,state,outcome from http_request_receipt where scope_hash=${scope}`.execute(
          trx,
        );
      return { created: false, row: existing.rows[0] };
    });
    if (!admitted.created) {
      const row = admitted.row;
      if (row === undefined) throw new ServiceUnavailableError();
      if (row.request_hash !== input.requestHash)
        throw new ConflictError("Idempotency key was used for another request.");
      if (row.state !== "completed" || row.outcome === null) throw new ServiceUnavailableError();
      if (!row.outcome.ok && row.outcome.error !== undefined) {
        const error = row.outcome.error;
        throw new ApiError(error.code, error.message, error.statusCode);
      }
      return row.outcome.value as T;
    }
    let outcome: Outcome;
    let value: T;
    try {
      value = await operation();
      outcome = { ok: true, value };
    } catch (error) {
      // Only known boundary/domain errors guarantee a definitive result.
      // Unexpected failures may be commit-ambiguous and remain started.
      if (!(error instanceof ApiError) || error.statusCode >= 500)
        throw new ServiceUnavailableError();
      outcome = {
        ok: false,
        error: { code: error.code, message: error.message, statusCode: error.statusCode },
      };
      await sql`update http_request_receipt set state='completed',outcome=${JSON.stringify(outcome)}::jsonb where scope_hash=${scope} and state='started'`.execute(
        this.db,
      );
      throw error;
    }
    await sql`update http_request_receipt set state='completed',outcome=${JSON.stringify(outcome)}::jsonb where scope_hash=${scope} and state='started'`.execute(
      this.db,
    );
    return value;
  }
}
