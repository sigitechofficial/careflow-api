-- Many-to-many: employee employment ↔ service user monitoring areas.

CREATE TABLE "employees"."EmployeeEmploymentServiceUserArea" (
    "employmentId" UUID NOT NULL,
    "serviceUserAreaId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeEmploymentServiceUserArea_pkey" PRIMARY KEY ("employmentId", "serviceUserAreaId")
);

CREATE INDEX "EmployeeEmploymentServiceUserArea_serviceUserAreaId_idx"
ON "employees"."EmployeeEmploymentServiceUserArea"("serviceUserAreaId");

ALTER TABLE "employees"."EmployeeEmploymentServiceUserArea"
ADD CONSTRAINT "EmployeeEmploymentServiceUserArea_employmentId_fkey"
FOREIGN KEY ("employmentId") REFERENCES "employees"."EmployeeEmployment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees"."EmployeeEmploymentServiceUserArea"
ADD CONSTRAINT "EmployeeEmploymentServiceUserArea_serviceUserAreaId_fkey"
FOREIGN KEY ("serviceUserAreaId") REFERENCES "scheduling"."ServiceUserArea"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
