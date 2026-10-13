# 15 — Sprint B4B Summary: Audit Crash Fix and Salaried Annual Hours

**Date:** 2026-10-13 · **Branch:** `payroll-remediation/sprint-b4b` (on `sprint-b4a`) · Nothing pushed, deployed, sent to HMRC or paid. All test data is synthetic. This does not make CareFlow a complete UK payroll product.

## 1. What was fixed

**Task 1 — audit log crash: DONE.** Cause: when the socket of a signed-in user closed, the notifications gateway wrote an audit entry that nothing awaited. For a deleted user the foreign key failed, and Node ends the process on an unhandled rejection.

- The write is now handled. A failed audit write is logged as an error and answered with a controlled error: 401 "Your account is no longer active" when the user no longer exists, otherwise 500. It is never skipped and no user is made up.
- The actor is checked on every request before anything runs (existing sign-in check; now tested): a deleted or inactive user gets 401 and nothing changes.
- **Saved together or not at all:** UK payroll run create, enrol, gross, tax and NI, close, reactivate and delete-all; minimum wage review; recovery policy withdrawal; rejection of a disruption pay decision. Visit pay runs and payouts already worked this way.
- `main.ts` logs any other unhandled rejection instead of letting it stop the API.

**Task 2 — annual excess hours: DONE as infrastructure; real use is blocked on one approval (section 5).**

- The basic hours of a pay period no longer assume 52 weeks. The multiplier comes from an annualisation method that one user enters and another approves. Contracted weekly hours stay the contract's only figure; no annual-hours field was added.
- **No approved method → `POLICY_REVIEW_REQUIRED`:** no compliance is claimed, no top-up is made, and the run cannot close without a review.
- With a method, the UK run records for each salaried employee: the calculation year, its basic hours, hours worked in the year before the period, and excess hours counted.
- Within the year's basic hours, a month with extra hours is compliant and needs no review (B3 flagged every such month). From the period in which they are exceeded, excess hours are added to the hours the pay must cover and a shortfall is topped up, using the existing one-per-period claim.
- **No duplicates:** each source of time (claim, visit or pay line) counts once however many runs show it; excess hours already counted by an earlier assessment are not counted again, and excess that arrived late is picked up by the next assessment. Cancelled runs are ignored. Closed runs are never rewritten.

## 2. Files changed and commits (backend only; no frontend change)

| Commit | What |
|---|---|
| `641f2dc` | Task 1: `audit-logs.service.ts`, `notifications.gateway.ts`, `main.ts`, `payroll/payroll-runs.service.ts`, `billing/wage-recoveries.service.ts`, `billing/visit-disruptions.service.ts`, test `audit-integrity.int-spec.ts` |
| `a168b2b` | Task 2: `prisma/schema.prisma` + migration, `billing/nmw-period.util.ts` (+ spec), `payroll/payroll-runs.service.ts`, `payroll-settings.service.ts` / `.controller.ts`, `dto/payroll.dto.ts`, audit actions, tests `salaried-annual-hours.int-spec.ts`, `salaried-nmw.int-spec.ts`, `harness.ts`, browser fixture, rehearsal script |
| this commit | This report |

New API (no screen): `GET/POST /payroll/salaried-hours-methods`, `POST …/:id/approve`, `POST …/:id/withdraw`. Enter needs `payroll.settings.manage`; approve and withdraw need `payroll.pay_agreements.approve`, and the approver must be a different user.

## 3. Tests

| Run | Result |
|---|---|
| Payroll integration suite, once at the end | **43 suites, 438 tests passed, 0 failed** |
| Backend unit (billing, payroll, guards, role-responsibilities, audit-logs, notifications) | 64 suites, 497 passed |
| Backend type-check | Clean |
| Migration rehearsal | 61 of 61 checks (one added: no method is created by the migrations) |

Whole-repository suites and browser checks were not run (no screen changed).

- **Task 1** (6 tests): valid audit; deleted user's session refused; user gone between sign-in and the change → 401 and full rollback; audit table failure on close → 500, nothing of the close remains, the next request works; review not saved without its entry; the socket case. The socket test fails against the old gateway and passes with the fix.
- **Task 2** (9 integration, 11 unit): 35 weekly hours with the synthetic method; within annual hours; exceeded with top-up in that month and the next; new year resets; supplementary run; cancelled run; weekly hours changed mid-year; leaver; missing, unapproved and withdrawn method; locked month unchanged.
- **HMRC examples reproduced in unit tests** (GOV.UK "Working hours for which the minimum wage must be paid", updated 6 January 2026): 1,920 ÷ 12 = 160 h; 1,400 ÷ 52 = 26.92 h; excess month 55.9 + 100.6 + 70 = 226.5 h → £2,265.00; next month 340 h → further £1,700; leaver 170 + 130 = 300 h → £3,663; contract change 1,196 + 786 = 1,982 h and 1,196 + 479 + 291.
- Four B4A tests that relied on the old "excess hours not verified" exception now use the missing-method case.

## 4. Database migration

`20261021100000_salaried_annual_hours`, additive: new empty table `payroll.SalariedHoursAnnualisation`; six nullable columns on `billing.NmwPeriodAssessment` (calculation year start and end, weeks per year, annual basic minutes, year minutes before, excess minutes). No existing row is changed. Applied to the local development and test databases only.

## 5. Annual-hours method and its configuration status

- **Calculation year:** from the start of the salaried contract. Monthly from the 1st: that date each year. Monthly from another day: to the end of the same month a year later, then from the 1st. Weekly, fortnightly, four-weekly: each anniversary.
- **Basic hours of the year:** contracted weekly hours × weeks of the approved method, by days ÷ 365 across agreements. Per period: year ÷ pay periods.
- **Exceeding period:** basic hours by days plus the excess hours. Later periods: ordinary basic hours plus all hours worked. Leaver: compared with the basic hours of the pay periods employed.
- **Status: NOT CONFIGURED.** No method exists in any real database and none is created by the migration. Tests use a row marked synthetic (weekly hours × 52), which the API cannot create.
- **Exact approval missing:** Allfor Care's multiplier for turning weekly hours into a year (for example 52, 52.14 or 52.18), where it is written down, and the date it applies from; entered by one authorised user and approved by another.

## 6. Remaining policy blockers and gaps

1. **Contract start date.** The calculation year is taken from the first salaried agreement on record (or the employment start date if later). For staff salaried before their first CareFlow agreement, that date must be the true contract start, or the year is wrong.
2. **Paid absence does not count yet.** HMRC counts absence paid at full salary (holiday, sickness) as hours worked. Only time collected by UK runs counts: visits, travel, waiting, non-visit activity. Year totals are understated for staff with paid leave.
3. **A late visit wholly covered by the salary**, in a supplementary run with nothing else payable, is refused by that run (existing behaviour), so its hours reach no run and are not counted.
4. **A shortfall confirmed by a reviewer while no method existed** is replaced by the calculation once a method is approved. The assessment says so and the audit entry stays.
5. **Audit entries still written after the change, not with it:** visit approval decisions, payroll settings, employee payroll profiles, leave, disruption rules, HMRC submissions. A failure there now returns a controlled error but does not undo the change.
6. No screen for the method; the compliance section shows the result only through the assessment's text.

## 7. Next small sprint

**B4C — make the method usable and finish the year's hours:** a small settings screen to enter and approve the annualisation method; the year position shown in the Minimum wage compliance section; paid-absence hours counted in the year (gap 2), which needs the client's answer on how leave hours are recorded. Second choice: move the remaining audit entries of gap 5 into their transactions.
