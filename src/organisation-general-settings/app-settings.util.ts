export type OrganisationAppSettings = {
  pinCodeRequired: boolean;
  viewPoliciesCareApp: boolean;
  viewPoliciesRosterApp: boolean;
  bookHolidaysCareApp: boolean;
  fingerprintLoginCareApp: boolean;
  singleDeviceLoginCareApp: boolean;
  /** Care app: with more than one phone allowed, the most at once (0 = no limit). */
  maxDevicesCareApp: number;
  /** Office website: one person signed in on more than one browser or device. */
  officeMultipleDeviceLogin: boolean;
  /** Office website: with more than one allowed, the most at once (0 = no limit). */
  officeMaxDevices: number;
};

export const DEFAULT_APP_SETTINGS: OrganisationAppSettings = {
  pinCodeRequired: false,
  viewPoliciesCareApp: true,
  viewPoliciesRosterApp: true,
  bookHolidaysCareApp: true,
  fingerprintLoginCareApp: true,
  singleDeviceLoginCareApp: false,
  maxDevicesCareApp: 0,
  officeMultipleDeviceLogin: true,
  officeMaxDevices: 0,
};

export function parseOrganisationAppSettings(
  row: Partial<{
    appSettingPinCodeRequired: boolean;
    appSettingViewPoliciesCareApp: boolean;
    appSettingViewPoliciesRosterApp: boolean;
    appSettingBookHolidaysCareApp: boolean;
    appSettingFingerprintLoginCareApp: boolean;
    appSettingSingleDeviceLoginCareApp: boolean;
    appSettingMaxDevicesCareApp: number;
    officeMultipleDeviceLogin: boolean;
    officeMaxDevices: number;
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
    maxDevicesCareApp: row.appSettingMaxDevicesCareApp ?? DEFAULT_APP_SETTINGS.maxDevicesCareApp,
    officeMultipleDeviceLogin: row.officeMultipleDeviceLogin ?? DEFAULT_APP_SETTINGS.officeMultipleDeviceLogin,
    officeMaxDevices: row.officeMaxDevices ?? DEFAULT_APP_SETTINGS.officeMaxDevices,
  };
}
