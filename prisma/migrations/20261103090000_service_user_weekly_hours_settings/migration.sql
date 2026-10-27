-- Service user weekly hours rules, chosen in Settings → DOM Care. '{}' = today's behaviour (defaults in code).
ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "serviceUserWeeklyHoursSettings" JSONB NOT NULL DEFAULT '{}';
