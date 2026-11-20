-- Governance -> Mock CQC inspection: a service scores each quality statement 1-4 against the active
-- CQC framework version; ratings come from the version's scoringRules (seed file `scoring`).
-- Additive only: one nullable column on CqcFrameworkVersion, new enums and tables.

-- CreateEnum
CREATE TYPE "quality"."CqcMockInspectionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "quality"."CqcMockActionStatus" AS ENUM ('OPEN', 'DONE');

-- AlterTable
ALTER TABLE "quality"."CqcFrameworkVersion" ADD COLUMN     "scoringRules" JSONB;

-- CreateTable
CREATE TABLE "quality"."CqcMockInspection" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "locationId" UUID,
    "title" TEXT NOT NULL,
    "status" "quality"."CqcMockInspectionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "leadReviewerId" UUID,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "result" JSONB,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcMockInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcMockInspectionStatement" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "score" INTEGER,
    "strengths" TEXT,
    "concerns" TEXT,
    "notes" TEXT,
    "evidenceSnapshot" JSONB,
    "snapshotAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcMockInspectionStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."CqcMockInspectionAction" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "statementId" UUID,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "ownerId" UUID,
    "dueAt" TIMESTAMP(3),
    "status" "quality"."CqcMockActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcMockInspectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CqcMockInspection_locationId_idx" ON "quality"."CqcMockInspection"("locationId");

-- CreateIndex
CREATE INDEX "CqcMockInspection_status_idx" ON "quality"."CqcMockInspection"("status");

-- CreateIndex
CREATE INDEX "CqcMockInspectionStatement_statementId_idx" ON "quality"."CqcMockInspectionStatement"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "CqcMockInspectionStatement_inspectionId_statementId_key" ON "quality"."CqcMockInspectionStatement"("inspectionId", "statementId");

-- CreateIndex
CREATE INDEX "CqcMockInspectionAction_inspectionId_idx" ON "quality"."CqcMockInspectionAction"("inspectionId");

-- CreateIndex
CREATE INDEX "CqcMockInspectionAction_status_dueAt_idx" ON "quality"."CqcMockInspectionAction"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "quality"."CqcMockInspection" ADD CONSTRAINT "CqcMockInspection_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "quality"."CqcFrameworkVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcMockInspectionStatement" ADD CONSTRAINT "CqcMockInspectionStatement_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality"."CqcMockInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcMockInspectionStatement" ADD CONSTRAINT "CqcMockInspectionStatement_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "quality"."CqcQualityStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcMockInspectionAction" ADD CONSTRAINT "CqcMockInspectionAction_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality"."CqcMockInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."CqcMockInspectionAction" ADD CONSTRAINT "CqcMockInspectionAction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "quality"."CqcQualityStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

