-- Multi-select "who was affected": store all affected person kinds on the incident.
ALTER TABLE "incidents"."Incident"
  ADD COLUMN IF NOT EXISTS "affectedPersonKinds" "incidents"."IncidentPersonKind"[] NOT NULL DEFAULT ARRAY[]::"incidents"."IncidentPersonKind"[];
