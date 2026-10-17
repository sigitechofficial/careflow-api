# 12 — Gate B2 Summary: Employment Wages, Salary Calculations and Payroll Compliance Foundations

**Phase:** Gate B2 · **Dates:** 2026-10-13 · **Branch (both repositories):** `payroll-remediation/gate-b2`, on top of `payroll-remediation/gate-b`

Nothing was pushed, deployed, run against live data, sent to HMRC or paid. Every commit is local. The development database received additive migrations only (new nullable columns, new tables, one new enum value); no existing row was changed. All people, rates, agreements and rules used in tests are synthetic.

**CareFlow is not a complete UK payroll product.** This phase makes carer and employee gross earnings more correct and more traceable. Tax, National Insurance, pensions, statutory payments and RTI are a separate phase with its own compliance tests, and the tax and NI figures in the tests here are stand-ins.

Status words used in this document:

- **DONE** — built, reachable by the user it is for, and covered by passing tests.
- **TESTED** — the tests that cover it, by kind.
- **PARTIAL** — part built; what is missing is listed.
- **POLICY BLOCKED** — the foundation works with synthetic policy, but real use waits for a client decision. Label: *IMPLEMENTED FOUNDATION — TESTED WITH SYNTHETIC POLICY — CLIENT APPROVAL PENDING*.
- **NOT STARTED** — nothing built.

---

## 0. Status at a glance

| Stage | Item | Audit / decision | Built | Tested | Real use |
|---|---|---|---|---|---|
| 1 | Non-visit earnings that cannot be worked out are held and shown | R-22, VW-03 | DONE | unit, http (8), ui (2) | Ready |
| 1 | Incomplete bank holiday calendars hold carer pay | R-27, PC-24 | DONE | unit (17), http (9) | Ready; calendars for Scotland, NI and 2027 on are still empty on the development system |
| 1 | Mileage: split shown on the UK run, correction of settled mileage, release of earlier unpaid mileage | D-15, D-20, D-21 | DONE | http (7), ui (4) | POLICY BLOCKED on D-15 (rates not verified) and D-20 (which earlier amounts to pay) |
| 2 | Salary agreements: entry, effective dates, proration, approval, history | WM-02, WM-03 | DONE | unit (20), http (9), ui (8), browser | POLICY BLOCKED (Q22) |
| 2 | A salaried employee is not paid visit wages again for work the salary covers | WM-09 | DONE | int (21), e2e | POLICY BLOCKED (Q22) |
| 2 | Salary adjustment and backpay after a run is closed | WM-09 | DONE | int | POLICY BLOCKED (Q22, D-23) |
| 3 | Guaranteed hours top-up | WM-07, EL-01 | DONE | unit (4), http (13), ui (2), e2e | POLICY BLOCKED (Q23) |
| 3 | Weekly overtime across pay runs | WM-18 | DONE | unit, http (7), e2e | Ready for cards that already carry an overtime rule; rule itself POLICY BLOCKED (Q29) |
| 3 | Daily overtime | WM-18 | NOT STARTED | — | Needs Q29 |
| 4 | Travel-time intervals: categories, evidence, approval | TR-01, TR-04, TR-05, TR-06 | DONE | unit (5), http (7), ui (6), browser | Ready as an override; making it the default is POLICY BLOCKED (Q32) |
| 4 | Cancellations, no access, emergency care: rules and pay decisions | Q13 | DONE | unit (5), http (8), ui (4), e2e, browser | POLICY BLOCKED: no rule exists until the client supplies them |
| 5 | Holiday entitlement and holiday pay foundations | Q35 | PARTIAL (API and calculation; no screens; leave is not booked from the rota or paid automatically) | unit (14), http (11), e2e | POLICY BLOCKED (Q35) |
| 5 | Minimum wage on the pay reference period; apprentices; excluded earnings | Q37–Q39 | DONE for time work | unit (16), http (11), e2e | Ready; open points under D-29 |
| 5 | Minimum wage for salaried-hours work; deductions against the rate | Q37–Q39 | PARTIAL (function and record only) | unit (2) | Not assessed on the UK run |
| 6 | Policy decision register | — | DONE | — | `05-policy-decisions-required.md` sections 2b and 2c |
| 7 | Fifteen validations, end to end | — | DONE | `e2e-gate-b2` (10 steps) and the suites in section 5 | — |

---

## 1. Features completed

### Stage 1 — remaining high-risk earnings gaps

- **R-22.** A training activity, on-call period, pay item, overtime premium or rolled-up holiday amount that cannot be worked out becomes a line on the pay run with amount 0.00, no claim, the worker, the source and the reason. Recalculating is the retry. A held activity of a locked period is picked up by later runs. Where the amount could never be carried (overtime, rolled-up holiday when the card cannot be read) the run cannot be locked until it is resolved. A list of everything held, with its state, is at `GET /billing/payroll-runs/held-earnings`.
- **R-27.** The system knows which days are normally bank holidays in each nation (never used to price). A visit on such a day, on a card that pays more for bank holidays, with no calendar entry for it, is held with the day named and what to do. The client charge is unaffected. Visits approved before the check are held at the pay run instead. Data: the GOV.UK lists for England and Wales 2019–2028 and Scotland and Northern Ireland 2025–2028 are kept as a test fixture.
- **Mileage.** The UK run shows, per employee: taxable wages, reimbursement within the approved amount, taxable excess, reimbursement not verified, net wages, total payable. A settled visit's miles are corrected as mileage with its own tax split (second approver; paid or recovered in the next run). Expenses of UK runs calculated before reimbursements were paid through payouts can be released one employee and run at a time, with a reason, by a user with the payout approval power.

### Stage 2 — salary and employment agreements

- Salary entered per year, month or week; the yearly figure is stored.
- Each agreement states how a part period is paid (equal pay periods with part periods by calendar days; the same by Monday-to-Friday days; or calendar days of a 365.25-day year) and what the salary pays for (all visit work; visit work up to the contracted weekly hours; other duties only).
- Agreements are effective-dated. The agreement in force on a day is the one with the latest start on or before it. A period with a starter, a leaver, an increase or a decrease is paid in parts, each with its own claim.
- An agreement that carries or replaces a salary takes effect only when a second person approves it (`payroll.pay_agreements.approve`, granted by name, never implied by an administrator role). Pay terms in effect are not edited: the agreement is ended and a new one added.
- In UK gross, earnings the salary covers come in at 0.00 with their value recorded and are settled by the run. Hours beyond the contracted hours are paid. Approved pay items and expenses are always paid as well.
- A salary agreement approved after a period was paid produces one salary adjustment in the next run, or in a supplementary run of the same period. The closed run is not touched.

### Stage 3 — guaranteed hours and overtime

- **Guaranteed hours.** Stated on the pay agreement and paid only when the agreement says the shortfall is paid and a second person approved it. The Monday-to-Sunday week is settled by the run in which it ends. A late-approved visit reduces a top-up already paid.
- **Overtime.** The hours of a week are every pay-approved visit of that week, whichever run it is in. The premium due, less what locked runs already paid, is paid by the run. Identity `OVERTIME:<employee>:<week>:<n>`.

### Stage 4 — travel time, cancellations and disruptions

- **Travel time.** A person records what a stretch of time before a visit was; a second person approves; approved intervals decide travel and waiting pay and minimum wage hours for that visit. Otherwise the earlier estimate applies, now labelled as an estimate.
- **Disrupted visits.** Rules per event and notice (none exist until the client supplies them); a pay decision per carer and event; a list of cancelled visits with a carer allocated and no decision.

### Stage 5 — holiday and minimum wage

- **Holiday.** Leave terms per employee, entitlement by worker category, balance, 52-week holiday pay rate, leaver position, and rolled-up holiday pay held for workers it cannot lawfully be used for.
- **Minimum wage.** Assessed over the worker's payroll schedule period, across runs, with one top-up identity per period; age and rate at the start of the period; the apprentice rate only under 19 or in the first year.

---

## 2. Confirmed defects fixed

Each was reproduced by a test that failed before the change, or was read directly from the code path and then covered by a test.

| # | Defect | Effect before | Fixed in |
|---|---|---|---|
| V-22 | A visit whose pay-run line was an exception (£0.00) was claimed and marked as included when the run was locked | The carer was never paid for that visit, and no later run could pay it | `d1474a6` |
| V-23 | Training, on-call, overtime premium and rolled-up holiday pay were skipped when the card could not be read, had no rate, or the activity had no duration | Earnings left out of a run with nothing on the run to say so; a locked period's training was never paid | `bb54b27` |
| V-24 | A year, or a nation, with no bank holiday dates priced its holidays as ordinary days | Underpayment with no warning | `d1474a6` |
| V-25 | A salaried employee enrolled in a UK run received the salary and every visit pay line for the same work | Double payment | `ac885b8` |
| V-26 | The salary came from the one agreement picked when the employee was enrolled, for the whole period, by calendar days of a 365.25-day year | A starter, a leaver or a mid-period change was paid as a whole period; a monthly salary varied with the length of the month; an agreement approved after enrolment was ignored | `ac885b8` |
| V-27 | One person could create an active salary agreement, and later edit its salary in place. The screen could not enter a salary at all | No second person; history rewritten; salaries reachable only through the API | `ac885b8`, `05b7148` |
| V-28 | Overtime was worked out from each run's own visits and identified by the run | A week split between two runs was two short weeks: the premium was not paid | `92ae183` |
| V-29 | Guaranteed weekly hours were recorded on the employment record and never read by pay | No effect, and no way to say whether a shortfall is paid | `a781f82` |
| V-30 | Anyone on an apprentice contract was checked against the apprentice minimum wage rate | An apprentice of 19 or over past the first year could be underpaid against the law | `36dbfdd` |
| V-31 | Minimum wage was checked over the dates of each pay run, with the age and rate of its last day | A monthly run averaged away a low week of a weekly-paid worker; a birthday or rate change applied early | `36dbfdd` |
| V-32 | The overtime premium and pay for hours not worked counted as pay for the minimum wage check; a pay item's "does not count" setting was ignored | A shortfall on worked hours could be hidden | `36dbfdd` |
| V-33 | Rolled-up holiday pay on a card was added for everyone on the card | Paid to workers it cannot lawfully be used for; no method per employee | `ca0a763` |
| V-34 | A settled visit's mileage could only be corrected as a wage adjustment | A reimbursement correction was taxed as pay | `446bc0a` |
| V-35 | A cancelled visit produced nothing for the carer and nothing said so | "No pay" by default, with no record of a decision | `6e5dfa0` |
| V-36 | A gap between two visits was paid as travel or waiting by its length alone | An estimate presented as fact; no way to record a rest break or a commute | `6e5dfa0` |
| V-40 | The travel card described travel minutes entered on the visit as an estimate of 0 minutes | Misleading wording on a new screen (found in the browser run) | `79ced6f`, `e259ab2` |

Found while testing, before it could ship: adding the new approval permission to the existing "approve pay" responsibility would have dropped every role that already approves pay from that responsibility, and saving the responsibilities screen would then have stripped their approval powers. The new power is a responsibility of its own (`approve-pay-agreements`).

Not changed, and recorded: `pay-policy.util.ts` still holds an unused `DEFAULT_CANCELLATION_POLICY` written before this programme. No pay path reads it. It should be deleted when that file is next touched, so that it is never mistaken for policy.

---

## 3. Features partially implemented

| Item | Built | Missing |
|---|---|---|
| Holiday (Q35) | Terms, entitlement, ledger, balance, pay rate, leaver position, rolled-up eligibility; API | Screens; booking leave from the rota or the holiday record; paying holiday automatically; the 28-day yearly maximum; overtime, bonuses and allowances in the 52-week average; per-period accrual for irregular hours uses calendar months when the worker has no payroll schedule |
| Minimum wage for salaried-hours work | The worker is recorded as "salaried hours work" and gets no top-up from visit lines; `salariedHoursCheck` compares a period's salary with the basic hours | The check is not run or shown on the UK payroll run |
| Minimum wage and deductions | — | Fines and penalties are not yet tested against the rate before they are taken |
| Minimum wage and premiums | The overtime premium is excluded | A weekend or bank holiday enhancement inside a visit's single amount still counts as pay |
| Contracted-hours salary cover | Visit time is counted per week across runs | Training and other non-visit time is treated as covered, not counted against the hours |
| Travel time | Override by approved intervals; estimate labelled | The estimate is still the default; the carer app does not capture intervals; the previous visit is looked for only inside the same run when estimating |
| Disrupted visits | Rules, decisions, payment, list of undecided cancellations | Events are recorded by the office, not raised automatically when a visit is cancelled; no screen for the rules themselves (API only) |
| Guaranteed hours | Weekly guarantee with visits, optionally travel and waiting, counted | Training and on-call time are not counted; a period other than a week is not supported |
| Overtime | Weekly, across runs | Daily overtime; full-rate replacement (the premium is premium-only); stacking on enhanced rates |
| Mileage correction | Car and van, motorcycle, bicycle | Passenger mileage; re-splitting later journeys around the 10,000-mile threshold |
| UK payslip | Totals by kind | Overtime, guarantee top-up, cancellation pay and salary adjustments appear inside "Other pay" or "Salary", not as named lines |

---

## 4. Business decisions still required

The register is `05-policy-decisions-required.md`, sections 2b and 2c. In short:

| Decision | Blocks |
|---|---|
| Q22 salary terms per role; D-22 arithmetic; D-23 recovery of overpaid salary; D-24 what a salary covers | Entering real salary agreements |
| Q23 who has guaranteed hours and on what terms; D-25 | Any guarantee top-up |
| Q29 overtime basis; D-26 | Daily overtime; any change to the premium base |
| Q32 what travel time is paid and how it is evidenced; D-27 | Switching from estimates to approved intervals |
| Q13 rules for each kind of disrupted visit | Automatic proposals; until then every event is decided by a person |
| Q35 holiday terms per worker category; D-28 | Any real leave entitlement |
| Q37–Q39 and D-29 | Salaried-hours check, premium elements, deductions |
| D-15 mileage rates and HMRC approved amounts | Any statement that mileage is tax-free |
| D-20 earlier unpaid mileage | Paying any of it |
| D-01 named approvers (unchanged) | All real use: nobody holds the approval powers on the development system |

---

## 5. Test results and actual commands

Run of 2026-10-13 on backend `79ced6f` and frontend `e259ab2`.

| Suite | Command (from `careadmin-backend` unless stated) | Result |
|---|---|---|
| Payroll integration (real PostgreSQL test database, real controllers and guards) | `npm run payroll-test-db` then `npx jest --config ./test/jest-payroll-int.json` | **38 suites, 385 tests, all pass** |
| Unit, billing and payroll | `npx jest src/billing src/payroll src/common/guards src/role-responsibilities` | **59 suites, 461 tests, all pass** |
| Unit, whole repository | `npx jest` | 350 suites: 340 pass, 10 fail (18 tests). The same 10 suites and 18 tests failed on the Gate A and Gate B commits; none is in billing or payroll |
| Migration rehearsal (scratch database built at the audited commit, synthetic history, all 18 migrations applied) | `npm run payroll-migration-rehearsal` | **58 of 58 checks pass** |
| Type check | `npx tsc --noEmit -p tsconfig.build.json` | Clean for `src` and `test` |
| Frontend, billing and payroll | `npx vitest run src/features/billing src/features/payroll` (in `care-admin`) | **11 files, 59 tests, all pass** |
| Frontend, whole repository | `npx vitest run` (in `care-admin`) | 1,316 tests: 1,300 pass, 16 fail, all outside this programme (alerts, policies, scheduling, service users; Playwright files that vitest cannot load are also listed as failed files) — the same 16 as on the Gate A and Gate B commits. One billing test was added after this run and passes in the row above |
| Frontend type check | `npx tsc --noEmit -p tsconfig.json` (in `care-admin`) | Clean |
| Browser (synthetic test instance, two synthetic users) | See `09-end-to-end-validation.md` section 10 | **5 flows, each confirmed in the test database** |

New test files in Gate B2:

| File | Tests | Covers |
|---|---|---|
| `test/payroll-int/non-visit-holds.int-spec.ts` | 8 | R-22 |
| `test/payroll-int/calendar-holds.int-spec.ts`, `src/billing/holiday-calendar.r27.spec.ts` | 9, 17 | R-27 |
| `test/payroll-int/mileage-corrections.int-spec.ts` | 7 | D-21, D-20 |
| `src/payroll/salary.util.spec.ts` | 24 | Salary rules, cover, guarantee week |
| `test/payroll-int/salary-gross.int-spec.ts` | 21 | The eleven salary scenarios and more |
| `test/payroll-int/salary-agreements-api.int-spec.ts` | 9 | Entry, approval, history |
| `test/payroll-int/overtime-weeks.int-spec.ts` | 7 | Weeks divided between runs |
| `test/payroll-int/guaranteed-hours.int-spec.ts` | 13 | Guarantee top-up |
| `src/billing/travel-interval.util.spec.ts`, `test/payroll-int/travel-intervals.int-spec.ts` | 5, 7 | Travel categories |
| `src/billing/visit-disruption.util.spec.ts`, `test/payroll-int/visit-disruptions.int-spec.ts` | 5, 8 | Disrupted visits |
| `src/billing/nmw-period.util.spec.ts`, `test/payroll-int/nmw-reference-period.int-spec.ts` | 16, 11 | Minimum wage |
| `src/payroll/leave.util.spec.ts`, `test/payroll-int/leave-entitlement.int-spec.ts` | 14, 11 | Holiday |
| `test/payroll-int/e2e-gate-b2.int-spec.ts` | 10 | The fifteen validations on one synthetic period |
| `care-admin`: `PayrollRunAttentionList`, `VisitMileageCorrectionCard`, `PayAgreementsPanel`, `TravelAndDisruptions` tests | 2, 4, 8, 10 | Screens |

Existing tests changed, and why: `pay-card-conflicts.int-spec` and `holiday-calendar.int-spec` (a held line is now a `HELD_EARNING` line; the Scotland case uses a holiday the calendar decides); `earning-status.int-spec` (seeds its own cards instead of relying on rows left by another file). No assertion about an amount paid was weakened.

The fifteen validations and where each is proved:

| # | Validation | Proved by |
|---|---|---|
| 1 | Hourly carer paid correctly | `e2e-gate-b2` V-01; `rate-regressions`; `pay-card-api` |
| 2 | Salaried employee not double-paid | `salary-gross` (salary and visit work); `e2e-gate-b2` V-02 |
| 3 | Guarantee top-up correct | `guaranteed-hours` (13); `e2e-gate-b2` V-03 |
| 4 | Overtime correct across pay runs | `overtime-weeks` (7); `e2e-gate-b2` V-04 |
| 5 | Travel pay and mileage separate | `travel-intervals`; `e2e-gate-b2` V-05; `mileage-settlement` |
| 6 | Cancelled visit follows policy | `visit-disruptions` (8); `e2e-gate-b2` V-06 |
| 7 | Holiday pay by worker category | `leave-entitlement` (11); `e2e-gate-b2` V-07 |
| 8 | Minimum wage on the correct reference period | `nmw-reference-period` (11); `e2e-gate-b2` V-08 |
| 9 | Missing pay rules are visible exceptions | `non-visit-holds` (8); `pay-evaluation-failures`; `e2e-gate-b2` V-09 |
| 10 | Incomplete calendars are visible holds | `calendar-holds` (9); `e2e-gate-b2` V-10 |
| 11 | Corrected earnings enter a later run once | `pay-corrections`; `mileage-corrections`; `e2e-gate-b2` V-11 |
| 12 | Locked history unchanged | `locked-history`; `e2e-gate-b2` V-12 (line-for-line snapshot before and after) |
| 13 | UK cancellation does not strand earnings | `uk-cancellation`; `e2e-gate-b2` V-13 |
| 14 | Approved expenses included once | `mileage-settlement`; `salary-gross`; `e2e-gate-b2` V-14 |
| 15 | Source earnings reconcile to pay-run lines | `e2e-gate-b2` V-15; `duplicate-claims` |

---

## 6. Database changes

Five migrations, all additive. Detail, rollback notes and rehearsal: `04-database-changes.md` section 0.

| # | Migration | Change |
|---|---|---|
| 14 | `20261015100000_mileage_correction_tax_fields` | Three nullable columns on `EmployeePayItem` |
| 15 | `20261016100000_salary_agreement_terms` | Seven nullable columns on `EmployeePayAgreement`; two on `UkPayrollInputLine` |
| 16 | `20261016140000_guaranteed_hours` | Pay line type `GUARANTEED_HOURS`; four nullable columns on `EmployeePayAgreement` |
| 17 | `20261017100000_travel_intervals_and_disruption_pay` | Tables `TravelTimeInterval`, `VisitDisruptionPayRule`, `VisitDisruptionPayDecision` |
| 18 | `20261018100000_nmw_periods_and_leave_terms` | Tables `NmwPeriodAssessment`, `EmployeeLeaveTerms`, `EmployeeLeaveEntry`; one nullable column on `EmployeePayrollProfile` |

No existing row is changed by any of them. No agreement, rule, guarantee, leave terms or apprenticeship date is created: the rehearsal checks each of those on a synthetic historical database. No financial constraint or locked-history trigger was altered. The migrations were applied to the local development database and the synthetic test database only.

One step is needed on a database that already has the approval role: `node scripts/payroll-approval-permissions.mjs` adds the permission `payroll.pay_agreements.approve` and gives it to the role "Payroll Approver". It assigns the role to nobody.

---

## 7. Commits

`careadmin-backend`, branch `payroll-remediation/gate-b2` (base: Gate B head `ccf5741`):

| SHA | Subject |
|---|---|
| `bb54b27` | R-22: non-visit earnings that cannot be worked out are held on the run |
| `d1474a6` | R-27: a normally-bank-holiday day with no calendar entry holds carer pay |
| `446bc0a` | D-21 / D-20: settled mileage corrected as mileage; earlier mileage paid only when released |
| `ac885b8` | WM-02 / WM-03 / WM-09: salary from effective-dated agreements; covered work not paid again |
| `92ae183` | WM-18: weekly overtime settled per employee and week |
| `a781f82` | WM-07 / EL-01: guaranteed hours top-up under an approved agreement |
| `6e5dfa0` | TR-01/04/05/06 and Q13: travel intervals; pay decisions for disrupted visits |
| `36dbfdd` | Q37–Q39: minimum wage over the pay reference period |
| `ca0a763` | Q35: holiday entitlement and holiday pay from approved leave terms |
| `79ced6f` | End-to-end test, migration rehearsal checks, browser fixture, travel basis as used |
| the commit after it (`git log -1` on the branch) | These reports |

`care-admin`, branch `payroll-remediation/gate-b2` (base: Gate B head `b36a61f`):

| SHA | Subject |
|---|---|
| `a994548` | R-22: held earnings shown on the pay run |
| `27c8c7e` | D-21: mileage correction card on a settled visit |
| `05b7148` | WM-02 / WM-03: salary agreements entered, reviewed and approved; salary cover on the UK run |
| `473bd74` | WM-07: guaranteed hours on the agreement form |
| `b4ad476` | Travel time before a visit; disrupted visits panel |
| `340162a` | Apprenticeship start date on the payroll profile |
| `e259ab2` | Travel card says when the visit's own travel minutes are used |

---

## 8. Financial reconciliation examples

All figures are asserted by tests; every amount is synthetic.

**One week, one month (`e2e-gate-b2`).** Card: £14.00 an hour; overtime at time and a half above 10 hours a week; travel time £12.00 an hour.

| Person | Source earnings | Pay run lines | UK gross for November |
|---|---|---|---|
| Hana, hourly | 12 hours of visits; 40 minutes between two visits; 10 miles; bonus £25.00; a correction of +£7.00 recorded after the lock | Visit pay £168.00; travel time £8.00 (40 min); overtime £14.00 (2 h × £7.00 premium); bonus £25.00; mileage on its own line (10 miles); later run: adjustment £7.00 | £222.00 = 168 + 8 + 14 + 25 + 7. Mileage is in expenses, not in gross |
| Gus, guaranteed 14 hours | 10 hours worked in week one; nothing scheduled in week two | Visit pay £140.00; top-up £56.00 (4 h); week two top-up £196.00 (14 h) | £392.00. Each week totals £196.00 = 14 h × £14.00 |
| Sal, salaried £24,000 | A 2-hour visit worth £28.00 | Visit pay £28.00 | Salary £2,000.00; the visit comes in at £0.00 with £28.00 recorded as covered. Gross £2,000.00 |
| Lou, paid £12.00 an hour | 10 hours | Visit pay £120.00; minimum wage top-up £7.10 (10 h × £12.71 − £120.00) | £127.10 |
| Cal, nobody home | A 60-minute visit; synthetic rule "paid in full" | Cancellation pay £14.00 | £14.00 |

Every approved visit has exactly one visit pay line claimed by that visit, for the approved amount; every approved pay item has exactly one line claimed by that item; no line is without a claim; the run total equals the sum of its wage lines; every locked line appears once in UK gross. After a correction, a cancelled and replaced UK run, a close and a supplementary run, the locked week is identical, line for line, to what was locked.

**Salary.**

| Case | Calculation | Result |
|---|---|---|
| Whole month, £24,000 a year, equal pay periods | 24,000 ÷ 12 | £2,000.00 in November and in February alike |
| Starter on 16 November, by calendar days | 2,000 × 15 ÷ 30 | £1,000.00 |
| Starter on 16 November, by working days | 2,000 × 11 ÷ 21 | £1,047.62 |
| Leaver on 10 November | 2,000 × 10 ÷ 30 | £666.67 |
| Rise to £30,000 from 16 November | 1,000.00 + 2,500 × 15 ÷ 30 | £1,000.00 + £1,250.00 |
| Cover up to 10 contracted hours; 14 hours worked at £14.00 | 10 h covered (£140.00), 4 h paid | Salary + £56.00 |
| Salary found to be £30,000 after November closed at £24,000 | 2,500.00 − 2,000.00 | One adjustment of £500.00 in December; nothing in January |

**Weeks and periods divided between runs.**

| Case | First run | Second run | Total |
|---|---|---|---|
| Overtime: 12 hours, then 2 more, threshold 10 | 2 h × £7.00 = £14.00 | 4 h due (£28.00) − £14.00 paid = £14.00 | £28.00 |
| Guarantee 14 hours: 6 worked, top-up paid, then a 2-hour visit approved late | Top-up £112.00 | Visit £28.00, top-up −£28.00 | £196.00 |
| Minimum wage, monthly period: 10 h at £12.00, then 10 h more at £12.00 | Top-up £7.10 | £14.20 due − £7.10 = £7.10 | £14.20 |
| Minimum wage, weekly-paid worker in one monthly run: a week at £12.00 and a week at £14.00 | — | — | £7.10 for the low week (averaging would have paid nothing) |

---

## 9. Existing functionality preserved

- Every integration suite that existed at the Gate B head still passes. Three files were adjusted (section 5); no payment amount in them changed.
- Claims: `PayrollRunLine.claimKey` and `UkPayrollInputLine.claimKey` are unchanged and still unique. The new weekly and period identities use the same column and the same conflict-and-retry path.
- Locked history: the triggers are untouched. No Gate B2 code updates a line of a locked run; differences are new lines in later runs.
- Maker and checker, and the powers that an administrator role never implies, are unchanged; one power was added to that list.
- Pay cards, charge cards, client charging, payouts, payment states, the correction ledger, mileage settlement, attendance verification, evaluation failures, approval evidence, branch scope: no change in behaviour, and their suites pass.
- An employee with no agreement, no leave terms and no payroll schedule is paid exactly as before, with two visible differences: a rolled-up holiday line says the eligibility is not verified, and a minimum wage line says the run dates were used as the period.
- Behaviour that does change for existing data, all of it deliberate: (a) an employee on an apprentice contract aged 19 or over with no apprenticeship start date is checked against the rate for their age; (b) the overtime premium no longer counts as pay for the minimum wage check; (c) a salaried employee with a salary agreement that records no cover has visit wages held in UK gross; (d) a top-up for a low week can be reduced by later pay in the same payroll period; (e) overtime for a week already partly paid is the difference, not a fresh calculation.
- Whole-repository test baselines are identical to Gate B outside this programme (backend 18 failing tests in 10 suites; frontend 16).

---

## 10. Outstanding compliance risks

1. **No approved policy.** Salary cover, guarantees, overtime, travel, cancellations and holiday all run on what the client has not yet stated. Until it does, real employees get the earlier behaviour, which is known to be incomplete.
2. **Minimum wage and premium elements.** A weekend or bank holiday enhancement inside a visit's amount counts as pay. A worker on a low base rate with many enhanced hours could be below the rate on basic pay and not be flagged.
3. **Minimum wage for salaried-hours workers and after deductions** is not assessed.
4. **Statutory minimum wage rates** are constants in the code and were not re-verified in this phase.
5. **Holiday pay** is not yet calculated or paid by the system when leave is taken; the 52-week average leaves out overtime, bonuses and allowances.
6. **Rolled-up holiday pay** is still paid to employees with no leave terms, with a note that eligibility is not verified.
7. **Mileage tax treatment** is "not verified" on every line until finance records HMRC's approved amounts (D-15).
8. **Travel time** is still an estimate by default. An estimate can over- or under-state working time.
9. **Timezone.** UK payroll periods and salary-covered weeks are compared in UTC days, as that module already did; visit pay runs use the organisation's timezone. A visit between midnight and 01:00 in summer can fall in a different week in the two.
10. **Recovery from wages.** A lowered salary, a reduced top-up and a reduced guarantee are taken back automatically through negative lines. Whether and how the employer may do that is a decision (D-23).
11. **The carer mobile app** is still not available to development, so nothing captured by it (including any future travel record) has been observed.
12. **Pay reference period** falls back to the run dates for a worker with no payroll schedule; a run longer than a month would then be an unlawful period, and nothing stops that yet.

---

## 11. Remaining Gate B work

In suggested order:

1. Screens for leave terms, leave entries and the leave position; a screen for disrupted-visit rules; mileage rates screen (R-26).
2. Show the minimum wage assessment (`NmwPeriodAssessment`) on the pay run, and run the salaried-hours check on the UK run.
3. Separate basic pay from premium inside a visit's amount, so premiums can be excluded from the minimum wage check and included in holiday pay correctly.
4. Deductions tested against the minimum wage before they are taken.
5. Raise a disruption event automatically when a visit with a carer allocated is cancelled.
6. Daily overtime, once Q29 is answered.
7. Holiday: book leave against the balance, pay it at the reference rate, bring overtime and bonuses into the average, apply the yearly maximum.
8. Travel: use the previous visit across runs when estimating; capture from the carer app when it is available; switch the default once Q32 is answered.
9. UK payslip: name overtime, guarantee, cancellation and salary adjustment lines.
10. Refuse a pay run longer than a month as a pay reference period.
11. Left from earlier gates and unchanged: D-01 named approvers, D-07 legal employers, the mobile app (R-02), Easter rate (D-16), bank holiday travel rates (D-19).

---

## 12. Readiness for full UK statutory payroll development

**Ready as inputs to a statutory engine:**

- Gross earnings arrive in the UK run as lines with a source and a unique claim, by kind: visit pay, travel and waiting, salary (in dated parts), salary adjustment, overtime, guarantee top-up, cancellation pay, minimum wage top-up, pay items, deductions.
- Reimbursements are apart from wages, with the taxable excess as its own taxed line.
- A period's salary, a week's overtime and a period's minimum wage top-up each have one identity, so supplementary and replacement runs cannot duplicate them.
- Cancelling a UK run releases what it collected; closing settles it; history is fixed by database triggers.
- The pay reference period is defined by the payroll schedule and recorded per worker and run.

**Needed before statutory development can rely on these:**

- The client decisions in section 4, at least Q22, Q35, Q37–Q39, D-01 and D-15.
- Items 2 to 4 of section 11 (minimum wage for salaried workers, premiums, deductions).
- Pay elements classified for tax, NI, pension and holiday purposes one by one; today that is by line kind only.
- Starter and leaver dates agreed between the HR record and the pay agreement.

**Not part of this phase and not claimed:** PAYE and NI correctness beyond what earlier phases tested, pensions and auto-enrolment, statutory sick, maternity and other payments, student loans, attachment orders, RTI submissions as a tested end-to-end path, year end, P45 and P60, payslip itemisation to the statutory standard, bank payments. CareFlow should not be described as a complete UK payroll product until those phases and their compliance tests are finished.
