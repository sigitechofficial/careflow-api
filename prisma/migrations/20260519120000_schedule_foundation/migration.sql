-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "scheduling";

-- CreateEnum
CREATE TYPE "scheduling"."ScheduleStatus" AS ENUM ('NOT_BUILT', 'BUILDING', 'BUILT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "scheduling"."ScheduleBuildSource" AS ENUM ('TEMPLATE', 'WITHOUT_TEMPLATE', 'MANUAL');

-- CreateTable
CREATE TABLE "scheduling"."ScheduleArea" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "locationId" UUID,
    "zoneId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ScheduleArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."ScheduleBatch" (
    "id" UUID NOT NULL,
    "scheduleDate" DATE NOT NULL,
    "name" TEXT,
    "status" "scheduling"."ScheduleStatus" NOT NULL DEFAULT 'NOT_BUILT',
    "buildSource" "scheduling"."ScheduleBuildSource",
    "templateId" UUID,
    "builtAt" TIMESTAMP(3),
    "builtById" UUID,
    "notes" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ScheduleBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."ScheduleAreaStatus" (
    "id" UUID NOT NULL,
    "scheduleBatchId" UUID NOT NULL,
    "scheduleAreaId" UUID NOT NULL,
    "status" "scheduling"."ScheduleStatus" NOT NULL DEFAULT 'NOT_BUILT',
    "builtAt" TIMESTAMP(3),
    "builtById" UUID,
    "notes" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleAreaStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleArea_code_key" ON "scheduling"."ScheduleArea"("code");

-- CreateIndex
CREATE INDEX "ScheduleArea_deletedAt_idx" ON "scheduling"."ScheduleArea"("deletedAt");

-- CreateIndex
CREATE INDEX "ScheduleArea_isActive_idx" ON "scheduling"."ScheduleArea"("isActive");

-- CreateIndex
CREATE INDEX "ScheduleArea_locationId_idx" ON "scheduling"."ScheduleArea"("locationId");

-- CreateIndex
CREATE INDEX "ScheduleArea_zoneId_idx" ON "scheduling"."ScheduleArea"("zoneId");

-- CreateIndex
CREATE INDEX "ScheduleBatch_scheduleDate_idx" ON "scheduling"."ScheduleBatch"("scheduleDate");

-- CreateIndex
CREATE INDEX "ScheduleBatch_status_idx" ON "scheduling"."ScheduleBatch"("status");

-- CreateIndex
CREATE INDEX "ScheduleBatch_deletedAt_idx" ON "scheduling"."ScheduleBatch"("deletedAt");

-- CreateIndex
CREATE INDEX "ScheduleBatch_isActive_idx" ON "scheduling"."ScheduleBatch"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAreaStatus_scheduleBatchId_scheduleAreaId_key" ON "scheduling"."ScheduleAreaStatus"("scheduleBatchId", "scheduleAreaId");

-- CreateIndex
CREATE INDEX "ScheduleAreaStatus_scheduleBatchId_idx" ON "scheduling"."ScheduleAreaStatus"("scheduleBatchId");

-- CreateIndex
CREATE INDEX "ScheduleAreaStatus_scheduleAreaId_idx" ON "scheduling"."ScheduleAreaStatus"("scheduleAreaId");

-- CreateIndex
CREATE INDEX "ScheduleAreaStatus_status_idx" ON "scheduling"."ScheduleAreaStatus"("status");

-- CreateIndex
CREATE INDEX "ScheduleAreaStatus_deletedAt_idx" ON "scheduling"."ScheduleAreaStatus"("deletedAt");

-- Partial unique: one active batch per schedule date
CREATE UNIQUE INDEX "ScheduleBatch_scheduleDate_active_key"
ON "scheduling"."ScheduleBatch"("scheduleDate")
WHERE "deletedAt" IS NULL AND "isActive" = true;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleArea" ADD CONSTRAINT "ScheduleArea_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleArea" ADD CONSTRAINT "ScheduleArea_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "lookups"."Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleArea" ADD CONSTRAINT "ScheduleArea_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleArea" ADD CONSTRAINT "ScheduleArea_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleArea" ADD CONSTRAINT "ScheduleArea_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleBatch" ADD CONSTRAINT "ScheduleBatch_builtById_fkey" FOREIGN KEY ("builtById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleBatch" ADD CONSTRAINT "ScheduleBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleBatch" ADD CONSTRAINT "ScheduleBatch_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleBatch" ADD CONSTRAINT "ScheduleBatch_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleAreaStatus" ADD CONSTRAINT "ScheduleAreaStatus_scheduleBatchId_fkey" FOREIGN KEY ("scheduleBatchId") REFERENCES "scheduling"."ScheduleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleAreaStatus" ADD CONSTRAINT "ScheduleAreaStatus_scheduleAreaId_fkey" FOREIGN KEY ("scheduleAreaId") REFERENCES "scheduling"."ScheduleArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleAreaStatus" ADD CONSTRAINT "ScheduleAreaStatus_builtById_fkey" FOREIGN KEY ("builtById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
