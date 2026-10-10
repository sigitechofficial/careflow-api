-- Interim suspension lifecycle: scheduled / active / lifted (with reason), kept after lifting.
ALTER TABLE "incidents"."IncidentCarerSuspension"
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "liftedAt" TIMESTAMP(3),
  ADD COLUMN "liftedById" UUID,
  ADD COLUMN "liftReason" TEXT;

-- Previously "removed" suspensions were soft-deleted: they count as lifted.
UPDATE "incidents"."IncidentCarerSuspension"
SET "status" = 'LIFTED', "liftedAt" = "deletedAt", "liftReason" = 'Removed before suspension history was kept'
WHERE "deletedAt" IS NOT NULL;

-- A carer can be suspended again after a lift, so (incident, employee) is no longer unique.
DROP INDEX IF EXISTS "incidents"."IncidentCarerSuspension_incidentId_employeeId_key";
CREATE INDEX "IncidentCarerSuspension_incidentId_employeeId_idx" ON "incidents"."IncidentCarerSuspension"("incidentId", "employeeId");
