# 20 — Micro Sprint B4G: No Lock While Attendance Pay Failures Are Open

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/sprint-b4g` (backend only, on `sprint-b4f`) · Nothing pushed or deployed. Synthetic data only.

## Fix implemented

When the pay step of an attendance correction fails, B4F holds the visit for review. That hold can fail to save (its audit entry fails), leaving only the open `ATTENDANCE_CORRECTION` failure record, and a pay run could then lock the visit's pay on the old times.

- **Visit pay run lock.** Inside the lock transaction, the run reads the open `ATTENDANCE_CORRECTION` failures for the visits it is about to settle, straight from the failure records, not the visit's flag. If there are any, the lock is refused. Nothing is set to LOCKED and nothing is settled.
- **The error** names only visit references and failure references, for example "Cannot lock this pay run: corrected attendance times of 1 visit(s) have not reached carer pay yet: VIS-… (failure 1a2b3c4d). Retry them from Pay calculation failures…". No employee data.
- **UK payroll close.** A UK run settles provisional visits directly on close, so close has the same guard ("Cannot close this payroll run: …").
- **Fails closed.** The check runs in the same transaction as the lock, so if the query fails the lock fails with it; it is never skipped.
- **Concurrency.** Recording such a failure and settling visits take the same transaction-scoped advisory lock. Either the failure is seen by the lock, or it is recorded after the visit is settled, and then B4F flags it for a correction.
- **After a retry.** Once the existing retry resolves the failure, the run is recalculated and locks normally. Locks, approvals, source claims and corrections are unchanged.

## Files changed

- New `src/billing/attendance-pay-guard.util.ts`
- `src/billing/payroll-runs.service.ts` (lock)
- `src/payroll/payroll-runs.service.ts` (UK close)
- `src/billing/visit-reconciliations.service.ts` (recording an attendance failure takes the lock)
- New `test/payroll-int/lock-attendance-failures.int-spec.ts`

## Commit

Backend `c8cbeb1` (this report in the next commit). No frontend change.

## Tests

| Run | Result |
|---|---|
| New spec (6) | 6 passed; 5 fail against the previous code (the unrelated-visit case passes both ways, as it should) |
| `locked-history`, plus `attendance-pay-step` and `duplicate-claims` (the lock, close and failure-recording paths changed) | 3 suites, 22 passed |
| Backend type-check | Clean |

The six scenarios:

1. Failure after approval: lock refused.
2. Hold not saved, only the failure record exists: lock refused.
3. Failure recorded after calculation and approval: lock refused.
4. Resolved by the existing retry: recalculate, approve, lock.
5. A failure on a visit outside the run: lock goes ahead.
6. UK payroll close refused, then allowed once the failure is resolved.

The full payroll suite and all backend unit tests were not run (micro-sprint rule).

## Migration

None.

## Remaining risk

- **Whole visit blocked.** The guard works per visit, not per carer: one carer's open failure blocks the other carers on the same visit until it is retried.
- **A dismissed failure no longer blocks.** Dismissing is the office's decision and is audited, but the visit's pay then stays on whatever times it has.
- **Still open:** superseded agreements have no audit entry of their own; audit gaps B4C-03 to B4C-07 and B4D-01.

## Next recommended micro-sprint

**B4H:** write the superseded agreements into the approval's audit entry (B4D risk 4), then B4C-03 (an audited retry and dismissal of pay calculation failures in the same transaction).
