-- T04: HMRC FPS hours-normally-worked band (A–E) on employee payroll profile.
ALTER TABLE "payroll"."EmployeePayrollProfile"
  ADD COLUMN IF NOT EXISTS "hoursNormallyWorked" TEXT;
