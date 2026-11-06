-- Survey roadmap Phase 2 part 6: acting on results. See src/surveys/survey-actions.service.ts.

-- An action raised from a result (a question's figure, a theme, an alert, a team discussion, or general), owned by
-- a role (its RoleTask, sourceType SURVEY_ACTION) and optionally a person in it. Feeds CQC evidence "You said, we did".
-- source: QUESTION | THEME | ALERT | DISCUSSION | GENERAL; status: OPEN | IN_PROGRESS | DONE | CANCELLED.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyAction" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "periodId" UUID,
  "source" TEXT NOT NULL DEFAULT 'GENERAL',
  "sourceKey" TEXT,
  "sourceLabel" TEXT,
  "discussionId" UUID,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "ownerRoleId" UUID NOT NULL,
  "ownerUserId" UUID,
  "roleTaskId" UUID,
  "dueOn" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "outcome" TEXT,
  "youSaid" TEXT,
  "weDid" TEXT,
  "evidenceNote" TEXT,
  "locationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "completedAt" TIMESTAMP(3),
  "completedById" UUID,
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyAction_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyAction_surveyId_idx" ON "surveys"."SurveyAction"("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyAction_status_dueOn_idx" ON "surveys"."SurveyAction"("status", "dueOn");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyAction_roleTaskId_key" ON "surveys"."SurveyAction"("roleTaskId");

-- When results were discussed with a team, and what was agreed. kind: TEAM_MEETING | STAFF_FORUM |
-- SUPERVISION_GROUP | MANAGEMENT_MEETING | CLIENT_OR_FAMILY_MEETING | OTHER.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyDiscussion" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "periodId" UUID,
  "heldOn" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "attendees" INTEGER,
  "summary" TEXT NOT NULL,
  "agreed" TEXT,
  "locationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "recordedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyDiscussion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyDiscussion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyDiscussion_surveyId_idx" ON "surveys"."SurveyDiscussion"("surveyId");

-- "You said, we did": a summary published to the portal, the carer app, a printable letter and / or a public page.
-- channels: PORTAL | APP | LETTER | PUBLIC; status: DRAFT | PUBLISHED | WITHDRAWN. items: [{ youSaid, weDid, actionId }].
-- headline: the overall figure as shown when published (only when it could be shown), else null. No answers, no names.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyYouSaidWeDid" (
  "id" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "periodId" UUID,
  "title" TEXT NOT NULL,
  "intro" TEXT,
  "items" JSONB NOT NULL,
  "headline" JSONB,
  "channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publicToken" TEXT,
  "locationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "audience" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "publishedById" UUID,
  "withdrawnAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyYouSaidWeDid_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyYouSaidWeDid_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyYouSaidWeDid_surveyId_idx" ON "surveys"."SurveyYouSaidWeDid"("surveyId");
CREATE INDEX IF NOT EXISTS "SurveyYouSaidWeDid_status_idx" ON "surveys"."SurveyYouSaidWeDid"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyYouSaidWeDid_publicToken_key" ON "surveys"."SurveyYouSaidWeDid"("publicToken");
