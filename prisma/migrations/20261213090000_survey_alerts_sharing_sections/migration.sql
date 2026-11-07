-- Surveys Phase 1: alert rules (answers -> role tasks), contact-me follow-up, "who it's for",
-- shared links (branch links, shared link on staff / service-user surveys), section introductions.
-- See docs/SURVEY_ROADMAP.md section 5 and src/surveys/survey-alerts.service.ts.

-- Role tasks raised by another feature (a survey alert) have no template.
ALTER TABLE "identity"."RoleTask" ALTER COLUMN "templateId" DROP NOT NULL;
ALTER TABLE "identity"."RoleTask"
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceId" UUID;
CREATE INDEX IF NOT EXISTS "RoleTask_sourceType_sourceId_idx" ON "identity"."RoleTask"("sourceType", "sourceId");

ALTER TABLE "surveys"."Survey"
  ADD COLUMN IF NOT EXISTS "alertRulesSetUpAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "audienceGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "audienceGroupOther" TEXT,
  ADD COLUMN IF NOT EXISTS "sharedLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sectionIntros" JSONB;

-- Responses given before alert rules existed are never alerted on.
ALTER TABLE "surveys"."SurveyResponse"
  ADD COLUMN IF NOT EXISTS "alertsChecked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "viaSharedLink" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shareLinkId" UUID;
-- Raw SQL: "updatedAt" (day-only on unlinked responses) is not touched.
UPDATE "surveys"."SurveyResponse" SET "alertsChecked" = true WHERE "alertsChecked" = false;
-- Responses with no recipient on a PUBLIC survey came through its shared link.
UPDATE "surveys"."SurveyResponse" r SET "viaSharedLink" = true
  FROM "surveys"."Survey" s
 WHERE s."id" = r."surveyId" AND s."targetKind" = 'PUBLIC' AND r."recipientId" IS NULL
   AND r."channel" = 'ONLINE' AND r."viaSharedLink" = false;

CREATE TABLE IF NOT EXISTS "surveys"."SurveyAlertRule" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL,
  "whenText" TEXT NOT NULL,
  "actionText" TEXT NOT NULL,
  "conditions" JSONB NOT NULL,
  "ownerKey" TEXT,
  "roleId" UUID,
  "dueWorkingDays" INTEGER NOT NULL DEFAULT 0,
  "urgent" BOOLEAN NOT NULL DEFAULT false,
  "recordKind" TEXT,
  "contactRequest" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "libraryAlert" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  CONSTRAINT "SurveyAlertRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyAlertRule_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyAlertRule_surveyId_key_key" ON "surveys"."SurveyAlertRule"("surveyId", "key");
CREATE INDEX IF NOT EXISTS "SurveyAlertRule_surveyId_idx" ON "surveys"."SurveyAlertRule"("surveyId");

CREATE TABLE IF NOT EXISTS "surveys"."SurveyAlert" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "ruleId" UUID,
  "responseId" UUID,
  "unlinked" BOOLEAN NOT NULL DEFAULT false,
  "matchCount" INTEGER NOT NULL DEFAULT 1,
  "matched" JSONB NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "contactRequest" BOOLEAN NOT NULL DEFAULT false,
  "serviceUserId" UUID,
  "employeeId" UUID,
  "locationId" UUID,
  "roleId" UUID,
  "roleTaskId" UUID,
  "ownerUserId" UUID,
  "dueDate" DATE NOT NULL,
  "urgent" BOOLEAN NOT NULL DEFAULT false,
  "outcomeKind" TEXT,
  "outcome" TEXT,
  "recordKind" TEXT,
  "linkedRecordType" TEXT,
  "linkedRecordId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "SurveyAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyAlert_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SurveyAlert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "surveys"."SurveyAlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyAlert_roleTaskId_key" ON "surveys"."SurveyAlert"("roleTaskId");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyAlert_ruleId_responseId_key" ON "surveys"."SurveyAlert"("ruleId", "responseId");
CREATE INDEX IF NOT EXISTS "SurveyAlert_surveyId_idx" ON "surveys"."SurveyAlert"("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyAlert_contactRequest_idx" ON "surveys"."SurveyAlert"("contactRequest");
CREATE INDEX IF NOT EXISTS "SurveyAlert_dueDate_idx" ON "surveys"."SurveyAlert"("dueDate");
-- An unlinked (grouped) alert never points at a response or a person.
ALTER TABLE "surveys"."SurveyAlert" DROP CONSTRAINT IF EXISTS "SurveyAlert_unlinked_names_no_one";
ALTER TABLE "surveys"."SurveyAlert" ADD CONSTRAINT "SurveyAlert_unlinked_names_no_one"
  CHECK (NOT "unlinked" OR ("responseId" IS NULL AND "serviceUserId" IS NULL AND "employeeId" IS NULL AND "contactRequest" = false));

CREATE TABLE IF NOT EXISTS "surveys"."SurveyAlertOwnerRole" (
  "ownerKey" TEXT NOT NULL,
  "roleId" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "SurveyAlertOwnerRole_pkey" PRIMARY KEY ("ownerKey")
);

CREATE TABLE IF NOT EXISTS "surveys"."SurveyShareLink" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "locationId" UUID,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "revokedAt" TIMESTAMP(3),
  "revokedById" UUID,
  CONSTRAINT "SurveyShareLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyShareLink_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyShareLink_token_key" ON "surveys"."SurveyShareLink"("token");
CREATE INDEX IF NOT EXISTS "SurveyShareLink_surveyId_idx" ON "surveys"."SurveyShareLink"("surveyId");
-- One live link per branch (and one live "all branches" extra link) per survey.
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyShareLink_one_live_per_branch"
  ON "surveys"."SurveyShareLink"("surveyId", COALESCE("locationId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "revokedAt" IS NULL;
