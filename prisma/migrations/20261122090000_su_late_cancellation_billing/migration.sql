-- Late cancellation billing: a visit cancelled with a Charge decision becomes its own invoice line.
-- Backward compatible: existing lines keep their visit reconciliation; new columns are nullable.

ALTER TYPE "billing"."InvoiceRunLineType" ADD VALUE IF NOT EXISTS 'LATE_CANCELLATION';

ALTER TABLE "billing"."InvoiceRunLine" ALTER COLUMN "visitReconciliationId" DROP NOT NULL;
ALTER TABLE "billing"."InvoiceRunLine" ADD COLUMN "scheduledJobCancellationId" UUID;

ALTER TABLE "scheduling"."ScheduledJobCancellation" ADD COLUMN "chargePercent" INTEGER;
ALTER TABLE "scheduling"."ScheduledJobCancellation" ADD COLUMN "includedInInvoiceRunId" UUID;

CREATE UNIQUE INDEX "InvoiceRunLine_cancellation_funding_line_key" ON "billing"."InvoiceRunLine"("invoiceRunId", "scheduledJobCancellationId", "serviceUserFundingId", "lineType");
CREATE INDEX "InvoiceRunLine_scheduledJobCancellationId_idx" ON "billing"."InvoiceRunLine"("scheduledJobCancellationId");
CREATE INDEX "ScheduledJobCancellation_includedInInvoiceRunId_idx" ON "scheduling"."ScheduledJobCancellation"("includedInInvoiceRunId");

ALTER TABLE "billing"."InvoiceRunLine" ADD CONSTRAINT "InvoiceRunLine_scheduledJobCancellationId_fkey" FOREIGN KEY ("scheduledJobCancellationId") REFERENCES "scheduling"."ScheduledJobCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJobCancellation" ADD CONSTRAINT "ScheduledJobCancellation_includedInInvoiceRunId_fkey" FOREIGN KEY ("includedInInvoiceRunId") REFERENCES "billing"."InvoiceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
