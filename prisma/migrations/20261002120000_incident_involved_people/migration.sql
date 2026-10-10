-- AlterTable
ALTER TABLE "incidents"."Incident" ADD COLUMN     "involvedEmployeeIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "involvedServiceUserIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- Backfill: existing incidents involve their primary service user / employee.
UPDATE "incidents"."Incident"
SET "involvedServiceUserIds" = ARRAY["primaryServiceUserId"]
WHERE "primaryServiceUserId" IS NOT NULL;

UPDATE "incidents"."Incident"
SET "involvedEmployeeIds" = ARRAY["primaryEmployeeId"]
WHERE "primaryEmployeeId" IS NOT NULL;
