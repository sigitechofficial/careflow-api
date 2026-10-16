# 41 — Loan and Pension Completion (IMPLEMENTED BUT UNVERIFIED)

**Date:** 2026-10-14 · **Branches:** `payroll-remediation/loan-pension-completion` in both repositories (backend on `gate-c20`, frontend on `gate-c20`) · No push, deployment, HMRC or provider contact, or payment.

## 1. Student loan: implemented
- **Declaration on the profile:** status (`LOAN_DECLARED` / `NO_LOAN_CONFIRMED`; null = not yet verified), source (starter checklist / P45 / other) and date, with a screen section.
- **Rules in the UK run** (an HMRC notice in force always wins):
  - a "no loan" declaration that contradicts the profile's plan is refused;
  - a declared loan with no plan is refused (no plan is chosen);
  - more than one declared plan uses the lowest-threshold plan until an SL1 (HMRC rule).

  The explanation names the source.
- **Corrections of closed runs** (`PayrollDeductionAdjustment`):
  - maker/checker (the approver is not the proposer), with the original and corrected amounts kept;
  - one live correction per run, kind and employee;
  - refunds only: an under-deduction is refused as needing HMRC or employer intervention;
  - applied once, in the next run of the same tax year (claimed by that run), shown on the payslip, posted to YTD; closed runs are never rewritten.
- **Payslip and FPS:** the payslip PDF shows student and postgraduate loan YTD. The FPS data builder now carries plan, period and YTD amounts, and flags an issue (the year's history is incomplete) when a run of the year predates loans.

## 2. Pension: implemented
- **Automatic enrolment assessment** on every tax and NI calculation:
  - categories: eligible jobholder, non-eligible jobholder, entitled worker, not in scope, review required;
  - inputs: 2026–27 trigger and qualifying earnings by pay frequency, age on the pay date, State Pension age (derived, or recorded for transitional births), and UK-worker evidence;
  - the result is stored on the run row and in `EmployeePensionAe`, with the automatic enrolment date, a six-week deadline, and postponement or overdue notes;
  - it never blocks payroll, enrols or exempts anyone.
- **Events** (`/pension-ae/events`):
  - postponement (at most 3 months, notice within 6 weeks);
  - enrolment information given;
  - opt-in and joining requests;
  - opt-out (only within the opt-out period: it sets `OPTED_OUT`, stops contributions, sends open runs back for recalculation and proposes employee refunds and employer reversals for approval);
  - ceasing membership (no refund);
  - re-enrolment date.

  Each event is audited.
- **Other frequencies:** qualifying earnings for weekly, fortnightly and four-weekly pay. Monthly relief at source is unchanged.
- **Contribution file:** a provider-independent export (CSV) and reconciliation per run, from the stored figures, on the run detail page. A scheme reference snapshot is kept on each run row.
- **Payslip:** pension YTD (employee and employer) and pension correction lines.

## 3. Files
- **Backend:** `prisma/schema.prisma`; new `payroll-loan-pension.service.ts` and `.controller.ts`; `payroll-runs.service.ts`, `payroll-statutory.util.ts`, `uk-deduction-elections.util.ts`, `payroll-payslip.util.ts`, `payroll-payslip-pdf.util.ts`, `payroll-fps.util.ts`, the payslip and FPS types, the profile DTO, service and mapper, `payroll.module.ts`, `audit-action.enum.ts`.
- **Frontend:** new `LoanDeclarationSection`, `PensionAutoEnrolmentSection`, `PayrollCorrectionsSection`, `PensionContributionsPanel`; `PayrollEmployeesPage`, `UkPayrollRunDetailPage`, `WorkplacePensionSection`; the API, hooks, keys and types; mocks added to the C9 page test.

## 4. Migration
`20261028100000_loan_pension_completion`: additive columns and two new empty tables. It was not applied or rehearsed anywhere.

## 5. Commits
Backend `28e668b` (this report in the next commit), frontend `01dba6c`.

## 6. Blocked by missing client policy
- Net Pay Arrangement, salary sacrifice, AVCs and any basis other than qualifying earnings: these need approved scheme rules and their tax and NI treatment. They are still refused.
- Allfor Care's actual scheme, its rates and postponement policy.
- The employer's duties start date (for the re-enrolment cycle).

## 7. Not finished
- **No statutory communications:** their content and sending are not built; only the dates are tracked.
- **No automatic enrolment action:** the assessment does not create an enrolment.
- **Refund timing:** the one-month deadline is not enforced.
- **Corrections across tax years** stay unapplied and are only listed.
- **No FPS XML mapping:** only the internal data builder carries the loan fields.
- **No screen for some new data:** corrections are not on the payslip list, and loans for directors are still refused.
- The opt-out / ceased statuses are not selectable on the C17 pension form (shown as labels).
- AE earnings use the run's gross pay.

## 8. Statement
**Automated tests not run — implementation unverified.**

Each repository had one type-check:
- the backend's one error was fixed;
- the frontend's seven errors, all from the same cause, were fixed.

Neither was re-run.
