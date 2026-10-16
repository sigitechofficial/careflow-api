-- Payroll remediation, Gate B sprint (R-18 / VW-02).
-- An approval remembers who or what gave it and the attendance evidence it was given for, so that
-- evidence arriving later can withdraw an automatic approval or send a person's approval back for
-- review instead of leaving a stale approval in place.
--
-- Additive: four nullable columns and one enum value. No pay column is touched, so the trigger that
-- protects settled pay allows the backfill on settled visits too.

ALTER TYPE "billing"."FinanceExceptionCode" ADD VALUE IF NOT EXISTS 'EVIDENCE_CHANGED';

ALTER TABLE "billing"."VisitReconciliation"
  ADD COLUMN "approvalSource" TEXT,
  ADD COLUMN "approvedEvidence" TEXT,
  ADD COLUMN "evidenceChangedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceChangedReason" TEXT;

-- Backfill the source of approvals that already exist: a named approver means a person approved;
-- no approver means the system approved a clean visit. `approvedEvidence` stays NULL: the first
-- evaluation after the upgrade records the evidence as it then stands, without withdrawing anything.
UPDATE "billing"."VisitReconciliation"
SET "approvalSource" = CASE WHEN "approvedById" IS NOT NULL THEN 'MANAGER_APPROVED' ELSE 'AUTO_VERIFIED' END
WHERE "status"::text IN ('APPROVED_FOR_PAY', 'APPROVED_FOR_BOTH', 'APPROVED_FOR_INVOICE', 'LOCKED')
  AND "approvalSource" IS NULL;
