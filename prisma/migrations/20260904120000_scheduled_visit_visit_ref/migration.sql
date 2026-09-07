-- EMONITORED visit reference on the scheduled visit (available before reconciliation).
ALTER TABLE "scheduling"."ScheduledVisit"
ADD COLUMN IF NOT EXISTS "visitRef" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledVisit_visitRef_key"
ON "scheduling"."ScheduledVisit"("visitRef");

-- Backfill from earliest VisitReconciliation row per scheduled visit.
UPDATE "scheduling"."ScheduledVisit" sv
SET "visitRef" = src."visitRef"
FROM (
  SELECT DISTINCT ON ("scheduledVisitId")
    "scheduledVisitId",
    "visitRef"
  FROM "billing"."VisitReconciliation"
  WHERE NULLIF(BTRIM("visitRef"), '') IS NOT NULL
  ORDER BY "scheduledVisitId", "createdAt" ASC
) src
WHERE sv.id = src."scheduledVisitId"
  AND sv."visitRef" IS NULL;