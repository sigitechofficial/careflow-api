-- Employee home address coordinates + multiple base locations
ALTER TABLE "employees"."EmployeePersonalDetail"
  ADD COLUMN IF NOT EXISTS "county" TEXT,
  ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10,7);

CREATE TABLE IF NOT EXISTS "employees"."EmployeeEmploymentBaseLocation" (
  "employmentId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeEmploymentBaseLocation_pkey" PRIMARY KEY ("employmentId","locationId")
);

CREATE INDEX IF NOT EXISTS "EmployeeEmploymentBaseLocation_locationId_idx"
  ON "employees"."EmployeeEmploymentBaseLocation"("locationId");

ALTER TABLE "employees"."EmployeeEmploymentBaseLocation"
  ADD CONSTRAINT "EmployeeEmploymentBaseLocation_employmentId_fkey"
  FOREIGN KEY ("employmentId") REFERENCES "employees"."EmployeeEmployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees"."EmployeeEmploymentBaseLocation"
  ADD CONSTRAINT "EmployeeEmploymentBaseLocation_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
