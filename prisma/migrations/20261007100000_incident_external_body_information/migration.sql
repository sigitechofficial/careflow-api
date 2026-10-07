-- External bodies: what we gave them and what we got back (replaces the single notes field).
ALTER TABLE "incidents"."IncidentExternalBody"
  ADD COLUMN "informationProvided" TEXT,
  ADD COLUMN "informationReceived" TEXT;

UPDATE "incidents"."IncidentExternalBody"
  SET "informationReceived" = "notes"
  WHERE "notes" IS NOT NULL;

ALTER TABLE "incidents"."IncidentExternalBody" DROP COLUMN "notes";
