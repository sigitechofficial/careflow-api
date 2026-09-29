-- When to auto-send the survey to employees, and when that send actually ran.

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "distributeAt" TIMESTAMP(3);
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "distributedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Survey_distributeAt_idx" ON "surveys"."Survey"("distributeAt");
