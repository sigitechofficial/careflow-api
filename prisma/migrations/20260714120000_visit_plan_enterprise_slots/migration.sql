-- Visit plan enterprise: slot lifecycle, carer assignments, exceptions, allocation times

CREATE TYPE "service_users"."VisitPlanSlotKind" AS ENUM ('STANDARD', 'OVERNIGHT', 'ONE_OFF');
CREATE TYPE "service_users"."VisitPlanSlotCarerRole" AS ENUM ('LEAD', 'SECONDARY');
CREATE TYPE "service_users"."VisitPlanSlotExceptionType" AS ENUM ('SKIP', 'EXTRA');

ALTER TABLE "service_users"."VisitPlanSlot"
  ADD COLUMN "slotKind" "service_users"."VisitPlanSlotKind" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "slotEffectiveFrom" TIMESTAMP(3),
  ADD COLUMN "slotEffectiveTo" TIMESTAMP(3),
  ADD COLUMN "oneOffDate" TIMESTAMP(3),
  ADD COLUMN "allowBackfillDays" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "VisitPlanSlot_slotEffectiveFrom_idx" ON "service_users"."VisitPlanSlot"("slotEffectiveFrom");
CREATE INDEX "VisitPlanSlot_slotEffectiveTo_idx" ON "service_users"."VisitPlanSlot"("slotEffectiveTo");

CREATE TABLE "service_users"."VisitPlanSlotCarerAssignment" (
  "id" UUID NOT NULL,
  "visitPlanSlotId" UUID NOT NULL,
  "dayOfWeek" INTEGER,
  "employeeId" UUID NOT NULL,
  "role" "service_users"."VisitPlanSlotCarerRole" NOT NULL DEFAULT 'SECONDARY',
  "durationMinutes" INTEGER,
  "plannedStartTime" TEXT,
  "plannedEndTime" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VisitPlanSlotCarerAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitPlanSlotCarerAssignment_visitPlanSlotId_idx" ON "service_users"."VisitPlanSlotCarerAssignment"("visitPlanSlotId");
CREATE INDEX "VisitPlanSlotCarerAssignment_employeeId_idx" ON "service_users"."VisitPlanSlotCarerAssignment"("employeeId");
CREATE INDEX "VisitPlanSlotCarerAssignment_visitPlanSlotId_dayOfWeek_idx" ON "service_users"."VisitPlanSlotCarerAssignment"("visitPlanSlotId", "dayOfWeek");

ALTER TABLE "service_users"."VisitPlanSlotCarerAssignment"
  ADD CONSTRAINT "VisitPlanSlotCarerAssignment_visitPlanSlotId_fkey"
    FOREIGN KEY ("visitPlanSlotId") REFERENCES "service_users"."VisitPlanSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "VisitPlanSlotCarerAssignment_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."VisitPlanSlotException" (
  "id" UUID NOT NULL,
  "visitPlanSlotId" UUID NOT NULL,
  "exceptionDate" TIMESTAMP(3) NOT NULL,
  "exceptionType" "service_users"."VisitPlanSlotExceptionType" NOT NULL,
  "plannedStartTime" TEXT,
  "plannedEndTime" TEXT,
  "durationMinutes" INTEGER,
  "requiredCarers" INTEGER,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VisitPlanSlotException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitPlanSlotException_visitPlanSlotId_exceptionDate_exceptionType_key"
  ON "service_users"."VisitPlanSlotException"("visitPlanSlotId", "exceptionDate", "exceptionType");
CREATE INDEX "VisitPlanSlotException_visitPlanSlotId_idx" ON "service_users"."VisitPlanSlotException"("visitPlanSlotId");
CREATE INDEX "VisitPlanSlotException_exceptionDate_idx" ON "service_users"."VisitPlanSlotException"("exceptionDate");

ALTER TABLE "service_users"."VisitPlanSlotException"
  ADD CONSTRAINT "VisitPlanSlotException_visitPlanSlotId_fkey"
    FOREIGN KEY ("visitPlanSlotId") REFERENCES "service_users"."VisitPlanSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduling"."JobAllocation"
  ADD COLUMN IF NOT EXISTS "scheduledStartDateTime" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledEndDateTime" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "isLeadCarer" BOOLEAN NOT NULL DEFAULT false;
