-- Surveys: where a survey came from, and two database safeguards.
--  * createdFromTemplateId: the template a survey was started from ("Use template"). A duplicate keeps
--    its source's template, so a survey started from a ready-made template keeps its origin. Surveys
--    started from a ready-made template also keep its libraryReference / libraryRevision; anonymity is
--    then fixed (the ready-made introduction and privacy notice tell people how answers are kept).
--    librarySourceId stays on adopted templates only.
--  * SurveyQuestion: a question key is unique among a survey's live questions ("Show only if" rules
--    point at keys).
--  * Survey: a ready-made (catalogue) survey is adopted at most once as a live organisation template.

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "createdFromTemplateId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Survey_createdFromTemplateId_fkey') THEN
    ALTER TABLE "surveys"."Survey"
      ADD CONSTRAINT "Survey_createdFromTemplateId_fkey"
      FOREIGN KEY ("createdFromTemplateId") REFERENCES "surveys"."Survey"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Survey_createdFromTemplateId_idx" ON "surveys"."Survey"("createdFromTemplateId");

-- Backfill from the creation audit entries (metadata.duplicatedFromId, metadata.fromTemplate) that
-- recorded the source until now: started from a template → that template; a duplicate → its source's
-- template (repeated so chains of duplicates resolve).
UPDATE "surveys"."Survey" s
  SET "createdFromTemplateId" = t."id"
  FROM "audit"."AuditLog" a, "surveys"."Survey" t
  WHERE s."createdFromTemplateId" IS NULL
    AND a."action" = 'survey_created'
    AND a."recordType" = 'Survey'
    AND a."recordId" = s."id"::text
    AND a."metadata"->>'fromTemplate' = 'true'
    AND t."id"::text = a."metadata"->>'duplicatedFromId'
    AND t."isTemplate" = true
    AND t."id" <> s."id";

DO $$
DECLARE i INT;
BEGIN
  FOR i IN 1..3 LOOP
    UPDATE "surveys"."Survey" s
      SET "createdFromTemplateId" = src."createdFromTemplateId"
      FROM "audit"."AuditLog" a, "surveys"."Survey" src
      WHERE s."createdFromTemplateId" IS NULL
        AND a."action" = 'survey_created'
        AND a."recordType" = 'Survey'
        AND a."recordId" = s."id"::text
        AND a."metadata" ? 'duplicatedFromId'
        AND COALESCE(a."metadata"->>'fromTemplate', 'false') <> 'true'
        AND src."id"::text = a."metadata"->>'duplicatedFromId'
        AND src."createdFromTemplateId" IS NOT NULL
        AND src."createdFromTemplateId" <> s."id";
  END LOOP;
END $$;

-- Surveys started from a ready-made template keep its reference and revision.
UPDATE "surveys"."Survey" s
  SET "libraryReference" = t."libraryReference",
      "libraryRevision" = COALESCE(s."libraryRevision", t."libraryRevision")
  FROM "surveys"."Survey" t
  WHERE s."createdFromTemplateId" = t."id"
    AND s."libraryReference" IS NULL
    AND t."libraryReference" IS NOT NULL;

-- Resolve duplicate keys among a survey's live questions before the unique index: the first question
-- (survey order) keeps the key, the others get a new one.
WITH ranked AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "surveyId", "key" ORDER BY "sortOrder", "createdAt", "id") AS rn
  FROM "surveys"."SurveyQuestion"
  WHERE "deletedAt" IS NULL AND "key" IS NOT NULL
)
UPDATE "surveys"."SurveyQuestion" q
  SET "key" = 'q-' || substr(replace(q."id"::text, '-', ''), 1, 12)
  FROM ranked r
  WHERE q."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "SurveyQuestion_surveyId_key_live_key"
  ON "surveys"."SurveyQuestion"("surveyId", "key")
  WHERE "deletedAt" IS NULL;

-- Resolve ready-made surveys adopted more than once: the first live template stays linked; the others
-- keep their questions and library reference but are no longer linked (no update offers).
WITH ranked AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "librarySourceId" ORDER BY "createdAt", "id") AS rn
  FROM "surveys"."Survey"
  WHERE "isTemplate" = true AND "deletedAt" IS NULL AND "isCatalogue" = false AND "librarySourceId" IS NOT NULL
)
UPDATE "surveys"."Survey" s
  SET "librarySourceId" = NULL
  FROM ranked r
  WHERE s."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Survey_librarySourceId_live_template_key"
  ON "surveys"."Survey"("librarySourceId")
  WHERE "isTemplate" = true AND "deletedAt" IS NULL AND "isCatalogue" = false;
