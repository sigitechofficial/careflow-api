-- Organisation operational timezone (schedules / ECM / "today")
ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Europe/London';
