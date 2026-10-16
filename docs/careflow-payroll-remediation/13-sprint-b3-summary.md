# 13 — Sprint B3 Summary: Minimum Wage and Financial Safety

**Date:** 2026-10-13 · **Branch (both repositories):** `payroll-remediation/sprint-b3`, on top of `payroll-remediation/gate-b2`

Nothing was pushed, deployed, run against live data, sent to HMRC or paid. All data in tests is synthetic. This sprint does not make CareFlow a complete UK payroll product: tax and NI in these tests are stand-ins.

Statuses: **DONE** · **PARTIAL** · **POLICY BLOCKED** · **NOT STARTED**.

---

## 1. Tasks completed

| Task | Status | What changed |
|---|---|---|
| 1. Prevent unauthorised negative wage recoveries | **DONE** (API; the approval has no screen yet) | An overpayment found by a calculation is no longer deducted by itself. It becomes a `WageRecovery`: kind, reason, the original payment, amount, status. It is shown on the run (a held line on a visit pay run; a £0.00 line marked `RECOVERY_NOT_AUTHORISED` on a UK run) and nothing is deducted. A user with `billing.payroll_runs.approve`, other than the one whose calculation proposed it, authorises it and records the authority for the deduction, or rejects it (written off). An authorised recovery is deducted by the next calculation with the same unique claim as before, and marked applied when the run is locked or closed |
| 2. Minimum wage for salaried-hours employees | **DONE** for the single pay period; **PARTIAL** for excess hours over the year | The UK payroll run that pays a period's salary assesses it and records the result in `NmwPeriodAssessment`. A certain shortfall is topped up once. What a single period cannot decide is not declared compliant: it is recorded, shown, and stops the run closing until a second person reviews it |
| 3. Valid pay reference periods and UK time boundaries | **DONE** | A period longer than a month is never used; a missing or invalid payroll schedule is recorded on the assessment and shown with the run; UK payroll decides pay period, week and agreement by the date in the United Kingdom |

### Task 1 in detail

Covered: salary lowered for a period already paid (UK run); guaranteed-hours top-up overtaken by a late visit; overtime of a week whose hours fell; minimum wage top-up overtaken by later pay in the period (visit pay runs).

- **Idempotent.** The recovery's key is the claim the deduction line would carry (for example `GUARANTEE:<employee>:<week>:2`), so one settlement has one recovery. Calculating again, a second run, or a later period does not create another, and an applied recovery is never deducted again.
- **A decision is for an amount.** If the overpayment changes after it was approved or rejected, it goes back to "proposed" and nothing is deducted.
- **Withdrawn** when the calculation that proposed it no longer finds an overpayment.
- **Locked history is untouched.** Nothing is written to a locked or closed run; the deduction, when authorised, is a new line in an open run.
- **A run can still be locked or closed** with a proposal unresolved: the employee is simply not charged. The proposal is shown again on each later run that touches the same week or period, and is listed at `GET /billing/wage-recoveries`.
- **Positive backpay is unchanged.**
- Not changed, because they are already entered and approved by people: pay corrections, mileage corrections and salary deductions (fines). They do not yet record the authority for a deduction (see section 7).

### Task 2 in detail

Method, checked against GOV.UK "Calculating the minimum wage" (read 2026-10-13): basic hours for the year are divided by the number of payments in the year (12, 13, 26 or 52). The system takes the agreement's contracted weekly hours × 52 as the basic annual hours; a part of a period (starter, leaver, change of agreement) carries its share by days.

- **Pay that counts:** the salary parts of the period, pay for hours paid on top, bonuses and adjustments, less deductions. Not counted: reimbursements, salary adjustments of other periods, holiday and sick pay, pay for time not worked, the overtime premium.
- **Hours:** basic hours of the period plus hours paid on top of the salary.
- **Rate:** by age at the start of the period and apprentice status, as for hourly workers. Rates in the code were checked against GOV.UK: £12.71 (21 and over), £10.85 (18 to 20), £8.00 (under 18 and apprentice) from 1 April 2026; £12.21 / £10.00 / £7.55 before.
- **Below the rate on those hours:** topped up by the difference, once (claim `NMW_SALARY:<employee>:<period>`).
- **More hours worked than paid for:** the guidance counts extra unpaid hours only once the basic hours for the year are exceeded, which one period cannot show. If counting them would put the worker below the rate, the assessment is `EXCESS_HOURS_NOT_VERIFIED`, `compliant` is empty, the possible shortfall is recorded, nothing is paid on a guess, and the run cannot be closed until reviewed.
- **No contracted hours on the agreement:** `BASIC_HOURS_NOT_RECORDED`, same treatment.
- **Review:** `POST /payroll/runs/:id/nmw-assessments/:assessmentId/review` with a reason, by a user with `payroll.runs.close` who did not create the run. Recalculating gross replaces the assessment and clears the review.
- **Supplementary run:** the period is assessed by the run that paid its salary; a later run of the same period makes no second assessment or top-up.
- The visit pay run no longer records a salaried worker as compliant: it records that the assessment is made in the UK run.
- The unused `salariedHoursCheck` helper is replaced by `basicHoursOfPeriod` and `assessSalariedHours` (same formula, with part periods, hours paid on top and excess hours) and has been removed.

### Task 3 in detail

- **Length:** a pay reference period is a month or less. A visit pay run longer than a month with no schedule, or a schedule period longer than a month, is assessed by calendar month instead.
- **Missing schedule:** the run's own dates are still used when they are a month or less, so the worker stays protected, and the assessment carries `NO_PAYROLL_SCHEDULE`. Those assessments are returned with the run (`nmwExceptions`) and listed on the pay run dialog. They do not change the run's status or stop it being locked.
- **UK dates:** UK payroll collected approved visits, chose the pay agreement and counted contracted-hours weeks by the UTC date. They now use the date in the United Kingdom (`Europe/London`). Attendance timestamps are stored and compared as before; only the question "which day is this" changed.

---

## 2. Files changed

Backend (`careadmin-backend`):

| File | Change |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261019100000_wage_recoveries_and_salaried_nmw/` | New table and columns (section 5) |
| `src/billing/wage-recovery.store.ts` (new) | Propose, re-propose, withdraw, apply |
| `src/billing/wage-recoveries.service.ts`, `wage-recoveries.controller.ts` (new) | List, approve, reject |
| `src/billing/payroll-runs.service.ts` | Recoveries for overtime, guarantee and minimum wage; assessment issues; `nmwExceptions` on the run; schedule period lookup margin |
| `src/billing/nmw-period.util.ts` (+ spec) | One-month rule, calendar-month fallback, salaried assessment, issue list |
| `src/payroll/payroll-runs.service.ts`, `payroll-runs.controller.ts`, `dto/payroll.dto.ts` | Salary recovery; salaried minimum wage; close check; review; UK dates |
| `src/payroll/salary.util.ts` | Salary parts carry days and contracted hours; cover by civil day |
| `src/billing/billing.module.ts`, `src/audit-logs/enums/audit-action.enum.ts` | Wiring; three audit actions |
| `scripts/payroll-migration-rehearsal.mjs` | One check |
| `test/payroll-int/wage-recoveries.int-spec.ts`, `salaried-nmw.int-spec.ts`, `pay-reference-periods.int-spec.ts` (new) | Section 4 |
| `test/payroll-int/salary-gross`, `guaranteed-hours`, `nmw-reference-period`, `e2e-gate-a`, `e2e-gate-b2`, `harness.ts` | Three tests now expect a proposal instead of an automatic deduction; synthetic salary agreements were given contracted hours |

Frontend (`care-admin`): `PayrollRunAttentionList.tsx` (+ test), `PayrollRunDetailDialog.tsx`, `api/payroll-runs.api.ts` — the pay run dialog lists minimum wage assessments that need attention.

---

## 3. Commits

| Repository | SHA | Subject |
|---|---|---|
| backend | `4c86fc3` | B3 Task 1: overpayments are proposed for recovery and deducted only once authorised |
| backend | `bcf1a01` | B3 Tasks 2 and 3: salaried minimum wage; pay reference period of a month or less; UK civil dates |
| backend | the commit after it | This report, the tracking updates, and removal of the superseded helper |
| frontend | `4268127` | Pay run dialog shows minimum wage assessments that need attention |

---

## 4. Tests

Final consolidated run on the code of this sprint:

| Suite | Command | Result |
|---|---|---|
| Payroll integration (PostgreSQL test database, real controllers and guards) | `npm run payroll-test-db` then `npx jest --config ./test/jest-payroll-int.json` | **41 suites, 416 tests, all pass** (38 suites and 385 tests at the end of Gate B2) |
| Unit: billing, payroll, guards, responsibilities | `npx jest src/billing src/payroll src/common/guards src/role-responsibilities` | **59 suites, 467 tests, all pass** |
| Migration rehearsal (the schema changed) | `npm run payroll-migration-rehearsal` | **59 of 59 checks pass** |
| Frontend, billing | `npx vitest run src/features/billing` (in `care-admin`) | 9 files, 50 tests, all pass |
| Type checks | `npx tsc --noEmit -p tsconfig.build.json`; `npx tsc --noEmit -p tsconfig.json` | Clean |

Not run, as the brief asks: the whole-repository suites (their known failures outside this programme are unchanged), browser tests.

New tests:

| File | Tests | Brief's list |
|---|---|---|
| `wage-recoveries.int-spec.ts` | 10 | Negative salary correction; guaranteed-hours overpayment; duplicate recovery attempt; approved authorised recovery; unapproved recovery excluded from payable payroll; recovery after closed payroll; positive backpay unaffected — plus rejection, a changed amount, withdrawal, and the close check |
| `salaried-nmw.int-spec.ts` | 11 | Above the rate; below the rate; starter and leaver; salary change in the period; additional qualifying hours; validated top-up and unresolved exception; supplementary payroll without a second assessment — plus age band, missing basic hours, review permissions, hourly worker unchanged |
| `pay-reference-periods.int-spec.ts` | 10 | Weekly worker; monthly worker; missing schedule; period over a month; visit near midnight in British Summer Time (four cases); period crossing a month end and the tax year end |
| `nmw-period.util.spec.ts` | 22 (was 16; the two tests of the superseded helper were removed with it) | One-month rule, calendar month, basic hours, salaried assessment |
| `PayrollRunAttentionList.test.tsx` | 4 (was 2) | Exceptions shown |

Existing financial-claim and locked-history suites (`duplicate-claims`, `locked-history`, `uk-cancellation`, `uk-provisional`, `pay-corrections`, `e2e-gate-a`, `e2e-gate-b2`) are part of the integration run above.

---

## 5. Database changes

One migration, `20261019100000_wage_recoveries_and_salaried_nmw`, applied to the local development and test databases only:

- New table `billing.WageRecovery` (empty).
- `billing.NmwPeriodAssessment`: new nullable columns `ukPayrollRunId`, `issue`, `shortfall`, `resolvedById`, `resolvedAt`, `resolutionNote`; a unique index on (`ukPayrollRunId`, `employeeId`, `periodStart`); `payrollRunId` and `compliant` become nullable (an assessment can belong to a UK run, and "not assessed" is no longer stored as compliant). No stored value changes.

No existing row is changed, and no recovery is created for history.

---

## 6. Remaining business decisions

| Decision | Why |
|---|---|
| **Authority to recover overpayments** (D-23, widened). On what basis may Allfor Care deduct an overpayment from wages: a contract clause, written agreement, or only the statutory overpayment exception? Who may authorise it, and is there a value or time limit? | The system now requires an authority to be stated but cannot judge it. Status: **POLICY BLOCKED** for real use |
| **Basic hours of salaried staff.** Are contracted weekly hours × 52 the basic annual hours in the contracts, or is another figure stated (the guidance allows 52.18, or a stated annual total)? | Every salaried assessment rests on it |
| **Excess hours.** Should hours worked beyond the basic hours be tracked against the year, so the system can decide instead of asking for a review each period? | Today each such period needs a person |
| **Who reviews minimum wage exceptions** (and D-01, named approvers, still open). | Nobody holds the powers on the development system |
| **Pay reference period for workers with no payroll schedule.** | They are assessed on the run's dates and flagged |

---

## 7. Outstanding risks

1. **No screen** for authorising wage recoveries or reviewing minimum wage exceptions on the UK run: both are API-only. A proposal is visible on the run; the decision is not yet reachable by an office user without the API.
2. **Existing salaried agreements with no contracted hours** will stop a UK run closing until the hours are recorded or the exception is reviewed. That is intended, and will be noticed immediately on first use.
3. **Excess hours are judged per period**, conservatively. A worker whose year has in fact exceeded the basic hours is flagged for review, not paid automatically.
4. **Premium inside visit pay** still counts as pay for hourly workers (unchanged from Gate B2, D-29).
5. **Corrections, mileage corrections and fines entered by people** can still be negative with a second approver but without a recorded authority for the deduction.
6. **A proposal left undecided** is re-shown on each later run that touches the same week or period, with no ageing or escalation.
7. **Leave calculations** (Gate B2) still read the UTC date of a visit; not changed here because it is outside the three tasks.
8. Found and fixed in this sprint, both introduced in Gate B2: the UK close check for lines that no longer hold their claim counted nothing (a "not equal" filter leaves out empty values), and the pay period of a visit at 00:30 in summer time could be missed. Each has a regression test. They are stated here because both were in code reported as tested.

---

## 8. Next recommended small sprint

**B4 — make B3 usable and close the last minimum wage gaps**, in this order:

1. A "Wage recoveries" screen: list, authorise with the authority stated, reject.
2. On the UK run page: the minimum wage assessments, the reason a run cannot be closed, and the review action.
3. Deductions (fines, penalties) tested against the minimum wage before they are taken, and an authority recorded for negative corrections.
4. Year-to-date basic hours for salaried staff, so excess hours can be decided rather than reviewed.
5. Basic pay and premium kept apart inside a visit's amount (D-29).

Holiday pay, PAYE, pensions, student loans and HMRC were not started and are not part of this sprint.
