-- Critical payroll audit fixes: overrun fields already exist; add travel/NMW support + multi-worker recon

ALTER TABLE billing."VisitReconciliation"
  ADD COLUMN IF NOT EXISTS "unpaidTravelMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "passengerMiles" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "payCardVersion" INTEGER;

-- Allow one reconciliation per worker allocation on a visit (double-up)
ALTER TABLE billing."VisitReconciliation" DROP CONSTRAINT IF EXISTS "VisitReconciliation_scheduledVisitId_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VisitReconciliation_scheduledVisitId_jobAllocationId_key'
  ) THEN
    -- Deduplicate any accidental duplicates before unique index (keep earliest)
    DELETE FROM billing."VisitReconciliation" a
    USING billing."VisitReconciliation" b
    WHERE a."scheduledVisitId" = b."scheduledVisitId"
      AND a."jobAllocationId" IS NOT DISTINCT FROM b."jobAllocationId"
      AND a."createdAt" > b."createdAt";

    ALTER TABLE billing."VisitReconciliation"
      ADD CONSTRAINT "VisitReconciliation_scheduledVisitId_jobAllocationId_key"
      UNIQUE ("scheduledVisitId", "jobAllocationId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "VisitReconciliation_scheduledVisitId_idx"
  ON billing."VisitReconciliation" ("scheduledVisitId");
