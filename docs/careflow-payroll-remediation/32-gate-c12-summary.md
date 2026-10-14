# 32 — Gate C12: Weekly, Fortnightly and Four-Weekly Student Loans

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c12` (backend only, on `gate-c11`) · Synthetic data only. No migration, UI, push or deployment.

**Implemented**
- **Weekly pay:** Plans 1, 2, 4, 5 and the postgraduate loan use the GOV.UK 2026–27 weekly thresholds (£517.30, £565.09, £649.90, £480.76 and £403.84).
- **Fortnightly and four-weekly pay (HMRC SL3):** the weekly deduction on average weekly pay, rounded down to the pound, times 2 or 4.
- **The period** is the schedule's NI earnings period.
- **Unchanged:** monthly, PAYE and NI. The C11 run-row and YTD fields, the supplementary-payment rule (period total less earlier deductions) and the refusals are reused. Another year has no thresholds and is refused.

**Files:** `src/payroll/payroll-statutory.util.ts` and its spec, `src/payroll/payroll-runs.service.ts`, `test/payroll-int/student-loans.int-spec.ts` · **Commit:** backend `9727151`.

**Tests**
- Unit: 39 passed. Two are new: weekly £650 gives £11 / £7 / £0 / £15 for Plans 1, 2, 4, 5 and £14 postgraduate; Plan 2 gives £7 / £14 / £28. Two C11 expectations that encoded "monthly only" were updated.
- `student-loans` integration: 3 passed, one new. Fortnightly £1,300 deducts £14 / £28; a supplementary £200 deducts £18 / £12; YTD is £32 / £40, posted once. The C11 weekly-refusal assertion was removed because weekly is now supported.
- Type-check clean.

**Limitations:** no SL1/SL2 or PGL1/PGL2 notice dates; directors and multiple plans are still refused; there is no payslip or FPS output yet; the C7/C10/C11 migrations are still to be applied to the dev database.

**Next:** C13, loan notice dates on the profile (SL1/SL2, PGL1/PGL2), so that deductions start and stop by notice.
