-- CreateEnum
CREATE TYPE "billing"."PaymentType" AS ENUM ('COUNCIL_REMITTANCE', 'BANK_TRANSFER', 'DIRECT_DEBIT', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "billing"."PaymentRecordStatus" AS ENUM ('RECEIVED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "billing"."PaymentMatchStatus" AS ENUM ('UNMATCHED', 'PARTIALLY_MATCHED', 'FULLY_MATCHED');

-- CreateTable
CREATE TABLE "billing"."Payment" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "paymentType" "billing"."PaymentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivedDate" DATE,
    "recordStatus" "billing"."PaymentRecordStatus" NOT NULL DEFAULT 'RECEIVED',
    "matchStatus" "billing"."PaymentMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "funderId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceRunId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_receivedDate_idx" ON "billing"."Payment"("receivedDate");

-- CreateIndex
CREATE INDEX "Payment_matchStatus_idx" ON "billing"."Payment"("matchStatus");

-- CreateIndex
CREATE INDEX "Payment_recordStatus_idx" ON "billing"."Payment"("recordStatus");

-- CreateIndex
CREATE INDEX "Payment_funderId_idx" ON "billing"."Payment"("funderId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "billing"."PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceRunId_idx" ON "billing"."PaymentAllocation"("invoiceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceRunId_key" ON "billing"."PaymentAllocation"("paymentId", "invoiceRunId");

-- AddForeignKey
ALTER TABLE "billing"."PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "billing"."Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceRunId_fkey" FOREIGN KEY ("invoiceRunId") REFERENCES "billing"."InvoiceRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
