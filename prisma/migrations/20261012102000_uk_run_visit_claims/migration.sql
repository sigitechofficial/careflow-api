-- Payroll remediation, Phase 0 (PR-05).
-- A UK payroll run that closes with a visit as a provisional input (approved, never put through a
-- visit pay run) now claims that visit, so no later UK run or visit pay run can pay it again.

ALTER TABLE "billing"."VisitReconciliation" ADD COLUMN "paidByUkPayrollRunId" UUID;

CREATE INDEX "VisitReconciliation_paidByUkPayrollRunId_idx" ON "billing"."VisitReconciliation"("paidByUkPayrollRunId");

-- Backfill from UK runs that are already closed. Visits that a visit pay run has also locked are
-- left alone here; they are listed by the duplicate report query in
-- docs/careflow-payroll-remediation/04-database-changes.md for manual review.
UPDATE "billing"."VisitReconciliation" v
SET "paidByUkPayrollRunId" = src."runId"
FROM (
  SELECT DISTINCT ON (l."sourceVisitReconciliationId")
    l."sourceVisitReconciliationId" AS "reconciliationId",
    l."runId"
  FROM "payroll"."UkPayrollInputLine" l
  JOIN "payroll"."UkPayrollRun" r ON r."id" = l."runId"
  WHERE l."isProvisional" = true
    AND l."sourceVisitReconciliationId" IS NOT NULL
    AND r."status"::text = 'CLOSED'
    AND r."deletedAt" IS NULL
  ORDER BY l."sourceVisitReconciliationId", r."closedAt" ASC NULLS LAST
) src
WHERE v."id" = src."reconciliationId"
  AND v."includedInPayrollRunId" IS NULL
  AND v."paidByUkPayrollRunId" IS NULL;
