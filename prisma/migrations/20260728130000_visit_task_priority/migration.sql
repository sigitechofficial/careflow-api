ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
  ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'routine';
