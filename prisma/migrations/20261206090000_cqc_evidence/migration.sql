-- CQC evidence (Quality & compliance -> CQC evidence): the CQC framework as versioned data
-- (key questions, quality statements, evidence categories; filled by prisma/seeds/cqc-framework.seed.ts)
-- and evidence records linked to quality statements. Survey results are captured automatically when a
-- survey or survey period closes. Additive only: nothing existing is changed.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "quality";

-- CreateEnum
CREATE TYPE "quality"."CqcFrameworkStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "quality"."CqcEvidenceSourceType" AS ENUM ('SURVEY_RESULT', 'POLICY', 'AUDIT', 'INCIDENT_LEARNING', 'TRAINING', 'COMPLAINT', 'COMPLIMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "quality"."CqcEvidenceStatus" AS ENUM ('CURRENT', 'SUPERSEDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "quality"."CqcFrameworkVersion" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "quality"."CqcFrameworkStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE,
    "checkedOn" DATE,
    "note" TEXT,
    "sources" JSONB,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcFrameworkVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcKeyQuestion" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcKeyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcQualityStatement" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "keyQuestionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mapsFrom" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcQualityStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcEvidenceCategory" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mapsFrom" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcEvidenceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcEvidence" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceType" "quality"."CqcEvidenceSourceType" NOT NULL,
    "sourceId" UUID,
    "sourceLabel" TEXT,
    "sourceKey" TEXT,
    "categoryCode" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "locationIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "quality"."CqcEvidenceStatus" NOT NULL DEFAULT 'CURRENT',
    "reviewDueAt" TIMESTAMP(3),
    "metrics" JSONB,
    "actions" JSONB,
    "notes" TEXT,
    "supersededById" UUID,
    "createdById" UUID,
    "updatedById" UUID,
    "archivedAt" TIMESTAMP(3),
    "archivedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcEvidenceStatement" (
    "evidenceId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CqcEvidenceStatement_pkey" PRIMARY KEY ("evidenceId","statementId")
);

-- CreateTable
CREATE TABLE "quality"."CqcEvidenceAttachment" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CqcEvidenceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcSurveyStatementChoice" (
    "surveyId" UUID NOT NULL,
    "statementIds" UUID[],
    "categoryCode" TEXT,
    "chosenById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcSurveyStatementChoice_pkey" PRIMARY KEY ("surveyId")
);

-- CreateTable
CREATE TABLE "quality"."CqcSurveyCapture" (
    "surveyId" UUID NOT NULL,
    "surveyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CqcSurveyCapture_pkey" PRIMARY KEY ("surveyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CqcFrameworkVersion_version_key" ON "quality"."CqcFrameworkVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "CqcKeyQuestion_frameworkVersionId_code_key" ON "quality"."CqcKeyQuestion"("frameworkVersionId", "code");

-- CreateIndex
CREATE INDEX "CqcQualityStatement_keyQuestionId_idx" ON "quality"."CqcQualityStatement"("keyQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "CqcQualityStatement_frameworkVersionId_code_key" ON "quality"."CqcQualityStatement"("frameworkVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CqcEvidenceCategory_frameworkVersionId_code_key" ON "quality"."CqcEvidenceCategory"("frameworkVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CqcEvidence_sourceKey_key" ON "quality"."CqcEvidence"("sourceKey");

-- CreateIndex
CREATE INDEX "CqcEvidence_status_idx" ON "quality"."CqcEvidence"("status");

-- CreateIndex
CREATE INDEX "CqcEvidence_sourceType_sourceId_idx" ON "quality"."CqcEvidence"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CqcEvidence_categoryCode_idx" ON "quality"."CqcEvidence"("categoryCode");

-- CreateIndex
CREATE INDEX "CqcEvidence_reviewDueAt_idx" ON "quality"."CqcEvidence"("reviewDueAt");

-- CreateIndex
CREATE INDEX "CqcEvidenceStatement_statementId_idx" ON "quality"."CqcEvidenceStatement"("statementId");

-- CreateIndex
CREATE INDEX "CqcEvidenceAttachment_evidenceId_idx" ON "quality"."CqcEvidenceAttachment"("evidenceId");

-- AddForeignKey
ALTER TABLE "quality"."CqcKeyQuestion" ADD CONSTRAINT "CqcKeyQuestion_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "quality"."CqcFrameworkVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcQualityStatement" ADD CONSTRAINT "CqcQualityStatement_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "quality"."CqcFrameworkVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcQualityStatement" ADD CONSTRAINT "CqcQualityStatement_keyQuestionId_fkey" FOREIGN KEY ("keyQuestionId") REFERENCES "quality"."CqcKeyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcEvidenceCategory" ADD CONSTRAINT "CqcEvidenceCategory_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "quality"."CqcFrameworkVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcEvidenceStatement" ADD CONSTRAINT "CqcEvidenceStatement_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "quality"."CqcEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcEvidenceStatement" ADD CONSTRAINT "CqcEvidenceStatement_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "quality"."CqcQualityStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcEvidenceAttachment" ADD CONSTRAINT "CqcEvidenceAttachment_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "quality"."CqcEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permissions: read (overview, evidence, framework), manage (add, edit, archive, attach, add surveys),
-- export (PDF / CSV packs for inspection).
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.key, v.description, true, NOW(), NOW()
FROM (VALUES
  ('cqc_evidence.read', 'View CQC evidence by quality statement'),
  ('cqc_evidence.manage', 'Add, edit and archive CQC evidence, and add survey results to it'),
  ('cqc_evidence.export', 'Export CQC evidence as PDF or CSV for inspection')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = v.key);

-- Super Admin, Admin and Manager: everything. Care Coordinator: read. CQC Inspector: read and export.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
JOIN "identity"."Permission" p ON (
     (r."name" IN ('Super Admin', 'Admin', 'Manager') AND p."key" IN ('cqc_evidence.read', 'cqc_evidence.manage', 'cqc_evidence.export'))
  OR (r."name" = 'Care Coordinator' AND p."key" = 'cqc_evidence.read')
  OR (r."name" = 'CQC Inspector' AND p."key" IN ('cqc_evidence.read', 'cqc_evidence.export'))
)
WHERE r."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x
    WHERE x."roleId" = r."id" AND x."permissionId" = p."id"
  );
