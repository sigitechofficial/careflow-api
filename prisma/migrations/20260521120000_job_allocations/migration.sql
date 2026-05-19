-- CreateEnum
CREATE TYPE "scheduling"."AllocationStatus" AS ENUM ('PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED', 'UNALLOCATED', 'CANCELLED');

-- CreateTable
CREATE TABLE "scheduling"."JobAllocation" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "scheduledVisitId" UUID,
    "employeeId" UUID NOT NULL,
    "status" "scheduling"."AllocationStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "warningTypes" JSONB,
    "warningMessages" JSONB,
    "notes" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedById" UUID,
    "unallocatedAt" TIMESTAMP(3),
    "unallocatedById" UUID,
    "unallocationReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JobAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobAllocation_scheduledJobId_idx" ON "scheduling"."JobAllocation"("scheduledJobId");
CREATE INDEX "JobAllocation_scheduledVisitId_idx" ON "scheduling"."JobAllocation"("scheduledVisitId");
CREATE INDEX "JobAllocation_employeeId_idx" ON "scheduling"."JobAllocation"("employeeId");
CREATE INDEX "JobAllocation_status_idx" ON "scheduling"."JobAllocation"("status");
CREATE INDEX "JobAllocation_deletedAt_idx" ON "scheduling"."JobAllocation"("deletedAt");
CREATE INDEX "JobAllocation_isActive_idx" ON "scheduling"."JobAllocation"("isActive");

-- One active allocation per job + employee
CREATE UNIQUE INDEX "JobAllocation_scheduledJobId_employeeId_active_key"
ON "scheduling"."JobAllocation"("scheduledJobId", "employeeId")
WHERE "deletedAt" IS NULL
  AND "isActive" = true
  AND "status" IN ('PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED');

-- AddForeignKey
ALTER TABLE "scheduling"."JobAllocation" ADD CONSTRAINT "JobAllocation_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."JobAllocation" ADD CONSTRAINT "JobAllocation_scheduledVisitId_fkey" FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."JobAllocation" ADD CONSTRAINT "JobAllocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduling"."JobAllocation" ADD CONSTRAINT "JobAllocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."JobAllocation" ADD CONSTRAINT "JobAllocation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."JobAllocation" ADD CONSTRAINT "JobAllocation_unallocatedById_fkey" FOREIGN KEY ("unallocatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
