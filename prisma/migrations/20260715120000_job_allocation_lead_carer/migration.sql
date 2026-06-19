-- Lead carer flag for multi-carer scheduled jobs (also added in 20260714120000_visit_plan_enterprise_slots)
ALTER TABLE "scheduling"."JobAllocation"
ADD COLUMN IF NOT EXISTS "isLeadCarer" BOOLEAN NOT NULL DEFAULT false;
