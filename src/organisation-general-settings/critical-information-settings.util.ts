export type OrganisationCriticalInformationSettings = {
  generateActions: boolean;
  memorableAnswerRequired: boolean;
  lockdownWebAccess: boolean;
  lockdownCareAppAccess: boolean;
};

export const DEFAULT_CRITICAL_INFORMATION_SETTINGS: OrganisationCriticalInformationSettings =
  {
    generateActions: true,
    memorableAnswerRequired: false,
    lockdownWebAccess: false,
    lockdownCareAppAccess: false,
  };

export function parseOrganisationCriticalInformationSettings(
  row: Partial<{
    criticalGenerateActions: boolean;
    criticalMemorableAnswerRequired: boolean;
    criticalLockdownWebAccess: boolean;
    criticalLockdownCareAppAccess: boolean;
  }>,
): OrganisationCriticalInformationSettings {
  return {
    generateActions:
      row.criticalGenerateActions ?? DEFAULT_CRITICAL_INFORMATION_SETTINGS.generateActions,
    memorableAnswerRequired:
      row.criticalMemorableAnswerRequired ??
      DEFAULT_CRITICAL_INFORMATION_SETTINGS.memorableAnswerRequired,
    lockdownWebAccess:
      row.criticalLockdownWebAccess ?? DEFAULT_CRITICAL_INFORMATION_SETTINGS.lockdownWebAccess,
    lockdownCareAppAccess:
      row.criticalLockdownCareAppAccess ??
      DEFAULT_CRITICAL_INFORMATION_SETTINGS.lockdownCareAppAccess,
  };
}
