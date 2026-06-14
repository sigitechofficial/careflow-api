-- Service user care plan instances, drafts, and published versions
CREATE TYPE "service_users"."ServiceUserCarePlanInstanceStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "service_users"."ServiceUserCarePlanInstance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serviceUserId" UUID NOT NULL,
    "carePathwayFormId" UUID NOT NULL,
    "carePathwayFormVersionId" UUID,
    "status" "service_users"."ServiceUserCarePlanInstanceStatus" NOT NULL DEFAULT 'DRAFT',
    "nextReviewDueAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "lastReviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserCarePlanInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserCarePlanDraft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "instanceId" UUID NOT NULL,
    "valuesJson" JSONB NOT NULL DEFAULT '{}',
    "composedFromJson" JSONB,
    "gapsJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserCarePlanDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserCarePlanPublishedVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "instanceId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "valuesJson" JSONB NOT NULL,
    "composedFromJson" JSONB,
    "summary" TEXT,
    "signaturesJson" JSONB,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserCarePlanPublishedVersion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "service_users"."CarePlanAssessmentLink" ADD COLUMN "carePlanInstanceId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserCarePlanInstance_serviceUserId_carePathwayFormId_key" ON "service_users"."ServiceUserCarePlanInstance"("serviceUserId", "carePathwayFormId");

-- CreateIndex
CREATE INDEX "ServiceUserCarePlanInstance_serviceUserId_idx" ON "service_users"."ServiceUserCarePlanInstance"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserCarePlanInstance_carePathwayFormId_idx" ON "service_users"."ServiceUserCarePlanInstance"("carePathwayFormId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserCarePlanDraft_instanceId_key" ON "service_users"."ServiceUserCarePlanDraft"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserCarePlanPublishedVersion_instanceId_versionNumber_key" ON "service_users"."ServiceUserCarePlanPublishedVersion"("instanceId", "versionNumber");

-- CreateIndex
CREATE INDEX "ServiceUserCarePlanPublishedVersion_instanceId_idx" ON "service_users"."ServiceUserCarePlanPublishedVersion"("instanceId");

-- CreateIndex
CREATE INDEX "ServiceUserAssessmentCompletion_carePlanInstanceId_idx" ON "service_users"."ServiceUserAssessmentCompletion"("carePlanInstanceId");

-- CreateIndex
CREATE INDEX "CarePlanAssessmentLink_carePlanInstanceId_idx" ON "service_users"."CarePlanAssessmentLink"("carePlanInstanceId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ADD CONSTRAINT "ServiceUserCarePlanInstance_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ADD CONSTRAINT "ServiceUserCarePlanInstance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ADD CONSTRAINT "ServiceUserCarePlanInstance_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanInstance" ADD CONSTRAINT "ServiceUserCarePlanInstance_lastReviewedById_fkey" FOREIGN KEY ("lastReviewedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanDraft" ADD CONSTRAINT "ServiceUserCarePlanDraft_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanDraft" ADD CONSTRAINT "ServiceUserCarePlanDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanPublishedVersion" ADD CONSTRAINT "ServiceUserCarePlanPublishedVersion_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCarePlanPublishedVersion" ADD CONSTRAINT "ServiceUserCarePlanPublishedVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" ADD CONSTRAINT "ServiceUserAssessmentCompletion_carePlanInstanceId_fkey" FOREIGN KEY ("carePlanInstanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" ADD CONSTRAINT "CarePlanAssessmentLink_carePlanInstanceId_fkey" FOREIGN KEY ("carePlanInstanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
