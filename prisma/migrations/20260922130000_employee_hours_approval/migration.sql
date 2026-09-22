-- CreateEnum
CREATE TYPE "service_users"."EmployeeHoursApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
-- CreateTable
CREATE TABLE "service_users"."EmployeeHoursApproval" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "visitPlanId" UUID NOT NULL,
    "visitPlanSlotId" UUID,
    "status" "service_users"."EmployeeHoursApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "contractedWeeklyHours" DOUBLE PRECISION,
    "projectedWeeklyHours" DOUBLE PRECISION,
    "extraHours" DOUBLE PRECISION,
    "reason" TEXT,
    "requestedById" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeHoursApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeHoursApproval_status_idx" ON "service_users"."EmployeeHoursApproval"("status");

-- CreateIndex
CREATE INDEX "EmployeeHoursApproval_employeeId_idx" ON "service_users"."EmployeeHoursApproval"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeHoursApproval_serviceUserId_idx" ON "service_users"."EmployeeHoursApproval"("serviceUserId");

-- CreateIndex
CREATE INDEX "EmployeeHoursApproval_visitPlanSlotId_idx" ON "service_users"."EmployeeHoursApproval"("visitPlanSlotId");
