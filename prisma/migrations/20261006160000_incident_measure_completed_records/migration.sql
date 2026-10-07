-- Corrective measures: the record(s) actually updated or added, chosen on completion.
ALTER TABLE "incidents"."IncidentAction" ADD COLUMN "completedRecords" JSONB;
