-- T17: store fraud-prevention header snapshot on each HMRC submission attempt.
ALTER TABLE "payroll"."PayrollHmrcSubmission"
  ADD COLUMN IF NOT EXISTS "fraudPreventionHeaders" JSONB;
