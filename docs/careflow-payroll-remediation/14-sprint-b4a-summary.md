# 14 — Sprint B4A Summary: Wage Recovery and Minimum Wage Review Screens

**Date:** 2026-10-13 · **Branch (both repositories):** `payroll-remediation/sprint-b4a`, on top of `payroll-remediation/sprint-b3`

Nothing was pushed, deployed, run against live data, sent to HMRC or paid. All data in tests is synthetic. This sprint does not make CareFlow a complete UK payroll product: tax and NI in these tests are stand-ins.

## 1. Result

| Task | Status | In one line |
|---|---|---|
| 1. Wage Recoveries screen | **DONE** | Billing → Wage recoveries: list, detail with history, authorise (authority, reference, reason), reject, and the employer recovery policy gate |
| 2. UK Payroll Minimum Wage Review | **DONE** for what the UK run assesses (salaried hours work); see gaps 1 and 2 in section 6 | Minimum wage compliance section on the UK payroll run page, with a review that states what it found and cannot clear a shortfall |

## 2. Task 1 — Wage Recoveries

Screen: `/billing/wage-recoveries` (sidebar: Billing → Wage recoveries; permission `billing.payroll_runs.read`, organisation pay scope).

- **List**, pending first, with tabs for authorised, deducted, rejected and all: employee, original payment, type, originally paid, recovery proposed, reason, status, date and user of the proposal, who decided and on what authority, the run it was deducted in.
- **Detail** (Open): the same fields plus what is now due, and a **history**: proposed, authorised or rejected (with reason, authority and the amount the decision was for), proposed again, withdrawn, deducted in which run.
- **Authorise**: authority type, its reference (at least 10 characters) and a reason are all required. The amount is shown and has no input. The screen says that choosing an authority records what was relied on and is not proof that the deduction is lawful.
- **Reject and write off** with a reason.

How each safeguard is enforced:

| Safeguard | Where |
|---|---|
| Proposer cannot approve their own proposal | API (403, existing B3 rule); the screen replaces the form with an explanation |
| Approval needs the existing financial permission | API: `billing.payroll_runs.approve` (explicit grant). Without it the screen is read-only |
| An unauthorised recovery does not reduce wages | Unchanged from B3: held line, no deduction |
| A changed amount needs fresh approval | Unchanged from B3 (goes back to proposed); the screen marks it "Amount changed: needs a fresh decision" |
| An applied recovery is not applied twice | Unchanged from B3; the API refuses any further decision and the screen offers none |
| No direct editing of an amount | No route changes an amount; an `amount` sent with a decision is refused (400) |
| Locked payroll and audit history preserved | Nothing is written to a locked or closed run; decisions and policy changes are audit entries |
| An authority type is not proof | Free-text reference and reason are required as well, and the wording says so |
| **Employer recovery policy not approved → review allowed, deduction blocked** | **New.** `WageRecoveryPolicy`: until a user with the approval power records where the approved policy and its legal authority are kept, an authorised recovery stays "authorised, not deducted" (held line on the run with that reason). Withdrawing the record blocks deductions again on the next calculation of an open run. Recording and withdrawing are audited |

Backend changes are small: the list and detail responses carry names, the original payment and history; approval now requires a reason as well as the authority; three policy routes; the outcome `POLICY_BLOCKED` in the existing recovery resolution. No new engine and no new status.

## 3. Task 2 — Minimum wage compliance on the UK payroll run

Section on the existing UK Payroll Run Detail page, above the employees table.

- **Per employee:** name, pay reference period, classification (work type and age band), hours the pay is measured against and hours worked, relevant pay, minimum rate, shortfall, top-up made by this run, assessment status, the reason it is not decided, and the review (what it found, who, when, the facts).
- **What stops closing** is listed at the top of the section; **Unresolved only** filters the table; **Details** shows the calculation and the review form.
- **Review** uses the existing API (`POST /payroll/runs/:id/nmw-assessments/:assessmentId/review`, permission `payroll.runs.close`, not the creator of the run). It now takes an **outcome** and a statement of facts of at least 20 characters.
- **Refresh:** the section reads the run; calculating gross re-reads it.

Compliance rules and how they hold:

| Rule | How |
|---|---|
| A confirmed shortfall cannot be dismissed by an ordinary review | Outcome `SHORTFALL_CONFIRMED` sets the issue to `SHORTFALL`. The API refuses any further review of it (either outcome, any user), and the screen offers none |
| A review resolves incomplete evidence or classification only on a documented factual basis | Only an open question can be reviewed (`BASIC_HOURS_NOT_RECORDED`, `EXCESS_HOURS_NOT_VERIFIED`, period or schedule problems). The facts are required and audited. Only the outcome `EVIDENCE_SUPPORTS_COMPLIANCE` unblocks closing |
| A verified shortfall requires the top-up or correction | A certain shortfall on basic hours is topped up by the run (B3). A confirmed one keeps the run blocked until pay is corrected and gross recalculated shows no shortfall (gap 1) |
| Reviewer is not the creator of the run | API (403, existing); the screen says so instead of showing the form |
| Unresolved blocking assessments prevent closure | Close check now reads the outcome: unreviewed and confirmed-shortfall assessments both block, and the error says how many are confirmed shortfalls |
| Recalculating gross invalidates outdated reviews | **Changed.** B3 dropped every review on recalculation. Now a review is kept only while pay, hours, rate and top-up are exactly the same and a question remains; any change drops it. If the dropped review had confirmed a shortfall, the new assessment says so for the next reviewer |
| Closed payroll history is not rewritten | Review and recalculation are refused on a closed run (tested) |

## 4. Files changed

**Backend** (`careadmin-backend`)

- `prisma/schema.prisma`, `prisma/migrations/20261020100000_wage_recovery_review_fields/` — additive (see `04-database-changes.md`)
- `src/billing/wage-recovery.store.ts`, `wage-recoveries.service.ts`, `wage-recoveries.controller.ts`, `payroll-runs.service.ts` (passes paid and due amounts; holds on `POLICY_BLOCKED`)
- `src/billing/nmw-period.util.ts` (review outcomes, `nmwBlocksClose`, `nmwCanBeReviewed`)
- `src/payroll/payroll-runs.service.ts`, `payroll-runs.controller.ts`, `dto/payroll.dto.ts`
- `src/audit-logs/enums/audit-action.enum.ts` (policy recorded / withdrawn)
- Tests: `test/payroll-int/wage-recoveries.int-spec.ts`, `salaried-nmw.int-spec.ts`, `nmw-reference-period.int-spec.ts`, `harness.ts`, `browser-fixture.seed.ts`; `scripts/payroll-migration-rehearsal.mjs` (one check added)
- Docs: this file; `04`, `05` (D-23), `06` (B3-01, B3-02 done; B4A-01 to B4A-03 added)

**Frontend** (`care-admin`)

- New: `src/features/billing/pages/WageRecoveriesPage.tsx` (+ test), `api/wage-recoveries.api.ts`, `hooks/useWageRecoveries.ts`
- New: `src/features/payroll/components/NmwComplianceSection.tsx` (+ test)
- Changed: `src/router.tsx`, `src/components/layout/Sidebar.tsx`, `src/features/payroll/pages/UkPayrollRunDetailPage.tsx`, `types/payroll.types.ts`, `api/payroll.api.ts`, `hooks/usePayroll.ts`

## 5. Commits (local, not pushed)

| Repository | Commit | What |
|---|---|---|
| Backend | `d411168` | Wage recoveries: review API for the screen, employer policy gate, migration |
| Backend | `60c1d6f` | Minimum wage review outcome; a shortfall cannot be reviewed away; reviews and recalculation |
| Backend | `c21553c` | Run detail names the user who created the run |
| Backend | `2f161be` | Browser fixture, rehearsal check, test isolation fix |
| Backend | the commit that adds this file | This report; docs 04, 05 and 06 |
| Frontend | `a67a097` | Wage recoveries screen |
| Frontend | `ba8a7f2` | Minimum wage compliance section |

## 6. Tests

Focused tests during the work; one consolidated run at the end. The whole-repository suites were not run (per the sprint rules; their known unrelated failures are listed in doc 13).

| Run | Result |
|---|---|
| Payroll integration suite, once (`npm run test:payroll-int`) | 41 suites, 423 tests: **422 passed, 1 failed** on the single full run. The failure was one assertion in a new test (`wage-recoveries`, the policy audit entries): it counted audit rows that earlier runs had left in the test database. The assertion now counts only its own test's entries, and that spec was re-run: 14 of 14 passed. The full suite was not run a second time |
| Backend unit: `src/billing`, `src/payroll`, `src/common/guards`, `src/role-responsibilities` | 59 suites, 467 tests passed |
| Frontend: `src/features/billing`, `src/features/payroll` | 13 files, 79 tests passed (18 new) |
| Type-check, backend (`tsconfig.build.json`) and frontend | Clean |
| Migration rehearsal (schema changed) | 60 of 60 checks passed (one added: no recovery policy is created by the migrations) |

New or changed tests, by the brief's list:

- **Task 1, API** (`wage-recoveries.int-spec.ts`, 14 tests): pending list with all fields; approval and rejection; permission denied (403); self-approval rejected (403); missing authority, short authority, missing reason (400); amount not enterable or editable; amount changed after approval goes back to proposed; applied recovery cannot be decided or applied again; history; no policy on record → authorised but not deducted, then deducted once after the policy is recorded, blocked again after it is withdrawn.
- **Task 1, screen** (`WageRecoveriesPage.test.tsx`, 9 tests): pending list; authorise form rules; reject; read-only without permission; own proposal; server refusal shown; amount changed; already applied with history; no policy on record.
- **Task 2, API** (`salaried-nmw.int-spec.ts`, 14 tests): compliant employee; top-up; missing basic hours; unverified excess hours; review permission (403), creator of the run (403), facts too short or unknown outcome (400); confirmed shortfall cannot be reviewed away and blocks closing until pay is corrected; recalculation keeps a review on unchanged figures and drops it on changed ones; nothing to review on a compliant or topped-up salary; closed run is not reviewed or recalculated.
- **Task 2, screen** (`NmwComplianceSection.test.tsx`, 9 tests): compliant; top-up displayed; missing basic hours and excess hours listed as blocking, with the filter; review form rules; confirmed shortfall; permissions, own run, closed run; server refusal shown; status after recalculation; empty state.

**Browser verification:** done on the test instance (API port 3101, frontend port 5174, payroll test database, synthetic fixture extended for this sprint; never the development database). Signed in as the synthetic approver.

- **Wage recoveries:** the sidebar entry and page load; the banner says no recovery policy is on record; the pending list shows Sam Salaried, £2,000.00 paid, £200.00 proposed, proposed by Olivia Office. Open shows paid, now due, proposer, run and history. The Authorise button is disabled until authority, reference and reason are filled. After authorising: status Authorised, decided by Peter Payroll with the authority text, a second history line, and "Authorised, but not deducted: no approved recovery policy of the employer is on record"; the authorise form is gone and reject remains.
- **Minimum wage compliance** on the December UK run: three rows (Lee topped up by £152.30, Sam compliant, Erin not decided with 150h worked and £206.50), and the banner naming Erin as what stops closing. "Unresolved only" leaves Erin. Recording a review with the outcome "A shortfall is confirmed" turns the row to Shortfall confirmed with reviewer, date and facts; the review form disappears and the banner stays. Calculate gross again: still confirmed. Tax and NI, then Close run: refused by the API (400) and the run stays open.

The generated login file was deleted afterwards and both test servers were stopped.

## 7. Security and compliance gaps

1. **The amount owed for excess hours is not calculated.** A reviewer can confirm a shortfall, and the run then cannot be closed, but the system does not work out the top-up: that depends on the hours of the year (B3-04, not in this sprint). The pay has to be corrected by hand and gross recalculated (B4A-01).
2. **The section shows only the assessments the UK run makes** (salaried hours work). Hourly workers are assessed by visit pay runs; those assessments have no screen of their own (B4A-02).
3. **Authority and facts are text.** The system records who said what and when; it does not check a clause against a contract, and no document is attached (B4A-03).
4. **The recovery policy record is a statement by one user** with the approval power. It is audited and can be withdrawn, but it is not a second-person approval and it is one switch for all recovery types.
5. **After changed figures, a previously confirmed shortfall is reviewed afresh.** The earlier confirmation stays in the audit log and the new assessment mentions it, but a reviewer could now record the other outcome. The reviewer is still never the creator of the run.
6. **Reviews recorded under Sprint B3 carry no outcome**, so on an open run they block closing again until reviewed with one. Closed runs are not affected.
7. **Seen during the browser check, not fixed (outside this sprint):** the API process exits when an audit entry cannot be written for a user who no longer exists (a browser session left over from before the test database was re-seeded made a request). An audit write that fails should not stop the server; worth a small fix of its own.
8. Unchanged from B3: a run can be locked or closed with a recovery proposal undecided (the employee is simply not charged), and undecided proposals do not escalate (B3-05). Deductions entered by people (fines, corrections) still record no authority (B3-03).

## 8. Business decisions still needed

- **D-23 — recovery of overpaid wages:** the authority the employer relies on, who may authorise, any value or time limit, and whether a recovery may take pay below the minimum wage. Until then the policy record should stay empty in real use.
- **Basic hours for salaried staff over the year** (doc 13, section 6): needed to decide excess hours instead of reviewing them each period.
- **Who may review minimum wage exceptions:** today it is whoever may close payroll. Confirm that this is the intended role.

## 9. Recommended next small sprint

**B4B — decide excess hours from the year so far (B3-04 and B4A-01):** keep a running total of basic hours and hours worked per salaried employee and calculation year, so that an excess-hours shortfall is calculated and topped up by the run instead of being flagged every period, and a confirmed shortfall has an amount. It is the one place where these two screens still leave the user to do arithmetic by hand. It needs the basic-hours decision above first.
