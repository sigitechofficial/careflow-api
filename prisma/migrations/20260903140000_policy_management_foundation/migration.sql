-- Policy Management foundation. Additive only: new schema, enums, tables, indexes,
-- FKs, organisation care-service-type column, and policy permission catalogue rows.
-- Does not drop or alter existing IA / care-plan / medication / incident / RBAC tables
-- beyond inserting permission and role-permission rows.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "policies";

-- AlterTable: organisation-operated care settings (ServiceUserCareType codes). Empty = not configured.
ALTER TABLE "identity"."CompanyProfile" ADD COLUMN "careServiceTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateEnum
CREATE TYPE "policies"."PolicyDocumentType" AS ENUM ('POLICY', 'PROCEDURE', 'PROTOCOL', 'GUIDELINE', 'FORM', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "policies"."PolicyDocumentSource" AS ENUM ('EDITOR', 'UPLOAD', 'CATALOGUE');

-- CreateEnum
CREATE TYPE "policies"."PolicyStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "policies"."PolicyLinkModuleType" AS ENUM ('CARE_PLAN', 'INITIAL_ASSESSMENT', 'RISK_ASSESSMENT', 'MEDICATION', 'INCIDENT', 'SAFEGUARDING', 'VISIT', 'EMPLOYEE', 'HR', 'TRAINING', 'RECRUITMENT', 'AUDIT', 'BUSINESS_CONTINUITY', 'BRANCH', 'EQUIPMENT', 'INFECTION_CONTROL');

-- CreateEnum
CREATE TYPE "policies"."PolicyLinkScope" AS ENUM ('MODULE', 'FORM_TEMPLATE', 'SECTION', 'RECORD');

-- CreateEnum
CREATE TYPE "policies"."PolicyAudienceTargetType" AS ENUM ('ALL_EMPLOYEES', 'ROLE', 'JOB_TITLE', 'WORK_AREA', 'LOCATION');

-- CreateEnum
CREATE TYPE "policies"."PolicyApprovalKind" AS ENUM ('REVIEW', 'APPROVAL');

-- CreateEnum
CREATE TYPE "policies"."PolicyApprovalDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "policies"."PolicyAcknowledgementStatus" AS ENUM ('PENDING', 'VIEWED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "policies"."PolicyCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "PolicyCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyTag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "PolicyTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyDocument" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "documentType" "policies"."PolicyDocumentType" NOT NULL,
    "source" "policies"."PolicyDocumentSource" NOT NULL DEFAULT 'EDITOR',
    "primaryCategoryId" UUID NOT NULL,
    "parentDocumentId" UUID,
    "currentVersionId" UUID,
    "status" "policies"."PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "isCatalogue" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "reviewerId" UUID,
    "approverId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyCategoryLink" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyCategoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyTagLink" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyTagLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyVersion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionMajor" INTEGER NOT NULL,
    "versionMinor" INTEGER NOT NULL,
    "status" "policies"."PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "titleSnapshot" TEXT NOT NULL,
    "contentJson" JSONB,
    "contentHtml" TEXT,
    "changeSummary" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "storagePath" TEXT,
    "effectiveDate" DATE,
    "reviewDate" DATE,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "archivedAt" TIMESTAMP(3),
    "acknowledgementRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyApplicability" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "organisationWide" BOOLEAN NOT NULL DEFAULT true,
    "locationId" UUID,
    "serviceTypeCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyApplicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyAudience" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "targetType" "policies"."PolicyAudienceTargetType" NOT NULL,
    "roleId" UUID,
    "jobTitleId" UUID,
    "workAreaId" UUID,
    "locationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyLink" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "moduleType" "policies"."PolicyLinkModuleType" NOT NULL,
    "scope" "policies"."PolicyLinkScope" NOT NULL,
    "recordId" UUID,
    "sectionKey" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PolicyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyApproval" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "kind" "policies"."PolicyApprovalKind" NOT NULL,
    "decision" "policies"."PolicyApprovalDecision" NOT NULL,
    "comments" TEXT,
    "actorId" UUID,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies"."PolicyAcknowledgement" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "policies"."PolicyAcknowledgementStatus" NOT NULL DEFAULT 'PENDING',
    "viewedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyCategory_code_key" ON "policies"."PolicyCategory"("code");

-- CreateIndex
CREATE INDEX "PolicyCategory_deletedAt_idx" ON "policies"."PolicyCategory"("deletedAt");

-- CreateIndex
CREATE INDEX "PolicyCategory_isActive_idx" ON "policies"."PolicyCategory"("isActive");

-- CreateIndex
CREATE INDEX "PolicyCategory_displayOrder_idx" ON "policies"."PolicyCategory"("displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyTag_name_key" ON "policies"."PolicyTag"("name");

-- CreateIndex
CREATE INDEX "PolicyTag_deletedAt_idx" ON "policies"."PolicyTag"("deletedAt");

-- CreateIndex
CREATE INDEX "PolicyTag_isActive_idx" ON "policies"."PolicyTag"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocument_reference_key" ON "policies"."PolicyDocument"("reference");

-- CreateIndex
CREATE INDEX "PolicyDocument_status_idx" ON "policies"."PolicyDocument"("status");

-- CreateIndex
CREATE INDEX "PolicyDocument_primaryCategoryId_idx" ON "policies"."PolicyDocument"("primaryCategoryId");

-- CreateIndex
CREATE INDEX "PolicyDocument_documentType_idx" ON "policies"."PolicyDocument"("documentType");

-- CreateIndex
CREATE INDEX "PolicyDocument_parentDocumentId_idx" ON "policies"."PolicyDocument"("parentDocumentId");

-- CreateIndex
CREATE INDEX "PolicyDocument_ownerId_idx" ON "policies"."PolicyDocument"("ownerId");

-- CreateIndex
CREATE INDEX "PolicyDocument_reviewerId_idx" ON "policies"."PolicyDocument"("reviewerId");

-- CreateIndex
CREATE INDEX "PolicyDocument_approverId_idx" ON "policies"."PolicyDocument"("approverId");

-- CreateIndex
CREATE INDEX "PolicyDocument_isCatalogue_idx" ON "policies"."PolicyDocument"("isCatalogue");

-- CreateIndex
CREATE INDEX "PolicyDocument_deletedAt_idx" ON "policies"."PolicyDocument"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyCategoryLink_documentId_categoryId_key" ON "policies"."PolicyCategoryLink"("documentId", "categoryId");

-- CreateIndex
CREATE INDEX "PolicyCategoryLink_documentId_idx" ON "policies"."PolicyCategoryLink"("documentId");

-- CreateIndex
CREATE INDEX "PolicyCategoryLink_categoryId_idx" ON "policies"."PolicyCategoryLink"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyTagLink_documentId_tagId_key" ON "policies"."PolicyTagLink"("documentId", "tagId");

-- CreateIndex
CREATE INDEX "PolicyTagLink_documentId_idx" ON "policies"."PolicyTagLink"("documentId");

-- CreateIndex
CREATE INDEX "PolicyTagLink_tagId_idx" ON "policies"."PolicyTagLink"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_documentId_versionMajor_versionMinor_key" ON "policies"."PolicyVersion"("documentId", "versionMajor", "versionMinor");

-- CreateIndex
CREATE INDEX "PolicyVersion_documentId_idx" ON "policies"."PolicyVersion"("documentId");

-- CreateIndex
CREATE INDEX "PolicyVersion_status_idx" ON "policies"."PolicyVersion"("status");

-- CreateIndex
CREATE INDEX "PolicyVersion_reviewDate_idx" ON "policies"."PolicyVersion"("reviewDate");

-- CreateIndex
CREATE INDEX "PolicyVersion_publishedAt_idx" ON "policies"."PolicyVersion"("publishedAt");

-- CreateIndex
CREATE INDEX "PolicyApplicability_versionId_idx" ON "policies"."PolicyApplicability"("versionId");

-- CreateIndex
CREATE INDEX "PolicyApplicability_locationId_idx" ON "policies"."PolicyApplicability"("locationId");

-- CreateIndex
CREATE INDEX "PolicyApplicability_serviceTypeCode_idx" ON "policies"."PolicyApplicability"("serviceTypeCode");

-- CreateIndex
CREATE INDEX "PolicyApplicability_organisationWide_idx" ON "policies"."PolicyApplicability"("organisationWide");

-- CreateIndex
CREATE INDEX "PolicyAudience_versionId_idx" ON "policies"."PolicyAudience"("versionId");

-- CreateIndex
CREATE INDEX "PolicyAudience_targetType_idx" ON "policies"."PolicyAudience"("targetType");

-- CreateIndex
CREATE INDEX "PolicyAudience_roleId_idx" ON "policies"."PolicyAudience"("roleId");

-- CreateIndex
CREATE INDEX "PolicyAudience_jobTitleId_idx" ON "policies"."PolicyAudience"("jobTitleId");

-- CreateIndex
CREATE INDEX "PolicyAudience_workAreaId_idx" ON "policies"."PolicyAudience"("workAreaId");

-- CreateIndex
CREATE INDEX "PolicyAudience_locationId_idx" ON "policies"."PolicyAudience"("locationId");

-- CreateIndex
CREATE INDEX "PolicyLink_versionId_idx" ON "policies"."PolicyLink"("versionId");

-- CreateIndex
CREATE INDEX "PolicyLink_moduleType_scope_idx" ON "policies"."PolicyLink"("moduleType", "scope");

-- CreateIndex
CREATE INDEX "PolicyLink_recordId_idx" ON "policies"."PolicyLink"("recordId");

-- CreateIndex
CREATE INDEX "PolicyApproval_versionId_idx" ON "policies"."PolicyApproval"("versionId");

-- CreateIndex
CREATE INDEX "PolicyApproval_actorId_idx" ON "policies"."PolicyApproval"("actorId");

-- CreateIndex
CREATE INDEX "PolicyApproval_kind_idx" ON "policies"."PolicyApproval"("kind");

-- CreateIndex
CREATE INDEX "PolicyApproval_decidedAt_idx" ON "policies"."PolicyApproval"("decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcknowledgement_versionId_userId_key" ON "policies"."PolicyAcknowledgement"("versionId", "userId");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgement_versionId_idx" ON "policies"."PolicyAcknowledgement"("versionId");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgement_userId_idx" ON "policies"."PolicyAcknowledgement"("userId");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgement_status_idx" ON "policies"."PolicyAcknowledgement"("status");

-- AddForeignKey
ALTER TABLE "policies"."PolicyDocument" ADD CONSTRAINT "PolicyDocument_primaryCategoryId_fkey" FOREIGN KEY ("primaryCategoryId") REFERENCES "policies"."PolicyCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyDocument" ADD CONSTRAINT "PolicyDocument_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "policies"."PolicyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyDocument" ADD CONSTRAINT "PolicyDocument_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyDocument" ADD CONSTRAINT "PolicyDocument_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyDocument" ADD CONSTRAINT "PolicyDocument_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyCategoryLink" ADD CONSTRAINT "PolicyCategoryLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "policies"."PolicyDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyCategoryLink" ADD CONSTRAINT "PolicyCategoryLink_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "policies"."PolicyCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyTagLink" ADD CONSTRAINT "PolicyTagLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "policies"."PolicyDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyTagLink" ADD CONSTRAINT "PolicyTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "policies"."PolicyTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyVersion" ADD CONSTRAINT "PolicyVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "policies"."PolicyDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyApplicability" ADD CONSTRAINT "PolicyApplicability_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "policies"."PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyApplicability" ADD CONSTRAINT "PolicyApplicability_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAudience" ADD CONSTRAINT "PolicyAudience_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "policies"."PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAudience" ADD CONSTRAINT "PolicyAudience_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAudience" ADD CONSTRAINT "PolicyAudience_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "lookups"."JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAudience" ADD CONSTRAINT "PolicyAudience_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "lookups"."WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAudience" ADD CONSTRAINT "PolicyAudience_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyLink" ADD CONSTRAINT "PolicyLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "policies"."PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyApproval" ADD CONSTRAINT "PolicyApproval_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "policies"."PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyApproval" ADD CONSTRAINT "PolicyApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "policies"."PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies"."PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Policy permission catalogue (idempotent). Does not change existing permission semantics.
INSERT INTO "identity"."Permission" ("id", "key", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), k, true, NOW(), NOW()
FROM unnest(ARRAY[
  'policies.read',
  'policies.create',
  'policies.update',
  'policies.submit',
  'policies.review',
  'policies.approve',
  'policies.publish',
  'policies.archive',
  'policies.categories.manage',
  'policies.links.manage',
  'policies.audit.read',
  'policies.acknowledgements.manage',
  'policies.acknowledgements.me'
]::text[]) AS k
WHERE NOT EXISTS (
  SELECT 1 FROM "identity"."Permission" p WHERE p."key" = k
);

UPDATE "identity"."Permission"
SET "isActive" = true, "deletedAt" = NULL, "updatedAt" = NOW()
WHERE "key" LIKE 'policies.%';

-- Super Admin + Admin: all policy permissions
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND r."deletedAt" IS NULL
  AND p."key" LIKE 'policies.%'
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- Manager / Care Coordinator
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Manager', 'Care Coordinator')
  AND r."deletedAt" IS NULL
  AND p."key" IN (
    'policies.read',
    'policies.create',
    'policies.update',
    'policies.submit',
    'policies.review'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- HR / Senior Carer/Nurse / Carer/Domestic (staff equivalent)
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('HR', 'Senior Carer/Nurse', 'Carer/Domestic')
  AND r."deletedAt" IS NULL
  AND p."key" IN ('policies.read', 'policies.acknowledgements.me')
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- CQC Inspector
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" = 'CQC Inspector'
  AND r."deletedAt" IS NULL
  AND p."key" IN ('policies.read', 'policies.audit.read')
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
