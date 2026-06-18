-- Skill / certification lookup default renewal windows (P1b)
ALTER TABLE "lookups"."SkillType" ADD COLUMN IF NOT EXISTS "defaultRefreshMonths" INTEGER;
ALTER TABLE "lookups"."CertificationType" ADD COLUMN IF NOT EXISTS "defaultValidityMonths" INTEGER;
