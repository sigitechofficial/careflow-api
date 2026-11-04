-- A draft visit plan over the service user's weekly hours waits for a manager before it can be activated.
ALTER TYPE "service_users"."EmployeeHoursApprovalType" ADD VALUE IF NOT EXISTS 'DRAFT_PLAN_OVER_HOURS';
