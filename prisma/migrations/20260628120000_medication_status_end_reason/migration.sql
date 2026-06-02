-- CreateEnum
CREATE TYPE "service_users"."MedicationStatusEndReason" AS ENUM ('MANUAL', 'END_DATE');

-- AlterTable
ALTER TABLE "service_users"."ServiceUserMedication"
ADD COLUMN "statusEndReason" "service_users"."MedicationStatusEndReason",
ADD COLUMN "statusEndedAt" TIMESTAMP(3),
ADD COLUMN "statusEndedById" UUID;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication"
ADD CONSTRAINT "ServiceUserMedication_statusEndedById_fkey"
FOREIGN KEY ("statusEndedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill ended rows (best-effort for existing data)
UPDATE "service_users"."ServiceUserMedication"
SET
  "statusEndReason" = 'END_DATE',
  "statusEndedAt" = COALESCE("endDate", "updatedAt")
WHERE
  "deletedAt" IS NULL
  AND "status" = 'ENDED'
  AND "statusEndReason" IS NULL
  AND "endDate" IS NOT NULL
  AND "endDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;

UPDATE "service_users"."ServiceUserMedication"
SET
  "statusEndReason" = 'MANUAL',
  "statusEndedAt" = COALESCE("updatedAt", "endDate", NOW())
WHERE
  "deletedAt" IS NULL
  AND "status" IN ('ENDED', 'CANCELLED')
  AND "statusEndReason" IS NULL;
