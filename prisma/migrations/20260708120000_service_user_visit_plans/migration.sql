-- Service user visit plans (authorised care package / call pattern)

CREATE TYPE "service_users"."VisitPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED');

CREATE TABLE "service_users"."ServiceUserVisitPlan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serviceUserId" UUID NOT NULL,
    "status" "service_users"."VisitPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "weeklyContractedHours" TEXT,
    "numberOfCarers" INTEGER NOT NULL DEFAULT 1,
    "sourceSubmissionId" UUID,
    "reviewDueAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceUserVisitPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."VisitPlanSlot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visitPlanId" UUID NOT NULL,
    "slotCode" TEXT NOT NULL,
    "daysOfWeek" INTEGER[] NOT NULL,
    "plannedStartTime" TEXT NOT NULL,
    "plannedEndTime" TEXT NOT NULL,
    "requiredCarers" INTEGER NOT NULL DEFAULT 1,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "medicationRoundCode" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitPlanSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."VisitPlanAmendment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visitPlanId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshotBefore" JSONB NOT NULL,
    "snapshotAfter" JSONB NOT NULL,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendedById" UUID,

    CONSTRAINT "VisitPlanAmendment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "scheduling"."ScheduledVisit"
ADD COLUMN "visitPlanSlotId" UUID;

CREATE INDEX "ServiceUserVisitPlan_serviceUserId_idx" ON "service_users"."ServiceUserVisitPlan"("serviceUserId");
CREATE INDEX "ServiceUserVisitPlan_status_idx" ON "service_users"."ServiceUserVisitPlan"("status");
CREATE INDEX "ServiceUserVisitPlan_sourceSubmissionId_idx" ON "service_users"."ServiceUserVisitPlan"("sourceSubmissionId");
CREATE INDEX "ServiceUserVisitPlan_deletedAt_idx" ON "service_users"."ServiceUserVisitPlan"("deletedAt");

CREATE INDEX "VisitPlanSlot_visitPlanId_idx" ON "service_users"."VisitPlanSlot"("visitPlanId");
CREATE UNIQUE INDEX "VisitPlanSlot_visitPlanId_slotCode_key" ON "service_users"."VisitPlanSlot"("visitPlanId", "slotCode");

CREATE INDEX "VisitPlanAmendment_visitPlanId_idx" ON "service_users"."VisitPlanAmendment"("visitPlanId");
CREATE INDEX "VisitPlanAmendment_amendedAt_idx" ON "service_users"."VisitPlanAmendment"("amendedAt");

CREATE INDEX "ScheduledVisit_visitPlanSlotId_idx" ON "scheduling"."ScheduledVisit"("visitPlanSlotId");

ALTER TABLE "service_users"."ServiceUserVisitPlan"
ADD CONSTRAINT "ServiceUserVisitPlan_serviceUserId_fkey"
FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserVisitPlan"
ADD CONSTRAINT "ServiceUserVisitPlan_sourceSubmissionId_fkey"
FOREIGN KEY ("sourceSubmissionId") REFERENCES "service_users"."InitialAssessmentSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."VisitPlanSlot"
ADD CONSTRAINT "VisitPlanSlot_visitPlanId_fkey"
FOREIGN KEY ("visitPlanId") REFERENCES "service_users"."ServiceUserVisitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."VisitPlanAmendment"
ADD CONSTRAINT "VisitPlanAmendment_visitPlanId_fkey"
FOREIGN KEY ("visitPlanId") REFERENCES "service_users"."ServiceUserVisitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduling"."ScheduledVisit"
ADD CONSTRAINT "ScheduledVisit_visitPlanSlotId_fkey"
FOREIGN KEY ("visitPlanSlotId") REFERENCES "service_users"."VisitPlanSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
