-- Link an incident to the visit (ScheduledJob) it was reported during.
ALTER TABLE "incidents"."Incident"
  ADD COLUMN IF NOT EXISTS "scheduledJobId" UUID;
CREATE INDEX IF NOT EXISTS "Incident_scheduledJobId_idx"
  ON "incidents"."Incident" ("scheduledJobId");
