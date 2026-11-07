-- Survey alerts: minimum answers for grouped alerts, roles an alert must never go to, a retry cap
-- for the alert sweep, and the organisation's bank holiday region for working-day timescales.
ALTER TABLE "surveys"."SurveyAlertRule" ADD COLUMN IF NOT EXISTS "minimumAnswers" INTEGER;
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "alertNeverRouteTo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "surveys"."SurveyResponse" ADD COLUMN IF NOT EXISTS "alertCheckFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "bankHolidayRegion" TEXT NOT NULL DEFAULT 'UK';
