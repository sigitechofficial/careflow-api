-- Native UK Payroll foundation (additive). Distinct from billing."PayrollRun".

CREATE SCHEMA IF NOT EXISTS "payroll";

CREATE TYPE "payroll"."PayrollTaxYearStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');
CREATE TYPE "payroll"."PayrollPayFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'FOUR_WEEKLY', 'MONTHLY');
CREATE TYPE "payroll"."PayrollScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "payroll"."PayrollPeriodStatus" AS ENUM ('OPEN', 'IN_RUN', 'CLOSED');
CREATE TYPE "payroll"."EmployeePayrollProfileStatus" AS ENUM ('DRAFT', 'READY', 'SUSPENDED');
CREATE TYPE "payroll"."PayrollStarterDeclaration" AS ENUM (
  'UNKNOWN',
  'A_FIRST_JOB',
  'B_ONLY_JOB_THIS_YEAR',
  'C_HAS_ANOTHER_JOB_OR_PENSION'
);
CREATE TYPE "payroll"."PayrollNiCategory" AS ENUM (
  'A', 'B', 'C', 'F', 'H', 'I', 'J', 'L', 'M', 'S', 'V', 'Z', 'X'
);
CREATE TYPE "payroll"."EmployeePayAgreementBasis" AS ENUM ('HOURLY_CARE', 'SALARIED', 'HYBRID');
CREATE TYPE "payroll"."EmployeePayAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'TERMINATED');
CREATE TYPE "payroll"."UkPayrollRunStatus" AS ENUM ('DRAFT', 'EMPLOYEES_ENROLLED', 'CLOSED', 'CANCELLED');

CREATE TABLE "payroll"."PayrollTaxYear" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "status" "payroll"."PayrollTaxYearStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PayrollTaxYear_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollTaxYear_code_key" ON "payroll"."PayrollTaxYear"("code");
CREATE INDEX "PayrollTaxYear_status_idx" ON "payroll"."PayrollTaxYear"("status");
CREATE INDEX "PayrollTaxYear_isCurrent_idx" ON "payroll"."PayrollTaxYear"("isCurrent");
CREATE INDEX "PayrollTaxYear_deletedAt_idx" ON "payroll"."PayrollTaxYear"("deletedAt");

CREATE TABLE "payroll"."PayrollSchedule" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "frequency" "payroll"."PayrollPayFrequency" NOT NULL,
  "anchorDay" INTEGER NOT NULL DEFAULT 1,
  "description" TEXT,
  "status" "payroll"."PayrollScheduleStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PayrollSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollSchedule_code_key" ON "payroll"."PayrollSchedule"("code");
CREATE INDEX "PayrollSchedule_status_idx" ON "payroll"."PayrollSchedule"("status");
CREATE INDEX "PayrollSchedule_deletedAt_idx" ON "payroll"."PayrollSchedule"("deletedAt");

CREATE TABLE "payroll"."PayrollPeriod" (
  "id" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "taxYearId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "paymentDate" DATE NOT NULL,
  "status" "payroll"."PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollPeriod_scheduleId_taxYearId_sequence_key"
  ON "payroll"."PayrollPeriod"("scheduleId", "taxYearId", "sequence");
CREATE INDEX "PayrollPeriod_scheduleId_periodStart_periodEnd_idx"
  ON "payroll"."PayrollPeriod"("scheduleId", "periodStart", "periodEnd");
CREATE INDEX "PayrollPeriod_taxYearId_idx" ON "payroll"."PayrollPeriod"("taxYearId");
CREATE INDEX "PayrollPeriod_status_idx" ON "payroll"."PayrollPeriod"("status");
CREATE INDEX "PayrollPeriod_deletedAt_idx" ON "payroll"."PayrollPeriod"("deletedAt");

CREATE TABLE "payroll"."EmployeePayrollProfile" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "scheduleId" UUID,
  "status" "payroll"."EmployeePayrollProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "taxCode" TEXT,
  "taxCodeWeek1Month1" BOOLEAN NOT NULL DEFAULT false,
  "niCategory" "payroll"."PayrollNiCategory",
  "starterDeclaration" "payroll"."PayrollStarterDeclaration" NOT NULL DEFAULT 'UNKNOWN',
  "studentLoanPlan1" BOOLEAN NOT NULL DEFAULT false,
  "studentLoanPlan2" BOOLEAN NOT NULL DEFAULT false,
  "studentLoanPlan4" BOOLEAN NOT NULL DEFAULT false,
  "postgraduateLoan" BOOLEAN NOT NULL DEFAULT false,
  "pensionOptedIn" BOOLEAN NOT NULL DEFAULT false,
  "pensionSchemeRef" TEXT,
  "bankSortCode" TEXT,
  "bankAccountNumber" TEXT,
  "bankAccountName" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeePayrollProfile_employeeId_key" ON "payroll"."EmployeePayrollProfile"("employeeId");
CREATE INDEX "EmployeePayrollProfile_status_idx" ON "payroll"."EmployeePayrollProfile"("status");
CREATE INDEX "EmployeePayrollProfile_scheduleId_idx" ON "payroll"."EmployeePayrollProfile"("scheduleId");
CREATE INDEX "EmployeePayrollProfile_deletedAt_idx" ON "payroll"."EmployeePayrollProfile"("deletedAt");

CREATE TABLE "payroll"."EmployeePayAgreement" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "scheduleId" UUID,
  "basis" "payroll"."EmployeePayAgreementBasis" NOT NULL DEFAULT 'HOURLY_CARE',
  "status" "payroll"."EmployeePayAgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "payCardId" UUID,
  "annualSalary" DECIMAL(12,2),
  "contractedHours" DECIMAL(8,2),
  "hourlyRateOverride" DECIMAL(12,4),
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EmployeePayAgreement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeePayAgreement_employeeId_effectiveFrom_idx"
  ON "payroll"."EmployeePayAgreement"("employeeId", "effectiveFrom");
CREATE INDEX "EmployeePayAgreement_employeeId_status_idx"
  ON "payroll"."EmployeePayAgreement"("employeeId", "status");
CREATE INDEX "EmployeePayAgreement_payCardId_idx" ON "payroll"."EmployeePayAgreement"("payCardId");
CREATE INDEX "EmployeePayAgreement_deletedAt_idx" ON "payroll"."EmployeePayAgreement"("deletedAt");

CREATE TABLE "payroll"."UkPayrollRun" (
  "id" UUID NOT NULL,
  "periodId" UUID NOT NULL,
  "taxYearId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "runNumber" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "status" "payroll"."UkPayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "employeeCount" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "notes" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedById" UUID,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "updatedById" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "UkPayrollRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UkPayrollRun_scheduleId_periodId_runNumber_key"
  ON "payroll"."UkPayrollRun"("scheduleId", "periodId", "runNumber");
CREATE INDEX "UkPayrollRun_status_idx" ON "payroll"."UkPayrollRun"("status");
CREATE INDEX "UkPayrollRun_taxYearId_idx" ON "payroll"."UkPayrollRun"("taxYearId");
CREATE INDEX "UkPayrollRun_periodId_idx" ON "payroll"."UkPayrollRun"("periodId");
CREATE INDEX "UkPayrollRun_deletedAt_idx" ON "payroll"."UkPayrollRun"("deletedAt");

CREATE TABLE "payroll"."UkPayrollRunEmployee" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "payAgreementId" UUID,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  CONSTRAINT "UkPayrollRunEmployee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UkPayrollRunEmployee_runId_employeeId_key"
  ON "payroll"."UkPayrollRunEmployee"("runId", "employeeId");
CREATE INDEX "UkPayrollRunEmployee_employeeId_idx" ON "payroll"."UkPayrollRunEmployee"("employeeId");
CREATE INDEX "UkPayrollRunEmployee_runId_idx" ON "payroll"."UkPayrollRunEmployee"("runId");

ALTER TABLE "payroll"."PayrollPeriod"
  ADD CONSTRAINT "PayrollPeriod_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "payroll"."PayrollSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll"."PayrollPeriod"
  ADD CONSTRAINT "PayrollPeriod_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "payroll"."PayrollTaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll"."EmployeePayrollProfile"
  ADD CONSTRAINT "EmployeePayrollProfile_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "payroll"."PayrollSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll"."EmployeePayAgreement"
  ADD CONSTRAINT "EmployeePayAgreement_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "payroll"."PayrollSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll"."UkPayrollRun"
  ADD CONSTRAINT "UkPayrollRun_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "payroll"."PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll"."UkPayrollRun"
  ADD CONSTRAINT "UkPayrollRun_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "payroll"."PayrollTaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll"."UkPayrollRun"
  ADD CONSTRAINT "UkPayrollRun_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "payroll"."PayrollSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll"."UkPayrollRunEmployee"
  ADD CONSTRAINT "UkPayrollRunEmployee_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "payroll"."UkPayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
