# 08 — Release Readiness

**Updated:** 2026-10-12

**Nothing in this programme is production-ready.** No change has been deployed, used against live data or through user acceptance testing. A passing build and passing tests are evidence for the specific behaviours tested, nothing more.

---

## Gate status

| Gate | Scope | Status |
|---|---|---|
| A — Financial containment | Phase 0 | **Implemented and tested locally. Not signed off** |
| B — Correct care earnings | Phases 1–4 | Started: 3 of about 20 items done (PC-21, PC-02, EL-09). The rest waits mostly on client decisions |
| C — Native statutory payroll | Phase 5 | Not started |
| D — Reporting and settlement | Phases 6–7 | Not started |
| E — Production readiness | Phases 8–9 | Not started |

---

## Gate A in detail

Completion statement: *the financial system cannot duplicate, silently change, erase, authorise or falsely mark money as paid through the identified unsafe paths.*

| Criterion | Evidence | Result |
|---|---|---|
| One entitlement is claimed once as an original earning | Unique claim index; `duplicate-claims` (10), `uk-provisional` (6), `reassignment` (3) | Met in tests |
| Additional amounts are distinct premium or adjustment records | `pay-corrections` (6) | Met in tests |
| Approved financial history stays reproducible | Triggers + service guards; `locked-history` (7) | Met in tests |
| Every change to settled pay is an authorised, traceable correction | Correction ledger with second approval and audit | Met in tests (API only) |
| A scheduled job cannot declare an employee paid | `payouts` (6) | Met in tests |
| Ordinary administration permissions cannot erase financial history | Environment gate, explicit permission, triggers; `controls` | Met in tests |
| Correcting attendance updates draft earnings or produces a post-lock adjustment; original evidence remains | `attendance` (5) | Met for completed visits |
| Client-submitted timestamps are not blindly trusted | `visit-time-trust.util.spec` (10), `attendance` | Rules met; app call not integration-tested |
| Maker / checker and separate approval permissions | `controls`, `payouts`, `permissions.guard.spec` | Met in tests |
| Money decisions are audited | `controls`, `payouts`, `pay-corrections` | Met in tests |
| Branch / legal-employer scoping | — | **Not met** (decision D-07) |
| Restricted access to salary, bank and NI data | — | **Not met** (Phase 7) |

### Blockers before Gate A can be signed off

| # | Blocker | Owner |
|---|---|---|
| 1 | Decide who holds the approval powers and assign them (D-01, D-02) | Client |
| 2 | Decide branch / legal-employer access, then apply it to pay (D-07, R-05) | Client, then development |
| 3 | Integration test of the carer-app completion with trusted times, and a check with the real app build (R-02) | Development |
| 4 | Screen for pay corrections (R-01), otherwise locked visits can only be corrected through the API | Development |
| 5 | Exercise the changed screens end to end with test data (R-11) | Development |
| 6 | Run the two read-only duplicate queries on a copy of real data and review the result (doc 04) | Client finance + development |
| 7 | Review by someone who did not write this code. Much of the wages code, and all of Phase 0, was written in the same workspace with the same assistant | Client |
| 8 | UAT of: two-person pay run approval, payout approval and settlement, a correction to a locked visit, an office attendance correction | Client |

### Known residual risks after Gate A

| Risk | Why it remains |
|---|---|
| Wrong-money defects are still present: apprentice rate, hard-coded holidays, mileage not paid, no PAYE refunds, fines before tax, minimum wage assessed on the wrong period. (The top-up double count and the 23:59 band gap have since been fixed on branch `payroll-remediation/phase-1`.) | Phases 1–5. Gate A made pay safe to hold still, not correct |
| A visit paid through the UK run's provisional route gets visit pay only | Decision D-03 |
| "Paid" rests on a person typing a reference | No bank integration (Phase 6.3) |
| Triggers can be bypassed by a database superuser or by setting the reset switch | By design for test resets; production must not set `ALLOW_FINANCIAL_TEST_RESET` and database access must be restricted |
| Concurrency was tested in one process | Multi-instance behaviour relies on the same database constraints, which hold, but was not load-tested |
| Charge / invoice side has no equivalent protection | Outside this programme |

---

## Operational controls to put in place before any live use

1. `NODE_ENV=production` and `ALLOW_FINANCIAL_TEST_RESET` unset.
2. At least two named users for pay: one prepares, one approves.
3. Database backups before each pay run lock and each UK run close.
4. No direct database write access for application users.
5. A written procedure for corrections, reversals and reopening a run.
6. HMRC live submission and any bank payment remain manual, explicitly authorised steps.

---

## What was not done in this phase, stated plainly

- No statutory calculation was changed or validated.
- No HMRC submission and no bank payment was made or simulated as real.
- No production or shared database was touched. Schema changes exist only on the local development database and the local test database.
- Nothing was pushed to a remote repository.
- Of Phases 1 to 9, only three small fixes (PC-21, PC-02, EL-09) have been made.
