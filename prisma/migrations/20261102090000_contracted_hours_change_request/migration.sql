-- Contracted weekly hours changes need manager approval (hours approvals page).
ALTER TYPE "service_users"."EmployeeHoursApprovalStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "service_users"."EmployeeHoursApprovalType" AS ENUM ('VISIT_PLAN_OVER_HOURS', 'CONTRACTED_HOURS_CHANGE');

ALTER TABLE "service_users"."EmployeeHoursApproval"
  ADD COLUMN "requestType" "service_users"."EmployeeHoursApprovalType" NOT NULL DEFAULT 'VISIT_PLAN_OVER_HOURS',
  ADD COLUMN "previousContractedWeeklyHours" DOUBLE PRECISION,
  ADD COLUMN "requestedContractedWeeklyHours" DOUBLE PRECISION,
  ADD COLUMN "impactSummary" JSONB,
  ALTER COLUMN "serviceUserId" DROP NOT NULL,
  ALTER COLUMN "visitPlanId" DROP NOT NULL;

CREATE INDEX "EmployeeHoursApproval_requestType_idx" ON "service_users"."EmployeeHoursApproval"("requestType");
