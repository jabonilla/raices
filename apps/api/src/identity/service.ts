import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import { defineStateMachine, transition } from "../audit/index.js";
import type { Database } from "../db/schema.js";
import { withSerializableTx } from "../db/serializable.js";
import { RateLimitedError, ServiceUnavailableError, UnauthorizedError } from "../errors.js";
import { findOrCreateUserByPhone } from "../relationships/users.js";

export const PhoneSchema = z.string().regex(/^\+[1-9][0-9]{1,14}$/);
export const RequestCodeSchema = z.object({ phone: PhoneSchema }).strict();
export const VerifyCodeSchema = z
  .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
const IpSchema = z.string().min(1).max(200);
export interface IdentityPolicy {
  codeTtlMs: number;
  sessionTtlMs: number;
  windowMs: number;
  requestPerPhone: number;
  requestPerIp: number;
  verifyPerPhone: number;
  verifyPerIp: number;
  maxFailures: number;
  lockoutMs: number;
}
const defaults: IdentityPolicy = {
  codeTtlMs: 5 * 60_000,
  sessionTtlMs: 24 * 60 * 60_000,
  windowMs: 60_000,
  requestPerPhone: 3,
  requestPerIp: 20,
  verifyPerPhone: 10,
  verifyPerIp: 60,
  maxFailures: 5,
  lockoutMs: 15 * 60_000,
};
export interface IdentityOptions {
  /** At least 32 bytes, provisioned server-side. Never part of mobile config. */
  pepper: string;
  policy?: Partial<IdentityPolicy>;
  /** Server-side provider adapter only. Neither code nor provider errors leave this seam. */
  deliver: (input: { phone: string; code: string; challengeId: string }) => Promise<void>;
}
type ChallengeState = "new" | "active" | "used" | "locked" | "expired" | "delivery_failed";
const challengeMachine = defineStateMachine<ChallengeState>({
  entityType: "identity_challenge",
  transitions: {
    new: ["active"],
    active: ["active", "used", "locked", "expired", "delivery_failed"],
    used: [],
    locked: [],
    expired: [],
    delivery_failed: [],
  },
});
const eventMachine = defineStateMachine<"new" | "recorded">({
  entityType: "identity_security_event",
  transitions: { new: ["recorded"], recorded: [] },
});
const sessionMachine = defineStateMachine<"active" | "revoked">({
  entityType: "identity_session",
  transitions: { active: ["revoked"], revoked: [] },
});
interface Challenge {
  id: string;
  phone: string;
  digest: string;
  state: Exclude<ChallengeState, "new">;
  failures: number;
  max_failures: number;
  valid: boolean;
}
class StaleChallenge extends Error {}
export interface IdentityUser {
  readonly id: string;
  readonly sessionId: string;
}
export interface IssuedSession {
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: string;
}

export class IdentityService {
  private readonly policy: IdentityPolicy;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: IdentityOptions,
  ) {
    if (Buffer.byteLength(options.pepper) < 32)
      throw new Error("Identity pepper must be at least 32 bytes");
    this.policy = { ...defaults, ...options.policy };
    for (const value of Object.values(this.policy))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid identity policy");
    if (this.policy.maxFailures > 20) throw new Error("Invalid identity failure policy");
  }
  private digest(value: string): string {
    return createHmac("sha256", this.options.pepper).update(value).digest("hex");
  }
  tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  private async event(action: string): Promise<void> {
    const id = randomUUID();
    await transition(
      this.db,
      eventMachine,
      {
        entityId: id,
        from: "new",
        to: "recorded",
        action,
        actor: { kind: "system" },
        channel: "app",
      },
      async (trx) => {
        await sql`insert into identity_security_event(id,state) values (${id},'recorded')`.execute(
          trx,
        );
      },
    );
  }
  private async limit(kind: "request" | "verify", phone: string, ip: string): Promise<void> {
    IpSchema.parse(ip);
    const phoneMax = kind === "request" ? this.policy.requestPerPhone : this.policy.verifyPerPhone;
    const ipMax = kind === "request" ? this.policy.requestPerIp : this.policy.verifyPerIp;
    const allowed = await withSerializableTx(this.db, async (trx) => {
      let ok = true;
      for (const [key, max] of [
        [`phone:${kind}:${phone}`, phoneMax],
        [`ip:${kind}:${ip}`, ipMax],
      ] as const) {
        const hash = this.digest(key);
        const result = await sql<{
          hits: number;
        }>`insert into identity_rate_bucket(key_hash,window_start,hits)
          values (${hash},clock_timestamp(),1) on conflict(key_hash) do update set
          hits=case when identity_rate_bucket.window_start <= clock_timestamp()-(${this.policy.windowMs} * interval '1 millisecond') then 1 else identity_rate_bucket.hits+1 end,
          window_start=case when identity_rate_bucket.window_start <= clock_timestamp()-(${this.policy.windowMs} * interval '1 millisecond') then clock_timestamp() else identity_rate_bucket.window_start end returning hits`.execute(
          trx,
        );
        if ((result.rows[0]?.hits ?? max + 1) > max) ok = false;
      }
      return ok;
    });
    if (!allowed) {
      await this.event("identity.rate_limited");
      throw new RateLimitedError();
    }
  }
  async requestCode(input: { phone: string; ip: string }): Promise<{ challengeId: string }> {
    const { phone } = RequestCodeSchema.parse({ phone: input.phone });
    await this.limit("request", phone, input.ip);
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const digest = this.digest(`otp:${challengeId}:${code}`);
    await transition(
      this.db,
      challengeMachine,
      {
        entityId: challengeId,
        from: "new",
        to: "active",
        action: "identity.requested",
        actor: { kind: "system" },
        channel: "app",
      },
      async (trx) => {
        await sql`insert into identity_challenge(id,phone,digest,state,max_failures,expires_at)
        values (${challengeId},${phone},${digest},'active',${this.policy.maxFailures},clock_timestamp()+(${this.policy.codeTtlMs} * interval '1 millisecond'))`.execute(
          trx,
        );
      },
    );
    try {
      await this.options.deliver({ phone, code, challengeId });
    } catch {
      // No provider error is propagated, logged or returned (it may contain the code).
      await transition(
        this.db,
        challengeMachine,
        {
          entityId: challengeId,
          from: "active",
          to: "delivery_failed",
          action: "identity.delivery_failed",
          actor: { kind: "system" },
          channel: "app",
        },
        async (trx) => {
          await sql`update identity_challenge set state='delivery_failed' where id=${challengeId} and state='active'`.execute(
            trx,
          );
        },
      );
      // Same public response; adapter failures are observable through audit IDs only.
    }
    return { challengeId };
  }
  async verifyCode(input: {
    challengeId: string;
    code: string;
    ip: string;
  }): Promise<IssuedSession> {
    const parsed = VerifyCodeSchema.parse({ challengeId: input.challengeId, code: input.code });
    const read = async (): Promise<Challenge | undefined> =>
      (
        await sql<Challenge>`select id,phone,digest,state,failures,max_failures,expires_at>clock_timestamp() as valid from identity_challenge where id=${parsed.challengeId}`.execute(
          this.db,
        )
      ).rows[0];
    let candidate = await read();
    await this.limit("verify", candidate?.phone ?? parsed.challengeId, input.ip);
    const supplied = this.digest(`otp:${parsed.challengeId}:${parsed.code}`);
    // Both sides are fixed-size HMACs, including the missing-challenge case.
    const matches = timingSafeEqual(
      Buffer.from(candidate?.digest ?? this.digest("missing"), "hex"),
      Buffer.from(supplied, "hex"),
    );
    if (candidate === undefined || candidate.state !== "active") {
      await this.event("identity.verification_denied");
      throw new UnauthorizedError();
    }
    // Provision through the existing domain helper only after matching a live code.
    // Provisioning is idempotent; it grants no session if the later CAS loses.
    const user =
      matches && candidate.valid
        ? await findOrCreateUserByPhone(this.db, { phone: candidate.phone, role: "sender" })
        : undefined;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.tokenHash(token);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (candidate === undefined || candidate.state !== "active") {
        await this.event("identity.verification_denied");
        throw new UnauthorizedError();
      }
      const current = candidate;
      // Phone-wide failures cannot be reset by asking for another challenge.
      const guard = await sql<{
        failures: number;
        locked: boolean;
      }>`select failures,coalesce(locked_until>clock_timestamp(),false) as locked from identity_phone_guard where phone_hash=${this.digest(`guard:${current.phone}`)}`.execute(
        this.db,
      );
      const locked = guard.rows[0]?.locked ?? false;
      const totalFailures = guard.rows[0]?.failures ?? 0;
      const success = matches && current.valid && !locked && user !== undefined;
      const to: ChallengeState = !current.valid
        ? "expired"
        : locked || (!success && totalFailures + 1 >= this.policy.maxFailures)
          ? "locked"
          : success
            ? "used"
            : "active";
      const action =
        to === "used"
          ? "identity.verified"
          : to === "locked"
            ? "identity.locked"
            : to === "expired"
              ? "identity.expired"
              : "identity.verification_failed";
      try {
        const result = await transition(
          this.db,
          challengeMachine,
          {
            entityId: current.id,
            from: "active",
            to,
            action,
            actor: user === undefined ? { kind: "system" } : { kind: "user", id: user.id },
            channel: "app",
          },
          async (trx) => {
            const phoneHash = this.digest(`guard:${current.phone}`);
            // Lock the phone guard before the challenge CAS. Refresh both within
            // this SERIALIZABLE transaction to prevent cross-challenge lockout races.
            await sql`insert into identity_phone_guard(phone_hash) values (${phoneHash}) on conflict do nothing`.execute(
              trx,
            );
            const actual = await sql<{
              failures: number;
              locked: boolean;
            }>`select failures,coalesce(locked_until>clock_timestamp(),false) as locked from identity_phone_guard where phone_hash=${phoneHash} for update`.execute(
              trx,
            );
            if (
              (actual.rows[0]?.locked ?? false) !== locked ||
              (actual.rows[0]?.failures ?? 0) !== totalFailures
            )
              throw new StaleChallenge();
            const updated = await sql<{
              id: string;
            }>`update identity_challenge set state=${to},failures=failures+${success ? 0 : 1}
            where id=${current.id} and state='active' and failures=${current.failures}
              and (expires_at>clock_timestamp())=${current.valid} returning id`.execute(trx);
            if (updated.rows.length !== 1) throw new StaleChallenge();
            if (!success) {
              await sql`update identity_phone_guard set failures=failures+1,
              locked_until=case when ${to === "locked"} then clock_timestamp()+(${this.policy.lockoutMs} * interval '1 millisecond') else locked_until end where phone_hash=${phoneHash}`.execute(
                trx,
              );
              return undefined;
            }
            await sql`update identity_phone_guard set failures=0,locked_until=null where phone_hash=${phoneHash}`.execute(
              trx,
            );
            const principal = await sql<{
              generation: string;
            }>`insert into identity_principal(user_id,generation) values (${user.id},1)
            on conflict(user_id) do update set generation=identity_principal.generation+1 returning generation`.execute(
              trx,
            );
            const generation = principal.rows[0]?.generation;
            if (generation === undefined) throw new Error("Missing identity generation");
            const sessionId = randomUUID();
            const session = await sql<{
              expires_at: Date;
            }>`insert into identity_session(id,user_id,challenge_id,generation,token_hash,state,expires_at)
            values (${sessionId},${user.id},${current.id},${generation}::bigint,${tokenHash},'active',clock_timestamp()+(${this.policy.sessionTtlMs} * interval '1 millisecond')) returning expires_at`.execute(
              trx,
            );
            const expiresAt = session.rows[0]?.expires_at;
            if (expiresAt === undefined) throw new Error("Missing session expiry");
            return { token, userId: user.id, expiresAt: expiresAt.toISOString() };
          },
        );
        if (result === undefined) throw new UnauthorizedError();
        return result;
      } catch (error) {
        if (!(error instanceof StaleChallenge)) throw error;
        candidate = await read();
      }
    }
    throw new ServiceUnavailableError();
  }
  async authenticate(token: string): Promise<IdentityUser> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedError();
    const row = (
      await sql<{ id: string; user_id: string }>`select s.id,s.user_id from identity_session s
      join identity_principal p on p.user_id=s.user_id and p.generation=s.generation
      join app_user u on u.id=s.user_id where s.token_hash=${this.tokenHash(token)} and s.state='active'
      and s.expires_at>clock_timestamp() and 'sender'=any(u.roles)`.execute(this.db)
    ).rows[0];
    if (row === undefined) throw new UnauthorizedError();
    return { id: row.user_id, sessionId: row.id };
  }
  async revoke(token: string): Promise<void> {
    const user = await this.authenticate(token);
    await transition(
      this.db,
      sessionMachine,
      {
        entityId: user.sessionId,
        from: "active",
        to: "revoked",
        action: "identity.session_revoked",
        actor: { kind: "user", id: user.id },
        channel: "app",
      },
      async (trx) => {
        const updated = await sql<{
          id: string;
        }>`update identity_session set state='revoked' where id=${user.sessionId} and state='active' returning id`.execute(
          trx,
        );
        if (updated.rows.length !== 1) throw new UnauthorizedError();
      },
    );
  }
}
