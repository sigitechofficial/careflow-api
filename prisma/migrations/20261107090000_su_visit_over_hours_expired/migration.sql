-- Service user weekly hours settings simplified (30 Oct 2026, docs/SU_WEEKLY_HOURS_SIMPLIFY_PLAN.md).
-- A rota visit (from a visit plan, or a special visit) over the service user's weekly hours waits for a manager.
ALTER TYPE "service_users"."EmployeeHoursApprovalType" ADD VALUE IF NOT EXISTS 'SERVICE_USER_VISIT_OVER_HOURS';

-- A request whose visit time has passed, or that is no longer valid, is shown apart from a manager's cancel.
ALTER TYPE "service_users"."EmployeeHoursApprovalStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Draft plans are no longer checked (only the visits made once active): draft requests still waiting are
-- taken off Hours approvals. Kept as CANCELLED (history stays); the draft can now be activated.
UPDATE "service_users"."EmployeeHoursApproval"
SET "status" = 'CANCELLED',
    "decidedAt" = NOW(),
    "decisionNotes" = 'Replaced by the new service user hours settings'
WHERE "status" = 'PENDING'
  AND "requestType" = 'DRAFT_PLAN_OVER_HOURS';
