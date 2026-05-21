ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "privacyNonActiveServiceUserDays" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "privacyNotifyInternalMessage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "privacyNotifyEmail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "privacySensitiveViewerRoles" JSONB NOT NULL DEFAULT '[]';
