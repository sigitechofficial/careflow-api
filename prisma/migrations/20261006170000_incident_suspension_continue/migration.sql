-- Outcome & close decision: a carer suspension continues beyond the incident (with reason).
ALTER TABLE "incidents"."IncidentCarerSuspension"
  ADD COLUMN "continuedAt" TIMESTAMP(3),
  ADD COLUMN "continuedById" UUID,
  ADD COLUMN "continueReason" TEXT;
