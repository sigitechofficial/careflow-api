-- Drop employee ↔ ServiceUserArea wiring (keep ServiceUserArea for service users).

ALTER TABLE "employees"."EmployeeEmployment"
DROP CONSTRAINT IF EXISTS "EmployeeEmployment_serviceUserAreaId_fkey";

DROP INDEX IF EXISTS "employees"."EmployeeEmployment_serviceUserAreaId_idx";

ALTER TABLE "employees"."EmployeeEmployment"
DROP COLUMN IF EXISTS "serviceUserAreaId";
