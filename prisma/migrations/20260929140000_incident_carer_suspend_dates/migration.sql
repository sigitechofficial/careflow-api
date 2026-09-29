-- AlterTable: suspension date range on investigation
ALTER TABLE "incidents"."IncidentInvestigation"
  ADD COLUMN "suspendFrom" DATE,
  ADD COLUMN "suspendTo" DATE;
