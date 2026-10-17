# 18 — Sprint B4E Summary: Manual Charge Audit and Pay-Window Edit Accuracy

**Date:** 2026-10-14 · **Branch (both repositories):** `payroll-remediation/sprint-b4e`, on `sprint-b4d` · Nothing pushed, deployed or paid. All test data is synthetic.

## 1. Task 1 — Manual client charge audit: DONE

`POST /billing/visit-reconciliations/:id/billable-amount` now saves the charge, and the invoice approval it implies, in one transaction with an audit entry (`visit_reconciliation_billable_amount_set`).

- **The entry records:** the visit and its reference, old and new amount, previous and new status, the user, the time, the note as the reason (optional, as before), and the permission it was done under.
- **On failure:** if the entry cannot be written, nothing changes and the caller gets the controlled 500. A deleted user gets 401, at sign-in or at write time.
- **Retry:** the same amount sent again, already entered by hand and with nothing to approve, writes nothing and records nothing. The note is not added twice.
- **Unchanged:** permissions, locked and invoice-run protections, settled carer pay and its locked lines.

## 2. Task 2 — Pay-window edit accuracy: DONE

**Cause.** `PATCH :id` with a payable start or end re-evaluates the visit. On a visit within the duration tolerance (or with an overrun), the pay rules put the planned window back. The answer was still a plain success, with an audit entry showing no change. A second problem showed up in testing: an edit that *did* take effect changed the minutes but left the amount at its old value (44 minutes priced as 29), because completed visits keep their stored amount unless repricing is forced.

**Now.** A request that names a payable time returns `data.payTimeEdit` and a matching message:

| Outcome | When | Message (example) | Audit |
|---|---|---|---|
| `PAY_TIME_CHANGED` | the window entered is in force | "Payable time changed to 09:01–09:45 (44 min). Carer pay is now £10.27." | `visit_reconciliation_updated` with the outcome |
| `PAY_TIME_UNCHANGED` | it was already in force | "Payable time is already … : nothing changed." | none |
| `PAY_TIME_NOT_APPLIED` | a pay rule put it back | "Payable time not changed. The visit is within the duration tolerance of 20 minutes, so it is paid its planned time. It stays 09:00–10:00 (60 min)." The rule is one of duration tolerance, overrun decision, or other pay rule | `visit_pay_time_edit_not_applied` (a record of the request, not a change) |
| Locked or settled | as before | 400, nothing written | none |

- **Repricing.** A named payable time is now repriced like a corrected attendance time, so minutes and amount agree. Where finance entered the amount by hand, the amount stays and the message says so. No rate, tolerance or rule changed.
- **Office attendance corrections.** One that leaves pay as it was now reports `PAY_UNCHANGED` with the reason and the payable time, instead of `REPRICED` "carer pay recalculated". The evidence stays recorded and is audited as an evidence-only change.
- **Other consumers.** Edits without a payable time (mileage, notes) answer exactly as before.

**Frontend.** No screen edits a payable window today, so there was nothing to relabel there; the visit dialog shows the server's outcome if a response carries one. The ECM *Record manual attendance* action now says what happened to pay (recalculated / unchanged with the reason / correction awaiting approval / check by hand) instead of only "Manual attendance recorded".

## 3. Files changed and commits

| Repository | Commit | Files |
|---|---|---|
| Backend | `0731141` | `src/billing/visit-reconciliations.service.ts`, `visit-reconciliations.controller.ts`, `src/audit-logs/enums/audit-action.enum.ts`; new `test/payroll-int/charge-audit-pay-time.int-spec.ts` |
| Backend | this commit | This report |
| Frontend | `2d69657` | new `src/features/billing/utils/pay-time-outcome.util.ts` (+ test); `api/visit-reconciliations.api.ts`, `components/VisitReconciliationDetailDialog.tsx`, `src/features/ecm/components/EcmOpsActions.tsx` |

## 4. Tests

| Run | Result |
|---|---|
| Payroll integration suite, once at the end | **46 suites, 470 tests: all passed** (929 s, against 445 s for the B4D run; not investigated) |
| New spec `charge-audit-pay-time` | 11 passed; 7 of them fail against the previous code |
| Backend unit (billing, payroll, guards, role-responsibilities, audit-logs, notifications, ecm) | 78 suites, 554 passed |
| Frontend `billing`, `ecm`, `payroll` | 27 files, 174 passed (9 new) |
| Type-check, backend and frontend | Clean |

- **Task 1:** charge saved with old and new amount; audit failure rolls back; same amount twice gives one entry; no permission 403; deleted user 401 at sign-in and at write time; settled pay and locked lines unchanged; invoice-run and locked visits refused.
- **Task 2:** within tolerance, not applied with the rule and window; outside tolerance, changed and repriced, minutes and amount agree; same edit again unchanged with no entry; attendance correction within tolerance reports `PAY_UNCHANGED`; settled and locked visits refused with nothing recorded; a mileage-only edit has no outcome added.

## 5. Migrations

None. The two new audit actions are values of the existing text column.

## 6. Remaining financial risks

1. **Behaviour change:** a payable time entered through the API now reprices the visit. Before, the amount stayed as it was; anyone who relied on that should know.
2. **Same-amount charge with a new note.** It is treated as no change, so the note is not saved. Send a different amount, or add the note in the visit's notes.
3. **Invoice check outside the transaction.** The approved-invoice check runs just before the transaction, so an invoice approved in that instant could still be changed (unchanged from before).
4. **Still open from B4D:** attendance correction is two steps (times first, then pay); superseded agreements have no entry of their own; evaluations are limited to 20 seconds.
5. **Audit gaps still open:** B4C-03 to B4C-07 and B4D-01.

## 7. Recommended next focused sprint

**B4F:** record the superseded agreements in the approval's entry; B4C-03 (pay evaluation failure retry and dismiss) and B4D-01 (the recalculation summary) with the same pattern; and a flag on a visit whose corrected times are recorded but whose pay step failed (B4D risk 3). Payroll settings, leave and disruption rules (B4C-04 to B4C-06) remain a separate mechanical sprint.
