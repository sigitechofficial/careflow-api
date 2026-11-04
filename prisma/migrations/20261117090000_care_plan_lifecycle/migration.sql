-- Phase 3B: care plan operational lifecycle (ACTIVE / SUSPENDED / ARCHIVED). Additive; idempotent.
-- Every existing plan becomes ACTIVE, so carers see exactly what they saw before.

DO $$ BEGIN
  CREATE TYPE "service_users"."ServiceUserCarePlanLifecycleStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "service_users"."ServiceUserCarePlanInstance"
  ADD COLUMN IF NOT EXISTS "lifecycleStatus" "service_users"."ServiceUserCarePlanLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "lifecycleReason" TEXT,
  ADD COLUMN IF NOT EXISTS "lifecycleChangedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lifecycleChangedById" UUID;

CREATE INDEX IF NOT EXISTS "ServiceUserCarePlanInstance_lifecycleStatus_idx"
  ON "service_users"."ServiceUserCarePlanInstance"("lifecycleStatus");
