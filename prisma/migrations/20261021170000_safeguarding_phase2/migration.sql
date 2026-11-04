-- AlterTable
ALTER TABLE "incidents"."SafeguardingCase" ADD COLUMN     "agencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "agenciesOther" TEXT,
ADD COLUMN     "capacity" TEXT,
ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "leadUserId" UUID,
ADD COLUMN     "meetingDate" TIMESTAMP(3),
ADD COLUMN     "meetingHeld" TEXT,
ADD COLUMN     "personSafe" TEXT,
ADD COLUMN     "personWants" TEXT,
ADD COLUMN     "personWords" TEXT,
ADD COLUMN     "protectionPlan" TEXT,
ADD COLUMN     "reportedToManagerAt" TIMESTAMP(3),
ADD COLUMN     "reviewDate" TIMESTAMP(3),
ADD COLUMN     "safetyMeasures" TEXT;

-- CreateIndex
CREATE INDEX "SafeguardingCase_locationId_idx" ON "incidents"."SafeguardingCase"("locationId");


-- Backfill: a case about a service user takes that person's branch when none was recorded.
UPDATE "incidents"."SafeguardingCase" c
SET "locationId" = su."locationId"
FROM "service_users"."ServiceUser" su
WHERE c."locationId" IS NULL AND c."aboutServiceUserId" = su."id" AND su."locationId" IS NOT NULL;
