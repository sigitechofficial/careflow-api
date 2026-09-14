-- Default operational timezone: Asia/Karachi (UTC+5)
ALTER TABLE identity."OrganisationGeneralSettings"
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Karachi';

ALTER TABLE scheduling."EcmVisitEvaluation"
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Karachi';
