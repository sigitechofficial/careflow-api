-- CreateEnum
CREATE TYPE "service_users"."SpecialistPathwayType" AS ENUM ('LEARNING_DISABILITY', 'DEMENTIA', 'END_OF_LIFE', 'CHILDREN', 'SUPPORTED_LIVING');

-- CreateEnum
CREATE TYPE "service_users"."SpecialistPathwayStatus" AS ENUM ('OPEN', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "service_users"."SpecialistPathwayPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayCase" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "pathwayType" "service_users"."SpecialistPathwayType" NOT NULL,
    "ref" TEXT NOT NULL,
    "status" "service_users"."SpecialistPathwayStatus" NOT NULL DEFAULT 'OPEN',
    "reviewDueDate" TIMESTAMP(3),
    "sections" JSONB NOT NULL DEFAULT '{}',
    "closedReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "SpecialistPathwayCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayCarePlan" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "service_users"."SpecialistPathwayPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL DEFAULT '{}',
    "comment" TEXT,
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "SpecialistPathwayCarePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialistPathwayCase_serviceUserId_idx" ON "service_users"."SpecialistPathwayCase"("serviceUserId");

-- CreateIndex
CREATE INDEX "SpecialistPathwayCase_pathwayType_status_idx" ON "service_users"."SpecialistPathwayCase"("pathwayType", "status");

-- CreateIndex
CREATE INDEX "SpecialistPathwayCase_deletedAt_idx" ON "service_users"."SpecialistPathwayCase"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialistPathwayCase_pathwayType_ref_key" ON "service_users"."SpecialistPathwayCase"("pathwayType", "ref");

-- CreateIndex
CREATE INDEX "SpecialistPathwayCarePlan_caseId_idx" ON "service_users"."SpecialistPathwayCarePlan"("caseId");

-- CreateIndex
CREATE INDEX "SpecialistPathwayCarePlan_status_idx" ON "service_users"."SpecialistPathwayCarePlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialistPathwayCarePlan_caseId_version_key" ON "service_users"."SpecialistPathwayCarePlan"("caseId", "version");

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayCase" ADD CONSTRAINT "SpecialistPathwayCase_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayCarePlan" ADD CONSTRAINT "SpecialistPathwayCarePlan_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "service_users"."SpecialistPathwayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

