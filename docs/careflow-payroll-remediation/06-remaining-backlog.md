# 06 — Remaining Backlog

**Updated:** 2026-10-12 (Gate A sprint)

What is still to do, in the order of the programme gates. Completed items have been removed; they are in `01-implementation-status.md`. "Decision" points to `05-policy-decisions-required.md` or to the audit question.

---

## 1. Left over from Gate A

Closed in this sprint and removed from this list: R-01, R-03, R-04, R-06, R-07, R-08, R-10, R-12.

| ID | Item | Audit | What remains | Needs |
|---|---|---|---|---|
| R-02 | Carer-app attendance | VW-02 | Check with the real mobile app: what it sends on completion, offline, for a support carer, and how it shows a held visit | The app's source or a test build |
| R-05 | Legal-employer scoping | SI-10 | Branch scope is done. Nothing exists to scope by employer | D-07 |
| R-09 | Bank payment states | PR-20 | Prepared / submitted / acknowledged / rejected / failed / returned / confirmed are defined but cannot be reached | D-04, then Phase 6.3 |
| R-11 | Browser exercise of the pay screens | — | Approve and lock a pay run, close a UK run, record a payment, reverse a correction, pay card walk-through, in a browser; automated browser tests | — |
| R-13 | Screens for a branch-limited user | SI-10 | Lists that need a branch (salaries, reconciliations, payslips, payroll employees) return "name a branch" for a branch user unless the location filter is set; the pay menus should hide what such a user cannot open | — |
| R-14 | Correction approval as its own permission | SI-15 | Approving a correction needs the same permission as recording one (a different user is enforced) | D-10 |
| R-15 | Time-verification tolerance as a setting | VW-02 | 15 minutes is a constant | D-05 |
| R-16 | Atomic per-carer trust record | VW-02 | Read-modify-write on job metadata; two simultaneous completions could overwrite each other. Move to a row per carer or a JSON path update | — |
| R-17 | Evaluation errors are swallowed | VW-03 | A carer without an employment record is left unpriced with no visible reason (`safeEvaluate`). Raise a finance exception instead | — |
| R-18 | Automatic approval kept when a later flag appears | VW-02 | Re-evaluation keeps an existing approval unless a blocking exception appears, and does not tell a person's approval from an automatic one. Fixed for the one path found (late support clock-out); the rule itself should treat an automatic approval as provisional | — |
| R-19 | Carer app wording for payment status | PR-19 | The API still sends the old `paymentState` values beside the new stage; the app should show `earningStageLabel` | The app |
| R-20 | Run the duplicate report on a copy of real data | SI-01 | Queries A–D of doc 04 | Client data, finance review |

---

## 2. Gate B — correct care earnings (Phases 1–4)

| Phase | Item | Audit | Type | Decision first |
|---|---|---|---|---|
| 1.1 | An explicit "all day" choice in the pay card editor instead of typed times | PC-21 | FIX | No |
| 1.2 | Calendar service: nations, substitute days, organisation special days, completeness check; remove hard-coded 25 / 26 Dec and 1 Jan; local-day everywhere | PC-19, PC-22, PC-23, PC-24 | FIX | D-13, Q15 |
| 1.4 | Conflict validation for same-level cards; funder context as at the visit date; further rate dimensions | PC-03, PC-10, PC-32, PC-11–PC-17 | FIX / BUILD | Q17 |
| 1.5 | Version every calculation input; draft → review → published → retired; arrears across visits after a rate change | PC-35, PC-36, PC-37, SI-14 | BUILD | Q5 |
| 1.6 | Fixed shift allowance once per shift | WM-04 | FIX | Q28 |
| 2.1 | Cancellation, late cancellation, no access, emergency, late approval sweep | VW-08, VW-09, VW-10, VW-20, VW-21 | BUILD | Q13 |
| 2.2 | Travel as recorded activity instead of the 90-minute gap | TR-01, TR-04, TR-05, TR-06 | BUILD | Q32 |
| 2.3 | Mileage carried to settlement; miles accumulated from approved miles; tax-year limits; rate check | TR-09, TR-13 | FIX | D-15, Q33 |
| 2.4 | Expenses: claim → evidence → approval → settlement | TR-10 | BUILD | Q34 |
| 2.5 | Short-visit tolerance for pay | VW-05 | FIX | D-14 |
| 3.1 | Salary entry, proration, salary-covered work | WM-02, WM-03, WM-09 | FIX | Q22 |
| 3.2 | Guaranteed hours | WM-07, EL-01 | BUILD | Q23 |
| 3.3 | Overtime across runs; configurable policy | WM-18 | FIX | Q29 |
| 3.4 | Leave year, entitlement, accrual, holiday pay | EL-02, EL-03, EL-04 | BUILD | Q35 |
| 3.5 | SSP and family pay framework, versioned by tax year | EL-05, EL-07 | BUILD | Statutory validation |
| 4.2 | Apprentice eligibility | EL-11 | FIX | Q38 |
| 4.3 | Compliance on the pay reference period; wage floors | EL-08, EL-12, EL-13 | BUILD | Q37, Q39 |

**Can start without a decision:** resolver and pay run tests the audit listed as unverified; conflict validation for same-level cards (PC-32); funder context as at the visit date (PC-10); local-day handling on the fixed-visit and night-duty paths (PC-19); R-13, R-16, R-17, R-18 above.

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
| R-18 | Should precede Phase 2.1 (more automatic flags will arrive) |
| R-20 | Before any production migration |
| D-13 | Before Phase 1.2 |
| D-15 | Before Phase 2.3 |
