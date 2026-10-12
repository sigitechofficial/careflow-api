# 06 — Remaining Backlog

**Updated:** 2026-10-12 (Gate B sprint)

What is still to do, in the order of the programme gates. Completed items have been removed; they are in `01-implementation-status.md`. "Decision" points to `05-policy-decisions-required.md` or to the audit question.

---

## 1. Left over from Gate A and from the Gate B sprint

Closed in the Gate A sprint: R-01, R-03, R-04, R-06, R-07, R-08, R-10, R-12. Closed in the Gate B sprint and removed from this list: **R-11, R-13, R-16, R-17, R-18**.

| ID | Item | Audit | What remains | Needs |
|---|---|---|---|---|
| R-02 | Carer-app attendance | VW-02 | Check with the real mobile app: what it sends on completion, offline, for a support carer, and how it shows a held visit | The app's source or a test build |
| R-05 | Legal-employer scoping | SI-10 | Branch scope is done. Nothing exists to scope by employer | D-07 |
| R-09 | Bank payment states | PR-20 | Prepared / submitted / acknowledged / rejected / failed / returned / confirmed are defined but cannot be reached | D-04, then Phase 6.3 |
| R-14 | Correction approval as its own permission | SI-15 | Approving a correction needs the same permission as recording one (a different user is enforced) | D-10 |
| R-15 | Time-verification tolerance as a setting | VW-02 | 15 minutes is a constant | D-05 |
| R-19 | Carer app wording for payment status | PR-19 | The API still sends the old `paymentState` values beside the new stage; the app should show `earningStageLabel` | The app |
| R-20 | Run the pre-migration reports on a copy of real data | SI-01, PC-32, TR-13 | Queries A–D of doc 04 (duplicates), and now also: carers between two pay cards (`GET /billing/pay-cards/conflicts`), calendar gaps (`GET /billing/bank-holidays/status`), and expenses of earlier runs that never reached a payout (`GET /billing/employee-payouts/reimbursements`) | Client data, finance review |
| R-21 | Mileage correction after the pay run is locked | TR-13 | Miles on a settled visit cannot be changed, and the only correction is a pay adjustment, which is taxed as wages. A reimbursement-type correction (positive or negative miles, same tax treatment as the original line) | D-21 |
| R-22 | Other resolver errors in the pay run's non-visit lines | PC-32, VW-03 | A pay card conflict now puts an exception line on the run. Any other error while resolving the card for training, on-call, overtime or rolled-up holiday pay is still swallowed there | — |
| R-23 | Cancelling an approved pay item | VW-22 | Uses a browser confirmation box and takes no reason (the action is audited). Use the application's own dialog and require a reason | — |
| R-24 | Payout batch feedback | PR-19 | Creating a batch from the UK run page gives no confirmation there, and the batch is filed under its week while the list opens on "this month" | — |
| R-25 | Other visit JSON written by read-modify-write | VW-02 | Attendance evidence now has its own rows. Other per-carer data kept in the visit JSON (support carers' check-outs, notes) is still read, changed and written back; it holds no pay evidence | — |
| R-26 | Screen for mileage rates | TR-09 | Rates and HMRC approved amounts are entered through the API (`billing/mileage-rates`), audited. No screen yet | — |
| R-27 | Run-level warning for an incomplete calendar | PC-23 | The calendar status and the pay preview report a year with missing dates. A visit pay run for such a year is not yet stopped or marked | D-13 |
| R-28 | Client charge: funding as at the visit date | PC-10 | Carer pay now uses the funder on the visit day. The charge still reads the client's current funding | Out of scope for wages; needs the invoicing owner |

---

## 2. Gate B — correct care earnings (Phases 1–4)

| Phase | Item | Audit | Type | Decision first |
|---|---|---|---|---|
| 1.1 | An explicit "all day" choice in the pay card editor instead of typed times | PC-21 | FIX | No |
| 1.2 | **Done in the Gate B sprint**: calendar, substitute days, organisation days, completeness check, local day everywhere, weekend-holiday policy as a setting. Left: the client's choice of basis; which days are Easter; a bank holiday rate for travel, mileage and waiting | PC-19, PC-22, PC-23, PC-24 | — | D-13, D-16, D-19 |
| 1.4 | **Done in the Gate B sprint**: same-level conflicts, funder as at the visit date. Left: further rate dimensions | PC-03, PC-11–PC-17 | BUILD | Q17 |
| 1.5 | Version every calculation input; draft → review → published → retired; arrears across visits after a rate change | PC-35, PC-36, PC-37, SI-14 | BUILD | Q5 |
| 1.6 | Fixed shift allowance once per shift | WM-04 | FIX | Q28 |
| 2.1 | Cancellation, late cancellation, no access, emergency, late approval sweep | VW-08, VW-09, VW-10, VW-20, VW-21 | BUILD | Q13 |
| 2.2 | Travel as recorded activity instead of the 90-minute gap | TR-01, TR-04, TR-05, TR-06 | BUILD | Q32 |
| 2.3 | **Done in the Gate B sprint**: rates per period, miles accumulated per tax year, tax treatment, reimbursement paid once. Left: the client's rates and the HMRC approved amounts to be recorded; R-21; R-26 | TR-09, TR-13 | — | D-15, D-20, D-21 |
| 2.4 | Expenses: claim → evidence → approval → settlement | TR-10 | BUILD | Q34 |
| 2.5 | Short-visit tolerance for pay | VW-05 | FIX | D-14 |
| 3.1 | Salary entry, proration, salary-covered work | WM-02, WM-03, WM-09 | FIX | Q22 |
| 3.2 | Guaranteed hours | WM-07, EL-01 | BUILD | Q23 |
| 3.3 | Overtime across runs; configurable policy | WM-18 | FIX | Q29 |
| 3.4 | Leave year, entitlement, accrual, holiday pay | EL-02, EL-03, EL-04 | BUILD | Q35 |
| 3.5 | SSP and family pay framework, versioned by tax year | EL-05, EL-07 | BUILD | Statutory validation |
| 4.2 | Apprentice eligibility | EL-11 | FIX | Q38 |
| 4.3 | Compliance on the pay reference period; wage floors | EL-08, EL-12, EL-13 | BUILD | Q37, Q39 |

**Can start without a decision:** 1.1 (an explicit all-day choice); R-22 to R-27 above; resolver and pay run tests the audit listed as unverified. Everything else in this table needs the decision named in its last column first.

---

## 3. Gate C — native statutory payroll (Phase 5)

| Item | Audit | Note |
|---|---|---|
| PAYE refunds, tax-code changes, Scottish and Welsh rates, emergency codes | PR-06 | Validate against HMRC published examples |
| Statutory rate catalogue per tax year | EL-16, EL-10 | Remove identical seeded rates |
| Student and postgraduate loans | PR-08 | |
| Workplace pensions | PR-09 | Scheme and provider needed |
| Deductions framework; suspend unsafe "fines" treatment | PR-10 | Q40 |
| Starter / leaver, P45, P60, year end | PR-15 | |
| Correction run instead of reopening | PR-13 | D-09 |

## 4. Gate D — reporting and settlement (Phases 6–7)

| Item | Audit |
|---|---|
| FPS / EPS schema validation, final outcome polling, corrections | PR-16, PR-17 |
| Payslip wording for every line type; delivery | PR-14, PR-23 |
| Bank file / provider, settlement confirmation, returned payments (uses the payment states of R-09) | PR-19, PR-20 |
| Encryption of bank details and NI numbers; log redaction; retention | PR-02, D-11 |
| Pay reconciliation report (visits → runs → payroll → payment) | PR-21 |

## 5. Gate E — production readiness (Phases 8–9)

Automated browser tests, the acceptance scenarios with the client, completion of carer self-service, load and multi-instance testing, and authorised UAT.

---

## 6. Dependencies between what is left and Phases 1–9

| Left-over item | Depends on / feeds |
|---|---|
| R-02, R-19 | Mobile app access. Independent of every phase |
| R-05 | D-07; would shape Phase 5 (one PAYE scheme per employer) and Phase 7 (access to salary data) |
| R-09 | D-04; is the first step of Phase 6.3 |
| R-14 | D-10; small change once decided |
| R-15, 2.5 | D-05, D-14; both are settings, best done with Phase 2 |
| R-21 | D-21; uses the correction ledger of Phase 0 |
| R-27 | D-13; best done when the client has chosen the holiday basis |
| R-20 | Before any production migration |
| D-13, D-16 | The setting exists; the client's choice is all that is missing |
| D-15 | The table exists; the client's rates and the HMRC approved amounts are all that is missing |
| D-17 | Before go-live: the conflicts list must be empty or accepted |

---

## 7. Recommended next implementation sprint

In this order, each behind its decision:

1. **Salary** (3.1): how a salary is entered, prorated for part periods, starters and leavers, and what work it covers. Decision Q22.
2. **Guaranteed hours** (3.2): the guarantee, the reference period, and the top-up when worked hours fall short. Decision Q23.
3. **Overtime across runs** (3.3): the threshold is weekly but pay runs can split a week; the premium is derived per run today. Decision Q29.
4. **Travel against waiting, breaks and commuting** (2.2): travel as a recorded activity with evidence instead of a 90-minute gap rule; what is paid, what only counts as working time. Decision Q32, D-19.
5. **Cancellation and no-access pay** (2.1): cancelled, late-cancelled, missed and no-access visits. Decision Q13.
6. **Holiday entitlement and holiday pay** (3.4): leave year, entitlement, accrual, the 52-week reference. Decision Q35.
7. **Apprentice eligibility and the pay reference period** (4.2, 4.3): the minimum wage check on the pay reference period instead of the pay run period. Decisions Q37 to Q39.
8. **Employment wage policies**: the rate dimensions that are contractual rather than card settings (PC-11 to PC-17). Decision Q17.

Small items that need no decision and can ride along: R-22, R-23, R-24, R-25, R-26.
