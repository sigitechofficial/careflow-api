-- Survey audiences: add the PUBLIC target kind, employee job-role targeting
-- (roleIds) and reusable templates (isTemplate). Idempotent so it is safe to
-- re-run if the columns were already applied manually.

ALTER TYPE "surveys"."SurveyTargetKind" ADD VALUE IF NOT EXISTS 'PUBLIC';

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "roleIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "isTemplate" BOOLEAN NOT NULL DEFAULT false;
