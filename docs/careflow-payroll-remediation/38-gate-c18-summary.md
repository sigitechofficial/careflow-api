# 38 — Gate C18: Reconciling Legacy and C16 Pension Settings

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c18` (backend only, on `gate-c17`) · No migration, frontend, push or deployment.

**Findings (data flow)**
- **Legacy fields:** `pensionOptedIn` and the elections `PENSION_EMPLOYEE`, `AVC_PENSION` and `SS_PENSION` are only written by the profile save (kept in step by `loanFlagsFromElections`), mapped for display, and noted on the payslip. No UK payroll calculation reads them.
- **C16 behaviour:** C16 already took contributions only from `pensionStatus`, so there was no duplicate.
- **Unchanged estimate:** `billing/pay-compliance.util.ts` has an employer pension cost estimate on visit pay runs. It is never deducted or posted, so it was left as it is.

**Implemented**
- **New check:** `legacyPensionConflict` in `uk-deduction-elections.util.ts`, called by the UK run.
- **What it stops:** the calculation, with `PENSION_CONFIGURATION_CONFLICT`, when the legacy settings record:
  - salary sacrifice;
  - additional voluntary contributions;
  - an opt-in for someone recorded `NOT_ENROLLED`.
- **What stays the same:**
  - absent legacy settings are not a conflict;
  - a missing C16 status is still refused;
  - nothing is converted, backfilled or deleted;
  - PAYE, NI, loans, net pay, YTD, recalculation, supplementary runs and closed history are unchanged.

**Files:** `src/payroll/uk-deduction-elections.util.ts`, `src/payroll/payroll-runs.service.ts`, `test/payroll-int/pension.int-spec.ts` · **Commit:** backend `2d00e08`.

**Tests**
- `pension` integration: 5 passed, 3 of them new: ENROLLED with the legacy opt-in contributes once; three conflicts are refused; NOT_ENROLLED gives 0 with PAYE £390.20, NI £156.16 / £387.45 and Plan 2 £49 kept, and a missing status is not filled in from the flags.
- `payroll-pension.spec`: 2 passed.
- Type-check clean.

**Blockers**
- Profiles with conflicting legacy elections stay blocked until someone corrects them on the profile.
- The payslip note still says pensions are not calculated.
- The C7–C16 migrations are still not on the dev database.

**Next:** C19, payslip lines for the C11–C16 deductions (student loan, postgraduate loan, pension employee/employer), replacing the out-of-date "not calculated" note.
