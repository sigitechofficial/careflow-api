-- CreateEnum
CREATE TYPE "scheduling"."CallOffVisitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "scheduling"."CallOffVisit" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID,
    "scheduledVisitId" UUID,
    "serviceUserId" UUID NOT NULL,
    "callOffDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "scheduling"."CallOffVisitStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CallOffVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallOffVisit_scheduledJobId_idx" ON "scheduling"."CallOffVisit"("scheduledJobId");
CREATE INDEX "CallOffVisit_scheduledVisitId_idx" ON "scheduling"."CallOffVisit"("scheduledVisitId");
CREATE INDEX "CallOffVisit_serviceUserId_idx" ON "scheduling"."CallOffVisit"("serviceUserId");
CREATE INDEX "CallOffVisit_callOffDate_idx" ON "scheduling"."CallOffVisit"("callOffDate");
CREATE INDEX "CallOffVisit_status_idx" ON "scheduling"."CallOffVisit"("status");
CREATE INDEX "CallOffVisit_deletedAt_idx" ON "scheduling"."CallOffVisit"("deletedAt");
CREATE INDEX "CallOffVisit_isActive_idx" ON "scheduling"."CallOffVisit"("isActive");

-- AddForeignKey
ALTER TABLE "scheduling"."CallOffVisit" ADD CONSTRAINT "CallOffVisit_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."CallOffVisit" ADD CONSTRAINT "CallOffVisit_scheduledVisitId_fkey" FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."CallOffVisit" ADD CONSTRAINT "CallOffVisit_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduling"."CallOffVisit" ADD CONSTRAINT "CallOffVisit_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."CallOffVisit" ADD CONSTRAINT "CallOffVisit_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
