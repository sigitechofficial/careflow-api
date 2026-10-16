-- Loan and pension completion (IMPLEMENTED BUT UNVERIFIED): loan declaration source, automatic
-- enrolment evidence, approved corrections of closed runs applied in later runs, and automatic
-- enrolment duty records. Additive only: nullable or default-0 columns and two new empty tables.
-- Nothing is backfilled: no loan declaration, enrolment history or correction is created.
-- Rollback: drop the new columns and tables.

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollProfile" ADD COLUMN     "loanDeclarationDate" DATE,
ADD COLUMN     "loanDeclarationSource" TEXT,
ADD COLUMN     "loanDeclarationStatus" TEXT,
ADD COLUMN     "pensionUkWorker" BOOLEAN,
ADD COLUMN     "statePensionAgeDate" DATE;

-- AlterTable
ALTER TABLE "payroll"."UkPayrollRunEmployee" ADD COLUMN     "aeCategory" TEXT,
ADD COLUMN     "aeExplanation" TEXT,
ADD COLUMN     "pensionEmployeeAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployerAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionSchemeRefApplied" TEXT,
ADD COLUMN     "postgraduateLoanAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "studentLoanAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payroll"."PayrollDeductionAdjustment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "taxYearId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceRunId" UUID NOT NULL,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "correctedAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposedById" UUID NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "appliedRunId" UUID,
    "appliedAt" TIMESTAMP(3),
    "activeKey" TEXT,

    CONSTRAINT "PayrollDeductionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll"."EmployeePensionAe" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "lastAssessedOn" DATE,
    "lastCategory" TEXT,
    "lastExplanation" TEXT,
    "lastRunId" UUID,
    "automaticEnrolmentDate" DATE,
    "enrolmentDeadline" DATE,
    "enrolmentNoticeSentOn" DATE,
    "postponementFrom" DATE,
    "postponementEndsOn" DATE,
    "postponementNoticeSentOn" DATE,
    "optInRequestedOn" DATE,
    "joiningRequestedOn" DATE,
    "optOutReceivedOn" DATE,
    "optOutEvidenceRef" TEXT,
    "ceasedOn" DATE,
    "reEnrolmentDueOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePensionAe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollDeductionAdjustment_activeKey_key" ON "payroll"."PayrollDeductionAdjustment"("activeKey");

-- CreateIndex
CREATE INDEX "PayrollDeductionAdjustment_employeeId_idx" ON "payroll"."PayrollDeductionAdjustment"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollDeductionAdjustment_appliedRunId_idx" ON "payroll"."PayrollDeductionAdjustment"("appliedRunId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePensionAe_employeeId_key" ON "payroll"."EmployeePensionAe"("employeeId");

