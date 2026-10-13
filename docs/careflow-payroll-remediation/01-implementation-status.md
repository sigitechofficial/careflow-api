# 01 — Implementation Status

**Programme:** CareFlow carer wages, pay cards and UK payroll remediation
**Updated:** 2026-10-13 · **Sprint B3 (unauthorised wage recoveries stopped; minimum wage for salaried-hours work; pay reference period of a month or less; UK dates):** implemented and tested on branch `payroll-remediation/sprint-b3`, see `13-sprint-b3-summary.md` · **Gate B2 (employment wages, salary, compliance foundations):** implemented and tested with synthetic policy, see section 00 and `12-gate-b-employment-wages-summary.md` · **Phase 0 (financial safety):** implemented and tested · **Gate A sprint (R-01 to R-12):** implemented and tested, see section 1 · **Gate B sprint (R-16, R-17, R-18, R-13, R-11, PC-19, PC-32, PC-10, PC-22/23/24, TR-09, TR-13):** implemented and tested, see section 0 · **Everything else:** not started

| Repository | Branch | Base commit (audited) | Gate A head | Head |
|---|---|---|---|---|
| careflow-api (`careadmin-backend`) | `payroll-remediation/gate-b2` (on `gate-b`, on `gate-a`, on `phase-1`, on `phase-0`) | `e163815` | `035e482` | Gate B `ccf5741`; Gate B2 code `79ced6f`, then the reports commit |
| careflow-admin (`care-admin`) | `payroll-remediation/gate-b2` (on `gate-b`, on `gate-a`, on `phase-1`, on `phase-0`) | `a8b7b9a` | `01da8a2` | Gate B `b36a61f`; Gate B2 `e259ab2` |

Nothing has been pushed, deployed or run against live data. All commits are local. `main` is untouched in both repositories.

Status words: **DONE** = fixed, covered by passing tests, and reachable by the user it is for · **PARTIAL** = part done, rest listed · **BLOCKED** = needs a client decision or something not available to development · **POLICY BLOCKED** (Gate B2) = the foundation works and is tested with synthetic policy, real use waits for a client decision · **OPEN** / **NOT STARTED** = nothing built.

"Verified by": **int** = integration test on a real database · **http** = over HTTP through the real controllers and guards · **unit** · **ui** = component test · **browser** = exercised in a browser on synthetic data.

---

## 00. Gate B2 — employment wages, salary calculations and compliance foundations (2026-10-13)

Summary, reconciliation examples, risks and what is left: `12-gate-b-employment-wages-summary.md`. Decisions: `05-policy-decisions-required.md` sections 2b and 2c. **CareFlow is not a complete UK payroll product**: this phase concerns gross earnings; statutory payroll is a later phase.

Label for every POLICY BLOCKED row: *IMPLEMENTED FOUNDATION — TESTED WITH SYNTHETIC POLICY — CLIENT APPROVAL PENDING*.

### Stage 1 — remaining high-risk earnings gaps

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| R-22 | VW-03 | Training, on-call, overtime premium, rolled-up holiday pay and pay items were left out of a pay run without a word when the card could not be read, had no rate, or the activity had no duration | The earning becomes a held line on the run (amount 0.00, no claim) naming the worker, the source and the reason. Recalculating is the retry; a held activity of a locked period is carried into later runs; a run cannot be locked while it holds amounts that could never be carried. `GET /billing/payroll-runs/held-earnings` lists everything held | `billing/payroll-runs.service.ts`, `payroll-claim.util.ts`, `PayrollRunAttentionList.tsx` | http `non-visit-holds` (8); ui (2); e2e V-09 | DONE |
| R-27 | PC-24 | A year or a nation with no bank holiday dates priced its holidays as ordinary days in silence | The usual pattern of bank holidays per nation is known (never used to price). A visit on such a day, on a card that pays more for holidays, with no calendar entry, is held with the day named. Pre-check at pricing and at the pay run; the client charge is unaffected | `billing/holiday-calendar.util.ts`, `holiday-calendar.store.ts`, `visit-reconciliations.service.ts`, `payroll-runs.service.ts` | unit `holiday-calendar.r27.spec` (17); http `calendar-holds` (9: England and Wales, Scotland, Northern Ireland, missing years, substitute days, midnight); e2e V-10 | DONE. Scotland, Northern Ireland and 2027 onwards are still empty on the development calendar |
| D-15, D-20, D-21 | TR-13 | The UK run did not show wages and reimbursements apart; settled mileage could only be corrected as wages; mileage of earlier runs had no route to payment | The run shows taxable wages, reimbursement within the approved amount, taxable excess, reimbursement not verified, net wages and total payable. A settled visit's miles are corrected as mileage with a tax split (second approver). Earlier unpaid mileage is released one employee and run at a time, with a reason, by a user with the payout approval power | `billing/pay-items.service.ts`, `mileage-ledger.store.ts`, `employee-payouts.service.ts`, `payroll/payroll-runs.service.ts`, `VisitMileageCorrectionCard.tsx` | http `mileage-corrections` (7: tax-year change, threshold, prior claims, reversal, payout reconciliation); ui (4) | DONE. POLICY BLOCKED on D-15 (rates not verified) and D-20 (which amounts to release) |

### Stage 2 — salary and employment agreements

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| WM-02 | WM-02 | A salary could not be entered on any screen; the API accepted an annual figure only | Salary entered per year, month or week; the yearly figure is stored. Contracted weekly hours, part-period method and what the salary pays for are part of the agreement | `payroll/salary.util.ts`, `payroll-employees.service.ts`, `PayAgreementsPanel.tsx` | unit (24); http `salary-agreements-api` (9); ui (8); **browser** | DONE. POLICY BLOCKED (Q22) |
| WM-03 | WM-03 | One agreement, picked at enrolment, applied to the whole period. One person could create or rewrite an active salary | Effective-dated timeline (latest start on or before the day); starter, leaver and mid-period change paid in parts, each with its own claim; a second person approves (`payroll.pay_agreements.approve`, granted by name); terms in effect are ended, not edited; history with who entered and approved | same, `payroll-runs.service.ts`, `explicit-grant-permissions.ts`, migration 15 | int `salary-gross` (21); http (9); **browser** (two users) | DONE. POLICY BLOCKED (Q22) |
| WM-09 | WM-09 | A salaried employee in a UK run received the salary and every visit pay line for the same work | Earnings the salary covers come in at 0.00 with the value recorded and are settled by the run; hours beyond the contracted hours are paid, counted per week across runs; approved pay items and expenses are always paid; a salary with no cover recorded holds the visit wages; a salary agreement approved after a period was paid gives one adjustment in the next or a supplementary run | `payroll/payroll-runs.service.ts`, `salary.util.ts`, `UkPayrollRunDetailPage.tsx` | int `salary-gross` (21: the eleven scenarios of the brief and ten more); e2e V-02 | DONE. POLICY BLOCKED (Q22, D-22 to D-24) |

### Stage 3 — guaranteed hours and overtime

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| WM-07, EL-01 | WM-07, EL-01 | Guaranteed weekly hours were recorded and never read by pay; nothing said whether a shortfall is paid | Guarantee on the pay agreement with "shortfall is paid", what counts, and the treatment of absence; second-person approval; settled per Monday-to-Sunday week by the run in which it ends, identity `GUARANTEE:<employee>:<week>:<n>`; part weeks count for their own days; an undecided visit holds the top-up; a late visit reduces it | `payroll/salary.util.ts`, `billing/payroll-runs.service.ts`, migration 16 | unit (4); http `guaranteed-hours` (13); ui (2); e2e V-03 | DONE. POLICY BLOCKED (Q23, D-25) |
| WM-18 | WM-18 | Overtime was worked out from each run's own visits and identified by the run: a week split between two runs was two short weeks | The hours of a week are every pay-approved visit of that week; the premium due less what locked runs paid is paid by the run; identity `OVERTIME:<employee>:<week>:<n>`; two open runs on one week hold the second | `billing/payroll-runs.service.ts`, `payroll-claim.util.ts` | unit; http `overtime-weeks` (7, including a week divided between two runs and a late visit); e2e V-04 | DONE for weekly overtime. Daily overtime NOT STARTED (Q29) |

### Stage 4 — travel time, cancellations and disruptions

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| TR-01, TR-04, TR-05, TR-06 | TR-01 to TR-06 | The gap between two visits was paid as travel or waiting by its length alone | Intervals classified by a person (travel between service users, required waiting, rest break, ordinary commute, training journey, journey to a cancelled visit, other) with evidence (estimated, recorded, verified), approved by a second person. Approved intervals decide travel and waiting pay and minimum wage hours; otherwise the estimate applies and its line says so. Mileage is untouched | `billing/travel-interval.util.ts`, `travel-intervals.service.ts`, `payroll-runs.service.ts`, migration 17, `VisitTravelTimeCard.tsx` | unit (5); http `travel-intervals` (7); ui (6); e2e V-05; **browser** | DONE as an override. Default still the estimate: POLICY BLOCKED (Q32) |
| Q13 | — | A cancelled visit produced nothing for the carer, and nothing recorded that as a decision | Rules per event and notice (none exist until supplied; second-person approval); a pay decision per carer and event — proposed by a rule, or decided by a person where none applies; approved amounts paid once through a pay item; a list of cancelled visits with a carer and no decision | `billing/visit-disruption.util.ts`, `visit-disruptions.service.ts`, migration 17, `DisruptedVisitsPanel.tsx` | unit (5); http `visit-disruptions` (8); ui (4); e2e V-06; **browser** | DONE. POLICY BLOCKED: no rule exists |

### Stage 5 — holiday and minimum wage

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| Q35 | — | One method for everyone: a card flag adding 12.07% rolled-up pay. No leave year, entitlement, balance or holiday pay rate | Leave terms per employee (worker category, leave year, normal week, contractual extra, carry-over, pay method) with approval; entitlement by category; ledger and balance; 52-week rate; leaver position; rolled-up pay held where it cannot lawfully be used | `payroll/leave.util.ts`, `leave.service.ts`, `leave.controller.ts`, migration 18 | unit (14); http `leave-entitlement` (11); e2e V-07 | PARTIAL: API and calculation only; no screens; leave is not booked or paid automatically. POLICY BLOCKED (Q35, D-28) |
| Q37–Q39 | — | Minimum wage checked over the dates of each run with the age and rate of its last day; every apprentice held to the apprentice rate; premiums and pay for time not worked counted as pay | Assessed over the worker's payroll schedule period across runs, identity `NMW:<employee>:<period start>:<n>`; age and rate at period start; apprentice rate only under 19 or in the first year; non-work pay excluded; `NmwPeriodAssessment` per run, worker and period | `billing/nmw-period.util.ts`, `payroll-runs.service.ts`, migration 18 | unit (16); http `nmw-reference-period` (11); e2e V-08; **browser** (apprenticeship field) | DONE for time work. PARTIAL: salaried-hours check and deductions (D-29) |

### Stage 6 to 8

| Item | State |
|---|---|
| Policy decision register | DONE: doc 05 sections 2b and 2c |
| Fifteen validations | DONE: `e2e-gate-b2` and the suites listed in doc 12 section 5 |
| Regression after each stage | Run after every stage; final figures in doc 03 section 00 |
| Financial and audit constraints | Unchanged; migration rehearsal 58 of 58 |
| Frontend workflows | Component tests, and five flows in a browser as two synthetic users (doc 09 section 10) |

### Issues found during Gate B2

| # | Found by | Issue | Outcome |
|---|---|---|---|
| V-22 | R-27 work | A visit whose run line was an exception (£0.00) was claimed and marked as included at lock, so it was never paid | Fixed (`d1474a6`): a held line is neither claimed nor settled |
| V-25 | Stage 2 trace | Salary and visit wages both paid for the same work | Fixed (`ac885b8`) |
| V-30 | Stage 5 trace | Any apprentice held to the apprentice rate, whatever their age or year | Fixed (`36dbfdd`) |
| V-37 | Stage 2 test | Adding the new approval power to the existing "approve pay" responsibility would have removed existing approver roles from it | Avoided before commit: the power is a responsibility of its own |
| V-38 | Stage 3 design | Capping a week's hours at the run's end date made a supplementary run claw back overtime already paid | Avoided before commit: the whole week is always read |
| V-39 | E2E | A guaranteed-hours employee with nothing scheduled in a later week receives the whole guarantee for that week from the run that covers it | Intended, and now visible; recorded so the client sees the cost of a guarantee before agreeing one |
| V-40 | Browser | The travel card called minutes entered on the visit "an estimate of 0 minutes" | Fixed: the card says the visit's own minutes are used |
| — | Reading | `pay-policy.util.ts` holds an unused default cancellation policy written before this programme | Not read by any pay path; left unchanged; recommended for deletion |

---

## 0. Gate B sprint — Gate A hardening, pay card correctness, mileage settlement

Summary of the sprint, defects found and what is left: `11-next-sprint-summary.md`.

### Sprint A — financial hardening

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| R-16 | VW-02 | Each carer's attendance evidence was written by reading the visit's JSON, changing it and writing it back. Two carers finishing a double-up at the same moment, or the office and a carer, overwrote each other: on the test database one of eight records survived, five times out of five | One row per carer and visit (`VisitAttendanceVerification`) with an append-only history. Every change takes the row lock, merges, bumps a version and writes a history entry; a repeated delivery is recognised by its event id. Completion times are resolved under the lock. Old evidence in the visit JSON is still read | `visit-attendance/visit-attendance-verification.store.ts`, `visit-time-trust.util.ts`, `employee-app-visits.service.ts`, `ecm-manual-attendance.service.ts`, migration 8 | int `attendance-concurrency` (11); unit `visit-time-trust.util.spec` (20); http `carer-app-attendance` (16) | DONE (server). Mobile app still not observed |
| R-17 | VW-03 | A pay calculation that failed was caught and written to the server log only. A carer without an employment record had an unpriced visit and no reason anywhere a person would look | A set-up gap the resolver can name becomes a held row with the reason, and the client charge is still priced. Anything else is kept as a `PayEvaluationFailure` without the error text, shown on the reconciliation screen, retryable and dismissable with a reason, audited, closed when a later calculation succeeds | `billing/pay-evaluation-failure.util.ts`, `visit-reconciliations.service.ts` and controller, migration 9, `PayEvaluationFailuresCard.tsx` | unit (6); http `pay-evaluation-failures` (7); ui (5) | DONE |
| R-18 | VW-04 | An approval stayed in place when the attendance evidence under it changed afterwards, or was withdrawn when nothing relevant had changed | The approval records what it was based on (start, finish, review state) and who or what gave it. On a change: an automatic approval is withdrawn and re-given if the new evidence is clean; a person's approval goes back to review with the reason kept; settled pay is flagged, never changed in place | `billing/approval-evidence.util.ts`, `visit-reconciliations.service.ts`, migration 10, `VisitReconciliationDetailDialog.tsx` | unit; http `approval-evidence` (10) | DONE |
| R-13 | SI-10 | The backend refused branch users on organisation-wide pay records; the screens still offered them and showed errors | Menu entries and ten pages are hidden or replaced by an explanation for a branch-limited user; the exception queue and the new lists take a branch | `auth/pay-scope.tsx`, `Sidebar.tsx`, `router.tsx`, `visit-reconciliations.controller.ts` | http `http-payroll-api` (68); ui (4); **browser** (branch manager) | DONE for branches. Legal employers still BLOCKED on D-07 |
| R-11 | — | Approving and locking a pay run, closing a UK run, recording a payment and other flows had been covered over HTTP only | A repeatable fixture fills the test database; six flows were carried out in a browser as three synthetic users | `test/payroll-int/browser-fixture.seed.ts`, doc 09 section 6 | **browser** (6 flows, each confirmed in the database) | DONE |

### Sprint B — pay card correctness

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| PC-19 | PC-19 | Fixed fees, night-duty allowances and travel, mileage and waiting rates chose the day from the UTC date. In summer time 00:00 to 00:59 local is still the previous day in UTC: a 30-minute visit at 00:15 on a Saturday was paid the weekday fee | Every pricing path classifies the day in the organisation's timezone. Elapsed time still uses instants. Cards, a carer's own card history and funder overrides are also in force on the local day | `billing/visit-reconciliation.util.ts`, `payroll-runs.service.ts`, `billing-cards.service.ts` | unit `local-day.pc19.spec` (15; 8 of 14 failed before); int `rate-regressions` (+1), `pay-card-conflicts` (+1) | DONE |
| PC-32 | PC-32 | When two active cards matched a carer at the same level, the most recently edited card was used and nobody was told | No card is chosen. The visit is held with the cards named; the pay run says what it could not calculate; the pay cards screen lists the carers affected; the card form warns before saving. Changes of a carer's own card, and funder overrides, take turns under a lock | `billing/pay-card-assignment.util.ts`, `billing-cards.service.ts`, `payroll-runs.service.ts`, `PayCardConflictNotice.tsx` | unit (13); http `pay-card-conflicts` (15: the ten scenarios asked for and five more); ui (7); **browser** (warning seen in the form) | DONE |
| PC-10 | PC-10 | The funder that selects a carer's funder pay card was the client's funder today, not on the day of the visit | The funder is read as at the visit day from the client's funding lines. Where the records cannot say, and the carer has a card for one of the possible funders, the pay is held with the reason and what to do | `billing/funding-at-date.util.ts`, `visit-reconciliations.service.ts` | unit (8); int `funding-history` (6; 4 failed before) | DONE for carer pay. The client charge still reads current funding (not in scope) |
| PC-22, PC-23, PC-24 | PC-22 to PC-24 | Bank holidays were read in several places; nothing knew which days are substitute days; organisation special days could be given a rate on a card but no day was ever classified as one; a year with no dates priced its holidays as ordinary days in silence; which day is paid when a holiday falls on a weekend was fixed in code | One calendar for carer pay: three nations, substitute days with the date they stand for, organisation special days, a completeness check, and the weekend-holiday policy as an organisation setting whose default is what was paid before | `billing/holiday-calendar.util.ts` and `.store.ts`, `bank-holidays.service.ts`, `pay-time-band.util.ts`, migration 11, `BankHolidaysPanel.tsx` | unit (20); http `holiday-calendar` (11); ui (6) | DONE. Which basis Allfor Care uses is decision D-13: not decided here |

### Sprint C — mileage settlement

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| TR-09 | TR-09 | Mileage rates and the 10,000-mile threshold were constants in the code. The year-to-date total was pounds divided by a rate, from runs of earlier periods only, so a threshold crossed inside one run was missed; 1 to 5 April was counted in the new tax year | Rates per period and vehicle type in a table, with HMRC approved amounts as a separate, verified-by-a-person set. Miles are stored on the line; the year-to-date total is miles by journey date in the tax year from 6 April, including earlier journeys in the same run. Miles with no rate are an exception line | `billing/pay-mileage.util.ts`, `payroll-runs.service.ts`, `mileage-rates.service.ts`, migrations 12 and 13 | unit `mileage.tr09.spec` (15); http `mileage-settlement` (9) | DONE. The rates in the first period are the ones the application already used and are **not verified** against HMRC (D-15) |
| TR-13 | TR-13 | A mileage reimbursement stopped at the UK payroll run ("tracked separately") and never reached a payout; it was treated as outside taxable pay whatever the rate | Each line says how much is within the approved amount and how much above, or "not verified". The part above is taxed as pay on its own input line. The reimbursement is owed with the run's net pay and paid once through the payout, shown apart from wages on the payout, the run and the payslip. Older runs are not changed: a reconciliation list shows their unpaid expenses | `payroll/payroll-runs.service.ts`, `payroll-payslip.util.ts`, `employee-payouts.service.ts`, `PayableBreakdown.tsx` | http `mileage-settlement` (9, through the application's own tax and NI calculation); unit (3 payslip); ui (3); **browser** (mileage line on the run) | DONE. Correcting mileage after the run is locked has no reimbursement-type correction yet (backlog R-21) |

### Issues found during this sprint

| # | Found by | Issue | Outcome |
|---|---|---|---|
| V-11 | R-16 reproduction | One of eight concurrent attendance records survived the old read-modify-write | Fixed (`7f1fa95`) |
| V-12 | PC-19 work | Travel, mileage and waiting rules are not ranked by day type, and the pay run never passes the bank holiday flag for them: a card's bank holiday travel rate is not used | Not changed (it would alter what existing cards pay; question Q17). Recorded in doc 05 |
| V-13 | PC-32 work | The pay run swallowed every error from the card resolver for training, on-call, overtime and rolled-up holiday pay, so those amounts were left out without a word | A conflict now puts an exception line on the run (`ee5c6ff`). Other resolver errors are still swallowed there (backlog R-22) |
| V-14 | PC-32 test | Two changes of a carer's own card at once left two cards in force on the same days; two funder overrides at once left two overrides | Fixed with a per-carer lock (`ee5c6ff`); both reproduced before the fix |
| V-15 | PC-22 work | The band engine applied a card's bank holiday rate to any special day, so an organisation day would have been paid the bank holiday rate by itself | Fixed before the feature could reach a card (`43997d6`) |
| V-16 | PC-22 work | A card can carry an "Easter" rate, but no day is ever classified as Easter | Not changed (which days it covers is a policy question). The pay preview now says so (doc 05, D-16) |
| V-17 | TR-13 trace | Mileage never reached a payout: the payout was net pay only | Fixed (`02597b8`) |
| V-18 | TR-09 work | Lines of locked pay runs cannot be back-filled with miles (the history triggers refuse it, correctly) | Older lines are read from the description they were written with; nothing historic is rewritten |
| V-19 | Browser | Cancelling an approved pay item uses a browser confirmation box and asks for no reason | Recorded as backlog R-23 (usability; the action is audited) |
| V-20 | Browser | A payout batch created from the run page gives no feedback there and is filed under its week, so the default "this month" list looked empty and a second attempt returned "already exists" | Recorded as backlog R-24 (usability; no money effect) |
| V-21 | Whole-repository test run | 18 unit tests in 10 suites fail in modules this programme does not touch (policies, assessments, care plans, medical, carer-app login) | The same 18 fail on the Gate A commit. Not changed |

---

## 1. Gate A sprint — backlog R-01 to R-12

| ID | Audit | Original problem | Actual fix | Main files | Verified by | Status |
|---|---|---|---|---|---|---|
| R-08 | PR-05 | A cancelled UK payroll run kept the pay lines it had collected. The unique index on the source line stopped any other run taking them: the earnings were stranded | The claim is its own column (`UkPayrollInputLine.claimKey`). Cancelling clears it, stamps `releasedAt`, keeps the line as a snapshot, records the reason. Salary and deductions are claimed per pay period. Close and cancel are conditional on status. Gross calculation retries when another run takes a source mid-flight | `payroll/payroll-runs.service.ts`, migration 6, `UkPayrollRunDetailPage.tsx` | int `uk-cancellation` (12, incl. concurrent cancel/close, concurrent collection, failed transaction, audit); http; e2e; migration rehearsal | DONE |
| R-02 | VW-02 | The carer-app completion call was unit-tested only | Tested over HTTP with real carer tokens: check-in → completion → reconciliation → pay run lines → office review. Found and fixed on the way: the support carer's finish was taken as sent on two of the three completion paths | `employee-app/employee-app-visits.service.ts`, `visit-attendance/visit-time-trust.util.ts` | http `carer-app-attendance` (16); unit `visit-time-trust.util.spec` (18) | DONE for the server. **BLOCKED for the mobile app itself**: its source and a build are not available, so what the app actually sends was not observed |
| R-03 | VW-02 | The time-trust record was kept per visit, so one carer's flag held every carer of a double-up | Kept per carer (`attendanceTimesByEmployee`); the exception is raised on that carer's row only; legacy visit-wide records are still read | same | http `carer-app-attendance` (double-up, three carers, lead first, support first) | DONE |
| R-05 | SI-10 | Pay screens and actions ignored branches | `PayrollScopeGuard`: organisation records need organisation-wide pay access; employee records need the employee to be in the user's branches; branch lists need a branch the user holds; pay audit hidden from branch users; carers see only their own pay | `common/guards/payroll-scope.guard.ts`, eight controllers, `audit-logs` | http `http-payroll-api` (branch scope: 8 tests); e2e | DONE for branches. **BLOCKED for legal employers** (no such model; decision D-07) |
| R-01 | VW-22, PR-22 | Corrections existed in the API only | "Pay corrections" card on the reconciliation dialog and on the employee Earnings and Salary tabs: original → corrected → difference, record, approve / reject by a second user, reverse once, history with status, names and run | `VisitPayCorrectionsCard.tsx`, `usePayItems.ts`, `pay-items.service.ts` | ui (8); int `pay-corrections` (9); http; **browser**: recorded as one user, approval refused for the same user, approved as a second user | DONE |
| R-06 | PR-05, PR-19 | "Paid" meant different things on different screens; a closed UK run or a typed reference read as "bank paid"; a cancelled run still showed "In UK payroll"; UK-settled visits were in no total | One projection (`earning-status.util`) used by the office API and the carer app; cancelled runs excluded; UK-settled visits counted as settled | `billing/earning-status.util.ts`, `payroll-runs.service.ts`, `earning-stage.ts`, two employee panels | unit (10); http `earning-status` (6: every route into payroll, cancel, correction, branch list, carer app); ui (4); browser | DONE |
| R-07 | VW-06 | Once pay was settled the overrun decision was refused altogether | Charge-only decision and charge corrections on a settled visit; pay snapshot untouched | `visit-reconciliations.service.ts` | int `pay-charge-separation` (5); e2e | DONE. Not separately tested: a charge already on an approved invoice (the existing invoice guard refuses it) |
| R-04 | VW-15 | An office correction on a visit still in progress wrote an event only | The office time is stored in that carer's trust record and becomes the start or finish at completion; a carer who then contradicts it is held for review | `ecm/ecm-manual-attendance.service.ts` | http `carer-app-attendance` (3 cases) | DONE. Whether the office time should also change what the carer sees mid-visit is decision D-06 |
| R-10 | SI-11 | No HTTP-level tests of pay controllers | Test application with real modules, guards and JWTs | `test/payroll-int/http-harness.ts` | http `http-payroll-api` (67): authentication, permissions, explicit grants, maker/checker, transitions, validation, scope | DONE |
| R-12 | SI-15 | Admin roles could not be chosen for the approval job and were shown as always holding it; nobody could see who approves | "Pay authorisation — who can do it today" (users per power, warnings); admin roles choosable; organisation-wide pay access travels with the pay jobs | `role-responsibilities/*`, `FinancialAuthorityCard.tsx`, `ResponsibilitiesPanel.tsx` | unit (14); http (5); ui (3); browser (read-only, on the development system) | DONE. Who holds the powers is decision D-01; nobody was assigned |
| R-09 | PR-20 | "Paid" overstated settlement; no room for bank states | Payment state machine with the full vocabulary; only transitions a person can evidence are supported; `settlementSource`; screens say "payment recorded manually — not confirmed by a bank" | `billing/payment-state.util.ts`, `employee-payouts.service.ts`, migration 7, payout screens | unit (7); int `payouts` (+3); http; browser | DONE as a foundation. Bank file, provider responses and confirmed settlement are **BLOCKED** on decision D-04 |
| R-11 | — | Changed screens had not been exercised with data | A second instance of the application on the payroll test database; flows exercised with synthetic data | `scripts/payroll-test-server.mjs`, `scripts/payroll-test-preview.mjs` | browser, see doc 09 sections 4 and 6 | DONE in the Gate B sprint (section 0): the remaining flows were carried out in a browser |

### Regression verification of earlier fixes

| ID | Asked for | Evidence | Status |
|---|---|---|---|
| PC-21 | Sunday 23:59, midnight, clock changes, bank holidays, actual and substitute holidays, fixed and hourly rate, pay and charge | unit `pay-time-band.all-day.spec` (14), `charge-time-band.all-day.spec` (6); int `rate-regressions` (6) through the real reconciliation service and the bank holiday calendar | DONE. Finding: 25 and 26 December and 1 January are premium days by date as well as their substitute days (decision D-13) |
| PC-02 | Create custom band → save → reload → edit → preview → publish; frontend and API tests | http `pay-card-api` (2); ui `BillingCardRulesEditor.custom-period` (3) | DONE. The walk-through was run over HTTP, not clicked in a browser |
| EL-09 | One top-up in draft, approved and locked run, UK gross, employee totals, exports | int `minimum-wage` (2), http `minimum-wage-flow` (4) | DONE. Found and fixed: the export double-counted hours |

### Issues found during validation

| # | Found by | Issue | Outcome |
|---|---|---|---|
| V-1 | R-06 work | A visit in a cancelled UK run still showed "In UK payroll" and was left out of "remaining" | Fixed (`1085a80`) |
| V-2 | R-12 test | Saving the approval job would have removed organisation-wide pay access from every other role (a side effect of R-05) | Fixed before release (`5ea70f2`) |
| V-3 | EL-09 test | Pay run export: a carer's total hours counted the visit again for each top-up or mileage line | Fixed (`205b066`) |
| V-4 | End-to-end test | Support carer clocking out after the lead closed the visit: finish time taken from the app as sent, future times accepted, row stayed approved | Fixed (`60e5aa0`) |
| V-5 | Browser | Mileage and manual pay could be typed on a settled visit and were refused only on save | Fixed (`d2c0a31`, `01da8a2`) |
| V-6 | Final test run | Two tests changed meaning once the organisation settings row existed (its tolerance default is 20 / 30 minutes, not 15) | Tests pin the setting; rule recorded as decision D-14 |
| V-7 | PC-21 test | Actual and substitute holiday days are both paid at the premium | Existing behaviour; decision D-13 |
| V-8 | End-to-end test | Mileage defaults to 55p a mile in code (`UK_MILEAGE_RATES_2026_27`) | Not changed; to be checked against the HMRC approved rate before use (doc 05) |
| V-9 | Frontend tests | Component tests could not run on this machine: `@testing-library/dom` (a locked peer dependency) was not installed | Installed locally; `package.json` unchanged. A clean `npm ci` installs it |
| V-10 | Reports | The frontend type-check command used earlier in this programme named a config file that does not exist, so it checked nothing | Re-run with `tsconfig.json`: no errors |

---

## 2. Phase 0 — result by audit item

| Audit ID | Original issue | Fix | Tests | Status | Remaining risk |
|---|---|---|---|---|---|
| SI-01 | Same visit can be in two visit pay runs; last lock wins | `PayrollRunLine.claimKey` unique across all runs; lines written in one transaction; calculation leaves out sources another run holds and retries; lock re-checks every visit | `duplicate-claims` (10), `payroll-claim.util.spec`, e2e | DONE | Lines calculated before this change hold no claim until the run is recalculated; lock refuses them |
| SI-02 | Overlapping runs not prevented | Overlap stays allowed; paying one source twice is prevented | `duplicate-claims`, e2e (supplementary run) | DONE | — |
| SI-03 | Pay items / activity paid once (manual check only) | Same claim mechanism | `duplicate-claims` "pay item" | DONE | Overtime premium and rolled-up holiday are derived per run (Phase 3.3) |
| SI-08 | Failed calculation leaves run in CALCULATING | Status restored on failure; a run is taken atomically | `duplicate-claims` "failed calculation" | DONE | — |
| PR-05 | UK run takes provisional visits, later run collects them again; cancelled run strands earnings | Closing claims provisional visits; settled visits skipped; **cancel releases claims (R-08)** | `uk-provisional` (6), `uk-cancellation` (12) | DONE | Whether provisional visits should feed payroll at all is decision D-03 |
| VW-23 | Reconciliation never locked; guards dead | "Pay settled"; service guards; database triggers; settled visit not editable on screen | `locked-history` (7), `pay-settlement.util.spec` | DONE | Charge side protected only by invoice rules |
| SI-05 | Bulk recalculation reprices locked visits | Settled visits are never repriced | `locked-history` | DONE | — |
| VW-22 | Correction after closure: record changes, pay does not | Correction ledger, second approval, one-time reversal, **screen (R-01)** | `pay-corrections` (9), ui (8), browser | DONE | Authority and value thresholds are decision D-10 |
| PR-13 | Locked lines are snapshots but visits are not; closed UK runs reopen freely | Triggers; reopen needs its own power and is refused once a payout is approved or a live FPS exists | `locked-history`, `uk-provisional` | DONE | Reopening still reverses year-to-date; decision D-09 |
| PR-22 | Backpay is manual, no difference calculation | Difference against everything settled so far | `pay-corrections` | DONE | Rate-change arrears across many visits are one correction per visit (Phase 1.5) |
| VW-11 | Reassignment after completion leaves two payable rows | Removed carer's row withdrawn; paid case held for a manager | `reassignment` (3) | DONE | Recovering the first payment is a manual correction (D-08) |
| SI-09 | Monthly job approves payouts and marks them paid | Job proposes DRAFT only | `payouts` (9), e2e | DONE | — |
| PR-18 | Payout allowed before UK run is closed | Closed runs only | `payouts`, http | DONE | — |
| PR-20 | "Paid" is a flag with no evidence | Reference and date required; **classified as manually recorded, never as confirmed (R-09)** | `payouts`, `payment-state.util.spec` | PARTIAL | No bank file, provider confirmation, failed or returned payments (D-04, Phase 6.3) |
| SI-06 | Delete-all / purge / reset endpoints live | Environment gate, explicit permission, audit, triggers | `controls` (10), http | DONE | `audit_logs.delete` rows already granted stay granted (the environment check still applies) |
| VW-02 | Carer app can send its own start and end | Server check-in is the start; reported times are evidence; uncorroborated times hold that carer's row; future times refused; **all three completion paths, per carer (R-02, R-03)** | `visit-time-trust.util.spec` (18), `carer-app-attendance` (16) | DONE (server) | Mobile app not observed; tolerance is 15 minutes (D-05) |
| VW-15 | Office attendance corrections do not reach pay | Completed visit: times updated, draft pay repriced, settled pay gets a pending correction. **Open visit: used at completion (R-04)** | `attendance` (5), `carer-app-attendance` | DONE | D-06 |
| SI-07 | Money decisions not audited | Audited: visit decisions, pay runs, payouts, corrections, reversals, resets, UK run cancel with reason, role responsibility changes | `controls`, `payouts`, `pay-corrections`, `uk-cancellation` | DONE | — |
| SI-15 / PR-12 | No separation of duties | Maker / checker; separate permissions; **who holds them is visible and warned about (R-12)** | `controls`, `payouts`, `permissions.guard.spec`, http | DONE | Pay card publication has no approval yet (Phase 1.5) |
| SI-11 | No guard or controller tests | Guard spec; **67 HTTP tests (R-10)** | `permissions.guard.spec` (6), `http-payroll-api` (67) | DONE | — |
| SI-10 | Admin users see every branch | **Branch scope on pay (R-05)** | `http-payroll-api` | PARTIAL | Legal-employer scoping BLOCKED on D-07 |
| VW-25 | Manual payable amount allowed with `employees.update`, unaudited | Needs `billing.visit_reconciliations.manage`; audited; refused on settled visits | `controls`, `locked-history` | DONE | — |
| VW-06 | Overrun pay and charge decided together | **Charge decided separately once pay is settled (R-07)** | `pay-charge-separation` (5) | DONE | — |

### Items verified and deliberately not changed

| Audit ID | Verified | Why left |
|---|---|---|
| EL-11, EL-12, EL-16, PR-06, PR-08, PR-09, PR-10 | Present as audited | Phases 4–5 |
| TR-13 | Mileage not in payouts, as audited at Gate A | Fixed in the Gate B sprint (section 0) |
| PC-23, WM-02 | Present as audited | Phases 1 and 3 |

---

## 3. Phases 1 and 4 — items that needed no policy decision

| Audit ID | Original issue | Fix | Tests | Status |
|---|---|---|---|---|
| PC-21 (1.1) | All-day band stored as 00:00–23:59 left 23:59–00:00 uncovered | Bands are half-open; an end of 23:59, or no end, means the end of the day | Section 1, regression table | DONE; charge results now tested |
| PC-02 (1.3) | A rule set to "Custom…" could not be saved | The custom entry has a real value | Section 1, regression table | DONE |
| EL-09 (4.1) | Minimum wage top-up counted twice in run gross | Run gross is the sum of its lines | Section 1, regression table | DONE. Top-up is still assessed on the visit pay run period (EL-08, Phase 4.3) |

---

## 4. Gate A

See `08-release-readiness.md` for the four sub-gates and for Gate B. In short: the financial-integrity criteria are met in tests; attendance is verified on the server (now also under concurrency) but not with the mobile app; access is enforced for branches, not for legal employers; migrations were rehearsed on synthetic history (13 migrations, 45 checks). Gate A is **not signed off**: independent review, client decisions and user acceptance testing have not taken place. Gate B (pay card correctness) is met in tests for the items in section 0 and is likewise not signed off.
