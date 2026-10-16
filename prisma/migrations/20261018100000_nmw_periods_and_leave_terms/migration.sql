-- Q37-Q39 and Q35: minimum wage by pay reference period, and holiday entitlement terms.
-- Additive only: three new tables and one nullable column. No existing row is changed.
--  * NmwPeriodAssessment: per pay run, worker and pay reference period. Runs calculated before this
--    migration have no rows; their minimum wage lines stay exactly as they were paid.
--  * EmployeePayrollProfile.apprenticeshipStartDate: nobody is given a date.
--  * EmployeeLeaveTerms / EmployeeLeaveEntry: no terms are created, so no entitlement is invented.
-- Rollback: drop the three tables and the column. Assessments are working records of open runs
-- and the evidence of locked ones: dropping them loses that evidence, so it is not a routine step.

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollProfile" ADD COLUMN     "apprenticeshipStartDate" DATE;

-- CreateTable
CREATE TABLE "billing"."NmwPeriodAssessment" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "periodSource" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ageAtPeriodStart" INTEGER,
    "requiredHourly" DECIMAL(8,4) NOT NULL,
    "eligiblePay" DECIMAL(12,2) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "periodPay" DECIMAL(12,2) NOT NULL,
    "periodMinutes" INTEGER NOT NULL,
    "topUpAlreadyPaid" DECIMAL(12,2) NOT NULL,
    "topUpInRun" DECIMAL(12,2) NOT NULL,
    "compliant" BOOLEAN NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NmwPeriodAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll"."EmployeeLeaveTerms" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workerCategory" TEXT NOT NULL,
    "leaveYearStartMonth" INTEGER NOT NULL,
    "leaveYearStartDay" INTEGER NOT NULL DEFAULT 1,
    "weeklyHours" DECIMAL(6,2),
    "contractualExtraHours" DECIMAL(8,2),
    "payMethod" TEXT NOT NULL,
    "carryOverMaxHours" DECIMAL(8,2),
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLeaveTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll"."EmployeeLeaveEntry" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "entryType" TEXT NOT NULL,
    "entitlementType" TEXT NOT NULL DEFAULT 'STATUTORY',
    "hours" DECIMAL(8,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLeaveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NmwPeriodAssessment_employeeId_periodStart_idx" ON "billing"."NmwPeriodAssessment"("employeeId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "NmwPeriodAssessment_payrollRunId_employeeId_periodStart_key" ON "billing"."NmwPeriodAssessment"("payrollRunId", "employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "EmployeeLeaveTerms_employeeId_effectiveFrom_idx" ON "payroll"."EmployeeLeaveTerms"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeLeaveEntry_employeeId_date_idx" ON "payroll"."EmployeeLeaveEntry"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "billing"."NmwPeriodAssessment" ADD CONSTRAINT "NmwPeriodAssessment_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "billing"."PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

