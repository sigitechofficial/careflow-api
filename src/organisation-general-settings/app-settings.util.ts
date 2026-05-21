export type OrganisationAppSettings = {
  pinCodeRequired: boolean;
  viewPoliciesCareApp: boolean;
  viewPoliciesRosterApp: boolean;
  bookHolidaysCareApp: boolean;
  fingerprintLoginCareApp: boolean;
};

export const DEFAULT_APP_SETTINGS: OrganisationAppSettings = {
  pinCodeRequired: false,
  viewPoliciesCareApp: true,
  viewPoliciesRosterApp: true,
  bookHolidaysCareApp: true,
  fingerprintLoginCareApp: true,
};

export function parseOrganisationAppSettings(
  row: Partial<{
    appSettingPinCodeRequired: boolean;
    appSettingViewPoliciesCareApp: boolean;
    appSettingViewPoliciesRosterApp: boolean;
    appSettingBookHolidaysCareApp: boolean;
    appSettingFingerprintLoginCareApp: boolean;
  }>,
): OrganisationAppSettings {
  return {
    pinCodeRequired: row.appSettingPinCodeRequired ?? DEFAULT_APP_SETTINGS.pinCodeRequired,
    viewPoliciesCareApp:
      row.appSettingViewPoliciesCareApp ?? DEFAULT_APP_SETTINGS.viewPoliciesCareApp,
    viewPoliciesRosterApp:
      row.appSettingViewPoliciesRosterApp ?? DEFAULT_APP_SETTINGS.viewPoliciesRosterApp,
    bookHolidaysCareApp:
      row.appSettingBookHolidaysCareApp ?? DEFAULT_APP_SETTINGS.bookHolidaysCareApp,
    fingerprintLoginCareApp:
      row.appSettingFingerprintLoginCareApp ?? DEFAULT_APP_SETTINGS.fingerprintLoginCareApp,
  };
}
