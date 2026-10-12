# 06 — Remaining Backlog

What is still to do after Phase 0, in the order of the programme gates. "Decision" points to `05-policy-decisions-required.md` or to the audit question.

---

## Left over from Phase 0

| ID | Item | Audit | Why open | Decision |
|---|---|---|---|---|
| R-01 | Screen to record a pay correction on a paid visit, see its history and reverse an item | VW-22, PR-22 | API exists; no UI | D-10 |
| R-02 | Integration test of the carer-app completion call with trusted times | VW-02 | Service has 15+ collaborators; only the rules are unit-tested | — |
| R-03 | Per-carer review flag on double-up visits | VW-02 | The time-trust record is kept per visit, so a flag raised by one carer holds every carer's row of that visit | — |
| R-04 | Office correction on a visit that is not completed yet | VW-15 | Still writes an event only | D-06 |
| R-05 | Branch / legal-employer scoping of pay screens and actions | SI-10 | `OrgScopeService` exists and is not applied to pay | D-07 |
| R-06 | Show "paid" consistently for visits settled by a UK run on earnings overviews | PR-05 | Overview queries read `includedInPayrollRunId` only | — |
| R-07 | Overrun decision for the charge side of a visit whose pay is settled | VW-06 | The whole overrun decision is refused once pay is settled; edit the charge window instead | — |
| R-08 | Release input lines when a UK run is cancelled | PR-05 | A cancelled run keeps its input lines, so locked lines it collected are not picked up by a new run | — |
| R-09 | Payout states beyond DRAFT / APPROVED / PAID / CANCELLED (prepared, submitted, failed, returned) | PR-20 | Needs the bank route | D-04 |
| R-10 | HTTP-level tests of the pay controllers and permissions | SI-11 | Guard and services tested; routes not | — |
| R-11 | Exercise the settlement form, discard and recalculate in a browser with test data; automated UI tests | — | Pages were opened and render correctly; the actions were not clicked | — |
| R-12 | Role responsibility screen: allow choosing admin roles for "Approve pay and record payments" | SI-15 | API supports it; the screen lists non-admin roles | D-01 |

---

## Gate B — correct care earnings (Phases 1–4)

| Phase | Item | Audit | Type | Decision first |
|---|---|---|---|---|
| 1.1 | Half-open time bands and an explicit all-day rule; migrate `00:00–23:59` rules | PC-21 | FIX | No |
| 1.2 | Calendar service: nations, substitute days, organisation special days, completeness check; remove hard-coded 25 / 26 Dec and 1 Jan; local-day everywhere | PC-19, PC-22, PC-23, PC-24 | FIX | Q15 |
| 1.3 | "Custom…" time band can be saved; form and API tests | PC-02 | FIX | No |
| 1.4 | Conflict validation for same-level cards; funder context as at the visit date; further rate dimensions | PC-03, PC-10, PC-32, PC-11–PC-17 | FIX / BUILD | Q17 |
| 1.5 | Version every calculation input; draft → review → published → retired | PC-35, PC-36, PC-37, SI-14 | BUILD | Q5 |
| 1.6 | Fixed shift allowance once per shift | WM-04 | FIX | Q28 |
| 2.1 | Cancellation, late cancellation, no access, emergency, late approval sweep | VW-08, VW-09, VW-10, VW-20, VW-21 | BUILD | Q13 |
| 2.2 | Travel as recorded activity (travel, waiting, standby, break, commute) instead of the 90-minute gap | TR-01, TR-04, TR-05, TR-06 | BUILD | Q32 |
| 2.3 | Mileage carried to settlement; miles accumulated from approved miles; tax-year limits | TR-09, TR-13 | FIX | Q33 |
| 2.4 | Expenses: claim → evidence → approval → settlement | TR-10 | BUILD | Q34 |
| 3.1 | Salary entry, proration, salary-covered work | WM-02, WM-03, WM-09 | FIX | Q22 |
| 3.2 | Guaranteed hours | WM-07, EL-01 | BUILD | Q23 |
| 3.3 | Overtime across runs; configurable policy | WM-18 | FIX | Q29 |
| 3.4 | Leave year, entitlement, accrual, holiday pay | EL-02, EL-03, EL-04 | BUILD | Q35 |
| 3.5 | SSP and family pay framework, versioned by tax year | EL-05, EL-07 | BUILD | Statutory validation |
| 4.1 | Top-up counted once | EL-09 | FIX | No |
| 4.2 | Apprentice eligibility | EL-11 | FIX | Q38 |
| 4.3 | Compliance on the pay reference period; wage floors | EL-08, EL-12, EL-13 | BUILD | Q37, Q39 |

**Can start without a decision:** 1.1, 1.3, 4.1, and the tests for the resolver and pay run that the audit listed as unverified.

---

## Gate C — native statutory payroll (Phase 5)

| Item | Audit | Note |
|---|---|---|
| PAYE refunds, tax-code changes, Scottish and Welsh rates, emergency codes | PR-06 | Validate against HMRC published examples |
| Statutory rate catalogue per tax year | EL-16, EL-10 | Remove identical seeded rates |
| Student and postgraduate loans | PR-08 | |
| Workplace pensions | PR-09 | Scheme and provider needed |
| Deductions framework; suspend unsafe "fines" treatment | PR-10 | Q40 |
| Starter / leaver, P45, P60, year end | PR-15 | |

## Gate D — reporting and settlement (Phases 6–7)

| Item | Audit |
|---|---|
| FPS / EPS schema validation, final outcome polling, corrections | PR-16, PR-17 |
| Payslip wording for every line type; carer salary endpoint labels; delivery | PR-14, PR-23 |
| Bank file / provider, settlement confirmation, returned payments | PR-19, PR-20 |
| Encryption of bank details and NI numbers; log redaction; retention | PR-02, D-11 |
| Pay reconciliation report (visits → runs → payroll → payment) | PR-21 |

## Gate E — production readiness (Phases 8–9)

End-to-end tests, the fifteen acceptance scenarios, completion of the pay screens and carer self-service, and authorised UAT.

---

## Suggested next step

Phase 1.1, 1.3 and 4.1 need no policy answer and remove three confirmed wrong-money defects. In parallel, obtain decisions D-01, D-03, D-05 and audit questions Q13, Q15, Q22, Q33, Q37.
