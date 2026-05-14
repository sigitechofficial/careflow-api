-- NotificationPreference: composite PK (userId, type); invariant sound => in-app

UPDATE "notifications"."NotificationPreference"
SET "soundEnabled" = false
WHERE "inAppEnabled" = false;

ALTER TABLE "notifications"."NotificationPreference" DROP CONSTRAINT IF EXISTS "NotificationPreference_pkey";

DROP INDEX IF EXISTS "notifications"."NotificationPreference_userId_type_key";

ALTER TABLE "notifications"."NotificationPreference" DROP COLUMN "id";

ALTER TABLE "notifications"."NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "type");

ALTER TABLE "notifications"."NotificationPreference"
  ADD CONSTRAINT "notification_pref_sound_requires_inapp"
  CHECK (NOT "soundEnabled" OR "inAppEnabled");
