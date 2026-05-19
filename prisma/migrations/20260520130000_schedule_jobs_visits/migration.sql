-- CreateEnum
CREATE TYPE "scheduling"."ScheduledJobStatus" AS ENUM ('DRAFT', 'UNALLOCATED', 'ALLOCATED', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'MISSED', 'CANCELLED', 'CALLED_OFF', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "scheduling"."ScheduledJobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "scheduling"."ScheduledVisitStatus" AS ENUM ('PLANNED', 'STARTED', 'COMPLETED', 'MISSED', 'CANCELLED', 'CALLED_OFF', 'PARTIALLY_COMPLETED', 'NEEDS_ATTENTION');

-- CreateTable
CREATE TABLE "scheduling"."ScheduleRun" (
    "id" UUID NOT NULL,
    "scheduleBatchId" UUID NOT NULL,
    "scheduleAreaId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "runDate" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."ScheduledJob" (
    "id" UUID NOT NULL,
    "scheduleBatchId" UUID NOT NULL,
    "scheduleAreaId" UUID,
    "scheduleRunId" UUID,
    "serviceUserId" UUID NOT NULL,
    "jobName" TEXT NOT NULL,
    "description" TEXT,
    "scheduledStartDateTime" TIMESTAMP(3) NOT NULL,
    "scheduledEndDateTime" TIMESTAMP(3),
    "estimatedDurationMinutes" INTEGER,
    "requiredCarers" INTEGER NOT NULL DEFAULT 1,
    "priority" "scheduling"."ScheduledJobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "scheduling"."ScheduledJobStatus" NOT NULL DEFAULT 'DRAFT',
    "postcode" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "timePeriodColor" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."ScheduledVisit" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "visitName" TEXT NOT NULL,
    "scheduledStartDateTime" TIMESTAMP(3) NOT NULL,
    "scheduledEndDateTime" TIMESTAMP(3),
    "actualStartDateTime" TIMESTAMP(3),
    "actualEndDateTime" TIMESTAMP(3),
    "status" "scheduling"."ScheduledVisitStatus" NOT NULL DEFAULT 'PLANNED',
    "requiredCarers" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "medicationRequired" BOOLEAN NOT NULL DEFAULT false,
    "checklistRequired" BOOLEAN NOT NULL DEFAULT false,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "notesRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ScheduledVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."VisitAction" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID,
    "scheduledVisitId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "actionType" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "status" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VisitAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleRun_scheduleBatchId_idx" ON "scheduling"."ScheduleRun"("scheduleBatchId");
CREATE INDEX "ScheduleRun_scheduleAreaId_idx" ON "scheduling"."ScheduleRun"("scheduleAreaId");
CREATE INDEX "ScheduleRun_runDate_idx" ON "scheduling"."ScheduleRun"("runDate");
CREATE INDEX "ScheduleRun_deletedAt_idx" ON "scheduling"."ScheduleRun"("deletedAt");
CREATE INDEX "ScheduleRun_isActive_idx" ON "scheduling"."ScheduleRun"("isActive");

CREATE INDEX "ScheduledJob_scheduleBatchId_idx" ON "scheduling"."ScheduledJob"("scheduleBatchId");
CREATE INDEX "ScheduledJob_scheduleAreaId_idx" ON "scheduling"."ScheduledJob"("scheduleAreaId");
CREATE INDEX "ScheduledJob_scheduleRunId_idx" ON "scheduling"."ScheduledJob"("scheduleRunId");
CREATE INDEX "ScheduledJob_serviceUserId_idx" ON "scheduling"."ScheduledJob"("serviceUserId");
CREATE INDEX "ScheduledJob_status_idx" ON "scheduling"."ScheduledJob"("status");
CREATE INDEX "ScheduledJob_priority_idx" ON "scheduling"."ScheduledJob"("priority");
CREATE INDEX "ScheduledJob_scheduledStartDateTime_idx" ON "scheduling"."ScheduledJob"("scheduledStartDateTime");
CREATE INDEX "ScheduledJob_postcode_idx" ON "scheduling"."ScheduledJob"("postcode");
CREATE INDEX "ScheduledJob_deletedAt_idx" ON "scheduling"."ScheduledJob"("deletedAt");
CREATE INDEX "ScheduledJob_isActive_idx" ON "scheduling"."ScheduledJob"("isActive");

CREATE INDEX "ScheduledVisit_scheduledJobId_idx" ON "scheduling"."ScheduledVisit"("scheduledJobId");
CREATE INDEX "ScheduledVisit_serviceUserId_idx" ON "scheduling"."ScheduledVisit"("serviceUserId");
CREATE INDEX "ScheduledVisit_status_idx" ON "scheduling"."ScheduledVisit"("status");
CREATE INDEX "ScheduledVisit_scheduledStartDateTime_idx" ON "scheduling"."ScheduledVisit"("scheduledStartDateTime");
CREATE INDEX "ScheduledVisit_deletedAt_idx" ON "scheduling"."ScheduledVisit"("deletedAt");
CREATE INDEX "ScheduledVisit_isActive_idx" ON "scheduling"."ScheduledVisit"("isActive");

CREATE INDEX "VisitAction_scheduledJobId_idx" ON "scheduling"."VisitAction"("scheduledJobId");
CREATE INDEX "VisitAction_scheduledVisitId_idx" ON "scheduling"."VisitAction"("scheduledVisitId");
CREATE INDEX "VisitAction_deletedAt_idx" ON "scheduling"."VisitAction"("deletedAt");
CREATE INDEX "VisitAction_isActive_idx" ON "scheduling"."VisitAction"("isActive");

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleRun" ADD CONSTRAINT "ScheduleRun_scheduleBatchId_fkey" FOREIGN KEY ("scheduleBatchId") REFERENCES "scheduling"."ScheduleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduleRun" ADD CONSTRAINT "ScheduleRun_scheduleAreaId_fkey" FOREIGN KEY ("scheduleAreaId") REFERENCES "scheduling"."ScheduleArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduleRun" ADD CONSTRAINT "ScheduleRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduleRun" ADD CONSTRAINT "ScheduleRun_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduleRun" ADD CONSTRAINT "ScheduleRun_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_scheduleBatchId_fkey" FOREIGN KEY ("scheduleBatchId") REFERENCES "scheduling"."ScheduleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_scheduleAreaId_fkey" FOREIGN KEY ("scheduleAreaId") REFERENCES "scheduling"."ScheduleArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_scheduleRunId_fkey" FOREIGN KEY ("scheduleRunId") REFERENCES "scheduling"."ScheduleRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJob" ADD CONSTRAINT "ScheduledJob_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduling"."ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledVisit" ADD CONSTRAINT "ScheduledVisit_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduling"."VisitAction" ADD CONSTRAINT "VisitAction_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitAction" ADD CONSTRAINT "VisitAction_scheduledVisitId_fkey" FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitAction" ADD CONSTRAINT "VisitAction_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
