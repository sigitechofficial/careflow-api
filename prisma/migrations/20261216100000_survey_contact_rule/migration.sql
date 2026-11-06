-- Survey roadmap Phase 2, part 2: the 4-week contact rule and sampling.
-- See src/surveys/survey-contact-rule.util.ts and src/surveys/survey-contact-rule.service.ts.

-- Whether this survey holds back people surveyed in the last 4 weeks, and whether being sent it counts as a
-- survey contact: { holdBack, countsAsContact, reason }. Null = the ready-made default (library
-- timing.contactRule), else both on. A repeating survey's periods use their source survey's.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "contactRule" JSONB;

-- Send each time to a share of the people who are free: { percent } (5 to 100). Null = everyone.
-- Only for audiences of everyone in branches / job titles, never chosen people.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "sampling" JSONB;

-- The row exists only because an answer was recorded or given, not because the survey was sent. Such rows
-- are never a survey contact on an anonymous survey (counting them would show that the person answered).
ALTER TABLE "surveys"."SurveyRecipient" ADD COLUMN IF NOT EXISTS "addedByAnswer" BOOLEAN NOT NULL DEFAULT false;

-- Someone held back from a survey by the 4-week rule: sent it on their free day if it is still open
-- (SENT), sent anyway by a manager with a reason (OVERRIDDEN), or not sent because it closed (LAPSED).
-- Days only (lastContactOn / freeFrom are the start of the operational day).
CREATE TABLE IF NOT EXISTS "surveys"."SurveyHeldBack" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "employeeId" UUID,
  "serviceUserId" UUID,
  "lastContactOn" TIMESTAMP(3) NOT NULL,
  "freeFrom" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'HELD',
  "overrideReason" TEXT,
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyHeldBack_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyHeldBack_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SurveyHeldBack_one_person" CHECK (("employeeId" IS NULL) <> ("serviceUserId" IS NULL))
);
CREATE INDEX IF NOT EXISTS "SurveyHeldBack_surveyId_idx" ON "surveys"."SurveyHeldBack"("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyHeldBack_status_freeFrom_idx" ON "surveys"."SurveyHeldBack"("status", "freeFrom");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyHeldBack_surveyId_employeeId_key" ON "surveys"."SurveyHeldBack"("surveyId", "employeeId") WHERE "employeeId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyHeldBack_surveyId_serviceUserId_key" ON "surveys"."SurveyHeldBack"("surveyId", "serviceUserId") WHERE "serviceUserId" IS NOT NULL;

-- Finding a person's recent survey contacts.
CREATE INDEX IF NOT EXISTS "SurveyRecipient_employeeId_sentAt_idx" ON "surveys"."SurveyRecipient"("employeeId", "sentAt");
CREATE INDEX IF NOT EXISTS "SurveyRecipient_serviceUserId_sentAt_idx" ON "surveys"."SurveyRecipient"("serviceUserId", "sentAt");
