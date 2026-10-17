# 17 — Sprint B4D Summary: Atomic Audit for Pay Agreements and Visit Pay Changes

**Date:** 2026-10-13 · **Branch:** `payroll-remediation/sprint-b4d` (on `sprint-b4c`) · Backend only. Nothing pushed, deployed, sent to HMRC or paid. All test data is synthetic.

## 1. Status

| Task | Status |
|---|---|
| 1. Pay agreements (B4C-01) | **DONE** |
| 2. Visit pay changes (B4C-02) | **DONE**, with one design note on recalculation (below) |

**Task 1.** Creating, approving and changing a pay agreement already ran in a transaction, but the audit entry was written after it. The entry is now written inside: a failed entry leaves no agreement, no approval and no change, and the agreement an approval would supersede stays in effect. Maker/checker, effective dates, salary, weekly hours and salary cover are untouched; no calculation changed.

**Task 2.** What each path does now:

| Path | One transaction containing |
|---|---|
| Payable-time edit (`PATCH :id`) | the edit, the re-evaluation, the entry |
| Amount entered by hand | the amount, the approval it implies, the entry |
| Attendance correction | the refreshed rows, the repricing, the answered flags, every entry; for settled pay, the pay correction item and its own entry (the pay items service now joins the caller's transaction instead of opening its own) |
| Approval withdrawn because evidence changed | every evaluation is now one transaction, whoever starts it: amounts, exceptions, the withdrawal and its entry |
| Carer removed from a visit (pay rejected) | the rejection and its entry |
| Recalculation asked for by a person | per visit: the repricing and that visit's entry |

- The transaction client is passed down to the real writes and audit calls; nothing is wrapped from outside while a nested service writes on its own connection.
- No external call sits inside any of these transactions (none of these paths makes one).
- Locked and settled pay is still never rewritten: a correction is an adjustment record awaiting a second approver.
- **Recalculation design note.** A batch covers up to 1,000 visits and tolerates single failures, so it is not one transaction. Each visit whose amounts change gets its own entry, saved with its change; a visit that does not change gets none. The batch summary entry is still written afterwards. A recalculation without a reason (a system refresh) writes no entry, as before.

## 2. Files changed and commits

| Commit | Files |
|---|---|
| `9dde4c2` Task 1 | `src/payroll/payroll-employees.service.ts` |
| `acec072` Task 2 | `src/billing/visit-reconciliations.service.ts`, `src/billing/pay-items.service.ts`, new `test/payroll-int/audit-atomic-pay-changes.int-spec.ts` |
| this commit | This report |

No frontend change, no API contract change, no schema change.

## 3. Tests

| Run | Result |
|---|---|
| Payroll integration suite, once at the end | **45 suites, 459 tests: all passed** |
| Backend unit (billing, payroll, guards, role-responsibilities, audit-logs, notifications, ecm) | 78 suites, 554 passed |
| Backend type-check | Clean |
| During development: salary agreement, visit reconciliation, attendance, corrections, evaluation-failure, locked-history and audit-integrity specs | 114 passed |

New spec, 11 tests; 8 of them fail against the previous code.

- **Agreements (5):** create, approve, supersede and change, each with its entry; audit failure rolls back creation, approval (the earlier agreement stays active) and a change; self-approval and missing permission still refused; a retry leaves one agreement and one entry, and a third approval has nothing to approve.
- **Visit pay (6):** time correction, manual amount, attendance correction with a withdrawn approval, settled visit, recalculation, standalone evaluation. In each, an audit failure leaves amount, minutes, pay window, status and approver exactly as they were; the retry records each thing once.
- **Settled visit:** edit and manual amount refused (400); a failed correction leaves no pay item and the locked lines unchanged; the retry creates one pending correction; sending it again adds nothing.

Migration rehearsal not run (no schema change). Whole-repository suites not run.

## 4. Database changes

None.

## 5. Remaining audit gaps

| Id | Path |
|---|---|
| B4C-03 | Pay evaluation failure retried or dismissed |
| B4C-04 | Payroll settings: employer settings, tax years, schedules, periods, tax codes, statutory rates |
| B4C-05 | Leave terms and leave entries |
| B4C-06 | Disruption pay rules |
| B4C-07 | HMRC FPS and EPS submission records (an external send cannot be rolled back: needs an outbox or post-commit design) |
| B4D-01 | The batch summary entry of a recalculation (written after the per-visit transactions) |

In all of these a failed entry returns a controlled error and does not stop the API, but the change is not undone.

## 6. Newly noticed financial risks (not fixed: outside this sprint)

1. **A manual client charge amount writes no audit entry at all** (`POST :id/billable-amount`). It is the charge side, not wages, but it is money and it is unrecorded.
2. **A pay-window edit can have no effect.** On a visit within the duration tolerance, evaluation re-applies the planned window, so `PATCH` with a new pay end returns success and writes an entry showing no change. The user is not told.
3. **Attendance correction is two steps.** The corrected times are committed first, then the pay step. If the pay step fails, the request returns an error with times and pay out of step until it is retried or the visit is evaluated again. That is the right order for evidence, but nothing flags the visit in between.
4. **Superseded agreements have no entry of their own.** The approval's entry is the only record that earlier agreements were superseded.
5. **Evaluations now have a 20 second limit** (the transaction's). One that runs longer is recorded as a pay evaluation failure instead of half-finishing. None came near it in tests; a very slow database could.

## 7. Recommended next focused sprint

**B4E — close the cheap gaps around what was just fixed:** audit the manual charge amount (risk 1) and write the superseded agreements into the approval's entry (risk 4); tell the user when a pay-window edit had no effect (risk 2); then B4C-03 and B4D-01 with the same pattern. Payroll settings, leave and disruption rules (B4C-04 to B4C-06) are one mechanical sprint after that. HMRC records (B4C-07) need a design decision first.
