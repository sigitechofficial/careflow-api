-- Phase 3.1: Plan 5 student loan + configurable UK deduction elections.

ALTER TABLE "payroll"."EmployeePayrollProfile"
  ADD COLUMN "studentLoanPlan5" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payroll"."EmployeePayrollProfile"
  ADD COLUMN "deductionElections" JSONB;