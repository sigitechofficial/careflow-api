-- Survey roadmap Phase 3: other languages and easy read. One row per survey and language: the translated
-- texts people see (title, introduction, questions, answer labels, the form's own wording). Answers are
-- always stored in English, so results, alerts and trends are the same whatever language people answer in.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyTranslation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "surveyId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedById" UUID,
    CONSTRAINT "SurveyTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyTranslation_surveyId_language_key" ON "surveys"."SurveyTranslation"("surveyId", "language");
CREATE INDEX IF NOT EXISTS "SurveyTranslation_surveyId_idx" ON "surveys"."SurveyTranslation"("surveyId");

DO $$ BEGIN
  ALTER TABLE "surveys"."SurveyTranslation"
    ADD CONSTRAINT "SurveyTranslation_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
