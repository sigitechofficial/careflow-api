-- CreateEnum
CREATE TYPE "scheduling"."ScheduleRunStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "scheduling"."ScheduleRun"
ADD COLUMN "employeeId" UUID,
ADD COLUMN "shiftType" TEXT,
ADD COLUMN "status" "scheduling"."ScheduleRunStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "scheduling"."ScheduledJob"
ADD COLUMN "runSequence" INTEGER;

-- CreateIndex
CREATE INDEX "ScheduleRun_employeeId_idx" ON "scheduling"."ScheduleRun"("employeeId");

-- CreateIndex
CREATE INDEX "ScheduleRun_status_idx" ON "scheduling"."ScheduleRun"("status");

-- CreateIndex
CREATE INDEX "ScheduledJob_scheduleRunId_runSequence_idx" ON "scheduling"."ScheduledJob"("scheduleRunId", "runSequence");

-- AddForeignKey
ALTER TABLE "scheduling"."ScheduleRun"
ADD CONSTRAINT "ScheduleRun_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
