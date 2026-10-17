-- Changes for specific dates (visit plan): who cancelled, reason, billing decision, extra-visit carers,
-- and the cancellation policy result stored with each rota cancellation.

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN IF NOT EXISTS "domCancellationHospitalExemption" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "service_users"."VisitPlanSlotException"
  ADD COLUMN IF NOT EXISTS "cancelledByParty" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledByDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "reasonCode" TEXT,
  ADD COLUMN IF NOT EXISTS "chargeDecision" TEXT,
  ADD COLUMN IF NOT EXISTS "chargeDecisionNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedEmployeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "createdById" UUID;

ALTER TABLE "scheduling"."ScheduledJobCancellation"
  ADD COLUMN IF NOT EXISTS "cancelledByParty" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledByDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationSource" TEXT,
  ADD COLUMN IF NOT EXISTS "noticeHours" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "suggestedChargeDecision" TEXT,
  ADD COLUMN IF NOT EXISTS "suggestedChargePercent" INTEGER,
  ADD COLUMN IF NOT EXISTS "policySnapshot" JSONB;
