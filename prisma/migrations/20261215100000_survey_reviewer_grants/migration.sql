-- Independent reviewer accounts (SUR-CQC-001/002): a temporary login may record answers on one
-- survey, inside a time window, only for the sample of people chosen (none = anonymous only).
CREATE TABLE IF NOT EXISTS "surveys"."SurveyReviewerGrant" (
    "id" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "inspectorId" UUID NOT NULL,
    "personIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    CONSTRAINT "SurveyReviewerGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SurveyReviewerGrant_window_check" CHECK ("validTo" > "validFrom")
);

CREATE INDEX IF NOT EXISTS "SurveyReviewerGrant_surveyId_idx" ON "surveys"."SurveyReviewerGrant"("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyReviewerGrant_inspectorId_idx" ON "surveys"."SurveyReviewerGrant"("inspectorId");

ALTER TABLE "surveys"."SurveyReviewerGrant"
    ADD CONSTRAINT "SurveyReviewerGrant_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surveys"."SurveyReviewerGrant"
    ADD CONSTRAINT "SurveyReviewerGrant_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "employees"."TemporaryInspector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
