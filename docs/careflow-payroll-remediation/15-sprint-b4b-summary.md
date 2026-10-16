# 15 — Sprint B4B Summary: Audit Crash Fix and Salaried Annual Hours

**Date:** 2026-10-13 · **Branch:** `payroll-remediation/sprint-b4b` (on `sprint-b4a`) · Nothing pushed, deployed, sent to HMRC or paid. All test data is synthetic. CareFlow is not yet a complete UK payroll product.

## 1. What was fixed

**Task 1 — audit log crash: DONE.** Cause: when a signed-in user's socket closed, the notifications gateway wrote an audit entry that nothing awaited. For a deleted user the foreign key failed, and Node ends the process on an unhandled rejection.

- A failed audit write is now logged and answered with a controlled error: 401 when the user no longer exists, otherwise 500. It is never skipped and no user is made up.
- A deleted or inactive user is refused (401) before anything runs (existing sign-in check, now tested).
- **Saved together or not at all:** UK payroll run create, enrol, gross, tax and NI, close, reactivate, delete-all; minimum wage review; recovery policy withdrawal; rejection of a disruption pay decision. Visit pay runs and payouts already worked this way.
- `main.ts` logs any other unhandled rejection instead of letting it stop the API.

**Task 2 — annual excess hours: DONE as infrastructure; real use is blocked on one approval (section 5).**

- Basic hours no longer assume 52 weeks. The multiplier comes from an annualisation method that one user enters and another approves. Contracted weekly hours stay the contract's only figure; no annual-hours field was added.
- **No approved method → `POLICY_REVIEW_REQUIRED`:** no compliance is claimed, no top-up is made, and the run cannot close without a review.
- With a method, the UK run works out the calculation year, its basic hours, the hours worked in it so far, and the excess. Within the basic hours a busy month is compliant and needs no review. Once they are exceeded, the excess hours must be paid and a shortfall is topped up under the existing one-per-period claim.
- **No duplicates:** each source of time counts once however many runs show it; excess already counted is not counted again, and excess that arrived late is picked up by the next assessment. Cancelled runs are ignored. Closed runs are never rewritten.

## 2. Files changed and commits (backend only; no frontend change)

| Commit | What |
|---|---|
| `641f2dc` | Task 1: `audit-logs.service.ts`, `notifications.gateway.ts`, `main.ts`, `payroll/payroll-runs.service.ts`, `billing/wage-recoveries.service.ts`, `billing/visit-disruptions.service.ts`; test `audit-integrity.int-spec.ts` |
| `a168b2b` | Task 2: schema + migration, `billing/nmw-period.util.ts` (+ spec), `payroll/payroll-runs.service.ts`, `payroll-settings.service.ts` / `.controller.ts`, `dto/payroll.dto.ts`, audit actions; tests `salaried-annual-hours.int-spec.ts`, `salaried-nmw.int-spec.ts`, harness, browser fixture, rehearsal script |
| this commit | This report |

New API, no screen: `GET/POST /payroll/salaried-hours-methods`, `POST …/:id/approve`, `POST …/:id/withdraw`. Entering needs `payroll.settings.manage`; approving and withdrawing need `payroll.pay_agreements.approve`, by a different user.

## 3. Tests

| Run | Result |
|---|---|
| Payroll integration suite, once at the end | **43 suites, 438 tests: all passed** |
| Backend unit (billing, payroll, guards, role-responsibilities, audit-logs, notifications) | 64 suites, 497 passed |
| Backend type-check | Clean |
| Migration rehearsal | 61 of 61 checks |

Whole-repository suites and browser checks were not run (no screen changed).

- **Task 1 (6 tests):** valid audit; deleted user's session refused; user gone between sign-in and the change → 401 and full rollback; audit table failure on close → 500, nothing of the close remains, the next request works; the socket case, which fails against the old gateway and passes with the fix.
- **Task 2 (9 integration, 11 unit):** 35 weekly hours; within annual hours; exceeded with top-up that month and the next; supplementary run; cancelled run; weekly hours changed mid-year; leaver; missing, unapproved and withdrawn method; closed month unchanged.
- **HMRC's examples are reproduced in unit tests** (GOV.UK "Working hours for which the minimum wage must be paid", updated 6 January 2026): 1,920 ÷ 12 = 160 h; 1,400 ÷ 52 = 26.92 h; excess month 226.5 h → £2,265.00; next month 340 h → further £1,700; leaver 300 h → £3,663; contract change 1,196 + 786 = 1,982 h.
- Four B4A tests that used the old "excess hours not verified" exception now use the missing-method case.

## 4. Database migration

`20261021100000_salaried_annual_hours`, additive: new empty table `payroll.SalariedHoursAnnualisation`, and six nullable columns on `billing.NmwPeriodAssessment` for the year's figures. No existing row is changed. Applied to the local development and test databases only.

## 5. Annual-hours method and its configuration status

- **Calculation year:** from the start of the salaried contract, by HMRC's rules for monthly pay (from the 1st, or from mid-month) and for weekly, fortnightly and four-weekly pay.
- **Basic hours:** contracted weekly hours × the method's weeks, by days ÷ 365 across agreements; per period, the year ÷ pay periods.
- **Excess:** in the period the basic hours are exceeded, basic hours by days plus the excess; afterwards, ordinary basic hours plus all hours worked. A leaver is measured against the basic hours of the periods employed.
- **Status: NOT CONFIGURED.** No method exists in any real database and the migration creates none. Tests use a row marked synthetic (weekly hours × 52), which the API cannot create.
- **Approval missing:** Allfor Care's multiplier (for example 52, 52.14 or 52.18), where it is written down, and the date it applies from.

## 6. Remaining policy blockers and gaps

1. **Contract start date.** The year runs from the first salaried agreement on record (or the employment start date if later). For staff salaried before their first CareFlow agreement, that date must be the true contract start.
2. **Paid absence is not counted yet.** HMRC counts absence paid at full salary as hours worked; only time collected by UK runs counts here (visits, travel, waiting, non-visit activity).
3. **A late visit wholly covered by the salary**, in a supplementary run with nothing else payable, is refused by that run (existing behaviour), so its hours are not counted.
4. **A shortfall a reviewer confirmed while no method existed** is replaced by the calculation once a method is approved; the assessment says so and the audit entry stays.
5. **Audit entries still written after the change:** visit approval decisions, payroll settings, employee payroll profiles, leave, disruption rules, HMRC submissions. A failure there now returns a controlled error but does not undo the change.

## 7. Next small sprint

**B4C:** a settings screen to enter and approve the method, the year position shown in the Minimum wage compliance section, and paid-absence hours counted in the year (needs the client's answer on how leave hours are recorded). Second choice: move the audit entries of gap 5 into their transactions.
