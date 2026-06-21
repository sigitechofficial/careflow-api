-- Remove legacy immigration catalog (full_time / student) and standardise on enterprise statuses.

UPDATE "employees"."EmployeeEmployment"
SET "visaTypeId" = 'skilled_worker'
WHERE "visaTypeId" = 'full_time' AND "deletedAt" IS NULL;

UPDATE "employees"."EmployeeEmployment"
SET "visaTypeId" = 'student_visa'
WHERE "visaTypeId" = 'student' AND "deletedAt" IS NULL;

UPDATE "identity"."OrganisationGeneralSettings"
SET "employeeVisaTypes" = '[{"id":"british_citizen","label":"British citizen","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":0},{"id":"irish_citizen","label":"Irish citizen","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":1},{"id":"settled_status","label":"Settled status / ILR","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":2},{"id":"pre_settled_euss","label":"Pre-settled status (EUSS)","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":3},{"id":"skilled_worker","label":"Skilled Worker","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":4},{"id":"health_care_worker","label":"Health and Care Worker","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":5},{"id":"student_visa","label":"Student visa","maxWeeklyHours":20,"defaultContractedHours":null,"weeklyHours":20,"sortOrder":6},{"id":"student_visa_sub_degree","label":"Student visa (sub-degree course)","maxWeeklyHours":10,"defaultContractedHours":null,"weeklyHours":10,"sortOrder":7},{"id":"graduate_visa","label":"Graduate visa","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":8},{"id":"dependent_family","label":"Dependent / family visa","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":9},{"id":"other_time_limited","label":"Other time-limited leave","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":10},{"id":"not_applicable","label":"Not applicable","maxWeeklyHours":40,"defaultContractedHours":null,"weeklyHours":40,"sortOrder":11}]'::jsonb;

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ALTER COLUMN "employeeVisaTypes" SET DEFAULT '[]'::jsonb;
