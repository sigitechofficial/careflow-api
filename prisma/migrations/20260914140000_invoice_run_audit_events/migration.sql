-- CreateEnum
CREATE TYPE "billing"."InvoiceRunAuditAction" AS ENUM (
  'CREATED',
  'CALCULATED',
  'APPROVED',
  'LOCKED',
  'SENT',
  'EMAIL_SENT',
  'EXPORTED',
  'PAYMENT_ALLOCATED'
);

-- AlterTable
ALTER TABLE "billing"."InvoiceRun"
  ADD COLUMN IF NOT EXISTS "lockedById" UUID,
  ADD COLUMN IF NOT EXISTS "sentById" UUID;

-- CreateTable
CREATE TABLE "billing"."InvoiceRunAuditEvent" (
  "id" UUID NOT NULL,
  "invoiceRunId" UUID NOT NULL,
  "action" "billing"."InvoiceRunAuditAction" NOT NULL,
  "actorUserId" UUID,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detail" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceRunAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceRunAuditEvent_invoiceRunId_occurredAt_idx"
  ON "billing"."InvoiceRunAuditEvent"("invoiceRunId", "occurredAt");

-- CreateIndex
CREATE INDEX "InvoiceRunAuditEvent_action_idx"
  ON "billing"."InvoiceRunAuditEvent"("action");

-- AddForeignKey
ALTER TABLE "billing"."InvoiceRunAuditEvent"
  ADD CONSTRAINT "InvoiceRunAuditEvent_invoiceRunId_fkey"
  FOREIGN KEY ("invoiceRunId") REFERENCES "billing"."InvoiceRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
