-- Per-employee approved weekly hours cap override (e.g. visa exception with documented reason).
ALTER TABLE "employees"."EmployeeEmployment"
  ADD COLUMN "weeklyHoursCapOverride" DOUBLE PRECISION,
  ADD COLUMN "weeklyHoursCapOverrideReason" TEXT,
  ADD COLUMN "weeklyHoursCapOverrideExpiresAt" TIMESTAMP(3);
