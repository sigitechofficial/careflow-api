# 08 — Release Readiness

**Updated:** 2026-10-12 (Gate A sprint)

**Nothing in this programme is production-ready.** No change has been deployed, pushed, used against live data, reviewed by anyone independent of its author, or put through user acceptance testing. Passing tests are evidence for the behaviours tested, on synthetic data, and nothing more.

---

## 1. Gate status

| Gate | Scope | Status |
|---|---|---|
| A — Financial containment | Phase 0 and the Gate A sprint | **Evidence complete for A1; A2, A3 and A4 have stated gaps. Ready to be submitted for independent review and client UAT. Not signed off** |
| B — Correct care earnings | Phases 1–4 | Started: 3 of about 20 items done (PC-21, PC-02, EL-09). The rest waits mostly on client decisions |
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
| Double-up carers reviewed independently | Per-carer trust record; both orders of completion; three carers; office correction for one carer only | Met |
| Office corrections correctly affect earnings | Open visit: used at completion. Completed: repriced. Settled: pending correction, once | Met |
| Original attendance evidence preserved | Reported times kept in the trust record; attendance events append-only; office entries carry who, when and why | Met |

To pass: run the attendance scenarios of doc 09 with a build of the mobile app against the test instance, or have the app's maintainers confirm the completion payloads.

---

## 4. Gate A3 — Financial access and UX: PASSED for branches; employer scoping BLOCKED

| Criterion | Evidence | Result |
|---|---|---|
| Appropriate branch / employer restrictions enforced | `PayrollScopeGuard`; 8 HTTP tests and the end-to-end month: other branch → not found; organisation records → refused; pay audit hidden; carer sees own pay only | **Branch: met. Legal employer: blocked**, no such structure exists and none was invented (D-07) |
| Corrections screen works | 8 component tests; browser: recorded by one user, approved by another, on the reconciliation dialog and the Earnings tab | Met. Reversal was not clicked in the browser (covered by component and HTTP tests) |
| Payroll statuses are accurate | One projection for office and carer app; 10 unit, 6 HTTP, 4 component tests; browser | Met on the server and the admin app. The mobile app's own wording was not seen |
| Payroll permissions verified at API level | 45 authentication / permission route cases, explicit-grant checks | Met |
| Approver responsibilities configurable | Admin roles choosable; users per power; warnings; saving one job no longer strips another; 14 unit, 5 HTTP, 3 component tests; browser (read only) | Met |

Known gap inside A3: list screens for a branch-limited user (R-13).

---

## 5. Gate A4 — Migration and test readiness: NOT PASSED (two criteria partly open)

| Criterion | Evidence | Result |
|---|---|---|
| Migrations tested against representative historical records | Rehearsal on the pre-remediation schema with synthetic history: 28 of 28 | Met for synthetic history. **Not run against a copy of real data** |
| Duplicate / backfill diagnostics recorded | Four read-only queries and the rehearsal's report (doc 04, sections 5–6) | Met |
| Unit and integration tests pass | 193 / 193 integration, 479 / 479 unit in scope, 37 / 37 frontend in scope | Met. Unrelated failures documented (doc 03, 6.3–6.4) |
| Browser workflows verified | Corrections, earnings, payouts list, roles screen | **Partly**: approve / lock, close, record payment, reverse were not clicked |
| Remaining failures documented | Doc 03 section 6 | Met |
| No live data affected | Local databases only; the development database's business rows untouched; nothing pushed | Met |

To pass: R-11 (remaining browser flows) and R-20 (duplicate report on a copy of real data).

---

## 6. Can Gate A be signed off?

**No.** It can be **submitted** for independent review and client UAT.

| # | Still needed | Owner |
|---|---|---|
| 1 | Review by someone who did not write this code. All of it was written in one workspace with the same assistant | Client |
| 2 | Decisions D-01, D-02 (who approves), D-05, D-06 (attendance), D-07 (employer), D-10 (corrections). Interim safeguards are in place for each | Client |
| 3 | Mobile app check of the attendance scenarios (A2) | Client / app maintainers |
| 4 | Duplicate report on a copy of real data, reviewed by finance (A4) | Client finance + development |
| 5 | Remaining browser flows (A4) | Development |
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
| Two carers completing a double-up in the same instant could overwrite each other's trust record | Read-modify-write on job metadata (R-16) |
| An automatic approval survives a later non-blocking flag | Fixed for the path found (R-18) |
| A carer with no employment record is left unpriced without a visible reason | R-17 |
| Charge / invoice side has no equivalent protection | Outside this programme |
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
