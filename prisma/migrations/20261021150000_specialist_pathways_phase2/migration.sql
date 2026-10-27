-- CreateEnum
CREATE TYPE "service_users"."SpecialistPathwayRiskStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "service_users"."SpecialistPathwayReviewOutcome" AS ENUM ('NO_CHANGE', 'PLAN_UPDATE_NEEDED', 'ESCALATED', 'CASE_CLOSED');

-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayRisk" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "controls" TEXT,
    "reviewDate" TIMESTAMP(3),
    "status" "service_users"."SpecialistPathwayRiskStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpecialistPathwayRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayReview" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" UUID,
    "outcome" "service_users"."SpecialistPathwayReviewOutcome" NOT NULL,
    "notes" TEXT,
    "nextReviewDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialistPathwayReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayEvent" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "userId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialistPathwayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialistPathwayRisk_caseId_idx" ON "service_users"."SpecialistPathwayRisk"("caseId");

-- CreateIndex
CREATE INDEX "SpecialistPathwayReview_caseId_idx" ON "service_users"."SpecialistPathwayReview"("caseId");

-- CreateIndex
CREATE INDEX "SpecialistPathwayEvent_caseId_idx" ON "service_users"."SpecialistPathwayEvent"("caseId");

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayRisk" ADD CONSTRAINT "SpecialistPathwayRisk_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "service_users"."SpecialistPathwayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayReview" ADD CONSTRAINT "SpecialistPathwayReview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "service_users"."SpecialistPathwayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayEvent" ADD CONSTRAINT "SpecialistPathwayEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "service_users"."SpecialistPathwayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

