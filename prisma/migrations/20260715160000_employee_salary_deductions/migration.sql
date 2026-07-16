-- CreateEnum
CREATE TYPE "billing"."SalaryDeductionType" AS ENUM ('FINE', 'PENALTY');

-- CreateTable
CREATE TABLE "billing"."EmployeeSalaryDeduction" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "billing"."SalaryDeductionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "salaryMonth" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "EmployeeSalaryDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeSalaryDeduction_employeeId_salaryMonth_idx" ON "billing"."EmployeeSalaryDeduction"("employeeId", "salaryMonth");

-- CreateIndex
CREATE INDEX "EmployeeSalaryDeduction_type_idx" ON "billing"."EmployeeSalaryDeduction"("type");

-- CreateIndex
CREATE INDEX "EmployeeSalaryDeduction_deletedAt_idx" ON "billing"."EmployeeSalaryDeduction"("deletedAt");
