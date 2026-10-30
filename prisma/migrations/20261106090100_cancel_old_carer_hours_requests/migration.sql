-- Carer weekly hours settings simplified (30 Oct 2026): carer requests still waiting under the old
-- rules are taken off Hours approvals. Kept as CANCELLED (history stays); carers and visits are not changed.
UPDATE "service_users"."EmployeeHoursApproval"
SET "status" = 'CANCELLED',
    "decidedAt" = NOW(),
    "decisionNotes" = 'Replaced by the new carer hours settings'
WHERE "status" = 'PENDING'
  AND "requestType" IN ('VISIT_PLAN_OVER_HOURS', 'ROTA_VISIT_OVER_HOURS', 'CONTRACTED_HOURS_CHANGE');
