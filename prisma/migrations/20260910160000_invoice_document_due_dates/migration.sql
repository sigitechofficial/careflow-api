-- AlterTable
ALTER TABLE "billing"."InvoiceDocument" ADD COLUMN IF NOT EXISTS "invoiceDate" DATE;
ALTER TABLE "billing"."InvoiceDocument" ADD COLUMN IF NOT EXISTS "dueDate" DATE;
ALTER TABLE "billing"."InvoiceDocument" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;

-- Backfill invoiceDate from createdAt for existing rows
UPDATE "billing"."InvoiceDocument"
SET "invoiceDate" = ("createdAt" AT TIME ZONE 'UTC')::date
WHERE "invoiceDate" IS NULL;

-- Default remaining nulls (should not happen after backfill)
UPDATE "billing"."InvoiceDocument"
SET "invoiceDate" = CURRENT_DATE
WHERE "invoiceDate" IS NULL;

ALTER TABLE "billing"."InvoiceDocument" ALTER COLUMN "invoiceDate" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "InvoiceDocument_dueDate_idx" ON "billing"."InvoiceDocument"("dueDate");
