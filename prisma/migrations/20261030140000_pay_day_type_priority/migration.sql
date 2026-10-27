-- Organisation priority per day type for carer pay (null = built-in order).
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "payDayTypePriority" JSONB;
