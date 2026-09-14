-- AlterTable
ALTER TABLE "billing"."InvoiceRun" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "billing"."InvoiceRun" ADD COLUMN IF NOT EXISTS "sequenceValue" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceRun_invoiceNumber_key" ON "billing"."InvoiceRun"("invoiceNumber");
