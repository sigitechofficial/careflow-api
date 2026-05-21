import type { Prisma } from '@prisma/client';

export type OptionalAboutMeField = {
  key: string;
  label: string;
  enabled: boolean;
};

export type OptionalFamilyShareVisitInfo = {
  recordedNotes: boolean;
  checklists: boolean;
  photographs: boolean;
  medications: boolean;
};

export type OrganisationOptionalSettings = {
  emarIntegration: boolean;
  medicationListRequired: boolean;
  medicationAmendRoles: string[];
  mhaDetentionRequired: boolean;
  restraintRecordingRequired: boolean;
  carePlanReadRequired: boolean;
  carePlanReadCycleMonths: number;
  formBuilderRequired: boolean;
  removeCreateNewCarePlan: boolean;
  aboutMeFields: OptionalAboutMeField[];
  serviceManagementRequired: boolean;
  learningDevSessionsRequired: boolean;
  familyPortalEnabled: boolean;
  familySharingAuthRequired: boolean;
  familyShareAllActions: boolean;
  familyShareCarePlans: boolean;
  familyShareVisitInfo: OptionalFamilyShareVisitInfo;
  allowInspectorLogin: boolean;
};

export const MEDICATION_AMEND_ROLE_OPTIONS = [
  { key: 'area_supervisor', label: 'Area Supervisor' },
  { key: 'allocator_coordinator', label: 'Allocator Coordinator' },
  { key: 'care_manager', label: 'Care Manager' },
] as const;

export const DEFAULT_OPTIONAL_ABOUT_ME_FIELDS: OptionalAboutMeField[] = [
  { key: 'interests', label: 'Interests', enabled: true },
  { key: 'life_history', label: 'My Life History', enabled: true },
  { key: 'daily_routine', label: 'My Daily Routine', enabled: true },
  { key: 'support_needed', label: 'Support I Need', enabled: true },
  { key: 'favourite_things', label: 'My Favourite Things', enabled: true },
  { key: 'identification', label: 'Identification Characteristics', enabled: true },
];

export const DEFAULT_OPTIONAL_SETTINGS: OrganisationOptionalSettings = {
  emarIntegration: false,
  medicationListRequired: true,
  medicationAmendRoles: MEDICATION_AMEND_ROLE_OPTIONS.map((r) => r.key),
  mhaDetentionRequired: false,
  restraintRecordingRequired: false,
  carePlanReadRequired: true,
  carePlanReadCycleMonths: 1,
  formBuilderRequired: true,
  removeCreateNewCarePlan: true,
  aboutMeFields: DEFAULT_OPTIONAL_ABOUT_ME_FIELDS.map((f) => ({ ...f })),
  serviceManagementRequired: true,
  learningDevSessionsRequired: true,
  familyPortalEnabled: true,
  familySharingAuthRequired: false,
  familyShareAllActions: true,
  familyShareCarePlans: true,
  familyShareVisitInfo: {
    recordedNotes: true,
    checklists: true,
    photographs: true,
    medications: true,
  },
  allowInspectorLogin: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAboutMe(raw: unknown): OptionalAboutMeField[] {
  const byKey = new Map<string, OptionalAboutMeField>();
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!isRecord(row)) continue;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      if (!key) continue;
      const def = DEFAULT_OPTIONAL_ABOUT_ME_FIELDS.find((f) => f.key === key);
      const label =
        typeof row.label === 'string' && row.label.trim()
          ? row.label.trim()
          : (def?.label ?? key);
      byKey.set(key, { key, label, enabled: row.enabled !== false });
    }
  }
  return DEFAULT_OPTIONAL_ABOUT_ME_FIELDS.map((def) => {
    const saved = byKey.get(def.key);
    return saved ? { ...def, enabled: saved.enabled } : { ...def };
  });
}

function parseVisitInfo(raw: unknown): OptionalFamilyShareVisitInfo {
  const defaults = DEFAULT_OPTIONAL_SETTINGS.familyShareVisitInfo;
  if (!isRecord(raw)) return { ...defaults };
  return {
    recordedNotes: raw.recordedNotes !== false,
    checklists: raw.checklists !== false,
    photographs: raw.photographs !== false,
    medications: raw.medications !== false,
  };
}

function parseRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_OPTIONAL_SETTINGS.medicationAmendRoles];
  const allowed = new Set<string>(MEDICATION_AMEND_ROLE_OPTIONS.map((r) => r.key));
  return raw.filter((id): id is string => typeof id === 'string' && allowed.has(id));
}

export type OptionalSettingsRow = {
  optionalEmarIntegration: boolean;
  optionalMedicationListRequired: boolean;
  optionalMedicationAmendRoles: unknown;
  optionalMhaDetentionRequired: boolean;
  optionalRestraintRecordingRequired: boolean;
  optionalCarePlanReadRequired: boolean;
  optionalCarePlanReadCycleMonths: number;
  optionalFormBuilderRequired: boolean;
  optionalRemoveCreateNewCarePlan: boolean;
  optionalAboutMeFields: unknown;
  optionalServiceManagementRequired: boolean;
  optionalLearningDevSessionsRequired: boolean;
  optionalFamilyPortalEnabled: boolean;
  optionalFamilySharingAuthRequired: boolean;
  optionalFamilyShareAllActions: boolean;
  optionalFamilyShareCarePlans: boolean;
  optionalFamilyShareVisitInfo: unknown;
  optionalAllowInspectorLogin: boolean;
};

export function parseOrganisationOptionalSettings(row: Partial<OptionalSettingsRow>): OrganisationOptionalSettings {
  return {
    emarIntegration: row.optionalEmarIntegration ?? DEFAULT_OPTIONAL_SETTINGS.emarIntegration,
    medicationListRequired:
      row.optionalMedicationListRequired ?? DEFAULT_OPTIONAL_SETTINGS.medicationListRequired,
    medicationAmendRoles: parseRoles(row.optionalMedicationAmendRoles),
    mhaDetentionRequired: row.optionalMhaDetentionRequired ?? DEFAULT_OPTIONAL_SETTINGS.mhaDetentionRequired,
    restraintRecordingRequired:
      row.optionalRestraintRecordingRequired ?? DEFAULT_OPTIONAL_SETTINGS.restraintRecordingRequired,
    carePlanReadRequired: row.optionalCarePlanReadRequired ?? DEFAULT_OPTIONAL_SETTINGS.carePlanReadRequired,
    carePlanReadCycleMonths: Math.min(
      60,
      Math.max(1, Math.round(row.optionalCarePlanReadCycleMonths ?? 1)),
    ),
    formBuilderRequired: row.optionalFormBuilderRequired ?? DEFAULT_OPTIONAL_SETTINGS.formBuilderRequired,
    removeCreateNewCarePlan:
      row.optionalRemoveCreateNewCarePlan ?? DEFAULT_OPTIONAL_SETTINGS.removeCreateNewCarePlan,
    aboutMeFields: parseAboutMe(row.optionalAboutMeFields),
    serviceManagementRequired:
      row.optionalServiceManagementRequired ?? DEFAULT_OPTIONAL_SETTINGS.serviceManagementRequired,
    learningDevSessionsRequired:
      row.optionalLearningDevSessionsRequired ?? DEFAULT_OPTIONAL_SETTINGS.learningDevSessionsRequired,
    familyPortalEnabled: row.optionalFamilyPortalEnabled ?? DEFAULT_OPTIONAL_SETTINGS.familyPortalEnabled,
    familySharingAuthRequired:
      row.optionalFamilySharingAuthRequired ?? DEFAULT_OPTIONAL_SETTINGS.familySharingAuthRequired,
    familyShareAllActions:
      row.optionalFamilyShareAllActions ?? DEFAULT_OPTIONAL_SETTINGS.familyShareAllActions,
    familyShareCarePlans: row.optionalFamilyShareCarePlans ?? DEFAULT_OPTIONAL_SETTINGS.familyShareCarePlans,
    familyShareVisitInfo: parseVisitInfo(row.optionalFamilyShareVisitInfo),
    allowInspectorLogin: row.optionalAllowInspectorLogin ?? DEFAULT_OPTIONAL_SETTINGS.allowInspectorLogin,
  };
}

export function serializeOptionalSettingsPatch(
  s: OrganisationOptionalSettings,
): Partial<Record<keyof OptionalSettingsRow, unknown>> {
  return {
    optionalEmarIntegration: s.emarIntegration,
    optionalMedicationListRequired: s.medicationListRequired,
    optionalMedicationAmendRoles: s.medicationAmendRoles,
    optionalMhaDetentionRequired: s.mhaDetentionRequired,
    optionalRestraintRecordingRequired: s.restraintRecordingRequired,
    optionalCarePlanReadRequired: s.carePlanReadRequired,
    optionalCarePlanReadCycleMonths: s.carePlanReadCycleMonths,
    optionalFormBuilderRequired: s.formBuilderRequired,
    optionalRemoveCreateNewCarePlan: s.removeCreateNewCarePlan,
    optionalAboutMeFields: s.aboutMeFields,
    optionalServiceManagementRequired: s.serviceManagementRequired,
    optionalLearningDevSessionsRequired: s.learningDevSessionsRequired,
    optionalFamilyPortalEnabled: s.familyPortalEnabled,
    optionalFamilySharingAuthRequired: s.familySharingAuthRequired,
    optionalFamilyShareAllActions: s.familyShareAllActions,
    optionalFamilyShareCarePlans: s.familyShareCarePlans,
    optionalFamilyShareVisitInfo: s.familyShareVisitInfo,
    optionalAllowInspectorLogin: s.allowInspectorLogin,
  };
}
