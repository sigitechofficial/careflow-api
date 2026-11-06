-- Surveys: send (or schedule) a service-user survey to chosen people we support, like chosen
-- employees on staff surveys. Empty = everyone in the survey's branches.

ALTER TABLE "surveys"."Survey"
  ADD COLUMN IF NOT EXISTS "audienceServiceUserIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
