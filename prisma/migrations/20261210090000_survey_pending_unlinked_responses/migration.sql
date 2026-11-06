-- Surveys: answers not linked to anyone (anonymous surveys, and "Answer without my name" on named
-- surveys) are held here before they are written as a SurveyResponse.
--  * The person's survey (SurveyRecipient) is marked Completed in its own transaction; the response
--    is written later by the survey job in shuffled batches (or when the survey / period closes), so
--    the Completed update and the response never share a transaction (xmin), row order or time.
--  * Nothing here references the recipient, the person, their link token or their IP address.
--  * createdAt is the start of the operational day only (like the response it becomes).

CREATE TABLE IF NOT EXISTS "surveys"."SurveyPendingResponse" (
    "id" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "channel" "surveys"."SurveyResponseChannel" NOT NULL DEFAULT 'ONLINE',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyPendingResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SurveyPendingResponse_surveyId_idx" ON "surveys"."SurveyPendingResponse"("surveyId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurveyPendingResponse_surveyId_fkey') THEN
    ALTER TABLE "surveys"."SurveyPendingResponse"
      ADD CONSTRAINT "SurveyPendingResponse_surveyId_fkey"
      FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
