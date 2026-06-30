ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
  ADD COLUMN IF NOT EXISTS "carerInstructions" TEXT;
