ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "criticalGenerateActions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "criticalMemorableAnswerRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "criticalLockdownWebAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "criticalLockdownCareAppAccess" BOOLEAN NOT NULL DEFAULT false;
