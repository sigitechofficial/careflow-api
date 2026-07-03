-- Add optional ethnicity lookup on employee personal details (shared service user ethnicity catalogue).
ALTER TABLE "employees"."EmployeePersonalDetail"
ADD COLUMN "ethnicityId" UUID;

ALTER TABLE "employees"."EmployeePersonalDetail"
ADD CONSTRAINT "EmployeePersonalDetail_ethnicityId_fkey"
FOREIGN KEY ("ethnicityId") REFERENCES "service_users"."ServiceUserEthnicity"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "EmployeePersonalDetail_ethnicityId_idx" ON "employees"."EmployeePersonalDetail"("ethnicityId");
