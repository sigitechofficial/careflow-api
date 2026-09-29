-- Survey branch scoping and published timestamp.

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "locationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

-- Backfill: surveys already sent are treated as published at their first send.
UPDATE "surveys"."Survey" s
SET "publishedAt" = r."firstSentAt"
FROM (
    SELECT "surveyId", MIN("sentAt") AS "firstSentAt"
    FROM "surveys"."SurveyRecipient"
    WHERE "sentAt" IS NOT NULL
    GROUP BY "surveyId"
) r
WHERE r."surveyId" = s."id" AND s."publishedAt" IS NULL;
