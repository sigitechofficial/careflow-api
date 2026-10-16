-- Payroll remediation, Phase 0 (SI-05, VW-22, VW-23, PR-13, SI-06).
-- Database backstop: locked visit pay history cannot be changed or deleted by any code path.
-- The services refuse these changes first with a readable message; these triggers catch anything
-- that is missed. Idempotent, so it can be re-applied (the payroll test database applies it too).
--
-- A reset of test data must opt in inside its own transaction:
--   SELECT set_config('careflow.allow_financial_reset', 'on', true);
-- The application only does that outside production and with the billing.financial_reset permission.

CREATE OR REPLACE FUNCTION "billing"."careflow_financial_reset_allowed"() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('careflow.allow_financial_reset', true), '') = 'on'
$$;

-- Locked / exported visit pay runs: no delete, no un-locking, no change to period or totals.
CREATE OR REPLACE FUNCTION "billing"."protect_locked_payroll_run"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "billing"."careflow_financial_reset_allowed"()
    AND OLD."status"::text IN ('LOCKED', 'EXPORTED')
  THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: a locked payroll run cannot be deleted (%)', OLD."id"
        USING ERRCODE = 'CF001';
    END IF;
    IF NEW."status"::text NOT IN ('LOCKED', 'EXPORTED')
      OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
      OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
      OR NEW."grossPay" IS DISTINCT FROM OLD."grossPay"
      OR NEW."nmwTopUp" IS DISTINCT FROM OLD."nmwTopUp"
      OR NEW."expenseTotal" IS DISTINCT FROM OLD."expenseTotal"
    THEN
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: a locked payroll run cannot be reopened or changed (%)', OLD."id"
        USING ERRCODE = 'CF001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "protect_locked_payroll_run" ON "billing"."PayrollRun";
CREATE TRIGGER "protect_locked_payroll_run"
  BEFORE UPDATE OR DELETE ON "billing"."PayrollRun"
  FOR EACH ROW EXECUTE FUNCTION "billing"."protect_locked_payroll_run"();

-- Pay lines of a locked / exported run: no insert, update or delete.
CREATE OR REPLACE FUNCTION "billing"."protect_locked_payroll_run_line"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_id uuid;
  run_status text;
BEGIN
  IF NOT "billing"."careflow_financial_reset_allowed"() THEN
    IF TG_OP = 'INSERT' THEN
      run_id := NEW."payrollRunId";
    ELSE
      run_id := OLD."payrollRunId";
    END IF;
    SELECT "status"::text INTO run_status FROM "billing"."PayrollRun" WHERE "id" = run_id;
    IF run_status IN ('LOCKED', 'EXPORTED') THEN
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: pay lines of a locked payroll run cannot be added, changed or deleted'
        USING ERRCODE = 'CF001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "protect_locked_payroll_run_line" ON "billing"."PayrollRunLine";
CREATE TRIGGER "protect_locked_payroll_run_line"
  BEFORE INSERT OR UPDATE OR DELETE ON "billing"."PayrollRunLine"
  FOR EACH ROW EXECUTE FUNCTION "billing"."protect_locked_payroll_run_line"();

-- Visit reconciliation paid by a locked run: the pay snapshot is frozen and the row cannot be deleted.
-- Charge-side columns stay editable (invoicing has its own lifecycle).
CREATE OR REPLACE FUNCTION "billing"."protect_paid_visit_reconciliation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "billing"."careflow_financial_reset_allowed"()
    AND OLD."includedInPayrollRunId" IS NOT NULL
  THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: a paid visit cannot be deleted (%)', OLD."id"
        USING ERRCODE = 'CF001';
    END IF;
    IF NEW."includedInPayrollRunId" IS DISTINCT FROM OLD."includedInPayrollRunId"
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
      RAISE EXCEPTION 'LOCKED_PAYROLL_HISTORY: the pay of a visit in a locked payroll run cannot be changed; record a pay correction instead (%)', OLD."id"
        USING ERRCODE = 'CF001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "protect_paid_visit_reconciliation" ON "billing"."VisitReconciliation";
CREATE TRIGGER "protect_paid_visit_reconciliation"
  BEFORE UPDATE OR DELETE ON "billing"."VisitReconciliation"
  FOR EACH ROW EXECUTE FUNCTION "billing"."protect_paid_visit_reconciliation"();
