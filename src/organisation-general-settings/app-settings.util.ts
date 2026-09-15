export type OrganisationAppSettings = {
  pinCodeRequired: boolean;
  viewPoliciesCareApp: boolean;
  viewPoliciesRosterApp: boolean;
  bookHolidaysCareApp: boolean;
  fingerprintLoginCareApp: boolean;
  singleDeviceLoginCareApp: boolean;
};

export const DEFAULT_APP_SETTINGS: OrganisationAppSettings = {
  pinCodeRequired: false,
  viewPoliciesCareApp: true,
  viewPoliciesRosterApp: true,
  bookHolidaysCareApp: true,
  fingerprintLoginCareApp: true,
  singleDeviceLoginCareApp: false,
};

export function parseOrganisationAppSettings(
  row: Partial<{
    appSettingPinCodeRequired: boolean;
    appSettingViewPoliciesCareApp: boolean;
    appSettingViewPoliciesRosterApp: boolean;
    appSettingBookHolidaysCareApp: boolean;
    appSettingFingerprintLoginCareApp: boolean;
    appSettingSingleDeviceLoginCareApp: boolean;
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
    singleDeviceLoginCareApp:
      row.appSettingSingleDeviceLoginCareApp ?? DEFAULT_APP_SETTINGS.singleDeviceLoginCareApp,
  };
}
