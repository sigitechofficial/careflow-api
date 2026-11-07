-- Shared-link spam protection kept in the database, so several API servers share it
-- (src/surveys/survey-link-guard.ts). Nothing about the person answering: a used form token's random
-- part and expiry; a hash of the link, the minute and a count. Expired rows are cleared by the guard.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyLinkFormToken" (
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SurveyLinkFormToken_pkey" PRIMARY KEY ("nonce")
);
CREATE INDEX IF NOT EXISTS "SurveyLinkFormToken_expiresAt_idx" ON "surveys"."SurveyLinkFormToken"("expiresAt");

CREATE TABLE IF NOT EXISTS "surveys"."SurveyLinkRate" (
    "linkHash" TEXT NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "answers" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SurveyLinkRate_pkey" PRIMARY KEY ("linkHash", "minute")
);
CREATE INDEX IF NOT EXISTS "SurveyLinkRate_minute_idx" ON "surveys"."SurveyLinkRate"("minute");

-- A raised per-link limit for a planned sitting (answers per 10 minutes), until a time.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "sharedLinkLimit" INTEGER;
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "sharedLinkLimitUntil" TIMESTAMP(3);
