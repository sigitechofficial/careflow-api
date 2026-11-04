-- Service user weekly contracted hours changes need manager approval (hours approvals page).
-- These requests have no carer, so employeeId becomes optional.
ALTER TYPE "service_users"."EmployeeHoursApprovalType" ADD VALUE IF NOT EXISTS 'SERVICE_USER_WEEKLY_HOURS_CHANGE';

ALTER TABLE "service_users"."EmployeeHoursApproval"
  ALTER COLUMN "employeeId" DROP NOT NULL;
