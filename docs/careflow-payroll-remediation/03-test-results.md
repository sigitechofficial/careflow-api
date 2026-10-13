# 03 — Test Results

**Run:** 2026-10-12, local development machine · branch `payroll-remediation/gate-a` in both repositories (backend `c53dd9a`, frontend `01da8a2`)

No test touched the development database's business data, a live system, HMRC or a bank. Integration tests run against a separate local database that holds synthetic rows only. The migration rehearsal uses a third, scratch database that it creates and drops.

---

## 00. Gate B2 (run of 2026-10-13, branch `payroll-remediation/gate-b2`, backend `79ced6f`, frontend `e259ab2`)

Sections 0 to 7 below are the earlier sprints' results and are kept as they were. This section is the current state.

### 00.1 Summary

| Suite | Suites | Tests | Passed | Failed |
|---|---|---|---|---|
| Backend payroll integration, incl. HTTP (`npx jest --config ./test/jest-payroll-int.json`) | 38 | 385 | 385 | 0 |
| Backend unit: `src/billing`, `src/payroll`, `src/common/guards`, `src/role-responsibilities` | 59 | 461 | 461 | 0 |
| Backend unit, whole repository (`npx jest`) | 350 | 2,761 | 2,743 | 18 in 10 suites: the same suites and tests as at Gate A and Gate B, none in a module this programme touches |
| Migration rehearsal (`npm run payroll-migration-rehearsal`) | — | 58 checks | 58 | 0 |
| Frontend: `src/features/billing`, `src/features/payroll` | 11 files | 59 | 59 | 0 |
| Frontend, whole repository (`npx vitest run`) | 236 files | 1,316 | 1,300 | 16, the same 16 as at Gate A and Gate B, plus Playwright files Vitest cannot load. One billing test was added after this run; it is in the row above |
| Backend type-check (`npx tsc --noEmit -p tsconfig.build.json`) | — | — | no errors in `src` or `test` | |
| Frontend type-check (`npx tsc --noEmit -p tsconfig.json`) | — | — | 0 errors | |
| Browser (test instance, synthetic data, two users) | 5 flows | — | 5 | 0 (doc 09 section 10) |

Growth since Gate B: integration 26 → 38 suites, 264 → 385 tests; billing and payroll unit 349 → 461; rehearsal 45 → 58 checks; frontend 1,293 → 1,317 tests (24 new, all passing).

### 00.2 New test files

| File | Tests | What it proves |
|---|---|---|
| `test/payroll-int/non-visit-holds.int-spec.ts` | 8 | R-22: training, on-call, pay items, overtime and rolled-up holiday that cannot be worked out are held with a reason, retried by recalculating, carried or block the lock |
| `src/billing/holiday-calendar.r27.spec.ts`, `test/payroll-int/calendar-holds.int-spec.ts` | 17, 9 | R-27: expected holidays per nation against GOV.UK data; holds for England and Wales, Scotland, Northern Ireland, missing years, substitute days, midnight |
| `test/payroll-int/mileage-corrections.int-spec.ts` | 7 | D-21, D-20: correction as mileage with tax split, across a tax-year change and the threshold, reversal, payout reconciliation, release of earlier mileage |
| `src/payroll/salary.util.spec.ts` | 24 | Agreement timeline, three proration methods, salary cover per line and per week, guarantee of a week |
| `test/payroll-int/salary-gross.int-spec.ts` | 21 | Monthly and annual salaried; starter; leaver; increase; decrease; salary with covered visits; with separately paid work; with expenses; corrected after close; supplementary run without a second salary; undecided cover held |
| `test/payroll-int/salary-agreements-api.int-spec.ts` | 9 | Entry per year, month, week; required terms; approval by a second person with a named power; history; leaver; hourly unchanged |
| `test/payroll-int/overtime-weeks.int-spec.ts` | 7 | A week inside one run; divided between two; two open runs; a late visit; weeks do not carry over; premium on base rate |
| `test/payroll-int/guaranteed-hours.int-spec.ts` | 13 | No agreement, no pay; top-up; full week; divided week; part week; travel counted when stated; paid leave; absence; undecided visit; late visit; minimum wage; API |
| `src/billing/travel-interval.util.spec.ts`, `test/payroll-int/travel-intervals.int-spec.ts` | 5, 7 | Categories; estimate labelled; approved intervals replace it; rest break unpaid; second person; policy categories; refusals |
| `src/billing/visit-disruption.util.spec.ts`, `test/payroll-int/visit-disruptions.int-spec.ts` | 5, 8 | No rule is not zero; rules by notice; each event; rule that cannot be worked out; rule approval and retirement; paid once; undecided cancellations |
| `src/billing/nmw-period.util.spec.ts`, `test/payroll-int/nmw-reference-period.int-spec.ts` | 16, 11 | Period from the payroll schedule; whole-period assessment across runs; top-up once; age at period start; apprentices; salaried; excluded pay |
| `src/payroll/leave.util.spec.ts`, `test/payroll-int/leave-entitlement.int-spec.ts` | 14, 11 | Leave year; entitlement by category; balance; carry-over; 52-week rate; leaver; rolled-up eligibility |
| `test/payroll-int/e2e-gate-b2.int-spec.ts` | 10 | The fifteen validations on one synthetic period (doc 09 section 9) |
| `care-admin`: `PayrollRunAttentionList.test`, `VisitMileageCorrectionCard.test`, `PayAgreementsPanel.test`, `TravelAndDisruptions.test` | 2, 4, 8, 10 | The new screens |

### 00.3 Tests that failed first

Written before the fix and seen to fail, or the defect was read in the code path and the test added with the fix: R-22 (8 of 8 failed before), R-27 (run test showed a false top-up and a visit lost at lock: V-22), salary double payment (the "salary plus covered visits" case paid £2,042.00 before), overtime across two runs (paid £0.00 before), apprentice of 25 (apprentice rate before), a monthly run with a low week (no top-up before).

During the phase these failed and were then fixed in the code, not in the test: the first R-22 rule was too strict and blocked ten existing suites (a missing employment record is not a card failure); a hold was missing when a second open run already held a period's top-up; the travel card described the visit's own minutes as a zero estimate.

### 00.4 Existing tests changed

`pay-card-conflicts.int-spec` and `holiday-calendar.int-spec` (a held line is now a `HELD_EARNING` line; the Scotland case uses a holiday the calendar decides, since 25 December is a premium day by date); `earning-status.int-spec` (seeds its own cards); `payroll-claim.util.spec` (+1). No expected amount was lowered or removed.

### 00.5 How to run

```
# in careadmin-backend
npm run payroll-test-db                                  # builds the synthetic test database
npx jest --config ./test/jest-payroll-int.json           # integration and HTTP
npx jest src/billing src/payroll src/common/guards src/role-responsibilities
npm run payroll-migration-rehearsal                      # scratch database, created and dropped
npx tsc --noEmit -p tsconfig.build.json
# in care-admin
npx vitest run src/features/billing src/features/payroll
npx tsc --noEmit -p tsconfig.json
```

### 00.6 Limits

- Tax and NI in these tests are a stand-in. Nothing here is a statutory payroll test.
- The statutory minimum wage rates used are the constants already in the code; they were not re-verified.
- Concurrency (two runs calculated at the same moment) is covered by the unique claim and the retry, and was exercised in one process only.
- The carer mobile app was not available; nothing it captures was observed.
- Browser flows were run on the synthetic test instance through the page's own controls driven by script, because the embedded browser pane does not draw; each result was read back from the page and confirmed in the database.

---

## 0. Gate B sprint (run of 2026-10-12, branch `payroll-remediation/gate-b`, backend `9315a95`, frontend `b36a61f`)

Sections 1 to 7 below are the Gate A sprint's results and are kept as they were. This section is the current state.

### 0.1 Summary

| Suite | Suites | Tests | Passed | Failed |
|---|---|---|---|---|
| Backend payroll integration, incl. HTTP (`npm run test:payroll-int`) | 26 | 264 | 264 | 0 |
| Backend unit: `src/billing`, `src/payroll` | 48 | 349 | 349 | 0 |
| Backend unit, whole repository (`npx jest`) | 344 | 2,679 | 2,661 | 18 in 10 suites, none in a module this programme touches (0.4) |
| Migration rehearsal (`npm run payroll-migration-rehearsal`) | — | 45 checks | 45 | 0 |
| Frontend: `src/features/billing`, `employees`, `auth`, `payroll`, `components/layout` | 16 files | 86 | 86 | 0 |
| Frontend, whole repository (`npx vitest run`) | 232 files | 1,293 | 1,277 | 16, the same 16 as at Gate A (section 6.4), plus Playwright files Vitest cannot load |
| Backend type-check (`npx tsc --noEmit -p tsconfig.build.json`) | — | — | no errors in `src` | |
| Frontend type-check (`npx tsc --noEmit -p tsconfig.json`) | — | — | 0 errors | |
| Browser (manual, test instance, synthetic data) | 6 flows | — | 6 | 0 (doc 09 section 6) |

Growth: integration 193 → 264 tests (19 → 26 suites); frontend 1,268 → 1,293 tests (25 new, all passing).

### 0.2 New and changed tests

| Suite | Kind | Tests | What it proves |
|---|---|---|---|
| `attendance-concurrency` | int | 11 | **R-16.** Two and three carers at the same instant; the office during a completion; two offices at once; a repeated delivery; a failed transaction retried; old evidence imported once; a settled carer untouched |
| `pay-evaluation-failures` | http | 7 | **R-17.** No employment record → held with the reason and the charge priced; an unexpected error kept without its text, retried, closed, audited; dismissal needs a reason; branch scope |
| `approval-evidence` | http | 10 | **R-18.** Late clean clock-out re-approved automatically; contradictory time held; other carer untouched; duplicate delivery changes nothing; a manager's approval goes to review with the reason; settled pay flagged then answered; old approvals adopt |
| `http-payroll-api` | http | 68 (+1) | **R-13.** Branch lists and organisation-only routes for a branch-limited user |
| `rate-regressions` | int | 7 (+1) | **PC-19.** A fixed fee just after midnight in summer time |
| `pay-card-conflicts` | http | 15 | **PC-32.** Two organisation defaults; two role cards; two branch cards and a carer in two branches; individual against branch; personal card settles a conflict; funder override against normal and two overrides; future-dated card and the form check; rate changed after the visit; historic ambiguity; conflict during a pay run; concurrent publication; concurrent assignment; concurrent funder overrides; card start on its local day; branch scope of the lists |
| `funding-history` | int | 6 | **PC-10.** Change of funder both ways; undated funding already on record; records that cannot say (held only when it matters, settled by entering the date); funder that started later; approved visit not re-priced |
| `holiday-calendar` | http | 11 | **PC-22 to PC-24.** Substitute days recorded; default basis unchanged; the basis needs permission and a reason and is audited; actual-day and statutory-day results; client charge unaffected; approved visit keeps its pay; Scotland; organisation special day; status with gaps and the preview warnings; GOV.UK import |
| `mileage-settlement` | http | 9 | **TR-09 / TR-13.** £154.00 and £3.41 apart from visit to payment, paid once; cancelled batch; part above the verified approved amount taxed; year-to-date across runs, inside a run and over 6 April; change of rate by date; correction before and after lock; deleted run; no rate → exception line; rates API |
| `visit-time-trust.util.spec` | unit | 20 | Merge rules for completion and office times |
| `pay-evaluation-failure.util.spec`, `approval-evidence.util.spec` | unit | 6 + 9 | Classification without leaking error text; approval outcomes |
| `local-day.pc19.spec` | unit | 15 | Local day for fixed fees, night duty, travel, mileage, waiting; clock changes |
| `pay-card-conflict.pc32.spec` | unit | 13 | Tie at the winning level → none chosen; wording; overlap; all overrides / own-card rows of a day |
| `funding-at-date.pc10.spec` | unit | 8 | Funder on the day; unclear cases; split funding; inclusive, local dates |
| `holiday-calendar.pc22.spec` | unit | 20 | Substitute days; three bases; Scotland; organisation days; completeness per nation |
| `mileage.tr09.spec` | unit | 15 | Rates by date; verified amounts only; tax year; threshold; tax split |
| `payroll-payslip.util.spec` | unit | +3 | Reimbursement, total payable, "not verified" note |
| `PayEvaluationFailuresCard`, `pay-scope`, `PayCardConflictNotice`, `BankHolidaysPanel`, `PayableBreakdown` | ui | 5 + 4 + 7 + 6 + 3 | The new screens and notices |

### 0.3 Tests that failed first

| Fix | What failed on the unfixed code |
|---|---|
| R-16 | Old read-modify-write kept 1 of 8 concurrent records, 5 runs out of 5 |
| PC-19 | 8 of 14 unit tests (for example £8 instead of £10; £60 instead of £70) |
| PC-32 (locks) | With the locks removed: two cards covering the same day after two changes at once; two funder overrides after two requests at once |
| PC-10 | 4 of 6 integration tests (override not applied before a change of funder; applied to work the old funder paid for) |
| TR-13 | By inspection of the payout code: the amount was net pay only. The new end-to-end test asserts the reimbursement on the payout line |

### 0.4 Failures outside this programme

`npx jest` over the whole backend: 18 tests fail in 10 suites — `policies` (2 suites), `dev-tools/ia-autofill-complete-catalog`, `initial-assessments/care-plan-ia-demo-overlay`, `service-user-care-plans/…/falls-care-plan.suggestions`, `service-users-medical/medical-clinical.migration`, `service-users/service-user-date-of-death.util`, `compliance-reports/compliance-board-enrichment.util`, `employee-app/employee-app-auth.service`, `employee-app/employee-app-body-map-pins.util`. None of these files, and nothing they test, was changed in this sprint. **The same 10 suites and 18 tests fail on the Gate A commit `035e482`** (run on that commit for comparison). They are not payroll failures and were not fixed here.

Frontend: the same 16 tests as at Gate A (Playwright end-to-end files run by Vitest, scheduling, service users, alerts).

### 0.5 How to run

```
npm run payroll-test-db                      # test database: schema, triggers, mileage rate defaults
npm run test:payroll-int                     # 26 suites, 264 tests
npx jest src/billing src/payroll             # 48 suites, 349 tests
npm run payroll-migration-rehearsal          # 45 checks on a scratch database, dropped afterwards
PAYROLL_BROWSER_LOGIN_FILE=<file outside the repository> npm run payroll-test-browser-seed
```

### 0.6 Limits

- The tax and NI figures in `mileage-settlement` come from the application's own calculation and the statutory rate set the test database seeds. The tests assert relations (a twin carer without mileage has the same tax, NI and net; net = gross − tax − NI; the taxable excess is inside gross). They do not validate the statutory tables against HMRC.
- Every rate in the tests is a labelled synthetic value.
- Concurrency tests run in one process against one database.
- Browser checks were manual, in an embedded browser; there are no automated browser tests.

---

## 1. Summary

| Suite | Suites | Tests | Passed | Failed |
|---|---|---|---|---|
| Backend payroll integration, incl. HTTP (`npm run test:payroll-int`) | 19 | 193 | 193 | 0 |
| Backend unit: billing, payroll, ecm, visit-attendance, job-allocations, scheduled-jobs-housekeeping, service-user-referrals, common, role-responsibilities, audit-logs | 81 | 479 | 479 | 0 |
| Backend unit: `src/employee-app` | 32 | 183 | 181 | 2 (unrelated, see 6.3) |
| Migration rehearsal (`npm run payroll-migration-rehearsal`) | — | 28 checks | 28 | 0 |
| Frontend, wages scope (`npx vitest run src/features/billing src/features/employees/lib src/features/settings`) | 8 | 37 | 37 | 0 |
| Frontend, whole repository (`npx vitest run`) | 227 files | 1,268 | 1,252 | 16 (unrelated, see 6.4), plus 13 Playwright files that Vitest cannot load |
| Backend type-check (`npx tsc --noEmit -p tsconfig.json`), `src` and `test/payroll-int` | — | — | no errors outside pre-existing spec / seed files | |
| Frontend type-check (`npx tsc --noEmit -p tsconfig.json`) | — | — | 0 errors | |

### How the figures grew, and the 55 / 56 question

| Point | Integration suites | Integration tests |
|---|---|---|
| End of Phase 0 | 9 | 54 |
| After Phases 1.1 / 4.1 (`minimum-wage`, 2 tests) | 10 | **56** |
| End of the Gate A sprint | 19 | 193 |

The previous version of this report said "56" in its summary while the per-suite table added up to **55**. The table was wrong: it listed `controls` with 9 tests; the suite has 10 (it had 10 at that commit too). Fifty-six was the true figure. The per-suite table below is taken from the Jest JSON output of the final run, not typed by hand.

---

## 2. Commands

```bash
npm run payroll-test-db
```

```bash
npm run test:payroll-int
```

```bash
npx jest src/billing src/payroll src/ecm src/visit-attendance src/job-allocations src/scheduled-jobs-housekeeping src/service-user-referrals src/common src/role-responsibilities src/audit-logs
```

```bash
npm run payroll-migration-rehearsal
```

Frontend (`care-admin`):

```bash
npx vitest run src/features/billing src/features/employees/lib src/features/settings
```

```bash
npx tsc --noEmit -p tsconfig.json
```

`payroll-test-db` creates `<dev database>_payroll_test` on the local PostgreSQL server (it refuses any other host), pushes the Prisma schema and applies the trigger migrations. The harness refuses any database whose name does not end in `_payroll_test`.

Actual output of the final runs:

```text
payroll integration   Test Suites: 19 passed, 19 total   Tests: 193 passed, 193 total
unit (command above)  Test Suites: 81 passed, 81 total   Tests: 479 passed, 479 total
src/employee-app      Test Suites: 2 failed, 30 passed, 32 total   Tests: 2 failed, 181 passed, 183 total
migration rehearsal   28 of 28 checks passed
frontend wages scope  Test Files 8 passed (8)   Tests 37 passed (37)
frontend whole repo   Test Files 21 failed | 206 passed (227)   Tests 16 failed | 1252 passed (1268)
```

---

## 3. Integration suites (final run)

Two kinds. **Service level**: real services, real PostgreSQL, real constraints and triggers; collaborators not under test are small stubs and the audit stub records calls. **HTTP**: the whole application module with only the database client replaced, real controllers, guards, validation and JWTs; scheduled jobs stopped; push notifications stubbed; the clock is controlled where attendance times matter.

| Suite | Kind | Tests | What it proves |
|---|---|---|---|
| `duplicate-claims` | service | 10 | Same visit in two runs → one line. Two runs calculating at once → one line per visit. Idempotent recalculation. Double-up → one line per carer. Supplementary run pays only new work. Database refuses a duplicate claim. Failed calculation → retry works. Pay item claimed once under concurrency |
| `uk-provisional` | service | 6 | Visit paid provisionally by a closed UK run is not collected again by any route. Two UK runs with the same visit cannot both close. Reopening releases claims and is refused once a payout is approved |
| `uk-cancellation` | service | 12 | **R-08.** Cancel releases locked lines and provisional visits; replacement collects each once; snapshot kept; cancelled run's claims do not block; cancel refused with a payout batch or live FPS; concurrent cancel and close → one wins; two runs collecting at once → no duplicate; failed transaction leaves claims intact; salary and deduction claimed per period; reactivation starts clean; reason audited |
| `locked-history` | service | 7 | Settled pay cannot change through the service or directly in the database; a locked run cannot be recalculated, re-approved or discarded |
| `pay-corrections` | service | 9 | Positive and negative corrections as separate approved adjustments; same correction twice pays once; two simultaneous submissions → one item; reversal once. **R-01:** history shows original / corrected / difference and each stage; a rejected correction is kept and does not block; a visit settled by a UK run uses its settled amount |
| `pay-charge-separation` | service | 5 | **R-07.** Charge-only overrun decision on a paid visit; pay-side decision still refused; pay basis kept; charge quantity and amount corrected; rate change reprices charge only |
| `reassignment` | service | 3 | Removed carer withdrawn before pay; after pay the replacement is held for a manager |
| `payouts` | service | 9 | Job proposes DRAFT only; closed run required; preparer cannot approve; PAID needs evidence; audit. **R-09:** typed reference → `MANUALLY_RECORDED`, never confirmed; legacy paid batch reads the same; cancelled is not paid |
| `controls` | service | 10 | Bulk deletion refused in four environment combinations (5 cases); maker / checker on visit pay run and UK close; recalculation withdraws approval; audit of run and visit decisions |
| `attendance` | service | 5 | Office correction reprices unpaid pay; on a paid visit raises one pending correction; unverified time holds and still prices; verification clears |
| `minimum-wage` | service | 2 | One top-up line; gross equals the legal hourly rate |
| `rate-regressions` | service | 6 | **PC-21** through the real reconciliation service and the calendar table: Sunday into Monday; clock change; substitute holiday; 25 / 26 December and 1 January by date; a card's own Christmas rate; fixed fee versus hourly; pay and charge each time |
| `di-wiring` | service | 1 | The application module graph resolves |
| `http-payroll-api` | HTTP | 67 | **R-10, R-05, R-12.** Authentication and permission on 45 route cases; Super Admin does not hold the six powers; run lifecycle with maker / checker and transitions; corrections; payout batch; UK close / reopen / cancel; branch scope (8); who holds the powers (5) |
| `carer-app-attendance` | HTTP | 16 | **R-02, R-03, R-04.** Carer session required; normal visit; reported earlier start not paid; future finish refused; missing check-in held; offline upload held then corrected; repeated completion; overnight; late start within tolerance paid as planned; double-up per carer, both orders of completion; three carers; office time before completion; office time contradicted; office correction for one carer of two |
| `earning-status` | HTTP | 6 | **R-06.** Stage at every step of the visit-pay-run route and the direct UK route; cancelled run gives the earning back; correction shows; branch list totals; carer app shows the same stage |
| `pay-card-api` | HTTP | 2 | **PC-02.** Create with a custom band → reload → edit → preview → publish → new version; validation and permission |
| `minimum-wage-flow` | HTTP | 4 | **EL-09.** One top-up in draft, recalculated, approved and locked run; not repeated by a later run; once in UK gross; once in export and carer totals |
| `e2e-gate-a` | HTTP | 13 | One synthetic month end to end (doc 09) |

**New or extended unit suites in this sprint:** `earning-status.util.spec` (10), `payment-state.util.spec` (7), `financial-authority.util.spec` (6), `role-responsibilities.catalog.spec` (8, 4 new), `pay-settlement.util.spec` (7, 1 new), `charge-time-band.all-day.spec` (6), `visit-time-trust.util.spec` (18, rewritten for per-carer and office times).

**Frontend tests added:** `VisitPayCorrectionsCard.test.tsx` (8), `ResponsibilitiesPanel.test.tsx` (3), `earning-stage.test.ts` (4), `BillingCardRulesEditor.custom-period.test.tsx` (3).

---

## 4. Database and migration tests

| What | Result |
|---|---|
| Unique claim index on pay lines, on UK input lines; one reversal per item | Refuse a duplicate (integration tests and rehearsal) |
| Triggers on locked runs, lines and paid visits | Refuse direct updates and deletes (`locked-history`, rehearsal) |
| Migrations 1–7 on the pre-remediation schema with synthetic history | 28 of 28 checks (doc 04, section 5) |
| Schema after migrations equals `schema.prisma` | Empty diff |
| Rows before and after the migrations | Identical counts in the eight pay tables |

---

## 5. Browser tests

Run against a second instance of the application (API on port 3101, app on port 5174) connected to the payroll test database after the end-to-end month had filled it. Two synthetic office users. Detail and limits in doc 09, section 4.

| Flow | Result |
|---|---|
| Employee → Earnings: stage per visit, settled total, "Pay corrections" link on settled visits | As expected |
| Record a correction (£14.00 → £21.00) as user 1 | Recorded; +£7.00 pending; "Approve" disabled for user 1 with the explanation |
| Open the same visit from Visit reconciliation as user 2; approve | "Approved for payroll · entered by … · approved by …" |
| Settled visit: mileage and manual pay | Not editable; pointer to pay corrections |
| Employee payouts, all history | "Payment recorded manually", "not confirmed by a bank" |
| Roles & permissions → Responsibilities (on the development system, read only) | Users per power; four warnings because nobody holds the approval powers; admin roles choosable |

Not clicked in a browser: approving and locking a pay run, closing a UK payroll run, recording a payment, reversing a correction, the pay card walk-through. These are covered over HTTP.

---

## 6. Known limitations

1. **The mobile carer app was not exercised.** The tests drive the endpoints the app calls, with the fields its DTOs accept. What the app really sends, its offline queue and its screens are untested: the source and a build were not available.
2. **Statutory calculation is replaced by a stand-in** in the end-to-end and UK-run tests (net pay is set by hand). Tax, NI and HMRC submission are outside Gate A.
3. **Two backend suites fail in `src/employee-app`** (`employee-app-body-map-pins.util.spec`, `employee-app-auth.service.spec`). Neither the files nor their subjects differ from the audited base commit.
4. **Sixteen frontend tests fail in eight files** outside the wages scope (alerts, scheduling timeline, service-user tabs, initial assessment, `src/test/utils.test.ts`); none of those files differs from the frontend base commit. Thirteen Playwright specs under `tests/e2e` are picked up by Vitest and cannot load there.
5. **Frontend component tests need `@testing-library/dom`**, a peer dependency that is in the lock file but was missing from the installed modules on this machine. It was installed locally; no project file changed.
6. **Concurrency tests** use concurrent calls in one process. They exercise the database constraints and conditional updates, not a multi-instance deployment or load.
7. **Per-carer trust records** are written by read-modify-write on the job's metadata. Two carers completing in the same instant could overwrite each other's record; not reproduced, not fixed.
8. **Integration tests assume a 15-minute duration tolerance** and now set it on every reset. A real organisation's setting is 20 minutes by default (decision D-14).
9. **Pre-existing type errors** remain in `prisma/scripts`, `prisma/seeds` and some spec files outside the wages scope. None in `src` or `test/payroll-int`.
10. **Browser coverage is partial** (section 5).

---

## 7. Reproduction evidence from earlier phases

| Area | Result on unfixed code |
|---|---|
| `duplicate-claims` | 7 of 10 failed |
| `payouts` | 5 of 6 failed |
| `pay-time-band.all-day` | 13 of 14 failed |
| `minimum-wage` | Run gross was £20.42 where £12.71 was expected |
| `uk-cancellation` (this sprint) | Written with the fix, so it did not run red first. The stranding follows from the old unique index on `sourcePayrollRunLineId`, which allowed one input line per pay line whatever the state of its run. The migration rehearsal seeds that situation on the old schema and shows the line is collectable after migration 6 |
| Support carer after lead (this sprint) | The end-to-end test failed first: row stayed approved with the app's time |
| Export hours (this sprint) | The EL-09 test failed first: total hours 2.00 for a one-hour visit |
