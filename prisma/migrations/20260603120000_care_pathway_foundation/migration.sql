-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "care_pathway";

-- CreateEnum
CREATE TYPE "care_pathway"."CarePathwayFormType" AS ENUM ('CARE_PLAN', 'ASSESSMENT', 'SERVICE_FORM', 'STAFF_FORM');
CREATE TYPE "care_pathway"."CarePathwayFormStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "care_pathway"."CarePathwayFormVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "care_pathway"."CarePathwayFormFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'TIME', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'RADIO', 'YES_NO', 'RICH_TEXT', 'FILE_UPLOAD', 'SIGNATURE', 'PHOTO', 'SECTION_TEXT');
CREATE TYPE "care_pathway"."PathwayActionType" AS ENUM ('CHECKLIST', 'OBSERVATION');
CREATE TYPE "care_pathway"."CarePictureType" AS ENUM ('STANDARD', 'UPLOADED');

-- CreateTable
CREATE TABLE "care_pathway"."CarePathwayForm" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "formType" "care_pathway"."CarePathwayFormType" NOT NULL,
    "status" "care_pathway"."CarePathwayFormStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" UUID,
    "lastPublishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "pictureUrl" TEXT,
    "versionLabel" TEXT NOT NULL DEFAULT '1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "CarePathwayForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePathwayFormVersion" (
    "id" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "care_pathway"."CarePathwayFormVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "schemaJson" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarePathwayFormVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePathwayFormSection" (
    "id" UUID NOT NULL,
    "formVersionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CarePathwayFormSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePathwayFormField" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "care_pathway"."CarePathwayFormFieldType" NOT NULL,
    "placeholder" TEXT,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "optionsJson" JSONB,
    "validationJson" JSONB,
    "conditionalLogicJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CarePathwayFormField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePathwayFormPublishLog" (
    "id" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "formVersionId" UUID NOT NULL,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CarePathwayFormPublishLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."DefaultFormSelection" (
    "id" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "formType" "care_pathway"."CarePathwayFormType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "selectedById" UUID,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "DefaultFormSelection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePlanTextCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CarePlanTextCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePlanTextTemplate" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "categoryId" UUID,
    "formId" UUID,
    "contentHtml" TEXT NOT NULL,
    "plainText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "CarePlanTextTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePlanTextPersonalisationToken" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "replacementSource" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CarePlanTextPersonalisationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."PathwayChecklist" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "carePlanId" UUID,
    "analysisGroupId" UUID,
    "observationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recordPhoto" BOOLEAN NOT NULL DEFAULT false,
    "familyShare" BOOLEAN NOT NULL DEFAULT false,
    "groupAction" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "PathwayChecklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."PathwayChecklistItem" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "itemText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "PathwayChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."PathwayAction" (
    "id" UUID NOT NULL,
    "actionName" TEXT NOT NULL,
    "actionIcon" TEXT NOT NULL,
    "instruction" TEXT,
    "actionType" "care_pathway"."PathwayActionType" NOT NULL,
    "carersCount" INTEGER NOT NULL DEFAULT 1,
    "startTime" TEXT,
    "endTime" TEXT,
    "durationMinutes" INTEGER,
    "notesMandatory" BOOLEAN NOT NULL DEFAULT false,
    "photoAllowed" BOOLEAN NOT NULL DEFAULT false,
    "allowFamilyShare" BOOLEAN NOT NULL DEFAULT false,
    "analysisAreaId" UUID,
    "approxDurationMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "PathwayAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."PathwayActionChecklistLink" (
    "id" UUID NOT NULL,
    "pathwayActionId" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PathwayActionChecklistLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."PathwayActionObservationLink" (
    "id" UUID NOT NULL,
    "pathwayActionId" UUID NOT NULL,
    "observationTypeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PathwayActionObservationLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePictureCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "CarePictureCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_pathway"."CarePicture" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "care_pathway"."CarePictureType" NOT NULL,
    "categoryId" UUID,
    "category" TEXT,
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "uploadedById" UUID,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CarePicture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarePathwayForm_currentVersionId_key" ON "care_pathway"."CarePathwayForm"("currentVersionId");
CREATE INDEX "CarePathwayForm_deletedAt_idx" ON "care_pathway"."CarePathwayForm"("deletedAt");
CREATE INDEX "CarePathwayForm_formType_idx" ON "care_pathway"."CarePathwayForm"("formType");
CREATE INDEX "CarePathwayForm_status_idx" ON "care_pathway"."CarePathwayForm"("status");
CREATE INDEX "CarePathwayForm_name_idx" ON "care_pathway"."CarePathwayForm"("name");

CREATE UNIQUE INDEX "CarePathwayFormVersion_formId_versionNumber_key" ON "care_pathway"."CarePathwayFormVersion"("formId", "versionNumber");
CREATE INDEX "CarePathwayFormVersion_formId_idx" ON "care_pathway"."CarePathwayFormVersion"("formId");
CREATE INDEX "CarePathwayFormVersion_status_idx" ON "care_pathway"."CarePathwayFormVersion"("status");

CREATE INDEX "CarePathwayFormSection_formVersionId_idx" ON "care_pathway"."CarePathwayFormSection"("formVersionId");
CREATE INDEX "CarePathwayFormSection_deletedAt_idx" ON "care_pathway"."CarePathwayFormSection"("deletedAt");

CREATE INDEX "CarePathwayFormField_sectionId_idx" ON "care_pathway"."CarePathwayFormField"("sectionId");
CREATE INDEX "CarePathwayFormField_deletedAt_idx" ON "care_pathway"."CarePathwayFormField"("deletedAt");

CREATE INDEX "CarePathwayFormPublishLog_formId_idx" ON "care_pathway"."CarePathwayFormPublishLog"("formId");

CREATE INDEX "DefaultFormSelection_formType_deletedAt_idx" ON "care_pathway"."DefaultFormSelection"("formType", "deletedAt");
CREATE INDEX "DefaultFormSelection_formId_idx" ON "care_pathway"."DefaultFormSelection"("formId");

CREATE INDEX "CarePlanTextCategory_deletedAt_idx" ON "care_pathway"."CarePlanTextCategory"("deletedAt");
CREATE INDEX "CarePlanTextTemplate_deletedAt_idx" ON "care_pathway"."CarePlanTextTemplate"("deletedAt");
CREATE INDEX "CarePlanTextTemplate_categoryId_idx" ON "care_pathway"."CarePlanTextTemplate"("categoryId");

CREATE UNIQUE INDEX "CarePlanTextPersonalisationToken_token_key" ON "care_pathway"."CarePlanTextPersonalisationToken"("token");

CREATE INDEX "PathwayChecklist_deletedAt_idx" ON "care_pathway"."PathwayChecklist"("deletedAt");
CREATE INDEX "PathwayChecklist_name_idx" ON "care_pathway"."PathwayChecklist"("name");

CREATE INDEX "PathwayChecklistItem_checklistId_idx" ON "care_pathway"."PathwayChecklistItem"("checklistId");
CREATE INDEX "PathwayChecklistItem_deletedAt_idx" ON "care_pathway"."PathwayChecklistItem"("deletedAt");

CREATE INDEX "PathwayAction_deletedAt_idx" ON "care_pathway"."PathwayAction"("deletedAt");
CREATE INDEX "PathwayAction_actionName_idx" ON "care_pathway"."PathwayAction"("actionName");
CREATE INDEX "PathwayAction_actionType_idx" ON "care_pathway"."PathwayAction"("actionType");

CREATE UNIQUE INDEX "PathwayActionChecklistLink_pathwayActionId_checklistId_key" ON "care_pathway"."PathwayActionChecklistLink"("pathwayActionId", "checklistId");

CREATE INDEX "PathwayActionObservationLink_pathwayActionId_idx" ON "care_pathway"."PathwayActionObservationLink"("pathwayActionId");

CREATE UNIQUE INDEX "CarePictureCategory_code_key" ON "care_pathway"."CarePictureCategory"("code");

CREATE INDEX "CarePicture_deletedAt_idx" ON "care_pathway"."CarePicture"("deletedAt");
CREATE INDEX "CarePicture_name_idx" ON "care_pathway"."CarePicture"("name");
CREATE INDEX "CarePicture_type_idx" ON "care_pathway"."CarePicture"("type");

-- AddForeignKey
ALTER TABLE "care_pathway"."CarePathwayForm" ADD CONSTRAINT "CarePathwayForm_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "care_pathway"."CarePathwayFormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."CarePathwayFormVersion" ADD CONSTRAINT "CarePathwayFormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."CarePathwayFormSection" ADD CONSTRAINT "CarePathwayFormSection_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "care_pathway"."CarePathwayFormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."CarePathwayFormField" ADD CONSTRAINT "CarePathwayFormField_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "care_pathway"."CarePathwayFormSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."CarePathwayFormPublishLog" ADD CONSTRAINT "CarePathwayFormPublishLog_formId_fkey" FOREIGN KEY ("formId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "care_pathway"."CarePathwayFormPublishLog" ADD CONSTRAINT "CarePathwayFormPublishLog_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "care_pathway"."CarePathwayFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."DefaultFormSelection" ADD CONSTRAINT "DefaultFormSelection_formId_fkey" FOREIGN KEY ("formId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."CarePlanTextTemplate" ADD CONSTRAINT "CarePlanTextTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "care_pathway"."CarePlanTextCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "care_pathway"."CarePlanTextTemplate" ADD CONSTRAINT "CarePlanTextTemplate_formId_fkey" FOREIGN KEY ("formId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."PathwayChecklistItem" ADD CONSTRAINT "PathwayChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "care_pathway"."PathwayChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."PathwayActionChecklistLink" ADD CONSTRAINT "PathwayActionChecklistLink_pathwayActionId_fkey" FOREIGN KEY ("pathwayActionId") REFERENCES "care_pathway"."PathwayAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_pathway"."PathwayActionChecklistLink" ADD CONSTRAINT "PathwayActionChecklistLink_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "care_pathway"."PathwayChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."PathwayActionObservationLink" ADD CONSTRAINT "PathwayActionObservationLink_pathwayActionId_fkey" FOREIGN KEY ("pathwayActionId") REFERENCES "care_pathway"."PathwayAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "care_pathway"."CarePicture" ADD CONSTRAINT "CarePicture_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "care_pathway"."CarePictureCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
