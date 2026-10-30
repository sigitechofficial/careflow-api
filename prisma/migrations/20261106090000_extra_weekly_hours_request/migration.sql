-- Extra weekly hours for a carer waiting for a manager (Settings → Dom Rules "Adding extra hours needs manager approval").
ALTER TYPE "service_users"."EmployeeHoursApprovalType" ADD VALUE IF NOT EXISTS 'EXTRA_WEEKLY_HOURS';
