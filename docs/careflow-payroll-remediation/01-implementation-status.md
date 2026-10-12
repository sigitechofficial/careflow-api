# 01 — Implementation Status

**Programme:** CareFlow carer wages, pay cards and UK payroll remediation
**Updated:** 2026-10-12 · **Phase 0 (financial safety):** implemented and tested · **Gate A sprint (R-01 to R-12):** implemented and tested, see section 1 · **Phases 1 and 4:** three items done and re-verified · **Everything else:** not started

| Repository | Branch | Base commit (audited) | Head |
|---|---|---|---|
| careflow-api (`careadmin-backend`) | `payroll-remediation/gate-a` (on `phase-1`, on `phase-0`) | `e163815` | `c53dd9a` + the reports commit |
| careflow-admin (`care-admin`) | `payroll-remediation/gate-a` (on `phase-1`, on `phase-0`) | `a8b7b9a` | `01da8a2` |

Nothing has been pushed, deployed or run against live data. All commits are local. `main` is untouched in both repositories.

Status words: **DONE** = fixed, covered by passing tests, and reachable by the user it is for · **PARTIAL** = part done, rest listed · **BLOCKED** = needs a client decision or something not available to development · **OPEN** = not started.

"Verified by": **int** = integration test on a real database · **http** = over HTTP through the real controllers and guards · **unit** · **ui** = component test · **browser** = exercised in a browser on synthetic data.

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
| R-11 | — | Changed screens had not been exercised with data | A second instance of the application on the payroll test database; flows exercised with synthetic data | `scripts/payroll-test-server.mjs`, `scripts/payroll-test-preview.mjs` | browser, see doc 09 section 4 | PARTIAL: corrections, earnings, payouts list and the roles screen were exercised. Approving and locking a pay run, closing a UK run and recording a payment were not clicked in the browser (covered over HTTP) |

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
| TR-13 | Mileage not in payouts, as audited. Observed in the end-to-end test: the mileage line is collected into UK payroll gross inputs as an expense line; what the tax step and the payout do with it was not examined (the test replaces the tax step) | Phase 2.3 |
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

See `08-release-readiness.md` for the four sub-gates. In short: the financial-integrity criteria are met in tests; attendance is verified on the server but not with the mobile app; access is enforced for branches, not for legal employers; migrations were rehearsed on synthetic history. Gate A is **not signed off**: independent review, client decisions and user acceptance testing have not taken place.
