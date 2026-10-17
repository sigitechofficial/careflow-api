# 33 — Gate C13: HMRC Student Loan Start / Stop Notices

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c13` (backend only, on `gate-c12`) · Synthetic data only. No UI, HMRC import, push or deployment.

**Recording a notice.** `POST`/`GET /payroll/employees/:id/loan-notices` (manage / read permission) record SL1, SL2, PGL1 and PGL2 notices: plan (SL1 only), HMRC reference, date on the notice, date received and effective payday.
- **Audit.** The notice and its audit entry (`payroll_loan_notice_recorded`) are saved in one transaction, with the actor.
- **Duplicates.** The same reference is kept once. The same reference with different details is refused (409).
- **No backdating.** The effective payday cannot be before the date received or the date on the notice.

**Applying it.** On each run, the notice in force on the payment date decides each loan, the student and the postgraduate loan separately: SL1 sets the plan (a later SL1 replaces it), SL2 stops it, PGL1 starts and PGL2 stops the postgraduate loan.
- **Without a notice,** the profile setting (starter checklist, P45 or earlier entry) still applies. The explanation shows the source of each deduction: the HMRC notice, or "profile setting, source not verified".
- **Refused:** two notices on the same payday that disagree, and a plan change within an earnings period that already has a closed payment (C11 check).
- **Unchanged:** the C11/C12 deduction methods, PAYE, NI, YTD and closed runs.

**Files:**
- `prisma/schema.prisma` and the migration
- new `src/payroll/payroll-loan-notice.util.ts`
- `payroll-runs.service.ts`, `payroll-employees.service.ts` and `.controller.ts`, `dto/payroll.dto.ts`
- `payroll-statutory.util.ts`, `audit-action.enum.ts`
- `test/payroll-int/student-loans.int-spec.ts`

**Migration:** `20261025100000_loan_notices` adds one new empty table. It is rehearsed on the disposable database (61 of 61 checks) and not applied to the dev database.

**Commit:** backend `3014106`.

**Tests**
- `student-loans` integration: 6 passed, 3 of them new.
  1. SL1 then SL2 (£0 → £49 → £0).
  2. PGL1 alongside SL1, then a Plan 1 SL1 (YTD £166 / £150).
  3. Duplicates, late notices, mismatches and same-payday conflicts, with closed April unchanged.
- Statutory unit spec: 39 passed.
- Type-check clean: it was run twice, because the first run found a type error that was then fixed.

**Gaps**
- Notices cannot be withdrawn or corrected.
- Existing profile loan flags are not verified notices: review their source before going live.
- Nothing checks that the effective payday is really the first practical one; the user enters it.
- There is no screen, and the notice is not shown on the payslip or FPS.

**Next:** C14, a notice screen on the payroll profile, with a correction or withdrawal flow and review of the legacy flags.
