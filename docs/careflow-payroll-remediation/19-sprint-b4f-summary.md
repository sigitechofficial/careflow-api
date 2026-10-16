# 19 — Micro Sprint B4F: Attendance Correction Whose Pay Step Fails

**Date:** 2026-10-14 · **Branch (both repositories):** `payroll-remediation/sprint-b4f`, on `sprint-b4e` · Nothing pushed or deployed. Synthetic data only. No migration.

## Bug fixed

An office attendance correction saves the corrected times, then recalculates pay. When the pay step failed, the request answered with an error, the times stayed changed, pay stayed on the old times, and nothing on the visit said so.

Now, when the pay step fails:

- **The times stay recorded.** Attendance evidence is never undone.
- **The failure is listed.** It is kept as a *pay calculation failure* (existing R-17 list) with the new operation `ATTENDANCE_CORRECTION`, one per visit. It holds the correction's reason so that a retry can repeat it.
- **Each carer's pay on the visit is flagged** with an `EVIDENCE_CHANGED` exception: "Attendance times were corrected but carer pay could not be recalculated…". Approved pay that is not yet settled goes back to review, so no pay run pays it on the old times. Settled pay is flagged only and never rewritten.
- **The flag and its audit entry are one transaction** (`visit_attendance_pay_not_recalculated`). If even that cannot be audited, nothing financial changes and the failure is still listed.
- **The answer is accurate:** 201 with outcome `PAY_NOT_RECALCULATED` and a message giving the reason and the failure reference. The ECM notice shows it as an error, not as "recorded".

**Retry** uses the existing route `POST /billing/visit-reconciliations/evaluation-failures/:id/retry`. It runs the same correction in one transaction, which clears the flag, closes the failure and, for settled pay, records one correction awaiting approval. Retrying again is refused, and a duplicate correction adds nothing. A later successful correction of the same visit also clears the flag.

## Files changed

- **Backend:** `src/billing/visit-reconciliations.service.ts`, `src/billing/pay-evaluation-failure.util.ts`, `src/audit-logs/enums/audit-action.enum.ts`; new `test/payroll-int/attendance-pay-step.int-spec.ts`; `test/payroll-int/audit-atomic-pay-changes.int-spec.ts` (two expectations: an audit failure here now answers 201 `PAY_NOT_RECALCULATED`, not 500).
- **Frontend:** `src/features/billing/utils/pay-time-outcome.util.ts` (+ test).

## Commits

| Repository | Commit |
|---|---|
| Backend | `c7fa5c4` (this report in the next commit) |
| Frontend | `cc520d6` |

## Tests

| Run | Result |
|---|---|
| New `attendance-pay-step` (success, failure flagged and listed, retry and duplicate retry, settled visit, audit failure) | 5 passed; 4 fail against the previous code |
| Affected integration: attendance, approval-evidence, audit-atomic (2 specs), audit-integrity, charge-audit-pay-time, pay-corrections, pay-evaluation-failures, locked-history, reassignment | 13 suites, 110 passed |
| Backend unit `src/billing`, `src/ecm` | 46 suites, 399 passed |
| Frontend notice helper | 10 passed |
| Type-check, backend and frontend | Clean |

The full payroll suite was not run (micro-sprint rule).

## Remaining risk

- A retry is carried out by the user who retries, with the original reason. The pay-correction item and the audit entry name that user, not the one who first entered the times.
- If the flag cannot be written (audit table down), the visit is not held, only listed. A pay run in that window could pay it on the old times.
- Still open from earlier sprints: superseded agreements have no entry of their own; audit gaps B4C-03 to B4C-07 and B4D-01.

## Recommended next micro-sprint

**B4G:** record superseded agreements in the approval's audit entry, and make a pay run refuse to lock while a visit in it has an open `ATTENDANCE_CORRECTION` failure. That closes the "not held" window above.
