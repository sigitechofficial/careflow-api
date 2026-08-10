-- Mark catalogue tasks that typically need more than one carer (double-up).
ALTER TABLE "service_users"."TaskCatalogueTask"
ADD COLUMN IF NOT EXISTS "requiresMultipleCarers" BOOLEAN NOT NULL DEFAULT false;
