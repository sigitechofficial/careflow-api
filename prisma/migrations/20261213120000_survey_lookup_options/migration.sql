-- Survey questions whose options come from a CareFlow list (ethnicity, sexual orientation, gender,
-- sex, language, marital status), answers kept by the entry's code; and alert rules due in calendar days.
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN IF NOT EXISTS "optionsFrom" TEXT;
ALTER TABLE "surveys"."SurveyAnswer" ADD COLUMN IF NOT EXISTS "lookupCodes" JSONB;
ALTER TABLE "surveys"."SurveyAlertRule" ADD COLUMN IF NOT EXISTS "dueCalendarDays" INTEGER;
