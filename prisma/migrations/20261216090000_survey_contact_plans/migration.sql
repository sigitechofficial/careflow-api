-- Survey roadmap Phase 2, part 1: reminders and contact plans, phone follow-up, opt-outs.
-- See src/surveys/survey-contact-plan.util.ts and src/surveys/survey-reminders.service.ts.

-- The survey's contact plan: reminders (days after sending), channels, quiet hours, phone follow-up.
-- Null = no automatic reminders. A repeating survey's periods use their source survey's plan.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "contactPlan" JSONB;

-- Reminders sent to this person for this survey (manual and automatic; never more than 3).
-- remindedAt (existing) is the last one; on anonymous surveys it is the day only.
ALTER TABLE "surveys"."SurveyRecipient" ADD COLUMN IF NOT EXISTS "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- One reminder run: how many people were reminded and by which channel. Counts only, never who.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyReminderRun" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "step" INTEGER,
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "sentById" UUID,
  "people" INTEGER NOT NULL DEFAULT 0,
  "email" INTEGER NOT NULL DEFAULT 0,
  "app" INTEGER NOT NULL DEFAULT 0,
  "portal" INTEGER NOT NULL DEFAULT 0,
  "text" INTEGER NOT NULL DEFAULT 0,
  "noContact" INTEGER NOT NULL DEFAULT 0,
  "optedOut" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SurveyReminderRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyReminderRun_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyReminderRun_surveyId_idx" ON "surveys"."SurveyReminderRun"("surveyId");

-- A phone call to someone who has not answered (named surveys only; never on anonymous surveys).
CREATE TABLE IF NOT EXISTS "surveys"."SurveyCallAttempt" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "outcome" TEXT NOT NULL,
  "notes" TEXT,
  "calledById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyCallAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyCallAttempt_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SurveyCallAttempt_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "surveys"."SurveyRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyCallAttempt_surveyId_idx" ON "surveys"."SurveyCallAttempt"("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyCallAttempt_recipientId_idx" ON "surveys"."SurveyCallAttempt"("recipientId");

-- Someone who does not want survey invitations or reminders (all channels, or one).
-- subjectKind: EMPLOYEE | SERVICE_USER | CONTACT (a person-involved contact) | EXTERNAL (outside contact).
-- channel: ALL | EMAIL | TEXT | APP | PORTAL | PHONE.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyContactOptOut" (
  "id" UUID NOT NULL,
  "subjectKind" TEXT NOT NULL,
  "subjectId" UUID NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'ALL',
  "reason" TEXT,
  "recordedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyContactOptOut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyContactOptOut_subjectKind_subjectId_channel_key" ON "surveys"."SurveyContactOptOut"("subjectKind", "subjectId", "channel");
