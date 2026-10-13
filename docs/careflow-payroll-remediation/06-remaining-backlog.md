# 06 — Remaining Backlog

**Updated:** 2026-10-13 (Sprint B3: B2-04, B2-14, B2-15 closed or reduced; B3-01 to B3-05 added. See `13-sprint-b3-summary.md`)

What is still to do, in the order of the programme gates. Completed items have been removed; they are in `01-implementation-status.md`. "Decision" points to `05-policy-decisions-required.md` or to the audit question.

---

## 0. After Gate B2

Closed in Gate B2 and removed from the lists below: **R-21** (mileage correction after the lock), **R-22** (non-visit earnings that cannot be worked out), **R-27** (incomplete calendars). The eight items of the "recommended next sprint" of the Gate B report (salary, guaranteed hours, overtime across runs, travel, cancellation pay, holiday, apprentices and the pay reference period) have their foundations built; what is left of each is here.

| ID | Item | What remains | Needs |
|---|---|---|---|
| B2-01 | Screens for holiday | Leave terms, leave entries and the leave position are API only | — |
| B2-02 | Holiday in pay | Book leave against the balance (from the holiday record or the rota); pay it at the reference rate; overtime, bonuses and allowances in the 52-week average; the 28-day yearly maximum | Q35, D-28 |
| B2-03 | Minimum wage on the pay run screen | Show `NmwPeriodAssessment` (period, source, category, rate, position) on the pay run | — |
| B2-04 | Minimum wage for salaried-hours work | **Done in Sprint B3** for the single pay period (assessment, top-up, close check, review). Left: hours beyond the basic hours are flagged for review each period instead of being decided from the year so far (B3-04) | Basic hours decision (doc 13 section 6) |
| B2-05 | Premium inside visit pay | Split a visit's amount into basic pay and premium, so premiums can be left out of the minimum wage check and brought into holiday pay | D-29, D-28 |
| B2-06 | Deductions against the minimum wage | Test fines and penalties against the rate before they are taken | D-29 |
| B2-07 | Disruption events raised automatically | When a visit with a carer allocated is cancelled, create the event instead of waiting for the office to record it | Q13 |
| B2-08 | Screen for disruption rules | Rules are entered through the API | Q13 |
| B2-09 | Daily overtime; overtime on enhanced rates; full-rate replacement | Not built | Q29, D-26 |
| B2-10 | Travel: default and capture | The estimate is still the default; the previous visit is looked for only inside the same run when estimating; nothing is captured from the carer app | Q32, the app |
| B2-11 | Guarantee: other qualifying time and periods | Training and on-call time are not counted; only a weekly guarantee | Q23, D-25 |
| B2-12 | Salary cover of non-visit time | Under "contracted hours" training time is treated as covered, not counted against the hours | Q22, D-24 |
| B2-13 | UK payslip lines | Overtime, guarantee top-up, cancellation pay and salary adjustment are inside "Other pay" / "Salary" | Phase 5 |
| B2-14 | Pay reference period guard | **Done in Sprint B3**: a period longer than a month is never used; a missing or invalid schedule is recorded and shown. Left: the client's answer for workers with no payroll schedule | Q37–Q39 |
| B2-15 | Timezone of UK payroll periods | **Done in Sprint B3** for UK gross (pay period, week, agreement by UK date). Left: the leave calculations still read the UTC date of a visit | — |
| B2-16 | Mileage correction: passengers and threshold | Passenger mileage cannot be corrected; later journeys are not re-split around the 10,000-mile threshold | D-21 |
| B2-17 | Unused default cancellation policy | `pay-policy.util.ts` holds a default written before this programme; nothing reads it; delete it | — |
| B2-18 | Ending a salary agreement | Needs the manage permission only, not a second person | D-23 |
| B3-01 | Screen for wage recoveries | Proposals are shown on the run; authorising or rejecting one is API only | — |
| B3-02 | Minimum wage on the UK run page | Assessments, why a run cannot be closed, and the review action are API only | — |
| B3-03 | Authority for other negative amounts | Pay corrections, mileage corrections and fines entered by people need a second approver but record no authority for the deduction; fines are not tested against the minimum wage | D-23, D-29 |
| B3-04 | Year-to-date basic hours for salaried staff | So that excess hours are decided, not reviewed each period | Basic hours decision |
| B3-05 | Ageing of undecided recoveries | A proposal left undecided is re-shown on each later run with no escalation | D-23 |

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
| R-23 | Cancelling an approved pay item | VW-22 | Uses a browser confirmation box and takes no reason (the action is audited). Use the application's own dialog and require a reason | — |
| R-24 | Payout batch feedback | PR-19 | Creating a batch from the UK run page gives no confirmation there, and the batch is filed under its week while the list opens on "this month" | — |
| R-25 | Other visit JSON written by read-modify-write | VW-02 | Attendance evidence now has its own rows. Other per-carer data kept in the visit JSON (support carers' check-outs, notes) is still read, changed and written back; it holds no pay evidence | — |
| R-26 | Screen for mileage rates | TR-09 | Rates and HMRC approved amounts are entered through the API (`billing/mileage-rates`), audited. No screen yet | — |
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

Gate B2 built the foundations the previous list asked for. What should come next, in this order:

1. **Client decisions** (doc 05 section 2b): Q22, Q23, Q13, Q35 first; nothing built in Gate B2 should carry a real employee before them. D-01 (named approvers) is still open and blocks all real use.
2. **Make the new records visible**: B2-01 (holiday screens), B2-03 (minimum wage assessment on the pay run), B2-08 (disruption rules screen), R-26 (mileage rates screen).
3. **Close the minimum wage gaps** (B2-04 and B2-14 were done in Sprint B3): B3-01 and B3-02 (screens for what B3 built), B3-03 and B2-06 (deductions), B3-04 (basic hours over the year), B2-05 (basic pay and premium apart).
4. **Holiday in pay**: B2-02.
5. **Disruption events from the rota**: B2-07.
6. **Employment wage policies** that are contractual rather than card settings (PC-11 to PC-17). Decision Q17.
7. Then Gate C: native statutory payroll (section 3), which should start from the pay element classification (doc 12 section 12).

Small items that need no decision and can ride along: B2-13, B2-15, B2-17, R-23, R-24, R-25.
