-- Initial Assessment Checklist (template-based)

CREATE TYPE "service_users"."InitialAssessmentStatus" AS ENUM (
  'DRAFT',
  'IN_PROGRESS',
  'SUBMITTED',
  'REVIEWED',
  'ARCHIVED',
  'CANCELLED'
);

CREATE TYPE "service_users"."InitialAssessmentQuestionType" AS ENUM (
  'CHECKBOX',
  'YES_NO',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'TIME'
);

CREATE TABLE "service_users"."InitialAssessmentTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "deletedById" UUID,
  CONSTRAINT "InitialAssessmentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."InitialAssessmentSection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "templateId" UUID NOT NULL,
  "sectionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "carePlanArea" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "InitialAssessmentSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."InitialAssessmentQuestion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sectionId" UUID NOT NULL,
  "questionText" TEXT NOT NULL,
  "helpText" TEXT,
  "questionType" "service_users"."InitialAssessmentQuestionType" NOT NULL,
  "options" JSONB,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "allowNotes" BOOLEAN NOT NULL DEFAULT true,
  "riskFlag" BOOLEAN NOT NULL DEFAULT false,
  "carePlanTrigger" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "InitialAssessmentQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."InitialAssessmentSubmission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "serviceUserId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "status" "service_users"."InitialAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "submittedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" UUID,
  "reviewNotes" TEXT,
  "overallNotes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "deletedById" UUID,
  CONSTRAINT "InitialAssessmentSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."InitialAssessmentAnswer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submissionId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "checked" BOOLEAN,
  "booleanValue" BOOLEAN,
  "textValue" TEXT,
  "numberValue" DECIMAL(12,4),
  "dateValue" TIMESTAMP(3),
  "timeValue" TEXT,
  "selectedOptions" JSONB,
  "notes" TEXT,
  "riskFlag" BOOLEAN NOT NULL DEFAULT false,
  "carePlanTrigger" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InitialAssessmentAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InitialAssessmentSection_templateId_sectionNumber_key"
  ON "service_users"."InitialAssessmentSection"("templateId", "sectionNumber");

CREATE UNIQUE INDEX "InitialAssessmentAnswer_submissionId_questionId_key"
  ON "service_users"."InitialAssessmentAnswer"("submissionId", "questionId");

CREATE INDEX "InitialAssessmentTemplate_isDefault_idx" ON "service_users"."InitialAssessmentTemplate"("isDefault");
CREATE INDEX "InitialAssessmentTemplate_isActive_idx" ON "service_users"."InitialAssessmentTemplate"("isActive");
CREATE INDEX "InitialAssessmentTemplate_deletedAt_idx" ON "service_users"."InitialAssessmentTemplate"("deletedAt");
CREATE INDEX "InitialAssessmentSection_templateId_idx" ON "service_users"."InitialAssessmentSection"("templateId");
CREATE INDEX "InitialAssessmentSection_deletedAt_idx" ON "service_users"."InitialAssessmentSection"("deletedAt");
CREATE INDEX "InitialAssessmentQuestion_sectionId_idx" ON "service_users"."InitialAssessmentQuestion"("sectionId");
CREATE INDEX "InitialAssessmentQuestion_deletedAt_idx" ON "service_users"."InitialAssessmentQuestion"("deletedAt");
CREATE INDEX "InitialAssessmentSubmission_serviceUserId_idx" ON "service_users"."InitialAssessmentSubmission"("serviceUserId");
CREATE INDEX "InitialAssessmentSubmission_templateId_idx" ON "service_users"."InitialAssessmentSubmission"("templateId");
CREATE INDEX "InitialAssessmentSubmission_status_idx" ON "service_users"."InitialAssessmentSubmission"("status");
CREATE INDEX "InitialAssessmentSubmission_deletedAt_idx" ON "service_users"."InitialAssessmentSubmission"("deletedAt");
CREATE INDEX "InitialAssessmentAnswer_submissionId_idx" ON "service_users"."InitialAssessmentAnswer"("submissionId");
CREATE INDEX "InitialAssessmentAnswer_questionId_idx" ON "service_users"."InitialAssessmentAnswer"("questionId");

ALTER TABLE "service_users"."InitialAssessmentSection"
  ADD CONSTRAINT "InitialAssessmentSection_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "service_users"."InitialAssessmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentQuestion"
  ADD CONSTRAINT "InitialAssessmentQuestion_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "service_users"."InitialAssessmentSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentSubmission"
  ADD CONSTRAINT "InitialAssessmentSubmission_serviceUserId_fkey"
  FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentSubmission"
  ADD CONSTRAINT "InitialAssessmentSubmission_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "service_users"."InitialAssessmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentSubmission"
  ADD CONSTRAINT "InitialAssessmentSubmission_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentSubmission"
  ADD CONSTRAINT "InitialAssessmentSubmission_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentAnswer"
  ADD CONSTRAINT "InitialAssessmentAnswer_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "service_users"."InitialAssessmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."InitialAssessmentAnswer"
  ADD CONSTRAINT "InitialAssessmentAnswer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "service_users"."InitialAssessmentQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
