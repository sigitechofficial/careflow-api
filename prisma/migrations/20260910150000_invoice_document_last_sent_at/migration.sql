-- AlterTable
ALTER TABLE "billing"."InvoiceDocument" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);
