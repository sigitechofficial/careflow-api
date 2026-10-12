-- Payroll remediation, Phase 0 (SI-01, SI-02, VW-22, SI-09).
-- Additive only: no existing column or row is removed.

-- 1) Original-earning claim on pay lines: one payable source can be an original earning in one run only.
ALTER TABLE "billing"."PayrollRunLine" ADD COLUMN "claimKey" TEXT;

-- Backfill. Where the same source already sits in more than one run, the line in a locked / exported
-- run keeps the claim (oldest first); the other lines keep a NULL claim and are listed by the
-- duplicate report query in docs/careflow-payroll-remediation/04-database-changes.md.
WITH keyed AS (
  SELECT
    l."id",
    CASE
      WHEN l."employeePayItemId" IS NOT NULL THEN 'PAY_ITEM:' || l."employeePayItemId"::text
      WHEN l."sourceType" = 'NON_CORE_ACTIVITY' AND l."sourceRef" IS NOT NULL THEN 'NON_CORE_ACTIVITY:' || l."sourceRef"
      WHEN l."visitReconciliationId" IS NOT NULL
        AND l."lineType"::text <> 'NMW_TOP_UP'
        AND COALESCE(l."sourceType", 'VISIT') = 'VISIT'
        THEN 'VISIT:' || l."visitReconciliationId"::text || ':' || l."lineType"::text
    END AS k,
    r."status"::text AS run_status,
    l."createdAt"
  FROM "billing"."PayrollRunLine" l
  JOIN "billing"."PayrollRun" r ON r."id" = l."payrollRunId"
),
ranked AS (
  SELECT
    "id",
    k,
    ROW_NUMBER() OVER (
      PARTITION BY k
      ORDER BY (run_status IN ('LOCKED', 'EXPORTED')) DESC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM keyed
  WHERE k IS NOT NULL
)
UPDATE "billing"."PayrollRunLine" l
SET "claimKey" = ranked.k
FROM ranked
WHERE ranked."id" = l."id" AND ranked.rn = 1;

CREATE UNIQUE INDEX "PayrollRunLine_claimKey_key" ON "billing"."PayrollRunLine"("claimKey");

-- 2) Correction ledger on pay items (corrections to locked earnings, and reversals).
ALTER TABLE "billing"."EmployeePayItem"
  ADD COLUMN "originalPayrollRunLineId" UUID,
  ADD COLUMN "originalAmount" DECIMAL(12,2),
  ADD COLUMN "correctedAmount" DECIMAL(12,2),
  ADD COLUMN "reversesPayItemId" UUID;

CREATE UNIQUE INDEX "EmployeePayItem_reversesPayItemId_key" ON "billing"."EmployeePayItem"("reversesPayItemId");

-- 3) Settlement evidence on payout batches.
ALTER TABLE "billing"."EmployeePayoutBatch"
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "settledOn" DATE,
  ADD COLUMN "settlementEvidence" TEXT;
