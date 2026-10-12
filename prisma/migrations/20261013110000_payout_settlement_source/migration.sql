-- Payroll remediation, Gate A sprint (R-09 / decision D-04).
-- Records how the system knows a payout batch was paid. Until a bank or payment-provider
-- connection exists there is one answer: a person typed the payment reference (MANUAL_ENTRY).
-- A later connection can write BANK_CONFIRMED without any change to the batch status enum.
--
-- Additive: one nullable column. Existing PAID batches were all marked by a person, so they are
-- backfilled as MANUAL_ENTRY. No row is removed and no status changes.

ALTER TABLE "billing"."EmployeePayoutBatch" ADD COLUMN "settlementSource" TEXT;

UPDATE "billing"."EmployeePayoutBatch"
SET "settlementSource" = 'MANUAL_ENTRY'
WHERE "status" = 'PAID' AND "settlementSource" IS NULL;
