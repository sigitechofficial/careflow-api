# 04 — Database Changes

All Phase 0 changes are additive. No column, table or row is dropped. They have been applied to the local development database and the local payroll test database only.

---

## 1. Migrations (apply in this order)

| # | Migration | Type | What it does |
|---|---|---|---|
| 1 | `20261012100000_payroll_source_claims_and_corrections` | schema + backfill | `PayrollRunLine.claimKey` (unique); correction columns on `EmployeePayItem`; settlement columns on `EmployeePayoutBatch` |
| 2 | `20261012101000_locked_payroll_history_triggers` | SQL only | Trigger functions and triggers protecting locked runs, their lines and paid visits |
| 3 | `20261012102000_uk_run_visit_claims` | schema + backfill | `VisitReconciliation.paidByUkPayrollRunId` (+index) |
| 4 | `20261012103000_paid_visit_trigger_uk_runs` | SQL only | Extends the paid-visit trigger to UK-run settlement and the reopen path |
| 5 | `20261012110000_finance_exception_unverified_times` | enum | `FinanceExceptionCode` gains `UNVERIFIED_TIMES` |

Migrations 2 and 4 are idempotent (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`). Prisma does not model triggers, so they do not appear in `schema.prisma`; `scripts/payroll-test-db.mjs` applies them to the test database.

---

## 2. New columns

| Table | Column | Type | Purpose |
|---|---|---|---|
| `billing.PayrollRunLine` | `claimKey` | text, unique, nullable | One original earning per source across all runs. Null for derived lines |
| `billing.VisitReconciliation` | `paidByUkPayrollRunId` | uuid, nullable, indexed | Visit settled as a provisional input of a closed UK run |
| `billing.EmployeePayItem` | `originalPayrollRunLineId` | uuid | Locked line a correction refers to |
| | `originalAmount`, `correctedAmount` | decimal(12,2) | Amount of the original line; corrected total |
| | `reversesPayItemId` | uuid, unique | The item a reversal cancels (one reversal per item) |
| `billing.EmployeePayoutBatch` | `paymentReference` | text | Bank / provider reference |
| | `settledOn` | date | Date the money left the account |
| | `settlementEvidence` | text | Where the evidence is held |

**Claim key format**

| Source | Key |
|---|---|
| Visit earning | `VISIT:<reconciliation id>:<line type>` (e.g. `VISIT_PAY`, `TRAVEL_TIME`, `MILEAGE`) |
| Pay item | `PAY_ITEM:<pay item id>` |
| Training / on-call activity | `NON_CORE_ACTIVITY:<activity id>` |
| NMW top-up, overtime premium, rolled-up holiday | none (derived from the claimed lines of their own run) |

A double-up visit has one reconciliation per carer, so each carer has an own key.

---

## 3. Constraints and triggers

| Object | Rule |
|---|---|
| `PayrollRunLine_claimKey_key` (unique index) | A second original line for the same source is refused, whichever run writes it |
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

---

## 4. Backfills

| Migration | Backfill |
|---|---|
| 1 | `claimKey` is set on existing lines. Where one source already sits in several runs, the line in a locked / exported run (oldest first) keeps the claim; the others stay NULL |
| 3 | `paidByUkPayrollRunId` is set from provisional visit inputs of UK runs that are already CLOSED, where the visit is not also in a locked visit pay run |

On the local development database both backfills touched no rows (there were no pay lines and no closed UK runs).

**Run these before and after migrating a database that holds real pay data.** They only read.

Sources already present in more than one run:

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

Visits paid provisionally by a closed UK run and also locked into a visit pay run (possible historical double payment):

```sql
SELECT v."id", v."visitRef", v."includedInPayrollRunId", l."runId" AS "ukPayrollRunId", l."amount"
FROM "payroll"."UkPayrollInputLine" l
JOIN "payroll"."UkPayrollRun" r ON r."id" = l."runId" AND r."status"::text = 'CLOSED'
JOIN "billing"."VisitReconciliation" v ON v."id" = l."sourceVisitReconciliationId"
WHERE l."isProvisional" = true AND v."includedInPayrollRunId" IS NOT NULL;
```

Any row returned by either query needs a finance decision; the migrations do not correct money already paid.

---

## 5. Deployment prerequisites

1. Back up the database.
2. Run the two read-only queries above and keep the output.
3. Stop pay processing (no calculate / lock / close in flight).
4. Apply migrations 1–5 with `prisma migrate deploy`.
5. Run `node scripts/payroll-approval-permissions.mjs`.
6. Assign the Payroll Approver role.
7. Confirm `ALLOW_FINANCIAL_TEST_RESET` is unset.
8. Recalculate any visit pay run that was open during the upgrade (its lines need claims before it can lock).

---

## 6. Recovery

The schema changes are additive, so the previous application version keeps working against the migrated database, with one exception: the triggers will refuse the old code's unsafe writes (overwriting a locked visit, deleting locked runs). That is the intended effect.

To remove the triggers in an emergency:

```sql
DROP TRIGGER IF EXISTS "protect_locked_payroll_run" ON "billing"."PayrollRun";
DROP TRIGGER IF EXISTS "protect_locked_payroll_run_line" ON "billing"."PayrollRunLine";
DROP TRIGGER IF EXISTS "protect_paid_visit_reconciliation" ON "billing"."VisitReconciliation";
```

The new columns can stay in place unused. Dropping `claimKey` or `paidByUkPayrollRunId` after runs have been locked under the new code would remove the duplicate-payment protection and is not recommended. The enum value `UNVERIFIED_TIMES` cannot be removed while any row uses it.
