import type { Currency } from "@raices/money";

/**
 * A synthetic provider statement built to exercise every discrepancy kind.
 *
 * The fixture declares both the inputs and the findings those inputs must
 * produce, so a test asserts against this description rather than against a
 * separately maintained list that could drift from it.
 *
 * Each mismatching pair is constructed to trip exactly one kind: the amount
 * pair settles on time in the expected state, the state pair has the right
 * amount and settles on time, and the timing pair matches on both amount and
 * state. Anything else would make "exactly one of each kind" ambiguous.
 */

export type DiscrepancyKind =
  "missing" | "unexpected" | "amount_mismatch" | "state_mismatch" | "timing";

export interface SyntheticExpectation {
  /** Stable handle so assertions can name the row without knowing its uuid. */
  readonly key: string;
  readonly providerRef: string;
  readonly amountMinor: bigint;
  readonly currency: Currency;
  readonly expectedState: string;
  /** Milliseconds from the statement's base time. */
  readonly expectedByOffsetMs: number;
}

export interface SyntheticLine {
  readonly key: string;
  readonly lineRef: string;
  readonly providerRef: string;
  readonly amountMinor: bigint;
  readonly currency: Currency;
  readonly state: string;
  /** Milliseconds from base time, or null for "not settled". */
  readonly settledAtOffsetMs: number | null;
  readonly raw: Record<string, unknown>;
}

export interface ExpectedFinding {
  readonly kind: DiscrepancyKind;
  readonly expectationKey?: string;
  readonly lineKey?: string;
}

export interface SyntheticStatement {
  readonly provider: string;
  readonly statementId: string;
  readonly baseTime: Date;
  readonly expectations: readonly SyntheticExpectation[];
  readonly lines: readonly SyntheticLine[];
  /** Exactly the discrepancies a correct reconciliation must report. */
  readonly expectedFindings: readonly ExpectedFinding[];
}

const HOUR = 60 * 60 * 1000;

/** Comfortably inside expected_by. */
const ON_TIME = 30 * 60 * 1000;
/** Comfortably outside it. */
const LATE = 2 * HOUR;

const SETTLED = "settled";
const PENDING = "pending";

/**
 * One discrepancy of each of the five kinds, and nothing else.
 *
 * The clean pair at the end is load-bearing: without it the fixture could not
 * distinguish "reports every kind" from "reports a discrepancy for every
 * row it sees".
 */
export function syntheticStatement(suffix: string): SyntheticStatement {
  const provider = `mock-bsp-${suffix}`;
  const ref = (name: string) => `${name}-${suffix}`;

  return {
    provider,
    statementId: `stmt-${suffix}`,
    baseTime: new Date("2026-09-23T00:00:00.000Z"),

    expectations: [
      // Clean: matched, right amount, right state, settled on time.
      {
        key: "clean",
        providerRef: ref("clean"),
        amountMinor: 10_000n,
        currency: "USD",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
      // missing: we expected this, the provider never mentions it.
      {
        key: "missing",
        providerRef: ref("missing"),
        amountMinor: 25_000n,
        currency: "USD",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
      // amount_mismatch: everything agrees except the amount.
      {
        key: "amount",
        providerRef: ref("amount"),
        amountMinor: 50_000n,
        currency: "USD",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
      // state_mismatch: everything agrees except the state.
      {
        key: "state",
        providerRef: ref("state"),
        amountMinor: 75_000n,
        currency: "USD",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
      // timing: everything agrees, but it settled after expected_by.
      {
        key: "timing",
        providerRef: ref("timing"),
        amountMinor: 90_000n,
        currency: "USD",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
    ],

    lines: [
      {
        key: "clean",
        lineRef: "L-001",
        providerRef: ref("clean"),
        amountMinor: 10_000n,
        currency: "USD",
        state: SETTLED,
        settledAtOffsetMs: ON_TIME,
        raw: { line: "L-001", note: "matches cleanly" },
      },
      // unexpected: the provider settled something we never intended.
      {
        key: "unexpected",
        lineRef: "L-002",
        providerRef: ref("unexpected"),
        amountMinor: 31_337n,
        currency: "USD",
        state: SETTLED,
        settledAtOffsetMs: ON_TIME,
        raw: { line: "L-002", note: "no expectation for this" },
      },
      {
        key: "amount",
        lineRef: "L-003",
        providerRef: ref("amount"),
        amountMinor: 49_999n, // one minor unit short
        currency: "USD",
        state: SETTLED,
        settledAtOffsetMs: ON_TIME,
        raw: { line: "L-003", note: "short by one minor unit" },
      },
      {
        key: "state",
        lineRef: "L-004",
        providerRef: ref("state"),
        amountMinor: 75_000n,
        currency: "USD",
        state: PENDING, // we expected settled
        settledAtOffsetMs: ON_TIME,
        raw: { line: "L-004", note: "still pending" },
      },
      {
        key: "timing",
        lineRef: "L-005",
        providerRef: ref("timing"),
        amountMinor: 90_000n,
        currency: "USD",
        state: SETTLED,
        settledAtOffsetMs: LATE, // after expected_by
        raw: { line: "L-005", note: "settled late" },
      },
    ],

    expectedFindings: [
      { kind: "missing", expectationKey: "missing" },
      { kind: "unexpected", lineKey: "unexpected" },
      { kind: "amount_mismatch", expectationKey: "amount", lineKey: "amount" },
      { kind: "state_mismatch", expectationKey: "state", lineKey: "state" },
      { kind: "timing", expectationKey: "timing", lineKey: "timing" },
    ],
  };
}

/** Everything agrees. A correct reconciliation reports nothing at all. */
export function cleanStatement(suffix: string): SyntheticStatement {
  const provider = `mock-bsp-${suffix}`;
  const ref = (name: string) => `${name}-${suffix}`;

  return {
    provider,
    statementId: `stmt-clean-${suffix}`,
    baseTime: new Date("2026-09-23T00:00:00.000Z"),
    expectations: [
      {
        key: "a",
        providerRef: ref("a"),
        amountMinor: 1_000n,
        currency: "USD",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
      {
        key: "b",
        providerRef: ref("b"),
        amountMinor: 2_500n,
        currency: "GTQ",
        expectedState: SETTLED,
        expectedByOffsetMs: HOUR,
      },
    ],
    lines: [
      {
        key: "a",
        lineRef: "C-001",
        providerRef: ref("a"),
        amountMinor: 1_000n,
        currency: "USD",
        state: SETTLED,
        settledAtOffsetMs: ON_TIME,
        raw: { line: "C-001" },
      },
      {
        key: "b",
        lineRef: "C-002",
        providerRef: ref("b"),
        amountMinor: 2_500n,
        currency: "GTQ",
        state: SETTLED,
        settledAtOffsetMs: ON_TIME,
        raw: { line: "C-002" },
      },
    ],
    expectedFindings: [],
  };
}
