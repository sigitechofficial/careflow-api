-- Shared links: "one answer per device" (a marker kept only on the device) and answers per day
-- through shared links (counts by day only), for the ballot-stuffing caution on Results.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "sharedLinkOncePerDevice" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "surveys"."SurveySharedLinkDay" (
  "surveyId" UUID NOT NULL,
  "day" DATE NOT NULL,
  "answers" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SurveySharedLinkDay_pkey" PRIMARY KEY ("surveyId", "day"),
  CONSTRAINT "SurveySharedLinkDay_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
