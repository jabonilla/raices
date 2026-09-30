import { describe, expect, it } from "vitest";

import { isDeclared } from "../src/audit/index.js";
import {
  transactionIntentMachine,
  transactionSettlementMachine,
} from "../src/transactions/index.js";
import type { IntentState, SettlementState } from "../src/transactions/index.js";

/**
 * The two state machines, asserted edge by edge without a database.
 *
 * apps/api/test/transactions.test.ts walks the paths that matter against
 * real Postgres, but walking a path only proves the edges it uses exist. It
 * cannot prove that an edge is *absent* unless it happens to try that exact
 * move. These tables assert the whole adjacency matrix, so widening either
 * machine — letting settlement skip a stage, or letting a cancelled intent
 * be re-committed — fails here even if no behaviour test happens to try it.
 */

const INTENT: readonly IntentState[] = ["committed", "cancelled"];

const SETTLEMENT: readonly SettlementState[] = [
  "not_started",
  "instructed",
  "in_flight",
  "settled",
  "failed",
  "reversed",
];

describe("the intent machine", () => {
  const declared: Readonly<Record<IntentState, readonly IntentState[]>> = {
    // A commitment can be withdrawn.
    committed: ["cancelled"],
    // A withdrawal cannot be taken back: re-committing is a new agreement,
    // which is a new request and a new transaction.
    cancelled: [],
  };

  for (const from of INTENT) {
    for (const to of INTENT) {
      const allowed = declared[from].includes(to);
      it(`${allowed ? "allows" : "refuses"} ${from} -> ${to}`, () => {
        expect(isDeclared(transactionIntentMachine, from, to)).toBe(allowed);
      });
    }
  }
});

describe("the settlement machine", () => {
  const declared: Readonly<Record<SettlementState, readonly SettlementState[]>> = {
    // Forward one stage at a time. Skipping a stage would record money as
    // having arrived without ever having been sent.
    not_started: ["instructed", "failed"],
    instructed: ["in_flight", "failed"],
    in_flight: ["settled", "failed"],
    // Nothing to reverse until something arrived.
    settled: ["reversed"],
    // Both ends are terminal. A failed payout is retried as a new transfer
    // with its own record, so "this attempt failed" stays true afterwards
    // instead of being overwritten by the retry.
    failed: [],
    reversed: [],
  };

  for (const from of SETTLEMENT) {
    for (const to of SETTLEMENT) {
      const allowed = declared[from].includes(to);
      it(`${allowed ? "allows" : "refuses"} ${from} -> ${to}`, () => {
        expect(isDeclared(transactionSettlementMachine, from, to)).toBe(allowed);
      });
    }
  }

  it("can reach failed from every stage before it lands", () => {
    for (const from of ["not_started", "instructed", "in_flight"] as const) {
      expect(isDeclared(transactionSettlementMachine, from, "failed")).toBe(true);
    }
  });

  it("can reach reversed only from settled", () => {
    for (const from of SETTLEMENT) {
      expect(isDeclared(transactionSettlementMachine, from, "reversed")).toBe(from === "settled");
    }
  });
});
