-- Default operational timezone back to Europe/London (production organisation setting).
-- Reverts the column defaults set by 20260914120000_default_timezone_asia_karachi.
-- ALTER DEFAULT only: existing rows (e.g. a dev org explicitly on Asia/Karachi) are untouched.
-- Code must always read OrganisationGeneralSettings.timezone; this default only applies to new rows.
ALTER TABLE identity."OrganisationGeneralSettings"
  ALTER COLUMN "timezone" SET DEFAULT 'Europe/London';

ALTER TABLE scheduling."EcmVisitEvaluation"
  ALTER COLUMN "timezone" SET DEFAULT 'Europe/London';
