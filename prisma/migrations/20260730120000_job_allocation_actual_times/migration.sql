-- AlterTable
ALTER TABLE "scheduling"."JobAllocation" ADD COLUMN IF NOT EXISTS "actualStartDateTime" TIMESTAMP(3);
ALTER TABLE "scheduling"."JobAllocation" ADD COLUMN IF NOT EXISTS "actualEndDateTime" TIMESTAMP(3);