-- Payroll remediation, Gate A sprint (R-08 / PR-05).
-- A cancelled UK payroll run used to keep hold of the visit pay lines it had collected: the unique
-- index on sourcePayrollRunLineId stopped a replacement run from collecting them, so the earning
-- could be stranded. The claim now lives in its own column, which cancelling a run clears while
-- the input line itself stays as the snapshot of the cancelled run.
--
-- Additive, except that the unique index on sourcePayrollRunLineId is replaced by the unique index
-- on claimKey. The new index is created before the old one is dropped.

ALTER TABLE "payroll"."UkPayrollInputLine"
  ADD COLUMN "claimKey" TEXT,
  ADD COLUMN "releasedAt" TIMESTAMP(3);

-- Backfill. Lines of cancelled runs hold no claim (their earnings become collectable again).
-- Where two live runs already hold the same salary or deduction for one period, the closed run
-- (oldest first) keeps the claim; the others stay NULL and are listed by the report query in
-- docs/careflow-payroll-remediation/04-database-changes.md.
WITH keyed AS (
  SELECT
    l."id",
    CASE
      WHEN l."sourcePayrollRunLineId" IS NOT NULL THEN 'LINE:' || l."sourcePayrollRunLineId"::text
      WHEN l."sourceType"::text = 'PAY_AGREEMENT_SALARY' THEN 'SALARY:' || l."employeeId"::text || ':' || r."periodId"::text
      WHEN l."sourceType"::text = 'SALARY_DEDUCTION' AND l."sourceSalaryDeductionId" IS NOT NULL
        THEN 'DEDUCTION:' || l."sourceSalaryDeductionId"::text || ':' || r."periodId"::text
    END AS k,
    r."status"::text AS run_status,
    l."createdAt"
  FROM "payroll"."UkPayrollInputLine" l
  JOIN "payroll"."UkPayrollRun" r ON r."id" = l."runId"
  WHERE r."status"::text <> 'CANCELLED' AND r."deletedAt" IS NULL
),
ranked AS (
  SELECT
    "id",
    k,
    ROW_NUMBER() OVER (
      PARTITION BY k
      ORDER BY (run_status = 'CLOSED') DESC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM keyed
  WHERE k IS NOT NULL
)
UPDATE "payroll"."UkPayrollInputLine" l
SET "claimKey" = ranked.k
FROM ranked
WHERE ranked."id" = l."id" AND ranked.rn = 1;

UPDATE "payroll"."UkPayrollInputLine" l
SET "releasedAt" = COALESCE(r."cancelledAt", r."updatedAt")
FROM "payroll"."UkPayrollRun" r
WHERE r."id" = l."runId" AND r."status"::text = 'CANCELLED';

CREATE UNIQUE INDEX "UkPayrollInputLine_claimKey_key" ON "payroll"."UkPayrollInputLine"("claimKey");

CREATE INDEX "UkPayrollInputLine_sourcePayrollRunLineId_idx" ON "payroll"."UkPayrollInputLine"("sourcePayrollRunLineId");

DROP INDEX "payroll"."UkPayrollInputLine_sourcePayrollRunLineId_key";
