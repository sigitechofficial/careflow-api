-- Add primary-person kind + name to Incident so Family/Visitor/Healthcare/Contractor/Other
-- can be recorded as the primary affected person (not only service users / employees).
ALTER TABLE "incidents"."Incident"
  ADD COLUMN IF NOT EXISTS "primaryPersonKind" "incidents"."IncidentPersonKind",
  ADD COLUMN IF NOT EXISTS "primaryPersonName" TEXT;
