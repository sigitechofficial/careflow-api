-- "Unsubscribe from all surveys" links (former people): an opaque random token per message, stored only as its
-- SHA-256 hash with the person it stands for. The link itself reveals nothing. See src/surveys/survey-unsubscribe.service.ts.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyUnsubscribeToken" (
  "id" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "subjectKind" TEXT NOT NULL,
  "subjectId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "SurveyUnsubscribeToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyUnsubscribeToken_tokenHash_key" ON "surveys"."SurveyUnsubscribeToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "SurveyUnsubscribeToken_subjectKind_subjectId_idx" ON "surveys"."SurveyUnsubscribeToken"("subjectKind", "subjectId");
