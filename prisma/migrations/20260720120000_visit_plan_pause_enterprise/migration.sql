-- CreateEnum
CREATE TYPE "service_users"."VisitPlanStatusEventType" AS ENUM ('SUSPENDED', 'REACTIVATED', 'ENDED');

-- CreateTable
CREATE TABLE "service_users"."VisitPlanPauseReasonCatalog" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "suggestsUseAbsence" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitPlanPauseReasonCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitPlanPauseReasonCatalog_code_key" ON "service_users"."VisitPlanPauseReasonCatalog"("code");

-- CreateIndex
CREATE INDEX "VisitPlanPauseReasonCatalog_isActive_idx" ON "service_users"."VisitPlanPauseReasonCatalog"("isActive");

-- AlterTable
ALTER TABLE "service_users"."ServiceUserVisitPlan" ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedById" UUID,
ADD COLUMN "pauseReasonCatalogId" UUID,
ADD COLUMN "expectedResumeAt" TIMESTAMP(3),
ADD COLUMN "suspensionReviewDueAt" TIMESTAMP(3),
ADD COLUMN "suspensionContingencyNotes" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "ServiceUserVisitPlan_pauseReasonCatalogId_idx" ON "service_users"."ServiceUserVisitPlan"("pauseReasonCatalogId");

-- CreateTable
CREATE TABLE "service_users"."VisitPlanStatusEvent" (
    "id" UUID NOT NULL,
    "visitPlanId" UUID NOT NULL,
    "eventType" "service_users"."VisitPlanStatusEventType" NOT NULL,
    "reason" TEXT NOT NULL,
    "pauseReasonCatalogId" UUID,
    "expectedResumeAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "contingencyNotes" TEXT NOT NULL DEFAULT '',
    "cancelFutureVisits" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "VisitPlanStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitPlanStatusEvent_visitPlanId_idx" ON "service_users"."VisitPlanStatusEvent"("visitPlanId");

-- CreateIndex
CREATE INDEX "VisitPlanStatusEvent_createdAt_idx" ON "service_users"."VisitPlanStatusEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserVisitPlan" ADD CONSTRAINT "ServiceUserVisitPlan_pauseReasonCatalogId_fkey" FOREIGN KEY ("pauseReasonCatalogId") REFERENCES "service_users"."VisitPlanPauseReasonCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."VisitPlanStatusEvent" ADD CONSTRAINT "VisitPlanStatusEvent_visitPlanId_fkey" FOREIGN KEY ("visitPlanId") REFERENCES "service_users"."ServiceUserVisitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."VisitPlanStatusEvent" ADD CONSTRAINT "VisitPlanStatusEvent_pauseReasonCatalogId_fkey" FOREIGN KEY ("pauseReasonCatalogId") REFERENCES "service_users"."VisitPlanPauseReasonCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed pause reason catalog
INSERT INTO "service_users"."VisitPlanPauseReasonCatalog" ("id", "name", "code", "sortOrder", "isActive", "suggestsUseAbsence", "createdAt", "updatedAt") VALUES
  ('a1000001-0001-4001-8001-000000000001', 'Hospital / inpatient care', 'HOSPITAL', 1, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000001-0001-4001-8001-000000000002', 'Holiday / temporary away', 'HOLIDAY', 2, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000001-0001-4001-8001-000000000003', 'Funding / commissioning review', 'FUNDING', 3, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000001-0001-4001-8001-000000000004', 'Safeguarding / risk management', 'SAFEGUARDING', 4, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000001-0001-4001-8001-000000000005', 'Commissioner / purchaser request', 'COMMISSIONER', 5, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000001-0001-4001-8001-000000000006', 'Package review (clinical / operational)', 'SERVICE_REVIEW', 6, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000001-0001-4001-8001-000000000007', 'Other', 'OTHER', 7, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
