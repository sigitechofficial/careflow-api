-- Answers not linked to anyone (anonymous surveys, "without my name", shared links, anonymous recorded
-- answers) get no audit row each: an exact time and the survey id would let anyone who reads the audit
-- log count a survey's answers and date each one. Instead the number per survey per day is kept here
-- (date only, nothing about the answer or the person) and written to the audit log once the day is over
-- (src/surveys/survey-unlinked-answer-days.ts).
CREATE TABLE IF NOT EXISTS "surveys"."SurveyUnlinkedAnswerDay" (
    "surveyId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "answers" INTEGER NOT NULL DEFAULT 0,
    "recorded" INTEGER NOT NULL DEFAULT 0,
    "reviewerRecorded" INTEGER NOT NULL DEFAULT 0,
    "auditedAt" TIMESTAMP(3),
    CONSTRAINT "SurveyUnlinkedAnswerDay_pkey" PRIMARY KEY ("surveyId", "day"),
    CONSTRAINT "SurveyUnlinkedAnswerDay_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyUnlinkedAnswerDay_auditedAt_day_idx" ON "surveys"."SurveyUnlinkedAnswerDay"("auditedAt", "day");
