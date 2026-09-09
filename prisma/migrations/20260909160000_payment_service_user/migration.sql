-- Tag payments to a service-user invoice so paid amounts are not split across
-- every client who shares the same funder on the run.
ALTER TABLE "billing"."Payment"
  ADD COLUMN IF NOT EXISTS "serviceUserId" UUID;

CREATE INDEX IF NOT EXISTS "Payment_serviceUserId_idx"
  ON "billing"."Payment"("serviceUserId");
