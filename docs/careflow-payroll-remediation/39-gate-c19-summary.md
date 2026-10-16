# 39 — Gate C19: Student Loans and Workplace Pension on Payslips

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c19` (backend only, on `gate-c18`) · No calculation change, migration, push or deployment.

**Payslip lines.** The payslip data and the PDF use only the closed run row's stored figures, never the current employee settings.
- **Deductions:** Income Tax (PAYE), employee NI, Student Loan (Plan 1/2/4/5), Postgraduate Loan, Workplace pension (the employee's net relief-at-source contribution), and other deductions as before.
- **Pension information**, in its own section and never deducted: the employer contribution, the gross employee contribution, and the basic-rate relief the provider claims. Employer NI stays under employer costs.
- **Zero and historical figures:** a calculated £0.00 is shown. Rows from before C11/C16 show "Historical detail unavailable" instead of a zero. This replaces the out-of-date "not calculated" note.
- **Reconciliation:** the stored net pay is checked against gross less the stored PAYE, NI, loans and pension deduction. If they disagree, the PDF export refuses (409) and changes nothing. Building the payslip again gives the same figures, and the closed run is never written.

**Files:** `types/payslip.types.ts`, `payroll-payslip.util.ts` and its spec, `payroll-payslip-pdf.util.ts`, `payroll-runs.service.ts` · **Commit:** backend `5a6d221` (the frontend is unchanged).

**Tests**
- `payroll-payslip.util.spec` and `payroll-payslip-pdf.util.spec`: 17 passed, 3 of them new.
  1. Plan 2 and the postgraduate loan appear as separate lines.
  2. The pension: £99.20 deducted once; £74.40, £124.00 and £24.80 shown as information.
  3. A legacy row shows "Historical detail unavailable", and a net pay that disagrees is flagged.
- On the first run, my test fixture had the wrong net (£2,205.44); it was corrected to £2,230.44. The code was right.
- Backend type-check clean.

**Blockers**
- The payslip list endpoint and screen show only gross, PAYE, NI and net, not the loan and pension columns.
- The payslip YTD block does not show loan or pension totals.
- The C7–C16 migrations are not yet on the dev database.

**Next:** C20, loan and pension YTD and columns on the payslip list and screen, then statutory payments (SSP).
