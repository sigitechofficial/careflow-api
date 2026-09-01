-- Employee primary monitoring area (under branch ServiceUserArea).

ALTER TABLE "employees"."EmployeeEmployment"
ADD COLUMN "serviceUserAreaId" UUID;

CREATE INDEX "EmployeeEmployment_serviceUserAreaId_idx"
ON "employees"."EmployeeEmployment"("serviceUserAreaId");

ALTER TABLE "employees"."EmployeeEmployment"
ADD CONSTRAINT "EmployeeEmployment_serviceUserAreaId_fkey"
FOREIGN KEY ("serviceUserAreaId") REFERENCES "scheduling"."ServiceUserArea"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
