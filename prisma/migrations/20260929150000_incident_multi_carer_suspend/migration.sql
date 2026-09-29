-- CreateTable: multiple carer suspensions per incident
CREATE TABLE "incidents"."IncidentCarerSuspension" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "suspendFrom" DATE NOT NULL,
    "suspendTo" DATE NOT NULL,
    "suspendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentCarerSuspension_pkey" PRIMARY KEY ("id")
);

-- Migrate any existing single-suspension rows from investigation
INSERT INTO "incidents"."IncidentCarerSuspension" (
  "id",
  "incidentId",
  "employeeId",
  "reason",
  "suspendFrom",
  "suspendTo",
  "suspendedAt",
  "createdAt",
  "updatedAt",
  "createdById",
  "updatedById"
)
SELECT
  gen_random_uuid(),
  i."incidentId",
  i."suspendedEmployeeId",
  COALESCE(NULLIF(TRIM(i."suspendReason"), ''), 'Suspended after investigation'),
  COALESCE(i."suspendFrom", DATE(COALESCE(i."suspendedAt", NOW()))),
  COALESCE(i."suspendTo", DATE(COALESCE(i."suspendedAt", NOW()))),
  COALESCE(i."suspendedAt", NOW()),
  NOW(),
  NOW(),
  i."createdById",
  i."updatedById"
FROM "incidents"."IncidentInvestigation" i
WHERE i."carerSuspended" = true
  AND i."suspendedEmployeeId" IS NOT NULL;

CREATE UNIQUE INDEX "IncidentCarerSuspension_incidentId_employeeId_key"
  ON "incidents"."IncidentCarerSuspension"("incidentId", "employeeId");

CREATE INDEX "IncidentCarerSuspension_incidentId_idx"
  ON "incidents"."IncidentCarerSuspension"("incidentId");

CREATE INDEX "IncidentCarerSuspension_employeeId_idx"
  ON "incidents"."IncidentCarerSuspension"("employeeId");

CREATE INDEX "IncidentCarerSuspension_deletedAt_idx"
  ON "incidents"."IncidentCarerSuspension"("deletedAt");

ALTER TABLE "incidents"."IncidentCarerSuspension"
  ADD CONSTRAINT "IncidentCarerSuspension_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop legacy single-suspension columns from investigation
ALTER TABLE "incidents"."IncidentInvestigation"
  DROP COLUMN IF EXISTS "carerSuspended",
  DROP COLUMN IF EXISTS "suspendedEmployeeId",
  DROP COLUMN IF EXISTS "suspendReason",
  DROP COLUMN IF EXISTS "suspendFrom",
  DROP COLUMN IF EXISTS "suspendTo",
  DROP COLUMN IF EXISTS "suspendedAt";
