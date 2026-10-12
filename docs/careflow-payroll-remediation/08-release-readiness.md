# 08 — Release Readiness

**Updated:** 2026-10-12 (Gate B sprint)

**Nothing in this programme is production-ready.** No change has been deployed, pushed, used against live data, reviewed by anyone independent of its author, or put through user acceptance testing. Passing tests are evidence for the behaviours tested, on synthetic data, and nothing more.

---

## 1. Gate status

| Gate | Scope | Status |
|---|---|---|
| A — Financial containment | Phase 0, the Gate A sprint and Sprint A of the Gate B sprint | **Evidence complete for A1, A3 (branches) and A4 (synthetic history). A2 has one gap that development cannot close (the mobile app). Ready to be submitted for independent review and client UAT. Not signed off** |
| B — Correct care earnings | Phases 1–4 | **Pay card correctness and mileage settlement: evidence complete in the test environment (section 5a). Salary, guaranteed hours, overtime across runs, travel, cancellation pay, holiday and minimum wage period are not started and wait on client decisions. Not signed off** |
| C — Native statutory payroll | Phase 5 | Not started |
| D — Reporting and settlement | Phases 6–7 | Not started (payment state foundation only) |
| E — Production readiness | Phases 8–9 | Not started |

A sub-gate is marked **PASSED** only where every criterion has evidence. **PASSED** here means "passed in the test environment on synthetic data"; it is not a production sign-off.

---

## 2. Gate A1 — Financial integrity: PASSED (test environment)

| Criterion | Evidence | Result |
|---|---|---|
| No duplicate original earnings | Unique claim indexes on pay lines and UK input lines; `duplicate-claims` (10), `uk-provisional` (6), `reassignment` (3), `minimum-wage-flow` (4); end-to-end month: one original line per carer per visit, no claim key held twice; migration rehearsal | Met |
| No stranded unpaid earnings after a valid payroll cancellation | `uk-cancellation` (12) including concurrent cancel / close and failed transactions; `earning-status` (released earning shows as waiting again); end-to-end month (cancel → replacement collects £3,157.41 once); rehearsal (a line held only by a cancelled run becomes collectable) | Met |
| Locked financial records protected | Service guards and triggers; `locked-history` (7); rehearsal (5 trigger checks on migrated history); settled visits not editable on screen | Met |
| Corrections auditable | Correction ledger with original, corrected, difference, who entered, who approved, which run paid; `pay-corrections` (9); audit entries asserted; screen exercised in a browser | Met |
| No automatic payment settlement | Monthly job proposes drafts only (`payouts`, end-to-end); a paid batch is classified as manually recorded and can never read as confirmed (`payment-state.util.spec`, `payouts`) | Met |
| Financial approvals enforced | Six powers never implied by an admin role; maker / checker on pay run, UK close, payout, correction; 67 HTTP tests | Met |

What A1 does not say: that amounts are *correct* (Gate B and C), or that the controls hold under multi-instance load (not tested).

---

## 3. Gate A2 — Attendance and work records: NOT PASSED (one criterion open)

| Criterion | Evidence | Result |
|---|---|---|
| Real carer-app completion integration verified | The endpoints the app calls, over HTTP with carer tokens, through to pay run lines: `carer-app-attendance` (16), end-to-end month | **Server side met. The mobile app itself was not exercised**: its source and a build are not available to development |
| Double-up carers reviewed independently | Per-carer verification row with history; both orders of completion; three carers; office correction for one carer only; **two and three carers, and the office and a carer, at the same instant: `attendance-concurrency` (11)** | Met |
| Office corrections correctly affect earnings | Open visit: used at completion. Completed: repriced. Settled: pending correction, once | Met |
| Original attendance evidence preserved | Reported times kept in the trust record; attendance events append-only; office entries carry who, when and why | Met |

Added in the Gate B sprint: a pay calculation that fails is recorded and shown instead of being dropped (`pay-evaluation-failures`, 7), and an approval is tied to the evidence it was given on (`approval-evidence`, 10).

To pass: run the attendance scenarios of doc 09 with a build of the mobile app against the test instance, or have the app's maintainers confirm the completion payloads. This is the only open criterion of Gate A2 and it cannot be closed by development alone.

---

## 4. Gate A3 — Financial access and UX: PASSED for branches; employer scoping BLOCKED

| Criterion | Evidence | Result |
|---|---|---|
| Appropriate branch / employer restrictions enforced | `PayrollScopeGuard`; 8 HTTP tests and the end-to-end month: other branch → not found; organisation records → refused; pay audit hidden; carer sees own pay only | **Branch: met. Legal employer: blocked**, no such structure exists and none was invented (D-07) |
| Corrections screen works | 8 component tests; browser: recorded by one user, approved by another, on the reconciliation dialog and the Earnings tab | Met. Reversal was not clicked in the browser (covered by component and HTTP tests) |
| Payroll statuses are accurate | One projection for office and carer app; 10 unit, 6 HTTP, 4 component tests; browser | Met on the server and the admin app. The mobile app's own wording was not seen |
| Payroll permissions verified at API level | 45 authentication / permission route cases, explicit-grant checks | Met |
| Approver responsibilities configurable | Admin roles choosable; users per power; warnings; saving one job no longer strips another; 14 unit, 5 HTTP, 3 component tests; browser (read only) | Met |

The gap recorded at Gate A (screens for a branch-limited user, R-13) is closed: the menu and ten pages adapt, and a branch manager was exercised in a browser (doc 09 section 6): own branch's visits and wages shown, the other branch's not, organisation-wide pages explained instead of erroring.

---

## 5. Gate A4 — Migration and test readiness: NOT PASSED (two criteria partly open)

| Criterion | Evidence | Result |
|---|---|---|
| Migrations tested against representative historical records | Rehearsal on the pre-remediation schema with synthetic history: **45 of 45** checks, 13 migrations, including the six of the Gate B sprint | Met for synthetic history. **Not run on a copy of real data** (R-20) |
| Duplicate / backfill diagnostics recorded | Four read-only queries and the rehearsal's report (doc 04, sections 5–6) | Met |
| Unit and integration tests pass | **264 / 264** integration (26 suites); **349 / 349** unit in `src/billing` and `src/payroll` (48 suites); frontend in scope all passing; frontend type-check clean | Met. Unrelated failures documented and shown to be the same on the Gate A commit (doc 03, section 0.4) |
| Browser workflows verified | Gate A: corrections, earnings, payouts list, roles screen. **Gate B sprint: approve and lock a pay run, close a UK run, record a manual payment, reverse an approved correction, create / save / reload a custom pay card, wages as a branch-limited user** (doc 09 section 6) | Met. Automated browser tests do not exist yet (Gate E) |
| Remaining failures documented | Doc 03 section 6 | Met |
| No live data affected | Local databases only; the development database's business rows untouched; nothing pushed | Met |

To pass: R-20 (the pre-migration reports on a copy of real data, reviewed by finance). R-11 is done.

---

## 5a. Gate B — pay card correctness and mileage settlement: PASSED in the test environment for the items below

| Criterion | Evidence | Result |
|---|---|---|
| The day a rate belongs to is the local day | `local-day.pc19.spec` (15; 8 of 14 failed before), `rate-regressions`, `pay-card-conflicts` (a card starting at 00:15 in summer time) | Met |
| Two cards for one carer are never settled by the last edit | `pay-card-conflict.pc32.spec` (13), `pay-card-conflicts` (15): two organisation defaults, two role cards, two branch cards, individual against branch, funder override against normal, future-dated, rate changed after the visit, during a pay run, historic, concurrent publication and assignment; warning seen in the card form in a browser | Met. Operational consequence: decision D-17 |
| The funder is the funder on the visit day | `funding-at-date.pc10.spec` (8), `funding-history` (6; 4 failed before) | Met for carer pay |
| One holiday calendar: three nations, substitute days, organisation days, completeness | `holiday-calendar.pc22.spec` (20), `holiday-calendar` (11), `BankHolidaysPanel.test` (6); the official GOV.UK dataset is the import source | Met |
| Calendar and premium policy are separate; the policy is not decided in code | The basis is a setting with the old behaviour as default; approved visits and client charges do not move with it; an organisation day pays more only where a card has a rate | Met. The client's choice is D-13 |
| Mileage rates per period, not in code; HMRC amounts verified per period | `mileage.tr09.spec` (15), `mileage-settlement` (9) | Met. **The approved amounts have not been recorded by anyone**, so today every mileage line is "not verified" (D-15) |
| Year-to-date miles and threshold crossing | `mileage-settlement`: across runs, inside one run, tax-year boundary on 6 April, deleted run, recalculation | Met |
| Reimbursement reaches the payment once, apart from wages | `mileage-settlement`: £154.00 wages and £3.41 mileage through visit pay run, UK run, the application's own tax and NI calculation, payout, payslip and reconciliation; cancelled batch; part above the approved amount taxed | Met |
| Nothing historic is re-priced or paid by the change | Migration rehearsal (locked mileage line untouched; no historic run given a reimbursement); default basis; frozen approvals | Met |

What this does not say: that the statutory tables used by the tax and NI calculation are right (Gate C); that Allfor Care's rates, holiday basis or mileage policy are what the system holds (D-13, D-15, D-16); that amounts are right for salary, guaranteed hours, overtime across runs, cancellations, holiday pay or the minimum wage period (not started).

---

## 6. Can Gate A be signed off?

**No.** It can be **submitted** for independent review and client UAT. The same holds for the Gate B items of section 5a. More code having been written does not change this: sign-off needs the items below, none of which development can supply.

| # | Still needed | Owner |
|---|---|---|
| 1 | Review by someone who did not write this code. All of it was written in one workspace with the same assistant | Client |
| 2 | Decisions D-01, D-02 (who approves), D-05, D-06 (attendance), D-07 (employer), D-10 (corrections). Interim safeguards are in place for each | Client |
| 3 | Mobile app check of the attendance scenarios (A2) | Client / app maintainers |
| 4 | Duplicate report on a copy of real data, reviewed by finance (A4) | Client finance + development |
| 5 | ~~Remaining browser flows (A4)~~ Done in the Gate B sprint | — |
| 6 | UAT of: two-person pay run approval; UK run cancel and replacement; payout approval and recording; a correction and its reversal; an office attendance correction; a double-up with one late-reported time; a branch user's view | Client |

---

## 7. Residual risks

| Risk | Why it remains |
|---|---|
| Wrong-money defects are still present: apprentice rate, hard-coded holidays (D-13), short visits paid as planned (D-14), mileage rate and settlement (D-15), no PAYE refunds, fines before tax, minimum wage assessed on the wrong period | Phases 1–5. Gate A makes pay safe to hold still, not correct |
| A visit paid through the UK run's provisional route gets visit pay only | D-03 |
| "Payment recorded" rests on a person typing a reference | No bank integration (D-04) |
| The mobile app may send or show something the tests did not anticipate | Not available for testing |
| Triggers can be bypassed by a database superuser or by the reset switch | By design for test resets; production must not set `ALLOW_FINANCIAL_TEST_RESET`, and direct database access must be restricted |
| Concurrency was tested in one process | The database constraints hold across instances, but this was not load-tested |
| Charge / invoice side has no equivalent protection | Outside this programme |
| **Carers between two pay cards are held after upgrade.** They used to be paid on the most recently edited card | By design (PC-32). The conflicts list must be reviewed before go-live (D-17) |
| **The tax treatment of all mileage is "not verified".** If the organisation's rate is above HMRC's approved amount, the part above is not being taxed | Nobody has recorded the approved amounts (D-15). The system no longer claims the mileage is tax-free, and taxes the excess as soon as the amounts are recorded |
| Mileage in UK runs calculated before this sprint never reached a payout from this system | Not paid automatically, to avoid paying twice (D-20); listed by the reconciliation endpoint |
| A mileage mistake found after the lock can only be corrected as wages | R-21, D-21 |
| A bank holiday rate for travel, mileage or waiting on a card is not used | V-12, D-19 |
| A year with no bank holiday dates is priced as ordinary days | The calendar status and the pay preview say so; pay runs are not stopped (R-27) |
| The holiday pay basis can be changed by one user with the pay card permission | Reason required and audited; no second approver. Fits Phase 1.5 (approval before publication) |
| The roles for preparing pay must be ticked again after upgrade to receive organisation-wide pay access | Change log, setup step 3 |

---

## 8. Operational controls before any live use

1. `NODE_ENV=production` and `ALLOW_FINANCIAL_TEST_RESET` unset.
2. At least two named users for pay: one prepares, one approves. The roles screen must show no warning.
3. Database backups before each pay run lock and each UK run close; restore tested.
4. No direct database write access for application users.
5. A written procedure for corrections, reversals, cancelling and reopening a run, and for the emergency change route in doc 04 section 8.
6. HMRC live submission and any bank payment remain manual, explicitly authorised steps.

---

## 9. What was not done in this sprint, stated plainly

- No statutory calculation was changed or validated; the tests replace the tax step.
- No HMRC submission and no bank payment was made or simulated as real. No bank connector exists.
- No production or shared database was touched. Schema changes exist on the local development database, the local test database and a scratch rehearsal database that was dropped.
- Nothing was pushed to a remote repository. Nothing was deployed.
- No user was given a pay power. No company or employer structure was created.
- No historical duplicate was deleted or corrected; none exists on the development database.
- Of Phases 1 to 9, three small fixes (PC-21, PC-02, EL-09) and their verification.

Gate B sprint, in addition:

- The tax and NI calculation itself was not changed and was not validated against HMRC figures. The mileage tests run through it (no stand-in) and check how reimbursements relate to it, not whether its tables are right.
- No rate was entered for Allfor Care. Every rate used in tests is a labelled synthetic value. The mileage rates recorded by the migration are the ones the application already used.
- No holiday premium policy was chosen. The setting's default is the previous behaviour.
- No legal-employer model was created (D-07).
- No client charge rule was changed: the holiday basis and the funder-at-visit-date rule apply to carer pay only.
- The mobile app was not observed.
- Browser checks were done by hand in an embedded browser on the test instance; one native confirmation box had to be accepted by script because the embedded browser dismisses them.
