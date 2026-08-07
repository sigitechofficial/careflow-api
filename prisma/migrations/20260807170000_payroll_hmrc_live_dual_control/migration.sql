-- T18: dual-control fields for live HMRC FPS submissions.
ALTER TABLE "payroll"."PayrollHmrcSubmission"
  ADD COLUMN IF NOT EXISTS "payloadFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedById" UUID,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedById" UUID,
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionNote" TEXT;
