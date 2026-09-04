-- Roster allocation compliance policy (WARN default so existing orgs are not surprise-blocked).
CREATE TYPE "identity"."ComplianceAllocationMode" AS ENUM ('WARN', 'BLOCK');

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN IF NOT EXISTS "complianceAllocationMode" "identity"."ComplianceAllocationMode" NOT NULL DEFAULT 'WARN',
  ADD COLUMN IF NOT EXISTS "complianceBlockStatuses" TEXT[] NOT NULL DEFAULT ARRAY['MISSING', 'EXPIRED', 'REJECTED']::TEXT[],
  ADD COLUMN IF NOT EXISTS "includeLearningInAllocationBlock" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "employees"."ComplianceRequirement"
  ADD COLUMN IF NOT EXISTS "blocksAllocation" BOOLEAN NOT NULL DEFAULT true;

UPDATE "employees"."ComplianceRequirement"
SET "blocksAllocation" = "isMandatory"
WHERE "blocksAllocation" IS DISTINCT FROM "isMandatory";
