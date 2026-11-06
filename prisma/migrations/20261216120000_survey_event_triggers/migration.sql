-- Survey roadmap Phase 2, part 3: surveys sent when something happens in the care records.
-- See src/surveys/survey-event-triggers.util.ts and src/surveys/survey-event-triggers.service.ts.

-- The event this survey is sent after, switched on per survey: { event, delayDays, windowDays, exclusions,
-- options, checkFirst, since, ownerKey }. Null = not sent by events.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "eventTrigger" JSONB;

-- One row per event acted on: who (a member of staff or a person we support), when it happened and when the
-- survey is due (days only), and what became of it (WAITING, DUE, BATCH, SENT, HELD, SKIPPED, CANCELLED,
-- EXPIRED, OFFERED). sourceKey names the record that raised it (e.g. the hospital stay), so each event is
-- acted on once. Never holds answers, completion or response times.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyEventOccurrence" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "event" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "employeeId" UUID,
  "serviceUserId" UUID,
  "eventOn" TIMESTAMP(3) NOT NULL,
  "dueOn" TIMESTAMP(3) NOT NULL,
  "lastDay" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "reason" TEXT,
  "sentSurveyId" UUID,
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyEventOccurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyEventOccurrence_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SurveyEventOccurrence_one_person" CHECK (("employeeId" IS NULL) <> ("serviceUserId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyEventOccurrence_surveyId_event_sourceKey_key" ON "surveys"."SurveyEventOccurrence"("surveyId", "event", "sourceKey");
CREATE INDEX IF NOT EXISTS "SurveyEventOccurrence_status_dueOn_idx" ON "surveys"."SurveyEventOccurrence"("status", "dueOn");
CREATE INDEX IF NOT EXISTS "SurveyEventOccurrence_serviceUserId_idx" ON "surveys"."SurveyEventOccurrence"("serviceUserId");
CREATE INDEX IF NOT EXISTS "SurveyEventOccurrence_employeeId_idx" ON "surveys"."SurveyEventOccurrence"("employeeId");
