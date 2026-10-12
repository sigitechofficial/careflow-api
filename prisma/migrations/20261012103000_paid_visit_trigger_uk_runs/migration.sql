-- Payroll remediation, Phase 0 (PR-05, PR-13). SQL only, idempotent.
-- Extends the paid-visit protection to visits settled by a closed UK payroll run
-- (paidByUkPayrollRunId), and allows exactly one release path: reopening that UK run.
--
-- Reopening a closed UK run sets, inside its own transaction:
--   SELECT set_config('careflow.reopening_uk_run', '<run id>', true);
-- Only the claim of that run may then be cleared; the pay figures still cannot change in that update.

CREATE OR REPLACE FUNCTION "billing"."protect_paid_visit_reconciliation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reopening text;
BEGIN
  IF NOT "billing"."careflow_financial_reset_allowed"()
    AND (OLD."includedInPayrollRunId" IS NOT NULL OR OLD."paidByUkPayrollRunId" IS NOT NULL)
  THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: a paid visit cannot be deleted (%)', OLD."id"
        USING ERRCODE = 'CF001';
    END IF;
    reopening := COALESCE(current_setting('careflow.reopening_uk_run', true), '');
    IF NEW."includedInPayrollRunId" IS DISTINCT FROM OLD."includedInPayrollRunId"
      OR (
        NEW."paidByUkPayrollRunId" IS DISTINCT FROM OLD."paidByUkPayrollRunId"
        AND NOT (NEW."paidByUkPayrollRunId" IS NULL AND reopening = OLD."paidByUkPayrollRunId"::text)
      )
      OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
      OR NEW."payableAmount" IS DISTINCT FROM OLD."payableAmount"
      OR NEW."payableMinutes" IS DISTINCT FROM OLD."payableMinutes"
      OR NEW."approvedPayStart" IS DISTINCT FROM OLD."approvedPayStart"
      OR NEW."approvedPayEnd" IS DISTINCT FROM OLD."approvedPayEnd"
      OR NEW."payCardId" IS DISTINCT FROM OLD."payCardId"
      OR NEW."payCardVersion" IS DISTINCT FROM OLD."payCardVersion"
      OR NEW."travelMiles" IS DISTINCT FROM OLD."travelMiles"
      OR NEW."travelMinutes" IS DISTINCT FROM OLD."travelMinutes"
      OR NEW."unpaidTravelMinutes" IS DISTINCT FROM OLD."unpaidTravelMinutes"
      OR NEW."passengerMiles" IS DISTINCT FROM OLD."passengerMiles"
    THEN
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: the pay of a visit in a locked or closed payroll run cannot be changed; record a pay correction instead (%)', OLD."id"
        USING ERRCODE = 'CF001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
