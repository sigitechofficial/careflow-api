-- CreateEnum
CREATE TYPE "audit"."AuditEventType" AS ENUM ('VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'SECURITY', 'SYSTEM');

-- AlterTable
ALTER TABLE "audit"."AuditLog" ADD COLUMN "eventType" "audit"."AuditEventType";

-- Backfill from action + metadata (matches resolveAuditEventType util)
UPDATE "audit"."AuditLog"
SET "eventType" = CASE
  WHEN metadata->>'autoEndDate' = 'true' THEN 'SYSTEM'::"audit"."AuditEventType"
  WHEN action ILIKE '%export%' OR action ILIKE '%exported%' THEN 'EXPORT'::"audit"."AuditEventType"
  WHEN action ILIKE '%login%'
    OR action ILIKE '%logout%'
    OR action ILIKE '%password%'
    OR action ILIKE '%permission%'
    OR action ILIKE '%account_locked%'
    OR action ILIKE 'role_%' THEN 'SECURITY'::"audit"."AuditEventType"
  WHEN action ILIKE '%viewed%'
    OR action ILIKE '%_view'
    OR action = 'data_viewed'
    OR action ILIKE '%downloaded%' THEN 'VIEW'::"audit"."AuditEventType"
  WHEN action ILIKE '%deleted%'
    OR action ILIKE '%archived%'
    OR action ILIKE '%cleared%'
    OR action ILIKE '%removed%' THEN 'DELETE'::"audit"."AuditEventType"
  WHEN action ILIKE '%created%'
    OR action ILIKE '%added%'
    OR action ILIKE '%registered%' THEN 'CREATE'::"audit"."AuditEventType"
  WHEN action ILIKE '%updated%'
    OR action ILIKE '%changed%'
    OR action ILIKE '%recorded%'
    OR action ILIKE '%corrected%'
    OR action ILIKE '%reviewed%'
    OR action ILIKE '%restored%'
    OR action ILIKE '%ended%'
    OR action ILIKE '%verified%'
    OR action ILIKE '%rejected%'
    OR action ILIKE '%regenerated%'
    OR action ILIKE '%resent%'
    OR action ILIKE '%marked%'
    OR action ILIKE '%generated%' THEN 'UPDATE'::"audit"."AuditEventType"
  ELSE 'UPDATE'::"audit"."AuditEventType"
END
WHERE "eventType" IS NULL;

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "audit"."AuditLog"("eventType");
