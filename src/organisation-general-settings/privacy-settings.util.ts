export const PRIVACY_SENSITIVE_VIEWER_ROLE_OPTIONS = [
  { key: 'carer_domestic', label: 'Carer/Domestic' },
  { key: 'senior_carer_nurse', label: 'Senior Carer/Nurse' },
  { key: 'staff_allocation', label: 'Staff Allocation' },
] as const;

export type PrivacySensitiveViewerRoleKey =
  (typeof PRIVACY_SENSITIVE_VIEWER_ROLE_OPTIONS)[number]['key'];

export type OrganisationPrivacySettings = {
  nonActiveServiceUserDays: number;
  notifyInternalMessage: boolean;
  notifyEmail: boolean;
  sensitiveViewerRoles: string[];
};

export const DEFAULT_PRIVACY_SETTINGS: OrganisationPrivacySettings = {
  nonActiveServiceUserDays: 60,
  notifyInternalMessage: true,
  notifyEmail: false,
  sensitiveViewerRoles: ['carer_domestic'],
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parseRoles(raw: unknown): string[] {
  const allowed = new Set<string>(PRIVACY_SENSITIVE_VIEWER_ROLE_OPTIONS.map(r => r.key));
  if (!Array.isArray(raw)) return [...DEFAULT_PRIVACY_SETTINGS.sensitiveViewerRoles];
  return raw.filter((id): id is string => typeof id === 'string' && allowed.has(id));
}

export function parseOrganisationPrivacySettings(
  row: Partial<{
    privacyNonActiveServiceUserDays: number;
    privacyNotifyInternalMessage: boolean;
    privacyNotifyEmail: boolean;
    privacySensitiveViewerRoles: unknown;
  }>,
): OrganisationPrivacySettings {
  return {
    nonActiveServiceUserDays: clampInt(
      row.privacyNonActiveServiceUserDays ?? DEFAULT_PRIVACY_SETTINGS.nonActiveServiceUserDays,
      1,
      3650,
    ),
    notifyInternalMessage:
      row.privacyNotifyInternalMessage ?? DEFAULT_PRIVACY_SETTINGS.notifyInternalMessage,
    notifyEmail: row.privacyNotifyEmail ?? DEFAULT_PRIVACY_SETTINGS.notifyEmail,
    sensitiveViewerRoles: parseRoles(row.privacySensitiveViewerRoles),
  };
}
