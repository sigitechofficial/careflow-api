-- AlterTable: staff involved in the incident (not the reporter, not just witnesses), linked to employees
ALTER TABLE "incidents"."Incident"
  ADD COLUMN "involvedEmployeeIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
