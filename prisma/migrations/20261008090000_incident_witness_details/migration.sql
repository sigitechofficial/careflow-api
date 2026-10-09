-- Carer-app witness text is kept as written instead of being split into witness rows.
ALTER TABLE "incidents"."Incident" ADD COLUMN "witnessDetails" TEXT;

ALTER TYPE "incidents"."IncidentClarificationField" ADD VALUE 'WITNESS_DETAILS';
