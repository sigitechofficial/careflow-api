-- The platform is for UK providers: the operational timezone defaults back to Europe/London
-- (reverses 20260914120000_default_timezone_asia_karachi). Existing rows keep their saved value.
ALTER TABLE identity."OrganisationGeneralSettings"
  ALTER COLUMN "timezone" SET DEFAULT 'Europe/London';

ALTER TABLE scheduling."EcmVisitEvaluation"
  ALTER COLUMN "timezone" SET DEFAULT 'Europe/London';
