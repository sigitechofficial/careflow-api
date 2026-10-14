# 40 — Gate C20: Loans and Pension on the Payslip Screen

**Date:** 2026-10-14 · **Branches:** `payroll-remediation/gate-c20` in both repositories (backend on `gate-c19`, frontend on `gate-c17`) · No calculation, migration or PDF change, no push.

**Implemented**
- **Payslip list:** returns the closed row's stored figures (student loan plan and deduction, postgraduate loan, employee pension net, employer pension), with their null markers.
- **Payroll → Payslips table:** three new columns (Student loan with the plan, PG loan, Pension (employee)), with the employer pension labelled "Employer-paid … (not deducted)". Gross, tax, NI and net are unchanged.
- **Display rules:** a calculated zero shows £0.00, no loan shows "—", and runs from before C11/C16 show "Historical detail unavailable". Nothing is recalculated.

**Files**
- Backend: `src/payroll/payroll-runs.service.ts`.
- Frontend: `pages/UkPayrollPayslipsPage.tsx` and new `UkPayrollPayslipsPage.test.tsx`, `types/payroll.types.ts`.

**Commits:** backend `de2f344`, frontend `0158b79`.

**Tests:** `UkPayrollPayslipsPage.test.tsx` 2 passed (stored Plan 2 £49, PG £75, pension £99.20 with employer £74.40 shown apart; historical rows show unavailable, not £0.00). Frontend 0 errors, backend type-check clean.

**Blockers:** loan and pension YTD are not on the payslip PDF or screen; the C7–C16 migrations are not on the dev database.

**Next:** statutory payments, starting with Statutory Sick Pay.
