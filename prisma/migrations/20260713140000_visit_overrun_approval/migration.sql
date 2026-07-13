-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "billing"."VisitOverrunDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "billing"."VisitReconciliation"
  ADD COLUMN IF NOT EXISTS "overrunMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "overrunReason" TEXT;

ALTER TABLE "billing"."VisitReconciliation"
  ADD COLUMN IF NOT EXISTS "overrunDecision" "billing"."VisitOverrunDecision";

CREATE INDEX IF NOT EXISTS "VisitReconciliation_overrunDecision_idx"
  ON "billing"."VisitReconciliation"("overrunDecision");
