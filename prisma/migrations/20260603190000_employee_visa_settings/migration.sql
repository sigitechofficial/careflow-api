ALTER TABLE "identity"."OrganisationGeneralSettings"
    ADD COLUMN "employeeVisaTypes" JSONB NOT NULL DEFAULT '[{"id":"full_time","label":"Full time visa","weeklyHours":40},{"id":"student","label":"Student visa","weeklyHours":20}]';

ALTER TABLE "employees"."EmployeeEmployment"
    ADD COLUMN "visaTypeId" TEXT,
    ADD COLUMN "isInCountry" BOOLEAN NOT NULL DEFAULT true;
