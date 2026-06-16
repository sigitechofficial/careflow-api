-- Lead carer flag for multi-carer scheduled jobs
ALTER TABLE "scheduling"."JobAllocation"
ADD COLUMN "isLeadCarer" BOOLEAN NOT NULL DEFAULT false;
