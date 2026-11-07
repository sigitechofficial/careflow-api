-- Restore columns dropped by 20260727140000_learning_module_foundation (unintended drift; the
-- Settings → Review types / Skills / Certifications interval fields and the workforce catalogue
-- still use them). Additive and safe to re-run: IF NOT EXISTS everywhere, no data changed.

-- AlterTable
ALTER TABLE "lookups"."ReviewType" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "lookups"."ReviewType" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "lookups"."ReviewType" ADD COLUMN IF NOT EXISTS "defaultIntervalDays" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewType_code_key" ON "lookups"."ReviewType"("code");

-- AlterTable
ALTER TABLE "lookups"."SkillType" ADD COLUMN IF NOT EXISTS "defaultRefreshMonths" INTEGER;

-- AlterTable
ALTER TABLE "lookups"."CertificationType" ADD COLUMN IF NOT EXISTS "defaultValidityMonths" INTEGER;
