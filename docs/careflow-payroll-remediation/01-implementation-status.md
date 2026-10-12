# 01 — Implementation Status

**Programme:** CareFlow carer wages, pay cards and UK payroll remediation
**Updated:** 2026-10-12 · **Phase reported:** 0 (financial safety) · **Phases 1–9:** not started

| Repository | Branch | Base commit (audited) | Phase 0 commits |
|---|---|---|---|
| careflow-api (`careadmin-backend`) | `payroll-remediation/phase-0` | `e163815` | `71f7a1e`, `0f3e0f9`, `f728ffc`, `9660c33`, then the reports commit |
| careflow-admin (`care-admin`) | `payroll-remediation/phase-0` | `a8b7b9a` | `e6c17e6`, `22eb4bc` |

Nothing has been pushed, deployed or run against live data. All commits are local.

Status words: **DONE** = fixed and covered by passing tests · **PARTIAL** = part fixed, rest listed · **BLOCKED** = needs a client decision · **OPEN** = not started.

"Reproduced" says how the defect was confirmed before the fix: **test** = a new test failed on the old code; **code** = read in the code at the audited commit; **after** = the test was written after the fix (it did not run red first).

---

## Phase 0 — result by audit item

| Audit ID | Original issue | Reproduced | Fix | Tests | Status | Remaining risk |
|---|---|---|---|---|---|---|
| SI-01 | Same visit can be in two visit pay runs; last lock wins | test (7 of 10 new tests failed) | `PayrollRunLine.claimKey` unique across all runs; lines written in one transaction; calculation leaves out sources another run holds and retries if a run takes one mid-flight; lock re-checks every visit | `duplicate-claims.int-spec` (10), `payroll-claim.util.spec` | DONE | Lines calculated before this change hold no claim until the run is recalculated; lock refuses them |
| SI-02 | Overlapping runs not prevented | test | Overlap stays allowed (off-cycle and supplementary runs are legitimate); what is prevented is paying one source twice | `duplicate-claims` "supplementary run" | DONE | — |
| SI-03 | Pay items / activity paid once (manual check only) | test (concurrent case failed) | Same claim mechanism; activity claim also covers open runs | `duplicate-claims` "pay item" | DONE | Overtime premium and rolled-up holiday are derived per run (Phase 3.3) |
| SI-08 | Failed calculation leaves run in CALCULATING | test | Status restored on failure; a run is taken atomically so it cannot be calculated twice at once | `duplicate-claims` "failed calculation" | DONE | — |
| PR-05 | UK run takes provisional visits, later run collects them again | code; tests after | Closing a UK run claims its provisional visits (`paidByUkPayrollRunId`, one conditional update); gross collection and visit pay runs skip settled visits; an open visit pay run holding the visit cannot lock | `uk-provisional.int-spec` (6) | DONE | Whether provisional visits should feed payroll at all is a client decision (doc 05, D-03) |
| VW-23 | Reconciliation never locked; guards dead | test (DB) + code | "Pay settled" = in a locked visit pay run or a closed UK run; service refuses pay changes; database triggers refuse them for any code path | `locked-history.int-spec` (7), `pay-settlement.util.spec` | DONE | Charge side is not covered (invoicing is outside this programme) |
| SI-05 | Bulk recalculation reprices locked visits | test | Settled visits are never repriced, forced or not | `locked-history` "bulk recalculation" | DONE | — |
| VW-22 | Correction after closure: record changes, pay does not | test | Correction ledger on pay items: states the corrected total, pays the difference in the next run after a second approval; idempotent; one-time reversal | `pay-corrections.int-spec` (6) | DONE (API) | No screen yet to record a correction (doc 06, R-01) |
| PR-13 | Locked lines are snapshots but visits are not; closed UK runs reopen freely | test | Triggers on locked runs, their lines and paid visits; reopening a closed UK run needs `payroll.runs.reopen`, releases its visit claims and is refused once a payout is approved or a live FPS exists | `locked-history`, `uk-provisional` "reopening" | DONE | Reopening still reverses year-to-date; a correction run would be safer (Phase 5) |
| PR-22 | Backpay is manual, no difference calculation | test | Difference calculated against everything settled so far | `pay-corrections` | DONE (API) | Rate-change arrears across many visits are still one correction per visit (Phase 1.5) |
| VW-11 | Reassignment after completion leaves two payable rows | tests after | Row of a removed carer is withdrawn; if that carer was already paid, the replacement is held for a manager | `reassignment.int-spec` (3) | DONE | Recovering the first payment is a manual correction |
| SI-09 | Monthly job approves payouts and marks them paid | test (5 of 6 failed) | Job only proposes DRAFT batches for closed runs, with no user credited; never approves or settles | `payouts.int-spec` (6) | DONE | — |
| PR-18 | Payout allowed before UK run is closed | test | Closed runs only | `payouts` | DONE | — |
| PR-20 | "Paid" is a flag with no evidence | test | PAID needs payment reference and value date (not in the future), stored and audited | `payouts` | PARTIAL | Manual evidence only; no bank file, provider confirmation, failed or returned payments (Phase 6.3) |
| SI-06 | Delete-all / purge / reset endpoints live | test | Refused in production and unless `ALLOW_FINANCIAL_TEST_RESET=true`; need `billing.financial_reset`; audited; triggers block locked data without the reset switch | `controls.int-spec` (5 env cases) | DONE | `audit_logs.delete` rows already granted to roles stay granted (the environment check still applies) |
| VW-02 | Carer app can send its own start and end | code; util test | Server check-in is the start; reported times are evidence; an uncorroborated reported time holds the visit for approval (`UNVERIFIED_TIMES`); future times refused | `visit-time-trust.util.spec` (10), `attendance.int-spec` | PARTIAL | The carer-app completion calls (lead and support carer) are not integration-tested (15+ dependencies); tolerance is a constant, 15 min (D-05) |
| VW-15 | Office attendance corrections do not reach pay | test after | On a completed visit the corrected time becomes the record; draft pay is repriced; settled pay gets a pending correction | `attendance.int-spec` (5) | PARTIAL | Corrections on visits not yet completed still write events only |
| SI-07 | Money decisions not audited | test | Audited: visit approve / reject / overrun / manual amount / time edit, visit pay run create / calculate / approve / lock / discard / export, payout create / approve / settle / cancel, corrections, reversals, resets | `controls` (2), `payouts`, `pay-corrections` | DONE | Bulk approve is audited per visit; mileage-only edits are covered by the time-edit audit |
| SI-15 / PR-12 | No separation of duties | test | Approver of a visit pay run, closer of a UK run and approver of a payout must differ from the creator; approval, settlement, close, reopen and reset are separate permissions | `controls`, `payouts`, `permissions.guard.spec` | DONE | Pay card publication has no approval yet (Phase 1.5) |
| SI-11 | No guard tests | test | Guard spec added; Super Admin no longer implies the financial powers | `permissions.guard.spec` (6) | DONE | Controllers are not HTTP-tested end to end |
| SI-10 | Admin users see every branch | code | — | — | BLOCKED | Needs the branch / legal-employer access decision (D-07) |
| VW-25 | Manual payable amount allowed with `employees.update`, unaudited | code | Needs `billing.visit_reconciliations.manage`; audited; refused on settled visits | `controls`, `locked-history` | DONE | — |

### Items closed in passing
- A recalculation of an approved run withdraws the approval (`controls`).
- A run that has not been locked can be discarded, which releases its visits (`DELETE /billing/payroll-runs/:id`).

### Items verified and deliberately not changed in Phase 0
| Audit ID | Verified | Why left |
|---|---|---|
| EL-09 | `grossPay + nmwTopUpTotal` double-counts; still present | Phase 4.1 |
| EL-11, EL-12, EL-16, PR-06, PR-08, PR-09, PR-10 | Present as audited | Phases 4–5 |
| TR-13 | Mileage not in payouts | Phase 2.3 |
| PC-21, PC-23, PC-02, WM-02 | Present as audited | Phases 1 and 3 |

---

## Gate A (financial containment)

See `08-release-readiness.md`. Summary: the identified unsafe paths are closed and tested at service and database level. Gate A is **not signed off**: the carer-app completion path is unit-tested only, branch scoping is undecided, and nothing has been through UAT.
