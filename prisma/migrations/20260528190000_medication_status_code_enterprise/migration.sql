-- Enterprise: MAR status code owns coarse administrationStatus; events link via FK.
-- Requires MedicationStatusCode table (20260528185000_medication_status_codes).

UPDATE "service_users"."MedicationStatusCode"
SET "administrationStatus" = CASE "code"
  WHEN 'G' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'F' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'I' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'S' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'T' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'R' THEN 'REFUSED'::"service_users"."MedicationAdministrationStatus"
  WHEN 'N' THEN 'MISSED'::"service_users"."MedicationAdministrationStatus"
  WHEN 'C' THEN 'CANCELLED'::"service_users"."MedicationAdministrationStatus"
  WHEN 'U' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'H' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'A' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'O' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'P' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'PCI' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'Pending' THEN 'PENDING'::"service_users"."MedicationAdministrationStatus"
  ELSE 'PENDING'::"service_users"."MedicationAdministrationStatus"
END
WHERE "administrationStatus" IS DISTINCT FROM CASE "code"
  WHEN 'G' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'F' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'I' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'S' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'T' THEN 'GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'R' THEN 'REFUSED'::"service_users"."MedicationAdministrationStatus"
  WHEN 'N' THEN 'MISSED'::"service_users"."MedicationAdministrationStatus"
  WHEN 'C' THEN 'CANCELLED'::"service_users"."MedicationAdministrationStatus"
  WHEN 'U' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'H' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'A' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'O' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'P' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'PCI' THEN 'NOT_GIVEN'::"service_users"."MedicationAdministrationStatus"
  WHEN 'Pending' THEN 'PENDING'::"service_users"."MedicationAdministrationStatus"
  ELSE 'PENDING'::"service_users"."MedicationAdministrationStatus"
END;

-- Backfill denormalised statusCode from enum where missing
UPDATE "service_users"."MedicationAdministrationEvent"
SET "statusCode" = CASE "status"
  WHEN 'GIVEN' THEN 'G'
  WHEN 'REFUSED' THEN 'R'
  WHEN 'MISSED' THEN 'N'
  WHEN 'NOT_GIVEN' THEN 'N'
  WHEN 'HELD' THEN 'U'
  WHEN 'CANCELLED' THEN 'C'
  WHEN 'PENDING' THEN 'Pending'
  ELSE "status"::text
END
WHERE "statusCode" IS NULL OR TRIM("statusCode") = '';

-- MedicationAdministrationEvent.statusCodeId FK
ALTER TABLE "service_users"."MedicationAdministrationEvent"
ADD COLUMN IF NOT EXISTS "statusCodeId" UUID;

UPDATE "service_users"."MedicationAdministrationEvent" AS e
SET "statusCodeId" = sc."id"
FROM "service_users"."MedicationStatusCode" AS sc
WHERE e."statusCode" = sc."code"
  AND sc."deletedAt" IS NULL
  AND e."statusCodeId" IS NULL;

-- Align coarse status enum from configured code row
UPDATE "service_users"."MedicationAdministrationEvent" AS e
SET "status" = sc."administrationStatus"
FROM "service_users"."MedicationStatusCode" AS sc
WHERE e."statusCodeId" = sc."id";

CREATE INDEX IF NOT EXISTS "MedicationAdministrationEvent_statusCode_idx"
ON "service_users"."MedicationAdministrationEvent"("statusCode");

CREATE INDEX IF NOT EXISTS "MedicationAdministrationEvent_statusCodeId_idx"
ON "service_users"."MedicationAdministrationEvent"("statusCodeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'MedicationAdministrationEvent_statusCodeId_fkey'
  ) THEN
    ALTER TABLE "service_users"."MedicationAdministrationEvent"
    ADD CONSTRAINT "MedicationAdministrationEvent_statusCodeId_fkey"
    FOREIGN KEY ("statusCodeId") REFERENCES "service_users"."MedicationStatusCode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Support profile: one active row per service user (soft-delete safe)
DROP INDEX IF EXISTS "service_users"."MedicationSupportProfile_serviceUserId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "MedicationSupportProfile_serviceUserId_active_key"
ON "service_users"."MedicationSupportProfile"("serviceUserId")
WHERE "deletedAt" IS NULL;
