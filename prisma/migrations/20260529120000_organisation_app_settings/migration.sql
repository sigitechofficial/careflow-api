ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "appSettingPinCodeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "appSettingViewPoliciesCareApp" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "appSettingViewPoliciesRosterApp" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "appSettingBookHolidaysCareApp" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "appSettingFingerprintLoginCareApp" BOOLEAN NOT NULL DEFAULT true;
