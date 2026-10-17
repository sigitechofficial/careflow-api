-- Payroll remediation, Phase 0.5 (VW-02).
-- A visit whose recorded start or finish came from the carer app without server corroboration is
-- held for office review through this finance exception code.
ALTER TYPE "billing"."FinanceExceptionCode" ADD VALUE IF NOT EXISTS 'UNVERIFIED_TIMES';
