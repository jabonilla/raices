import { createHmac } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.js";
import { withSerializableTx } from "../db/serializable.js";
import { RateLimitedError } from "../errors.js";

export class InviteLimiter {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly pepper: string,
    private readonly maxPerUser = 10,
    private readonly maxPerIp = 30,
    private readonly windowMs = 60_000,
  ) {
    if (
      Buffer.byteLength(pepper) < 32 ||
      ![maxPerUser, maxPerIp, windowMs].every((n) => Number.isSafeInteger(n) && n > 0)
    )
      throw new Error("Invalid invite rate policy");
  }
  async check(userId: string, ip: string): Promise<void> {
    const permitted = await withSerializableTx(this.db, async (trx) => {
      let allowed = true;
      for (const [key, max] of [
        [`invite:user:${userId}`, this.maxPerUser],
        [`invite:ip:${ip}`, this.maxPerIp],
      ] as const) {
        const hash = createHmac("sha256", this.pepper).update(key).digest("hex");
        const result = await sql<{
          hits: number;
        }>`insert into identity_rate_bucket(key_hash,window_start,hits) values (${hash},clock_timestamp(),1)
          on conflict(key_hash) do update set hits=case when identity_rate_bucket.window_start<=clock_timestamp()-(${this.windowMs}*interval '1 millisecond') then 1 else identity_rate_bucket.hits+1 end,
          window_start=case when identity_rate_bucket.window_start<=clock_timestamp()-(${this.windowMs}*interval '1 millisecond') then clock_timestamp() else identity_rate_bucket.window_start end returning hits`.execute(
          trx,
        );
        if ((result.rows[0]?.hits ?? max + 1) > max) allowed = false;
      }
      return allowed;
    });
    if (!permitted) throw new RateLimitedError();
  }
}
