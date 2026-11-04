-- Rota visit that puts a carer over their contracted weekly hours, waiting for a manager.
ALTER TYPE "service_users"."EmployeeHoursApprovalType" ADD VALUE IF NOT EXISTS 'ROTA_VISIT_OVER_HOURS';
