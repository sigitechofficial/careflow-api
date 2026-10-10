-- Corrective measures: a new care plan / risk assessment / policy is needed (nothing to update yet).
ALTER TABLE "incidents"."IncidentAction" ADD COLUMN "newRecordNeeded" BOOLEAN NOT NULL DEFAULT false;
