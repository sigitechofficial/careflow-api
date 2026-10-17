# 34 — Gate C14: Student Loan Notice Entry Screen

**Date:** 2026-10-14 · **Frontend branch:** `payroll-remediation/gate-c14` (on `gate-c9`) · **Backend branch:** `payroll-remediation/gate-c14`, report only (on `gate-c13`) · No backend or database change, push or deployment.

**UI.** The Payroll → Employees profile dialog has a new section, "Student & Postgraduate Loan Notices", using the C13 `GET`/`POST /payroll/employees/:id/loan-notices` endpoints.
- **Form:** SL1 (with plan), SL2, PGL1 and PGL2; HMRC reference, date on the notice, date received and effective payday. The user must tick an explicit confirmation of the effective payday, which is never filled in automatically.
- **Errors:** backend validation and conflict messages are shown in the section and in the existing toast.
- **History:** recorded notices, most recent payday first, reloaded after each save.
- **Warnings and notes:**
  - the profile's loan checkboxes are not verified HMRC notices;
  - notices cannot be edited or deleted here, so a wrong one needs a controlled correction;
  - recording a notice recalculates no pay and reports nothing to HMRC.
- **Permissions:** only `payroll.employees.manage` sees the form. No profile field or loan flag is changed.

**Files:** new `components/LoanNoticesSection.tsx` and its test; `api/payroll.api.ts`, `hooks/usePayroll.ts`, `keys.ts`, `types/payroll.types.ts`, `types/payroll-api.types.ts`, `pages/PayrollEmployeesPage.tsx`; the C9 page test's mocks · **Frontend commit:** `291c195`.

**Tests**
- `LoanNoticesSection.test.tsx`: 3 passed (SL1 required fields and history reload; PGL2 without a plan, with the conflict shown; reader view and legacy warning).
- The C9 page test needed a mock for the new section: 3 passed.
- Type-check: 0 errors.

**Limitations**
- Notices cannot be corrected or withdrawn: there is no backend for it yet.
- Readers never open the profile dialog (existing rule), so they see notices only if they can open it.
- The audit-log screen does not yet name the new audit action.
- The backend migrations from C7 onward are still not on the dev database, so this screen cannot save there yet.

**Next:** C15, a controlled correction and withdrawal of a notice (backend and screen), with audit and its effect from a stated payday.
