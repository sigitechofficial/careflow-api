-- Survey-level public share token (one link for many respondents).

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;

UPDATE "surveys"."Survey"
SET "shareToken" = gen_random_uuid()::text
WHERE "shareToken" IS NULL;

ALTER TABLE "surveys"."Survey" ALTER COLUMN "shareToken" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Survey_shareToken_key" ON "surveys"."Survey"("shareToken");
