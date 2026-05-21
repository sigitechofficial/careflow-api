-- Zone grouping for location management tree
ALTER TABLE "scheduling"."ScheduleArea" ADD COLUMN "parentZoneName" TEXT;

-- Employee floor/branch allocations within a parent zone
CREATE TABLE "employees"."EmployeeEmploymentFloorLocation" (
    "employmentId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeEmploymentFloorLocation_pkey" PRIMARY KEY ("employmentId","locationId")
);

CREATE INDEX "EmployeeEmploymentFloorLocation_locationId_idx" ON "employees"."EmployeeEmploymentFloorLocation"("locationId");

ALTER TABLE "employees"."EmployeeEmploymentFloorLocation" ADD CONSTRAINT "EmployeeEmploymentFloorLocation_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "employees"."EmployeeEmployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees"."EmployeeEmploymentFloorLocation" ADD CONSTRAINT "EmployeeEmploymentFloorLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill parent zone names from linked location labels (e.g. "Croydon - Croydon 1" -> "Croydon")
UPDATE "scheduling"."ScheduleArea" sa
SET "parentZoneName" = split_part(l."name", ' - ', 1)
FROM "lookups"."Location" l
WHERE sa."locationId" = l.id
  AND l."name" LIKE '% - %'
  AND sa."parentZoneName" IS NULL;
