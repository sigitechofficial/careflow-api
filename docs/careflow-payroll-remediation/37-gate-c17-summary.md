# 37 — Gate C17: Workplace Pension Settings on the Payroll Profile

**Date:** 2026-10-14 · **Frontend branch:** `payroll-remediation/gate-c17` (on `gate-c15`) · **Backend branch:** `payroll-remediation/gate-c17`, report only (on `gate-c16`) · No backend, migration, push or deployment.

**UI: a "Workplace Pension" section** in Payroll → Employees → profile dialog, for the C16 fields.
- **Statuses:** Not yet recorded / ENROLLED / NOT_ENROLLED. A missing status stays missing, with a warning that tax and NI wait for it.
- **ENROLLED** needs every field entered explicitly; nothing is prefilled:
  - effective date;
  - scheme and policy references;
  - qualifying earnings;
  - relief at source;
  - employee and employer % (at least 8% total and 3% employer);
  - a confirmation that the settings match the scheme rules.

  Net pay arrangement and salary sacrifice are not offered.
- **NOT_ENROLLED** needs a manager's confirmation. The section explains that it is an employer-recorded status, not an automatic-enrolment assessment or an exemption.
- **Saving:** only the pension fields are sent, through the audited profile API, and the profile reloads. Backend errors are shown. The section states that saving recalculates nothing. Readers see only the saved status.
- **One-line fix:** the main "Save profile" no longer clears `pensionSchemeRef` when its old pension-election field is hidden. It would otherwise erase the C16 scheme reference.

**Files:** new `components/WorkplacePensionSection.tsx` and its test; `pages/PayrollEmployeesPage.tsx`; `types/payroll.types.ts` and `payroll-api.types.ts`; the C9 page test's mocks · **Frontend commit:** `71192bb`.

**Tests**
- `WorkplacePensionSection.test.tsx`: 3 passed.
- The C9 page test, which needed a mock for the new section: 3 passed.
- Type-check: 0 errors.

**Blockers**
- The C7–C16 migrations are not on the dev database, so the screen cannot save there yet.
- Every existing profile shows "Not yet recorded", and payroll is blocked until each person is recorded.
- The old pension deduction elections and `pensionOptedIn` still exist alongside these fields. They should be reviewed or retired.

**Next:** C18, retire or reconcile the legacy pension election fields with the C16 enrolment, and show the pension figures on payslips.
