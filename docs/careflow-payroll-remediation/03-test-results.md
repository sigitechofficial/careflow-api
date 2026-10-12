# 03 — Test Results

**Run:** 2026-10-12, local development machine · branch `payroll-remediation/gate-a` in both repositories (backend `c53dd9a`, frontend `01da8a2`)

No test touched the development database's business data, a live system, HMRC or a bank. Integration tests run against a separate local database that holds synthetic rows only. The migration rehearsal uses a third, scratch database that it creates and drops.

---

## 1. Summary

| Suite | Suites | Tests | Passed | Failed |
|---|---|---|---|---|
| Backend payroll integration, incl. HTTP (`npm run test:payroll-int`) | 19 | 193 | 193 | 0 |
| Backend unit: billing, payroll, ecm, visit-attendance, job-allocations, scheduled-jobs-housekeeping, service-user-referrals, common, role-responsibilities, audit-logs | 81 | 479 | 479 | 0 |
| Backend unit: `src/employee-app` | 32 | 183 | 181 | 2 (unrelated, see 6.3) |
| Migration rehearsal (`npm run payroll-migration-rehearsal`) | — | 28 checks | 28 | 0 |
| Frontend, wages scope (`npx vitest run src/features/billing src/features/employees/lib src/features/settings`) | 8 | 37 | 37 | 0 |
| Frontend, whole repository (`npx vitest run`) | 227 files | 1,268 | 1,252 | 16 (unrelated, see 6.4), plus 13 Playwright files that Vitest cannot load |
| Backend type-check (`npx tsc --noEmit -p tsconfig.json`), `src` and `test/payroll-int` | — | — | no errors outside pre-existing spec / seed files | |
| Frontend type-check (`npx tsc --noEmit -p tsconfig.json`) | — | — | 0 errors | |

### How the figures grew, and the 55 / 56 question

| Point | Integration suites | Integration tests |
|---|---|---|
| End of Phase 0 | 9 | 54 |
| After Phases 1.1 / 4.1 (`minimum-wage`, 2 tests) | 10 | **56** |
| End of the Gate A sprint | 19 | 193 |

The previous version of this report said "56" in its summary while the per-suite table added up to **55**. The table was wrong: it listed `controls` with 9 tests; the suite has 10 (it had 10 at that commit too). Fifty-six was the true figure. The per-suite table below is taken from the Jest JSON output of the final run, not typed by hand.

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

```bash
npm run payroll-migration-rehearsal
```

Frontend (`care-admin`):

```bash
npx vitest run src/features/billing src/features/employees/lib src/features/settings
```

```bash
npx tsc --noEmit -p tsconfig.json
```

`payroll-test-db` creates `<dev database>_payroll_test` on the local PostgreSQL server (it refuses any other host), pushes the Prisma schema and applies the trigger migrations. The harness refuses any database whose name does not end in `_payroll_test`.

Actual output of the final runs:

```text
payroll integration   Test Suites: 19 passed, 19 total   Tests: 193 passed, 193 total
unit (command above)  Test Suites: 81 passed, 81 total   Tests: 479 passed, 479 total
src/employee-app      Test Suites: 2 failed, 30 passed, 32 total   Tests: 2 failed, 181 passed, 183 total
migration rehearsal   28 of 28 checks passed
frontend wages scope  Test Files 8 passed (8)   Tests 37 passed (37)
frontend whole repo   Test Files 21 failed | 206 passed (227)   Tests 16 failed | 1252 passed (1268)
```

---

## 3. Integration suites (final run)

Two kinds. **Service level**: real services, real PostgreSQL, real constraints and triggers; collaborators not under test are small stubs and the audit stub records calls. **HTTP**: the whole application module with only the database client replaced, real controllers, guards, validation and JWTs; scheduled jobs stopped; push notifications stubbed; the clock is controlled where attendance times matter.

| Suite | Kind | Tests | What it proves |
|---|---|---|---|
| `duplicate-claims` | service | 10 | Same visit in two runs → one line. Two runs calculating at once → one line per visit. Idempotent recalculation. Double-up → one line per carer. Supplementary run pays only new work. Database refuses a duplicate claim. Failed calculation → retry works. Pay item claimed once under concurrency |
| `uk-provisional` | service | 6 | Visit paid provisionally by a closed UK run is not collected again by any route. Two UK runs with the same visit cannot both close. Reopening releases claims and is refused once a payout is approved |
| `uk-cancellation` | service | 12 | **R-08.** Cancel releases locked lines and provisional visits; replacement collects each once; snapshot kept; cancelled run's claims do not block; cancel refused with a payout batch or live FPS; concurrent cancel and close → one wins; two runs collecting at once → no duplicate; failed transaction leaves claims intact; salary and deduction claimed per period; reactivation starts clean; reason audited |
| `locked-history` | service | 7 | Settled pay cannot change through the service or directly in the database; a locked run cannot be recalculated, re-approved or discarded |
| `pay-corrections` | service | 9 | Positive and negative corrections as separate approved adjustments; same correction twice pays once; two simultaneous submissions → one item; reversal once. **R-01:** history shows original / corrected / difference and each stage; a rejected correction is kept and does not block; a visit settled by a UK run uses its settled amount |
| `pay-charge-separation` | service | 5 | **R-07.** Charge-only overrun decision on a paid visit; pay-side decision still refused; pay basis kept; charge quantity and amount corrected; rate change reprices charge only |
| `reassignment` | service | 3 | Removed carer withdrawn before pay; after pay the replacement is held for a manager |
| `payouts` | service | 9 | Job proposes DRAFT only; closed run required; preparer cannot approve; PAID needs evidence; audit. **R-09:** typed reference → `MANUALLY_RECORDED`, never confirmed; legacy paid batch reads the same; cancelled is not paid |
| `controls` | service | 10 | Bulk deletion refused in four environment combinations (5 cases); maker / checker on visit pay run and UK close; recalculation withdraws approval; audit of run and visit decisions |
| `attendance` | service | 5 | Office correction reprices unpaid pay; on a paid visit raises one pending correction; unverified time holds and still prices; verification clears |
| `minimum-wage` | service | 2 | One top-up line; gross equals the legal hourly rate |
| `rate-regressions` | service | 6 | **PC-21** through the real reconciliation service and the calendar table: Sunday into Monday; clock change; substitute holiday; 25 / 26 December and 1 January by date; a card's own Christmas rate; fixed fee versus hourly; pay and charge each time |
| `di-wiring` | service | 1 | The application module graph resolves |
| `http-payroll-api` | HTTP | 67 | **R-10, R-05, R-12.** Authentication and permission on 45 route cases; Super Admin does not hold the six powers; run lifecycle with maker / checker and transitions; corrections; payout batch; UK close / reopen / cancel; branch scope (8); who holds the powers (5) |
| `carer-app-attendance` | HTTP | 16 | **R-02, R-03, R-04.** Carer session required; normal visit; reported earlier start not paid; future finish refused; missing check-in held; offline upload held then corrected; repeated completion; overnight; late start within tolerance paid as planned; double-up per carer, both orders of completion; three carers; office time before completion; office time contradicted; office correction for one carer of two |
| `earning-status` | HTTP | 6 | **R-06.** Stage at every step of the visit-pay-run route and the direct UK route; cancelled run gives the earning back; correction shows; branch list totals; carer app shows the same stage |
| `pay-card-api` | HTTP | 2 | **PC-02.** Create with a custom band → reload → edit → preview → publish → new version; validation and permission |
| `minimum-wage-flow` | HTTP | 4 | **EL-09.** One top-up in draft, recalculated, approved and locked run; not repeated by a later run; once in UK gross; once in export and carer totals |
| `e2e-gate-a` | HTTP | 13 | One synthetic month end to end (doc 09) |

**New or extended unit suites in this sprint:** `earning-status.util.spec` (10), `payment-state.util.spec` (7), `financial-authority.util.spec` (6), `role-responsibilities.catalog.spec` (8, 4 new), `pay-settlement.util.spec` (7, 1 new), `charge-time-band.all-day.spec` (6), `visit-time-trust.util.spec` (18, rewritten for per-carer and office times).

**Frontend tests added:** `VisitPayCorrectionsCard.test.tsx` (8), `ResponsibilitiesPanel.test.tsx` (3), `earning-stage.test.ts` (4), `BillingCardRulesEditor.custom-period.test.tsx` (3).

---

## 4. Database and migration tests

| What | Result |
|---|---|
| Unique claim index on pay lines, on UK input lines; one reversal per item | Refuse a duplicate (integration tests and rehearsal) |
| Triggers on locked runs, lines and paid visits | Refuse direct updates and deletes (`locked-history`, rehearsal) |
| Migrations 1–7 on the pre-remediation schema with synthetic history | 28 of 28 checks (doc 04, section 5) |
| Schema after migrations equals `schema.prisma` | Empty diff |
| Rows before and after the migrations | Identical counts in the eight pay tables |

---

## 5. Browser tests

Run against a second instance of the application (API on port 3101, app on port 5174) connected to the payroll test database after the end-to-end month had filled it. Two synthetic office users. Detail and limits in doc 09, section 4.

| Flow | Result |
|---|---|
| Employee → Earnings: stage per visit, settled total, "Pay corrections" link on settled visits | As expected |
| Record a correction (£14.00 → £21.00) as user 1 | Recorded; +£7.00 pending; "Approve" disabled for user 1 with the explanation |
| Open the same visit from Visit reconciliation as user 2; approve | "Approved for payroll · entered by … · approved by …" |
| Settled visit: mileage and manual pay | Not editable; pointer to pay corrections |
| Employee payouts, all history | "Payment recorded manually", "not confirmed by a bank" |
| Roles & permissions → Responsibilities (on the development system, read only) | Users per power; four warnings because nobody holds the approval powers; admin roles choosable |

Not clicked in a browser: approving and locking a pay run, closing a UK payroll run, recording a payment, reversing a correction, the pay card walk-through. These are covered over HTTP.

---

## 6. Known limitations

1. **The mobile carer app was not exercised.** The tests drive the endpoints the app calls, with the fields its DTOs accept. What the app really sends, its offline queue and its screens are untested: the source and a build were not available.
2. **Statutory calculation is replaced by a stand-in** in the end-to-end and UK-run tests (net pay is set by hand). Tax, NI and HMRC submission are outside Gate A.
3. **Two backend suites fail in `src/employee-app`** (`employee-app-body-map-pins.util.spec`, `employee-app-auth.service.spec`). Neither the files nor their subjects differ from the audited base commit.
4. **Sixteen frontend tests fail in eight files** outside the wages scope (alerts, scheduling timeline, service-user tabs, initial assessment, `src/test/utils.test.ts`); none of those files differs from the frontend base commit. Thirteen Playwright specs under `tests/e2e` are picked up by Vitest and cannot load there.
5. **Frontend component tests need `@testing-library/dom`**, a peer dependency that is in the lock file but was missing from the installed modules on this machine. It was installed locally; no project file changed.
6. **Concurrency tests** use concurrent calls in one process. They exercise the database constraints and conditional updates, not a multi-instance deployment or load.
7. **Per-carer trust records** are written by read-modify-write on the job's metadata. Two carers completing in the same instant could overwrite each other's record; not reproduced, not fixed.
8. **Integration tests assume a 15-minute duration tolerance** and now set it on every reset. A real organisation's setting is 20 minutes by default (decision D-14).
9. **Pre-existing type errors** remain in `prisma/scripts`, `prisma/seeds` and some spec files outside the wages scope. None in `src` or `test/payroll-int`.
10. **Browser coverage is partial** (section 5).

---

## 7. Reproduction evidence from earlier phases

| Area | Result on unfixed code |
|---|---|
| `duplicate-claims` | 7 of 10 failed |
| `payouts` | 5 of 6 failed |
| `pay-time-band.all-day` | 13 of 14 failed |
| `minimum-wage` | Run gross was £20.42 where £12.71 was expected |
| `uk-cancellation` (this sprint) | Written with the fix, so it did not run red first. The stranding follows from the old unique index on `sourcePayrollRunLineId`, which allowed one input line per pay line whatever the state of its run. The migration rehearsal seeds that situation on the old schema and shows the line is collectable after migration 6 |
| Support carer after lead (this sprint) | The end-to-end test failed first: row stayed approved with the app's time |
| Export hours (this sprint) | The EL-09 test failed first: total hours 2.00 for a one-hour visit |
