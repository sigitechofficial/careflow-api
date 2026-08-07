-- T14: Employment Allowance claim flag for EPS preview / future submit.
ALTER TABLE "payroll"."PayrollEmployerSettings"
  ADD COLUMN IF NOT EXISTS "employmentAllowanceClaimed" BOOLEAN NOT NULL DEFAULT false;
