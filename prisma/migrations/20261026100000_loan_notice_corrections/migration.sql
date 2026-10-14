-- Gate C15: correction of loan notices recorded in error (void the local record, optional
-- replacement). Additive columns. The reference uniqueness moves to activeReferenceKey, which
-- is cleared when a notice is voided, so a controlled replacement may reuse the reference;
-- notices already recorded get their key from their own values. Rollback: drop the columns
-- and restore the unique index on (employeeId, noticeType, hmrcReference).

-- DropIndex
DROP INDEX "payroll"."EmployeeLoanNotice_employeeId_noticeType_hmrcReference_key";

-- AlterTable
ALTER TABLE "payroll"."EmployeeLoanNotice" ADD COLUMN     "activeReferenceKey" TEXT,
ADD COLUMN     "replacedById" UUID,
ADD COLUMN     "replacesId" UUID,
ADD COLUMN     "voidEvidenceRef" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" UUID;

-- Backfill: the key of each notice already recorded with a reference.
UPDATE "payroll"."EmployeeLoanNotice" SET "activeReferenceKey" = "employeeId"::text || '|' || "noticeType" || '|' || "hmrcReference" WHERE "hmrcReference" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLoanNotice_activeReferenceKey_key" ON "payroll"."EmployeeLoanNotice"("activeReferenceKey");

