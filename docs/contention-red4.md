# RED-4: what is actually hot

Investigation for [#102](https://github.com/jabonilla/raices/issues/102). No
change to the retry budget, and none recommended.

## Summary

K3's harness measures a **synthetic** hot row: `redteam_hot_state`, one row
with `id = 1`, read-then-incremented by every one of 500 operations across 64
workers. Its contention fan-in is the whole concurrency of the run.

**No row in our real flows has that shape.** Every mutable row written inside
a serializable transaction is scoped to one relationship, request,
transaction, plan or user. The widest legitimate fan-in is two — the two
parties to a relationship — or N duplicate submissions of a single request,
which is exactly the case idempotency exists to collapse and which the
harness measures separately at **0% failure**.

So the 7.2% is a real measurement of a shape we do not currently have. It is
worth keeping as a tripwire, not as a reason to widen the budget.

## Every mutable-row write inside a serializable transaction

| Row | Written by | Who can contend for the *same* row | Why it is in the transaction |
|---|---|---|---|
| `money_plan.current_version_id` | `plans.ts` `appendVersion` | Two concurrent edits of one plan, by one sender | Atomicity: the pointer and the version it points at must commit together, or the plan names a version that does not exist |
| `app_user.roles` | `users.ts` `findOrCreateUserByPhone` | Onboarding races on one phone number; realistically a person who is both sender and recipient | Atomicity with the insert-or-find. Already a single `array_append` statement, not read-modify-write, so two callers adding different roles cannot lose one another's |
| `relationship.status` | `relationships.ts` `changeStatus` | The two parties to one relationship. **Fan-in 2** | Atomicity with the audit row (AU002), and since RED-1 the status read is in here too |
| `request.status` | `transactions.ts` `approveAndRecord` | Duplicate approvals of one request | Atomicity with the transaction row and the ledger posting — the whole point of P2.5 |
| `request.status` | `requests.ts` `resolve` (decline, expire) | Duplicate resolutions of one request | Atomicity with the audit row |
| `transaction.intent_state`, `transaction.settlement_state` | `transactions.ts` | Settlement callbacks for one transaction; a provider webhook retry storm is the realistic worst case | Atomicity with the audit row |
| `reconciliation_run.finished_at` | `reconcile.ts` | One run per input hash; duplicates are resolved by the unique key so only one proceeds | Atomicity with the findings insert |

**Is any of it in the ledger transaction only because it was convenient?**
No. Each row above has a stated atomicity reason and moving it out would
break something specific. I looked for the convenient ones and did not find
any.

**The one shape worth watching** is not a write. `submitRequest` calls
`monthToDateSpend` inside its transaction, and that is a range scan over
`request` filtered by relationship, category, status and `created_at`. Under
SERIALIZABLE a range scan takes predicate locks, so as request volume in one
category grows, concurrent submissions in that category can rw-conflict. It
is there for a real reason — the tier is classified against the spend at
submission time, atomically, or the classification is a guess — so it is not
convenience. It is simply the read most likely to become hot first, and the
one to instrument when volume arrives.

## Should anything be serialized per row?

Not on this evidence. Advisory locks and queues trade a fast, visible
failure for a slow, invisible wait, which is the same objection #102 raises
against a longer budget. Nothing measured justifies paying it.

If a genuinely hot row does appear, the first candidate is
`transaction.settlement_state` under provider webhook retries — and the right
tool there is idempotency at the webhook boundary, which the webhook dedupe
path already provides, rather than a lock around the state change.

## Re-measurement

Same harness, same parameters as K3's recorded run (500 operations, 64
workers, 2s budget, 5ms hold), three runs per arm, on one machine. The arms
differ only by whether RED-2's `ledger_entry_written_with_parent` trigger
exists, so this also answers "did the fix make contention worse".

| Scenario | RED-2 trigger | Failure rate, 3 runs | Operations needing >1 attempt | p99 (median) |
|---|---|---|---|---|
| shared-clearing | on | 0, 0, 0 | 18, 3, 3 | 232 ms |
| shared-clearing | off | 0, 0, 0 | 4, 1, 0 | 238 ms |
| duplicate-replay | on | 0, 0, 0 | 210, 228, 233 | 85 ms |
| duplicate-replay | off | 0, 0, 0 | 231, 238, 219 | 104 ms |
| hot-domain-row | on | 0.106, 0.096, 0.098 | 185, 184, 179 | 2020 ms |
| hot-domain-row | off | 0.100, 0.096, 0.098 | 177, 178, 184 | 2026 ms |

Three things follow.

**The 7.2% → ~9.8% difference from K3's figure is this machine, not the fix.**
The trigger-off arm measures ~9.8% too. Anyone comparing the two numbers
across reports would otherwise conclude the fix regressed hot-row contention;
it did not.

**The RED-2 trigger costs a few retries on the posting path and no
failures.** Each `ledger_entry` insert now does a primary-key lookup on its
parent `ledger_transaction`, and under SERIALIZABLE that read takes a
predicate lock. Each posting reads only its own parent, so the conflicts are
at index-page granularity — the same effect `ledger/post.ts` already
documents for the idempotency index, where a small index puts unrelated keys
on one page. It shows up as roughly 1 to 18 extra second attempts per 500
postings against 0 before, and zero failures in any run.

**It costs nothing on hot rows or on replay**, which is what you would expect:
the trigger touches the posting path only.

## What was not done

The budget stays at 2s. Nothing here argues it is wrong, and the failures
that exist are on a shape our flows do not have.
