-- ReviewType: stable code + default interval for nextDue computation (workforce catalog P1b)
ALTER TABLE "lookups"."ReviewType" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "lookups"."ReviewType" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "lookups"."ReviewType" ADD COLUMN IF NOT EXISTS "defaultIntervalDays" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "ReviewType_code_key" ON "lookups"."ReviewType"("code");
