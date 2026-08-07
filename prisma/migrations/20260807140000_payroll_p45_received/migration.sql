-- T05: P45 received flag on employee payroll profile (starter/leaver readiness).
ALTER TABLE "payroll"."EmployeePayrollProfile"
  ADD COLUMN IF NOT EXISTS "p45Received" BOOLEAN NOT NULL DEFAULT false;
