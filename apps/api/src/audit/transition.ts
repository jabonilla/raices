import type { Kysely, Transaction } from "kysely";

import { withSerializableTx, type WithSerializableTxOptions } from "../db/serializable.js";
import type { ActorKind, AuditDatabase, Channel } from "./schema.js";

/** The shape every identifier written to the audit log must have. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Who caused a transition. A system actor has no id behind it. */
export type Actor =
  | { readonly kind: Extract<ActorKind, "user" | "agent">; readonly id: string }
  | { readonly kind: Extract<ActorKind, "system">; readonly id?: undefined };

/**
 * A declared state machine: which states exist, and which moves between them
 * are legal. Anything not listed is undeclared and refused.
 */
export interface StateMachine<S extends string> {
  readonly entityType: string;
  readonly transitions: Readonly<Record<S, readonly S[]>>;
}

/** Thrown when a transition is not declared in the machine's table. */
export class UndeclaredTransitionError extends Error {
  readonly entityType: string;
  readonly from: string;
  readonly to: string;

  constructor(entityType: string, from: string, to: string, declared: readonly string[]) {
    const options = declared.length === 0 ? "none: it is a terminal state" : declared.join(", ");
    super(
      `Undeclared transition on ${entityType}: "${from}" -> "${to}". ` +
        `Declared from "${from}": ${options}.`,
    );
    this.name = "UndeclaredTransitionError";
    this.entityType = entityType;
    this.from = from;
    this.to = to;
  }
}

/**
 * Check a machine over at construction, so a malformed one fails at startup
 * rather than at the first transition that happens to use the bad edge.
 */
export function defineStateMachine<S extends string>(machine: StateMachine<S>): StateMachine<S> {
  if (!IDENTIFIER.test(machine.entityType)) {
    throw new Error(
      `State machine entity type "${machine.entityType}" is not a lower_snake_case identifier.`,
    );
  }

  const states = Object.keys(machine.transitions) as S[];

  for (const state of states) {
    if (!IDENTIFIER.test(state)) {
      throw new Error(`State "${state}" is not a lower_snake_case identifier.`);
    }
    for (const target of machine.transitions[state]) {
      if (!states.includes(target)) {
        throw new Error(
          `State machine "${machine.entityType}" declares "${state}" -> "${target}", ` +
            `but "${target}" is not a state of the machine.`,
        );
      }
    }
  }

  return Object.freeze({
    entityType: machine.entityType,
    transitions: Object.freeze(machine.transitions),
  });
}

/**
 * The states declared as reachable from `from`.
 *
 * `from` typically arrives from a database row, so despite its type it is not
 * guaranteed to be a key of the table. An unknown state declares no moves,
 * which makes every transition out of it undeclared rather than a crash.
 */
function declaredFrom<S extends string>(machine: StateMachine<S>, from: S): readonly S[] {
  return (machine.transitions as Partial<Record<S, readonly S[]>>)[from] ?? [];
}

/**
 * Whether the machine declares this move. Pure, so the decision is testable
 * without a database.
 */
export function isDeclared<S extends string>(machine: StateMachine<S>, from: S, to: S): boolean {
  return declaredFrom(machine, from).includes(to);
}

export interface TransitionInput<S extends string> {
  readonly entityId: string;
  readonly from: S;
  readonly to: S;
  /** A dotted identifier, e.g. `relationship.activate`. Never free text. */
  readonly action: string;
  readonly actor: Actor;
  readonly channel?: Channel;
  readonly assuranceLevel?: string;
}

/**
 * Move an entity from one state to another, writing the state change and its
 * audit row in the same transaction.
 *
 * An undeclared transition throws before the transaction opens, so nothing is
 * written. A declared one applies `applyStateChange` first and inserts the
 * audit row second, both inside one SERIALIZABLE transaction: if the audit
 * insert fails, the state change rolls back with it. Neither can commit alone.
 *
 * That makes the two atomic for callers of `transition()`. The database closes
 * the remaining gap: `audit_enforce_transitions()` in 0003_audit.sql refuses a
 * state change that reaches the table any other way.
 *
 * `applyStateChange` may run up to MAX_ATTEMPTS times, because the transaction
 * is retried on a serialization failure. It must therefore be replayable and
 * must not perform side effects outside the transaction it is handed.
 */
export async function transition<DB extends AuditDatabase, S extends string, T>(
  db: Kysely<DB>,
  machine: StateMachine<S>,
  input: TransitionInput<S>,
  applyStateChange: (trx: Transaction<DB>) => Promise<T>,
  options: WithSerializableTxOptions = {},
): Promise<T> {
  if (!isDeclared(machine, input.from, input.to)) {
    throw new UndeclaredTransitionError(
      machine.entityType,
      input.from,
      input.to,
      declaredFrom(machine, input.from),
    );
  }

  if (!ACTION.test(input.action)) {
    throw new Error(
      `Audit action "${input.action}" is not a dotted identifier such as ` +
        `"${machine.entityType}.${input.to}". Audit rows carry no free text.`,
    );
  }

  return withSerializableTx(
    db,
    async (trx) => {
      // The state change goes first so that a failing audit insert has
      // something to roll back. Were the order reversed, the rollback test
      // would pass without proving anything.
      const result = await applyStateChange(trx);

      // Kysely cannot narrow `insertInto("audit_log")` through the generic DB
      // parameter, so the insert is typed against the slice it actually needs.
      // DB extends AuditDatabase, so the table and its columns are the same.
      const audit = trx as unknown as Transaction<AuditDatabase>;

      await audit
        .insertInto("audit_log")
        .values({
          actor_id: input.actor.id ?? null,
          actor_kind: input.actor.kind,
          action: input.action,
          entity_type: machine.entityType,
          entity_id: input.entityId,
          channel: input.channel ?? null,
          assurance_level: input.assuranceLevel ?? null,
          before_state: JSON.stringify({ state: input.from }),
          after_state: JSON.stringify({ state: input.to }),
        })
        .execute();

      return result;
    },
    options,
  );
}
