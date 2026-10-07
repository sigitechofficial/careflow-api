-- The lead investigator is a staff member (Employee: carer or manager), not a platform login.
ALTER TABLE "incidents"."IncidentInvestigation" RENAME COLUMN "leadInvestigatorId" TO "leadInvestigatorEmployeeId";
