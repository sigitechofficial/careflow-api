-- Extra visits over a service user's weekly hours wait for a manager (hours approvals page).
ALTER TYPE "service_users"."EmployeeHoursApprovalType" ADD VALUE IF NOT EXISTS 'EXTRA_VISIT_OVER_HOURS';

ALTER TABLE "service_users"."EmployeeHoursApproval"
  ADD COLUMN "requestPayload" JSONB;
