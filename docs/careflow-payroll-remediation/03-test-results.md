# 03 — Test Results

**Run:** 2026-10-12, local development machine · backend head `9660c33` · frontend head `e6c17e6`

No test touched the development database's business data, a live system, HMRC or a bank. Integration tests run against a separate local database that holds synthetic rows only.

---

## 1. Summary

| Suite | Suites | Tests | Result |
|---|---|---|---|
| Payroll integration (`npm run test:payroll-int`) | 9 | 54 | all pass |
| Unit: billing, payroll, ecm, visit-attendance, job-allocations, scheduled-jobs-housekeeping, service-user-referrals, common, role-responsibilities, audit-logs | 76 | 423 | all pass |
| of which new in Phase 0 | 4 | 27 | all pass |
| Frontend type-check (`tsc --noEmit`) | — | — | no errors |

Before Phase 0 the wages scope had 57 suites / 324 unit tests and no service, database or permission test.

---

## 2. Commands

```bash
npm run payroll-test-db
```

```bash
npm run test:payroll-int
```

```bash
npx jest src/billing src/payroll src/ecm src/visit-attendance src/job-allocations src/scheduled-jobs-housekeeping src/service-user-referrals src/common src/role-responsibilities src/audit-logs
```

`payroll-test-db` creates `<dev database>_payroll_test` on the local PostgreSQL server (it refuses any other host), pushes the Prisma schema and applies the trigger migrations. The harness refuses any database whose name does not end in `_payroll_test`.

---

## 3. Integration suites

Real services, real PostgreSQL, real constraints and triggers. Collaborators that are not under test (organisation settings, pay card resolution, audit sink) are small stubs; the audit stub records calls so audit coverage is asserted.

| Suite | Tests | What it proves |
|---|---|---|
| `duplicate-claims` | 10 | Same visit in two runs → one line. Two runs calculating at once → one line per visit. Same run twice → idempotent. Double-up → one line per carer. Supplementary run over a locked period pays only new work. Second run cannot take a visit at lock. Database refuses a duplicate claim. Failed calculation → run usable, retry works. Changed visit must be recalculated before lock. Pay item claimed once under concurrency |
| `uk-provisional` | 6 | Visit paid provisionally by a closed UK run is not collected by a later UK run or by a visit pay run. An open visit pay run cannot lock it. Two UK runs with the same visit cannot both close. A locked line reaches one UK run. Reopening releases claims and is refused once a payout is approved |
| `locked-history` | 7 | Completed visit is priced and locked. Bulk recalculation leaves it alone. Attendance edited after lock keeps the pay snapshot and records the new fact. Pay-side actions are refused. Database refuses changes to a paid visit, a locked line and a locked run. A locked run cannot be recalculated, re-approved or discarded. An unlocked visit still reprices |
| `pay-corrections` | 6 | Positive backpay and negative correction as separate approved adjustments in the next run. Same correction twice pays once. Two simultaneous submissions create one item. Unsettled visit is refused. Reversal once, equal and opposite |
| `reassignment` | 3 | Removed carer withdrawn before pay. After pay the paid row stays and the replacement is held for a manager. Double-up keeps both carers |
| `payouts` | 6 | Job proposes DRAFT only. Job leaves existing batches alone. Closed run required. Preparer cannot approve. PAID needs evidence; future date refused. Create / approve / settle / cancel audited |
| `controls` | 9 | Bulk deletion refused in four environment combinations and allowed only on opt-in, with audit. Maker / checker on visit pay run and UK run close. Recalculation withdraws approval. Audit of run and visit decisions |
| `attendance` | 5 | Office correction reprices unpaid draft pay and keeps the event. On a paid visit it leaves the record and raises a pending correction; repeating it creates nothing. Start-after-finish refused. Unverified carer time holds the visit and still prices it. Office verification clears the flag |
| `di-wiring` | 1 | The whole application module graph still resolves after constructors and module imports changed |

### Mandatory Phase 0 tests from the brief

| Required test | Covered by | Result |
|---|---|---|
| Same visit in two runs | duplicate-claims | pass |
| Two payroll jobs executing concurrently | duplicate-claims (visits and pay items), uk-provisional (two closes) | pass |
| Same visit calculated twice | duplicate-claims | pass |
| Double-up visit with two employees | duplicate-claims, reassignment | pass |
| Visit reassigned after completion | reassignment | pass |
| Previously paid visit corrected | pay-corrections, attendance | pass |
| Prior-period adjustment | pay-corrections (paid in the following week's run) | pass |
| Supplemental payroll run | duplicate-claims | pass |
| Failed transaction and retry | duplicate-claims | pass |
| Edit attendance after locking | locked-history, attendance | pass |
| Correct a pay rate retroactively | locked-history (rate changed, bulk recalculation) | pass for "history unchanged"; arrears across visits is Phase 1.5 |
| Recalculate a locked visit | locked-history | pass |
| Correct a cancelled visit | — | not applicable yet: a cancelled visit has no pay record (VW-08, Phase 2.1) |
| Generate positive backpay / negative correction | pay-corrections | pass |
| Run adjustment twice | pay-corrections, attendance | pass |
| Reverse an adjustment safely | pay-corrections | pass |

---

## 4. Reproduction evidence

Tests were written first where that was practical, and run against the unfixed code:

| Area | Result on unfixed code |
|---|---|
| `duplicate-claims` | 7 of 10 failed (duplicate lines, run stuck in CALCULATING, lock overwrote the claim, pay item in two runs) |
| `payouts` | 5 of 6 failed (job approved and marked paid, payout from an unclosed run, self-approval, no evidence, no audit) |
| `locked-history` | Service guards failed. The two "history unchanged" cases already passed because the triggers, added first, refused the write |
| `uk-provisional`, `reassignment`, `attendance`, `pay-corrections` | Written with or after the fix; they did not run red first |

---

## 5. Known limitations

1. **Carer-app completion** (`EmployeeAppVisitsService.complete`) is not integration-tested: the service has more than fifteen collaborators. The time-trust rules are unit-tested and the wiring is a few lines.
2. **No HTTP-level tests.** Guards and services are tested; controllers are covered only by the dependency-injection smoke test and type-checking.
3. **No frontend tests** were added. The changed screens type-check. In a browser on the local instance, the employee payouts page and the visit pay runs page were opened: both render with the new wording and controls, with no console errors, and "Approve" is disabled for a Super Admin who has not been given the approval power. The settlement form and the discard / recalculate actions were not clicked, because the only data present belongs to the developer.
4. **Concurrency tests** use two concurrent calls in one process. They exercise the database constraint and conditional updates, not multi-instance deployment.
5. **Two unrelated suites fail** in `src/employee-app` (`employee-app-body-map-pins.util.spec`, `employee-app-auth.service.spec`). Neither file nor its subject was changed in this work.
6. **Pre-existing type errors** remain in `prisma/scripts`, `prisma/seeds` and some spec files outside the wages scope. No new type error was introduced in `src` or `test/payroll-int`.
7. Statutory calculations, HMRC and banking are untouched and untested in Phase 0.
