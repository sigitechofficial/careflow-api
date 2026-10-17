# 35 — Gate C15: Correcting Loan Notices Recorded in Error

**Date:** 2026-10-14 · **Branches:** `payroll-remediation/gate-c15` in both repositories (on `gate-c14`) · Synthetic data only. No push, deployment or HMRC contact.

**Backend.** `POST /payroll/employees/:id/loan-notices/:noticeId/correction` (manage permission) voids a notice entered wrongly in Careflow. It is never a stop of a genuine HMRC instruction.
- **Required:** a reason and an evidence reference. Optionally it records the correct notice in its place.
- **History kept:** the original stays, with who, when, why and the evidence. The status is ACTIVE, VOIDED or CORRECTED, with links between the two records.
- **Reference reuse:** the replacement may carry the same reference, because uniqueness now applies to notices in force (`activeReferenceKey`).
- **Saved safely:** the correction and its audit entry (`payroll_loan_notice_corrected`) are saved in one transaction, and a repeat is not applied twice.
- **Closed payroll:** refused (409) if closed payroll was paid on or after the payday either notice applies from; that needs a separate payroll correction.
- **Open runs:** runs calculated on the notice go back to "gross calculated", so they cannot close without recalculating.
- **Payroll:** ignores voided notices. Nothing is refunded or recovered.

**Frontend.** `LoanNoticesSection` shows each notice's status, reason, evidence and date.
- **Controls:** managers get "Correct entry" (a replacement prefilled from the original) and "Recorded in error". Both need a reason, evidence and a confirmation that this corrects Careflow's record only.
- **After saving:** errors are shown and the history reloads. Readers see no controls.

**Files**
- Backend: `prisma/schema.prisma` and the migration, `payroll-employees.service.ts` and `.controller.ts`, `dto/payroll.dto.ts`, `payroll-runs.service.ts`, `audit-action.enum.ts`, `test/payroll-int/student-loans.int-spec.ts`.
- Frontend: `LoanNoticesSection.tsx` and its test, the API, hooks and types.

**Migration:** `20261026100000_loan_notice_corrections` adds seven columns and moves the unique index to the active reference. It backfills only the key, from each notice's own values. It is rehearsed (61 of 61) and not on the dev database.

**Commits:** backend `1ec43fe`, frontend `83f734f`.

**Tests**
- `student-loans` integration: 9 passed, 3 of them new (replacement used by payroll; repeat / failed audit / reader 403; closed payroll refused and an open run sent back).
- `LoanNoticesSection`: 4 passed, 1 of them new.
- Type-checks: backend and frontend clean.

**Blockers**
- No payroll correction workflow exists for notices that closed payroll used.
- The audit-log screen does not name the two notice actions.
- The C7–C15 migrations are still not on the dev database.

**Next:** C16, a reviewed payroll correction for closed runs (supplementary adjustment) driven by a corrected notice, with maker/checker.
