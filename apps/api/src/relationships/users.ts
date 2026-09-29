import { sql, type Kysely, type Transaction } from "kysely";

import { withSerializableTx } from "../db/serializable.js";
import type { RelationshipDatabase, UserRole } from "./schema.js";

/** E.164, matching `user_is_e164` in 0004. */
const E164 = /^\+[1-9][0-9]{1,14}$/;

export class InvalidPhoneNumberError extends Error {
  constructor(phone: string) {
    super(
      `Phone number ${JSON.stringify(phone)} is not E.164. ` +
        `Expected a leading +, a non-zero country digit, and up to 14 more digits, with no separators.`,
    );
    this.name = "InvalidPhoneNumberError";
  }
}

export interface FoundOrCreatedUser {
  readonly id: string;
  readonly phone: string;
  readonly roles: readonly UserRole[];
  /** True only for the caller that actually inserted the row. */
  readonly created: boolean;
}

export interface FindOrCreateUserInput {
  readonly phone: string;
  readonly role: UserRole;
}

/**
 * Resolve a phone number to a user, creating one only if the number is new.
 *
 * A number already in the system links to the existing user and gains the
 * role it is being used for, rather than becoming a second account: the
 * person who receives money from one family member and sends it to another is
 * one user with both roles (PRD feature 1, edge cases).
 *
 * Insert-first rather than check-then-insert, for the same reason as
 * `post()`: under SERIALIZABLE a read of the phone index takes a predicate
 * lock, so concurrent first sightings of different numbers would conflict on
 * a small index. `on conflict do nothing` lets the loser fall through to the
 * read of a row that is now certainly there.
 */
export async function findOrCreateUserByPhone<DB extends RelationshipDatabase>(
  db: Kysely<DB>,
  input: FindOrCreateUserInput,
): Promise<FoundOrCreatedUser> {
  if (!E164.test(input.phone)) throw new InvalidPhoneNumberError(input.phone);

  return withSerializableTx(db, async (raw) => {
    // Kysely cannot narrow these queries through the generic DB parameter, so
    // they are typed against the slice they need. DB extends
    // RelationshipDatabase, so the tables and columns are the same.
    const trx = raw as unknown as Transaction<RelationshipDatabase>;

    const inserted = await trx
      .insertInto("app_user")
      .values({ phone: input.phone, roles: [input.role] })
      .onConflict((oc) => oc.column("phone").doNothing())
      .returning(["id", "phone", "roles"])
      .executeTakeFirst();

    if (inserted !== undefined) {
      return { ...inserted, roles: inserted.roles, created: true };
    }

    // Someone else owns the row. Add the role if it is missing; array_append
    // in one statement rather than read-modify-write, so two callers adding
    // different roles cannot lose one another's.
    const updated = await trx
      .updateTable("app_user")
      .set({
        roles: sql<UserRole[]>`
          case when ${input.role} = any(roles) then roles
               else array_append(roles, ${input.role}::text) end
        `,
      })
      .where("phone", "=", input.phone)
      .returning(["id", "phone", "roles"])
      .executeTakeFirstOrThrow();

    return { ...updated, created: false };
  });
}
