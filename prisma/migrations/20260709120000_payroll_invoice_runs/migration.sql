-- CreateEnum
CREATE TYPE "billing"."PayrollRunStatus" AS ENUM (
  'DRAFT',
  'CALCULATING',
  'EXCEPTION_FOUND',
  'READY_FOR_REVIEW',
  'APPROVED',
  'LOCKED',
  'EXPORTED'
);

-- CreateEnum
CREATE TYPE "billing"."PayrollRunLineType" AS ENUM ('VISIT_PAY', 'NMW_TOP_UP', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "billing"."InvoiceRunStatus" AS ENUM (
  'DRAFT',
  'CALCULATING',
  'EXCEPTION_FOUND',
  'READY_FOR_REVIEW',
  'APPROVED',
  'LOCKED',
  'SENT',
  'PART_PAID',
  'PAID',
  'DISPUTED'
);

-- CreateEnum
CREATE TYPE "billing"."InvoiceRunLineType" AS ENUM ('VISIT_CHARGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "billing"."BillingRunExportStatus" AS ENUM (
  'NOT_STARTED',
  'TEMPLATE_MISSING',
  'TEMPLATE_VALIDATION_FAILED',
  'READY_TO_RENDER',
  'RENDERED',
  'EXPORTED',
  'SENT'
);

-- AlterTable
ALTER TABLE "billing"."VisitReconciliation"
  ADD COLUMN "includedInPayrollRunId" UUID,
  ADD COLUMN "includedInInvoiceRunId" UUID;

-- CreateTable
CREATE TABLE "billing"."PayrollRun" (
  "id" UUID NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" "billing"."PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "carerCount" INTEGER NOT NULL DEFAULT 0,
  "visitLineCount" INTEGER NOT NULL DEFAULT 0,
  "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "nmwTopUp" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "exceptionCount" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "approvedAt" TIMESTAMP(3),
  "approvedById" UUID,
  "lockedAt" TIMESTAMP(3),
  "exportedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."PayrollRunLine" (
  "id" UUID NOT NULL,
  "payrollRunId" UUID NOT NULL,
  "visitReconciliationId" UUID NOT NULL,
  "employeeId" UUID,
  "lineType" "billing"."PayrollRunLineType" NOT NULL DEFAULT 'VISIT_PAY',
  "description" TEXT NOT NULL,
  "minutes" INTEGER,
  "unitAmount" DECIMAL(12,4),
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "payCardId" UUID,
  "visitRef" TEXT,
  "exceptionMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."InvoiceRun" (
  "id" UUID NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" "billing"."InvoiceRunStatus" NOT NULL DEFAULT 'DRAFT',
  "serviceUserCount" INTEGER NOT NULL DEFAULT 0,
  "funderCount" INTEGER NOT NULL DEFAULT 0,
  "netTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "exceptionCount" INTEGER NOT NULL DEFAULT 0,
  "exportStatus" "billing"."BillingRunExportStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "approvedAt" TIMESTAMP(3),
  "approvedById" UUID,
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  CONSTRAINT "InvoiceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."InvoiceRunLine" (
  "id" UUID NOT NULL,
  "invoiceRunId" UUID NOT NULL,
  "visitReconciliationId" UUID NOT NULL,
  "serviceUserId" UUID NOT NULL,
  "funderId" UUID,
  "serviceUserFundingId" UUID,
  "lineType" "billing"."InvoiceRunLineType" NOT NULL DEFAULT 'VISIT_CHARGE',
  "description" TEXT NOT NULL,
  "minutes" INTEGER,
  "splitPercent" DECIMAL(5,2),
  "unitAmount" DECIMAL(12,4),
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "chargeCardId" UUID,
  "visitRef" TEXT,
  "exceptionMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitReconciliation_includedInPayrollRunId_idx" ON "billing"."VisitReconciliation"("includedInPayrollRunId");
CREATE INDEX "VisitReconciliation_includedInInvoiceRunId_idx" ON "billing"."VisitReconciliation"("includedInInvoiceRunId");
CREATE INDEX "PayrollRun_status_idx" ON "billing"."PayrollRun"("status");
CREATE INDEX "PayrollRun_periodStart_periodEnd_idx" ON "billing"."PayrollRun"("periodStart", "periodEnd");
CREATE INDEX "PayrollRunLine_payrollRunId_idx" ON "billing"."PayrollRunLine"("payrollRunId");
CREATE INDEX "PayrollRunLine_visitReconciliationId_idx" ON "billing"."PayrollRunLine"("visitReconciliationId");
CREATE INDEX "PayrollRunLine_employeeId_idx" ON "billing"."PayrollRunLine"("employeeId");
CREATE UNIQUE INDEX "PayrollRunLine_payrollRunId_visitReconciliationId_lineType_key" ON "billing"."PayrollRunLine"("payrollRunId", "visitReconciliationId", "lineType");
CREATE INDEX "InvoiceRun_status_idx" ON "billing"."InvoiceRun"("status");
CREATE INDEX "InvoiceRun_periodStart_periodEnd_idx" ON "billing"."InvoiceRun"("periodStart", "periodEnd");
CREATE INDEX "InvoiceRunLine_invoiceRunId_idx" ON "billing"."InvoiceRunLine"("invoiceRunId");
CREATE INDEX "InvoiceRunLine_visitReconciliationId_idx" ON "billing"."InvoiceRunLine"("visitReconciliationId");
CREATE INDEX "InvoiceRunLine_serviceUserId_idx" ON "billing"."InvoiceRunLine"("serviceUserId");
CREATE INDEX "InvoiceRunLine_funderId_idx" ON "billing"."InvoiceRunLine"("funderId");
CREATE UNIQUE INDEX "InvoiceRunLine_invoiceRunId_visitReconciliationId_serviceUserFundingId_lineType_key" ON "billing"."InvoiceRunLine"("invoiceRunId", "visitReconciliationId", "serviceUserFundingId", "lineType");

-- AddForeignKey
ALTER TABLE "billing"."VisitReconciliation" ADD CONSTRAINT "VisitReconciliation_includedInPayrollRunId_fkey" FOREIGN KEY ("includedInPayrollRunId") REFERENCES "billing"."PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing"."VisitReconciliation" ADD CONSTRAINT "VisitReconciliation_includedInInvoiceRunId_fkey" FOREIGN KEY ("includedInInvoiceRunId") REFERENCES "billing"."InvoiceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing"."PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "billing"."PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_visitReconciliationId_fkey" FOREIGN KEY ("visitReconciliationId") REFERENCES "billing"."VisitReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."InvoiceRunLine" ADD CONSTRAINT "InvoiceRunLine_invoiceRunId_fkey" FOREIGN KEY ("invoiceRunId") REFERENCES "billing"."InvoiceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."InvoiceRunLine" ADD CONSTRAINT "InvoiceRunLine_visitReconciliationId_fkey" FOREIGN KEY ("visitReconciliationId") REFERENCES "billing"."VisitReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
