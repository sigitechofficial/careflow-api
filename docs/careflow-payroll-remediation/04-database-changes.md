# 04 — Database Changes

**Updated:** 2026-10-13 (Gate B2)

Eighteen migrations so far (seven to the end of the Gate A sprint, six in the Gate B sprint: section 0, five in Gate B2: section 00). Each adds columns, indexes, triggers or an enum value; none drops a table, a column or a row. They have been applied to the local development database, the local payroll test database and, for rehearsal, a scratch database built from the pre-remediation schema. **They have not been run on production or on any shared database.**

---

## 00. Gate B2 — migrations 14 to 18

All five are additive: nullable columns, new tables, one enum value. No table, column or row is dropped, no existing row is changed, and no constraint or trigger that protects financial history is altered. Applied to the local development database, the local payroll test database and the scratch rehearsal database only.

| # | Migration | What it does | Item |
|---|---|---|---|
| 14 | `20261015100000_mileage_correction_tax_fields` | `EmployeePayItem.taxFreeAmount`, `taxableAmount`, `taxTreatment` (nullable) | D-21 |
| 15 | `20261016100000_salary_agreement_terms` | `EmployeePayAgreement.salaryEntryPeriod`, `salaryEntryAmount`, `salaryProrationMethod`, `salaryCoverage`, `approvedById`, `approvedAt`, `termsChangedAt`; `UkPayrollInputLine.unpaidAmount`, `unpaidReason` (all nullable) | WM-02, WM-03, WM-09 |
| 16 | `20261016140000_guaranteed_hours` | Enum value `PayrollRunLineType.GUARANTEED_HOURS` (`ADD VALUE IF NOT EXISTS`); `EmployeePayAgreement.guaranteedWeeklyHours`, `guaranteeTopUp`, `guaranteeQualifyingTime`, `guaranteeLeaveTreatment` (nullable) | WM-07, EL-01 |
| 17 | `20261017100000_travel_intervals_and_disruption_pay` | Tables `billing.TravelTimeInterval`, `billing.VisitDisruptionPayRule`, `billing.VisitDisruptionPayDecision` (unique `payItemId`) | TR-01 to TR-06, Q13 |
| 18 | `20261018100000_nmw_periods_and_leave_terms` | Tables `billing.NmwPeriodAssessment` (unique per run, employee and period start; deleted with its run), `payroll.EmployeeLeaveTerms`, `payroll.EmployeeLeaveEntry`; `EmployeePayrollProfile.apprenticeshipStartDate` (nullable) | Q37–Q39, Q35 |

### What the migrations deliberately do not do

- They create no agreement, guarantee, rule, leave terms or apprenticeship date. Every policy value is entered by people afterwards.
- They do not back-fill any pay line. Lines of locked runs are untouched (the history triggers would refuse it, correctly). A locked overtime or minimum wage line written before Gate B2 carries no weekly or period claim and is left as it was paid.
- An agreement that already exists gets no proration method and no salary cover: it keeps the earlier salary calculation, and, having no cover recorded, holds visit wages in UK gross until an approved agreement records one.

### Identities added in existing columns (no schema change)

`PayrollRunLine.claimKey`, already unique, now also carries: `OVERTIME:<employee>:<Monday of the week>:<n>`, `GUARANTEE:<employee>:<Monday>:<n>`, `NMW:<employee>:<first day of the pay reference period>:<n>`. `UkPayrollInputLine.claimKey` now also carries `SALARY:<employee>:<period>:<part>` for the second and later parts of a period's salary and `SALARY_ADJ:<employee>:<period>:<n>` for an adjustment of a paid period.

### Rehearsal

`npm run payroll-migration-rehearsal`: a scratch database is built at the audited commit, filled with synthetic history (now including a salary agreement made before these fields existed), all 18 migrations are applied in order, and 58 checks are made. New checks for Gate B2: an existing pay item gets no tax treatment; an existing agreement keeps its salary and status and gets no method, cover, approval or change mark; no existing UK line is marked covered or held; no agreement gets guaranteed hours; the new line type exists; no travel interval, disruption rule, disruption decision, minimum wage assessment, leave terms or leave entry is created; no profile gets an apprenticeship date. Result: **58 of 58**. The migrated schema equals `prisma/schema.prisma`, and the row counts of the nine tracked tables are unchanged.

### Rollback

Each migration's header says what dropping it would lose. In short: migrations 14 to 16 are nullable columns and can be dropped only while no run calculated after them needs the record (what a salary covered, how a correction was taxed); the enum value of 16 cannot be removed while a line uses it; the tables of 17 and 18 can be dropped, at the cost of the evidence they hold (approved intervals, pay decisions, assessments, leave terms). None of these is a routine rollback once real runs exist.

### Deployment prerequisites added by Gate B2

`node scripts/payroll-approval-permissions.mjs` (adds `payroll.pay_agreements.approve` to the permission list and to the role "Payroll Approver"; assigns it to nobody). Before real use: the conflicts list of the Gate B sprint still applies, and the queries of section 6 are unchanged.

---

## 0. Gate B sprint — migrations 8 to 13

All six are additive: new tables, new nullable or defaulted columns, one enum value, and data that is either a default or derived from what is already there. No table, column or row is dropped. No row of a locked pay run is written to. Applied to the local development database, the local payroll test database and the scratch rehearsal database only.

| # | Migration | Type | What it does | Item |
|---|---|---|---|---|
| 8 | `20261014100000_visit_attendance_verification` | schema | Tables `scheduling.VisitAttendanceVerification` (one row per carer and visit, unique) and `VisitAttendanceVerificationEntry` (append-only history, unique per event id) | R-16 |
| 9 | `20261014101000_pay_evaluation_failures` | schema | Table `billing.PayEvaluationFailure` (unique subject key; kind, category, safe message, status, occurrences, history) | R-17 |
| 10 | `20261014102000_reconciliation_approval_evidence` | schema + backfill | `VisitReconciliation.approvalSource`, `approvedEvidence`, `evidenceChangedReason`, `evidenceChangedAt`; enum value `EVIDENCE_CHANGED` | R-18 |
| 11 | `20261014103000_holiday_calendar_substitute_days` | schema + backfill | `BankHoliday.isSubstitute`, `substituteForDate`, `source`; `OrganisationGeneralSettings.holidayPremiumBasis` default `BOTH` | PC-22 to PC-24 |
| 12 | `20261014104000_mileage_rates_and_reimbursement` | schema | Table `billing.MileageRate`; `PayrollRunLine.quantity`, `taxFreeAmount`, `taxableAmount`, `taxTreatment`; `UkPayrollRunEmployee.reimbursementPayable`, `expenseNotVerified`; `EmployeePayoutLine.reimbursementAmount` | TR-09, TR-13 |
| 13 | `20261014104500_mileage_rate_defaults` | data only | Four `MileageRate` rows from 2000-04-06: the rates the application already used. `ON CONFLICT DO NOTHING`; safe to run twice | TR-09 |

### Backfills

| # | Backfill | Why it is safe |
|---|---|---|
| 10 | `approvalSource` = `MANAGER_APPROVED` where a person is recorded as approver, else `AUTO_VERIFIED`, for approved rows. `approvedEvidence` is left empty | Nothing is invented: a row with no recorded evidence adopts its current evidence the next time it is evaluated, without withdrawing the approval |
| 11 | Existing holiday rows: `source` = `LEGACY`; a fixed-date holiday recorded on another date is marked as the substitute for that date; a row that only says "substitute" is marked with the date left empty | No date is added, removed or switched off. With the default basis the new columns are not used for pricing, so no visit is re-priced |
| 12 | None. Miles are **not** back-filled onto existing mileage lines | Lines of locked runs are history and the triggers refuse to change them. Their miles are read from the description they were written with |
| 13 | The first mileage period | The same numbers the code held, so no amount changes. HMRC approved amounts are left empty |

### Rehearsal

`npm run payroll-migration-rehearsal`: a scratch database is built from the schema of the commit the programme started from, filled with synthetic history, and migrations 1 to 13 are applied in order. **45 of 45 checks passed**; the scratch database is dropped afterwards. Checks added for this sprint:

- visit approved by a person → `MANAGER_APPROVED`; without one → `AUTO_VERIFIED`; no evidence invented;
- attendance verification and pay evaluation failures start empty; `EVIDENCE_CHANGED` exists;
- "Christmas Day" on 27 December 2027 → substitute for 25 December; holidays on their own date are not substitutes; a row that only says "substitute day" is marked with no date; a switched-off holiday stays off; rows labelled `LEGACY`;
- `holidayPremiumBasis` defaults to `BOTH`;
- a locked mileage line is not rewritten (quantity empty, description and amount unchanged);
- four mileage rate rows with the old numbers, none verified; no historic UK run employee is given a reimbursement to pay; the data migration can be applied twice;
- the migrated schema equals `prisma/schema.prisma`; no row was removed.

### Pre-migration reports to run on a copy of real data (in addition to queries A–D of section 6)

| Report | What to look for |
|---|---|
| `GET billing/pay-cards/conflicts` after migration, or the query below before it | Carers who will be held because two active cards match them at the same level |
| `GET billing/bank-holidays/status` | Years and nations with missing dates |
| `GET billing/employee-payouts/reimbursements` | Expenses of earlier UK runs that never reached a payout |

```sql
-- E. Active pay cards for the same audience in force on the same day today (PC-32).
SELECT a."code" AS card_a, b."code" AS card_b, a."assignmentLevel", a."assignmentTargetId", a."assignmentTargetKey"
FROM "billing"."PayCard" a
JOIN "billing"."PayCard" b
  ON a."id" < b."id" AND a."assignmentLevel" = b."assignmentLevel"
 AND a."assignmentTargetId" IS NOT DISTINCT FROM b."assignmentTargetId"
 AND a."assignmentTargetKey" IS NOT DISTINCT FROM b."assignmentTargetKey"
WHERE a."deletedAt" IS NULL AND b."deletedAt" IS NULL
  AND a."status" = 'ACTIVE' AND b."status" = 'ACTIVE'
  AND a."effectiveFrom" <= CURRENT_DATE AND (a."effectiveTo" IS NULL OR a."effectiveTo" >= CURRENT_DATE)
  AND b."effectiveFrom" <= CURRENT_DATE AND (b."effectiveTo" IS NULL OR b."effectiveTo" >= CURRENT_DATE);
```

Such pairs are a problem only for carers with no card of their own; the conflicts endpoint lists exactly those carers.

### Recovery

Each of migrations 8 to 13 can be left in place if the application is rolled back: the previous code ignores the new tables and columns. Removing them would discard attendance verification history, recorded failures, approval evidence, substitute-day information, mileage rates and reimbursement amounts, and is not a routine rollback.

---

## 1. Migrations (apply in this order)

| # | Migration | Type | What it does | Sprint |
|---|---|---|---|---|
| 1 | `20261012100000_payroll_source_claims_and_corrections` | schema + backfill | `PayrollRunLine.claimKey` (unique); correction columns on `EmployeePayItem`; settlement columns on `EmployeePayoutBatch` | Phase 0 |
| 2 | `20261012101000_locked_payroll_history_triggers` | SQL only | Trigger functions and triggers protecting locked runs, their lines and paid visits | Phase 0 |
| 3 | `20261012102000_uk_run_visit_claims` | schema + backfill | `VisitReconciliation.paidByUkPayrollRunId` (+index) | Phase 0 |
| 4 | `20261012103000_paid_visit_trigger_uk_runs` | SQL only | Extends the paid-visit trigger to UK-run settlement and the reopen path | Phase 0 |
| 5 | `20261012110000_finance_exception_unverified_times` | enum | `FinanceExceptionCode` gains `UNVERIFIED_TIMES` | Phase 0 |
| 6 | `20261013100000_uk_payroll_input_claims` | schema + backfill | `UkPayrollInputLine.claimKey` (unique) and `releasedAt`; the unique index on `sourcePayrollRunLineId` becomes an ordinary index (R-08) | Gate A |
| 7 | `20261013110000_payout_settlement_source` | schema + backfill | `EmployeePayoutBatch.settlementSource` (R-09) | Gate A |

The folder names sort in application order, which is the order `prisma migrate deploy` uses. Migrations 2 and 4 are idempotent (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`). Prisma does not model triggers, so they do not appear in `schema.prisma`; `scripts/payroll-test-db.mjs` applies them to the test database.

Migration 6 creates the new unique index **before** it drops the old one, so there is no moment without a uniqueness rule on collected pay lines.

---

## 2. New columns

| Table | Column | Type | Purpose |
|---|---|---|---|
| `billing.PayrollRunLine` | `claimKey` | text, unique, nullable | One original earning per source across all visit pay runs. Null for derived lines |
| `billing.VisitReconciliation` | `paidByUkPayrollRunId` | uuid, nullable, indexed | Visit settled as a provisional input of a closed UK run |
| `billing.EmployeePayItem` | `originalPayrollRunLineId` | uuid | Locked line a correction refers to |
| | `originalAmount`, `correctedAmount` | decimal(12,2) | Amount settled before the correction; corrected total |
| | `reversesPayItemId` | uuid, unique | The item a reversal cancels (one reversal per item) |
| `billing.EmployeePayoutBatch` | `paymentReference` | text | Reference typed by the person recording the payment |
| | `settledOn` | date | Date the money left the account |
| | `settlementEvidence` | text | Where the evidence is held |
| | `settlementSource` | text, nullable | How the system knows the batch was paid: `MANUAL_ENTRY` (a person typed the reference). `BANK_CONFIRMED` is reserved for a later bank or provider connection; nothing writes it today |
| `payroll.UkPayrollInputLine` | `claimKey` | text, unique, nullable | One UK payroll run per collected source. Null for provisional visit inputs (those are claimed on the visit when the run closes) and for lines of a cancelled run |
| | `releasedAt` | timestamp, nullable | When a cancelled run gave the source back. The line itself stays as the snapshot of that run |

**Claim key formats**

| Where | Source | Key |
|---|---|---|
| Visit pay run line | Visit earning | `VISIT:<reconciliation id>:<line type>` (e.g. `VISIT_PAY`, `TRAVEL_TIME`, `MILEAGE`) |
| | Pay item (bonus, correction, reversal, holiday…) | `PAY_ITEM:<pay item id>` |
| | Training / on-call activity | `NON_CORE_ACTIVITY:<activity id>` |
| | NMW top-up, overtime premium, rolled-up holiday | none (derived from the claimed lines of their own run) |
| UK payroll input line | Locked visit pay run line | `LINE:<pay run line id>` |
| | Salary from a pay agreement | `SALARY:<employee id>:<pay period id>` |
| | Salary deduction | `DEDUCTION:<deduction id>:<pay period id>` |
| | Provisional visit (no visit pay run) | none; `VisitReconciliation.paidByUkPayrollRunId` at close |

A double-up visit has one reconciliation per carer, so each carer has an own key.

---

## 3. Constraints and triggers

| Object | Rule |
|---|---|
| `PayrollRunLine_claimKey_key` (unique index) | A second original line for the same source is refused, whichever run writes it |
| `UkPayrollInputLine_claimKey_key` (unique index) | A locked pay line, a salary for a period or a deduction for a period is held by one live UK run. Cancelling the run clears the key, so a replacement run can take the source |
| `EmployeePayItem_reversesPayItemId_key` (unique index) | An item is reversed once |
| `billing.protect_locked_payroll_run` | A LOCKED / EXPORTED run cannot be deleted, moved to another status, or have its period or totals changed. LOCKED → EXPORTED is allowed |
| `billing.protect_locked_payroll_run_line` | No insert, update or delete of a line whose run is LOCKED / EXPORTED |
| `billing.protect_paid_visit_reconciliation` | A visit with `includedInPayrollRunId` or `paidByUkPayrollRunId` cannot be deleted, and these columns cannot change: `includedInPayrollRunId`, `paidByUkPayrollRunId`, `employeeId`, `payableAmount`, `payableMinutes`, `approvedPayStart`, `approvedPayEnd`, `payCardId`, `payCardVersion`, `travelMiles`, `travelMinutes`, `unpaidTravelMinutes`, `passengerMiles`. Charge-side columns stay editable |

Trigger errors use SQLSTATE `CF001` and start with `LOCKED_PAYROLL_HISTORY:`. The services refuse the same changes first with a readable message; the triggers are the backstop.

**Two deliberate ways through the triggers**

| Setting (transaction-local) | Set by | Allows |
|---|---|---|
| `careflow.allow_financial_reset = 'on'` | Test-reset code, only after the environment check (not production, `ALLOW_FINANCIAL_TEST_RESET=true`) | Everything, for that transaction |
| `careflow.reopening_uk_run = '<run id>'` | Reopening a closed UK run | Clearing `paidByUkPayrollRunId` of visits claimed by that run only |

No constraint was disabled, loosened or removed to make a test pass.

---

## 4. Backfills

| Migration | Backfill |
|---|---|
| 1 | `PayrollRunLine.claimKey` is set on existing lines. Where one source already sits in several runs, the line in a locked / exported run (oldest first) keeps the claim; the others stay NULL |
| 3 | `paidByUkPayrollRunId` is set from provisional visit inputs of UK runs that are already CLOSED, where the visit is not also in a locked visit pay run |
| 6 | `UkPayrollInputLine.claimKey` is set for lines of runs that are not cancelled. Where two live runs hold the same salary or deduction for one period, the CLOSED run (oldest first) keeps the claim; the other stays NULL. Lines of cancelled runs get `releasedAt` and no claim |
| 7 | `settlementSource = 'MANUAL_ENTRY'` for every batch already PAID (each was marked by a person). Other batches stay NULL |

No backfill deletes, merges or re-prices anything. Money already paid twice stays visible as two lines; the migrations only decide which line carries the claim.

On the local development database the backfills touched no rows: at the time it held 9 visit pay runs with no lines, 2 UK payroll runs with no input lines, and no payout batches (counted read-only on 2026-10-12).

---

## 5. Rehearsal on a synthetic historical database

```bash
npm run payroll-migration-rehearsal
```

`scripts/payroll-migration-rehearsal.mjs` creates a scratch database on the local PostgreSQL server (it refuses any other host), builds it from the schema of commit `e163815` (the last commit before the remediation), inserts synthetic history, applies migrations 1–7 in order, checks the result and drops the database.

Seeded history: three visit pay runs (two locked, one draft); seven visits; **one visit paid by both locked runs**; a visit in a locked and a draft run; a top-up line and a pay item line; a closed, a cancelled and an open UK payroll run in one pay period; a provisional visit in the closed run and one in the cancelled run; **a salary taken by two UK runs for the same period**; a pay line held only by the cancelled run; a PAID and a DRAFT payout batch.

Result of the run on 2026-10-12: **28 of 28 checks passed.**

| Mandatory check | Evidence in the rehearsal |
|---|---|
| 1. Migration ordering | All seven apply in folder order on the old schema, each on the state the previous one left |
| 2. Schema compatibility | `prisma migrate diff` between the migrated database and `prisma/schema.prisma` is empty |
| 3. Existing data backfills | 14 checks: claims on locked, draft, duplicated, top-up and pay item lines; provisional visits of closed and cancelled runs; UK line, salary and released claims; settlement source |
| 4. Historical duplicate claims | The visit paid twice: the older locked line keeps the claim, the other has none; both lines still exist; the report lists the visit with both runs and £28.00 paid |
| 5. Locked payroll records | Changing or deleting a locked line, reopening a locked run and changing the pay of a locked visit are refused by the triggers |
| 6. Cancelled payroll records | The cancelled run's lines are kept, carry `releasedAt` and no claim; the pay line it held can be collected by a replacement run (it could not before the migration) |
| 7. Claims involving previously closed UK runs | The closed run keeps `LINE:` and `SALARY:` claims; its provisional visit is marked paid by it and its pay can no longer be changed |
| 8. Constraints remain enforced | A second original pay line for a claimed visit and a second UK claim on a collected pay line are refused (unique violation) |
| 9. Safe upgrade on a representative synthetic database | Row counts of the eight pay tables are identical before and after |
| 10. Recovery procedure | Section 8 |

Limits of the rehearsal: the history is synthetic and small; it proves the migrations cope with these shapes of data, not with every shape a real database may hold, and says nothing about run time on large tables. Step 2 of section 7 (the read-only queries on a copy of the real data) is still required.

---

## 6. Duplicate reconciliation report

**Historical duplicates are not deleted or corrected automatically.** They are reported for authorised finance review. All four queries only read. Run them on a copy of the real database before migrating, and again after.

A. Sources already present in more than one visit pay run:

```sql
SELECT k AS source, COUNT(*) AS lines, COUNT(DISTINCT "payrollRunId") AS runs
FROM (
  SELECT l."payrollRunId",
    CASE
      WHEN l."employeePayItemId" IS NOT NULL THEN 'PAY_ITEM:' || l."employeePayItemId"::text
      WHEN l."sourceType" = 'NON_CORE_ACTIVITY' AND l."sourceRef" IS NOT NULL THEN 'NON_CORE_ACTIVITY:' || l."sourceRef"
      WHEN l."visitReconciliationId" IS NOT NULL AND l."lineType"::text <> 'NMW_TOP_UP'
        THEN 'VISIT:' || l."visitReconciliationId"::text || ':' || l."lineType"::text
    END AS k
  FROM "billing"."PayrollRunLine" l
) x
WHERE k IS NOT NULL
GROUP BY k
HAVING COUNT(DISTINCT "payrollRunId") > 1;
```

B. Visits with more than one locked visit pay line (money paid twice), with the runs and the total:

```sql
SELECT l."visitReconciliationId", v."visitRef", COUNT(*) AS "lockedLines", SUM(l."amount") AS "totalPaid",
       STRING_AGG(r."periodLabel", ' + ' ORDER BY r."periodStart") AS "runs"
FROM "billing"."PayrollRunLine" l
JOIN "billing"."PayrollRun" r ON r."id" = l."payrollRunId"
JOIN "billing"."VisitReconciliation" v ON v."id" = l."visitReconciliationId"
WHERE l."lineType"::text = 'VISIT_PAY' AND r."status"::text IN ('LOCKED','EXPORTED')
GROUP BY l."visitReconciliationId", v."visitRef"
HAVING COUNT(*) > 1;
```

C. Visits paid provisionally by a closed UK run and also locked into a visit pay run:

```sql
SELECT v."id", v."visitRef", v."includedInPayrollRunId", l."runId" AS "ukPayrollRunId", l."amount"
FROM "payroll"."UkPayrollInputLine" l
JOIN "payroll"."UkPayrollRun" r ON r."id" = l."runId" AND r."status"::text = 'CLOSED'
JOIN "billing"."VisitReconciliation" v ON v."id" = l."sourceVisitReconciliationId"
WHERE l."isProvisional" = true AND v."includedInPayrollRunId" IS NOT NULL;
```

D. (after migration 6) Live UK payroll inputs without a claim, because another run took the same source first:

```sql
SELECT l."id", l."sourceType", l."amount", r."label" AS run, r."status"
FROM "payroll"."UkPayrollInputLine" l
JOIN "payroll"."UkPayrollRun" r ON r."id" = l."runId"
WHERE l."claimKey" IS NULL AND l."releasedAt" IS NULL AND l."isProvisional" = false
  AND r."status"::text <> 'CANCELLED';
```

Every row returned is a question for finance: was the carer paid twice, and is the excess to be recovered (a negative pay correction), written off, or already dealt with outside the system? The answer is recorded against the row; the system does not decide.

On the rehearsal database, B returned the seeded double payment (`VIS-REHEARSAL-3`, two locked lines, £28.00, "Rehearsal wk 1 + Rehearsal wk 2") and D returned the seeded second salary (£2,000.00 in "Rehearsal June run 3"). On the local development database all four return nothing.

---

## 7. Deployment prerequisites

1. Back up the database and confirm the backup restores.
2. Run queries A–C of section 6 on a copy of the data; give the output to finance; agree what happens to each row.
3. Stop pay processing (no calculate / lock / close / cancel in flight).
4. Apply migrations 1–7 with `prisma migrate deploy`.
5. Run query D and review it with the earlier output.
6. Run `node scripts/payroll-approval-permissions.mjs` (permission rows and the unassigned Payroll Approver role).
7. Decide who approves pay and assign the role (decision D-01). Settings → Roles & permissions → Responsibilities shows who holds each power and warns while nobody does.
8. Confirm `NODE_ENV=production` and that `ALLOW_FINANCIAL_TEST_RESET` is unset.
9. Recalculate any visit pay run that was open during the upgrade (its lines need claims before it can lock), and recalculate gross on any open UK payroll run.

---

## 8. Recovery

**Removing the financial-protection triggers or the unique claim indexes is not a rollback procedure.** They are the reason one earning cannot be paid twice and paid history cannot be rewritten; a database running without them is in the unsafe state the remediation closed.

| Situation | Procedure |
|---|---|
| A migration fails part-way | Stop. Restore the backup taken in step 1. Nothing has been processed on the new schema, so no financial record is lost. Diagnose on a copy before trying again |
| The new application version misbehaves after a successful migration | Fix forward, or redeploy the previous application version. The schema changes are additive, so the previous version runs against the migrated database. Its unsafe writes (overwriting a locked visit, deleting a locked run, collecting a line a cancelled run still held) are refused by the triggers and indexes. That is intended |
| A trigger or index refuses an operation the business needs | Treat it as a defect or as a case for the designed routes: a pay correction for a settled visit; reopening a closed UK run with the reopen power; cancelling a UK run to release its earnings. Do not work around it in the database |
| A record genuinely has to be changed outside those routes | Emergency change, not routine. It needs written authorisation naming the record, the reason and the approver from finance and from engineering; a backup immediately before; the change made in one transaction by a database administrator; before and after values exported and filed with the authorisation; and a review afterwards of why the designed routes did not cover the case. The protections stay installed for every other record |
| Restoring a backup after pay has been processed on the new version | Only with finance sign-off, because every pay decision made since the backup is lost and must be re-entered. Export the pay runs, corrections, payout batches and audit entries made since the backup first |

The new columns can stay in place unused. Dropping `claimKey` (either table) or `paidByUkPayrollRunId` after runs have been processed under the new code would remove the duplicate-payment protection. The enum value `UNVERIFIED_TIMES` cannot be removed while any row uses it.

## Sprint B4A — `20261020100000_wage_recovery_review_fields` (additive)

| Change | Why |
|---|---|
| `billing.WageRecovery.paidAmount`, `dueAmount` (nullable decimals) | The screen shows the original payment and what is now due, not only the difference. Empty on recoveries proposed before this migration |
| `billing.WageRecoveryPolicy` (new table: reference, recorded by/at, withdrawn by/at/note) | Whether the employer has an approved recovery policy on record. Append-only: a newer record or a withdrawal closes the earlier row. No row is created by the migration, so nothing is deducted until a person records one |
| `billing.NmwPeriodAssessment.reviewOutcome` (nullable text) | What a review found: `EVIDENCE_SUPPORTS_COMPLIANCE` or `SHORTFALL_CONFIRMED`. Empty on assessments reviewed before this migration, which therefore block closing again until reviewed with an outcome (only open runs are affected; closed runs are not re-checked) |

No column is dropped or rewritten and no existing row is changed. Rehearsed with `npm run payroll-migration-rehearsal` (see `14-sprint-b4a-summary.md`).
