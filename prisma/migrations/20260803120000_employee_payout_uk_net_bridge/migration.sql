-- UK net → payout bridge: purge legacy visit-pay-net payouts, then link batches to UK runs.
-- Existing EmployeePayout* rows used visit-pay net (pre-PAYE) and are incompatible with UK netPay.

DELETE FROM "billing"."EmployeePayoutLine";
DELETE FROM "billing"."EmployeePayoutBatch";

-- AlterTable
ALTER TABLE "billing"."EmployeePayoutBatch" ADD COLUMN "ukPayrollRunId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "billing"."EmployeePayoutLine" ADD COLUMN "ukPayrollRunEmployeeId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "EmployeePayoutBatch_ukPayrollRunId_idx" ON "billing"."EmployeePayoutBatch"("ukPayrollRunId");

-- CreateIndex
CREATE INDEX "EmployeePayoutLine_ukPayrollRunEmployeeId_idx" ON "billing"."EmployeePayoutLine"("ukPayrollRunEmployeeId");

-- AddForeignKey
ALTER TABLE "billing"."EmployeePayoutBatch" ADD CONSTRAINT "EmployeePayoutBatch_ukPayrollRunId_fkey" FOREIGN KEY ("ukPayrollRunId") REFERENCES "payroll"."UkPayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."EmployeePayoutLine" ADD CONSTRAINT "EmployeePayoutLine_ukPayrollRunEmployeeId_fkey" FOREIGN KEY ("ukPayrollRunEmployeeId") REFERENCES "payroll"."UkPayrollRunEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
