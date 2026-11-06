-- Timebank hours on the weekly invoice (docs/SU_TIMEBANK_INVOICE_PLAN.md). New line types and table only.
ALTER TYPE "billing"."InvoiceRunLineType" ADD VALUE IF NOT EXISTS 'TIMEBANK_HOURS';
ALTER TYPE "billing"."InvoiceRunLineType" ADD VALUE IF NOT EXISTS 'TIMEBANK_USED';

ALTER TABLE "billing"."InvoiceRunLine" ADD COLUMN "timebankWeekStart" DATE;

CREATE TABLE "billing"."ServiceUserTimebankCharge" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "weekStart" DATE,
    "scheduledJobId" UUID,
    "minutes" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "invoiceRunId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserTimebankCharge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserTimebankCharge_serviceUserId_idx" ON "billing"."ServiceUserTimebankCharge"("serviceUserId");
CREATE INDEX "ServiceUserTimebankCharge_invoiceRunId_idx" ON "billing"."ServiceUserTimebankCharge"("invoiceRunId");

ALTER TABLE "billing"."ServiceUserTimebankCharge" ADD CONSTRAINT "ServiceUserTimebankCharge_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."ServiceUserTimebankCharge" ADD CONSTRAINT "ServiceUserTimebankCharge_invoiceRunId_fkey" FOREIGN KEY ("invoiceRunId") REFERENCES "billing"."InvoiceRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
