export const PORTAL_PROFILE_REF = {
  suffix: 'SU_PROFILE_SUFFIX',
  maidenName: 'SU_PROFILE_MAIDEN_NAME',
  placeOfBirth: 'SU_PROFILE_PLACE_OF_BIRTH',
  religion: 'SU_PROFILE_RELIGION',
  ethnicity: 'SU_PROFILE_ETHNICITY',
  sexualOrientation: 'SU_PROFILE_SEXUAL_ORIENTATION',
  disability: 'SU_PROFILE_DISABILITY',
  maternity: 'SU_PROFILE_MATERNITY',
  language: 'SU_PROFILE_LANGUAGE',
  preferredContactMethod: 'SU_PROFILE_PREF_CONTACT',
  emailType: 'SU_PROFILE_EMAIL_TYPE',
  otherContactMethod: 'SU_PROFILE_OTHER_CONTACT',
  dateOfDeath: 'SU_PROFILE_DATE_OF_DEATH',
} as const;

export type PortalProfileExtras = {
  suffix: string | null;
  maidenName: string | null;
  placeOfBirth: string | null;
  religion: string | null;
  ethnicity: string | null;
  sexualOrientation: string | null;
  disability: string | null;
  maternity: string | null;
  language: string | null;
  preferredContactMethod: string | null;
  emailType: string | null;
  otherContactMethod: string | null;
  dateOfDeath: string | null;
  asNumber: string | null;
};

export function parsePortalProfileExtras(
  references: Array<{ referenceType: string; referenceValue: string }>,
): PortalProfileExtras {
  const byType = new Map(references.map(r => [r.referenceType, r.referenceValue]));
  const val = (key: string) => byType.get(key)?.trim() || null;
  return {
    suffix: val(PORTAL_PROFILE_REF.suffix),
    maidenName: val(PORTAL_PROFILE_REF.maidenName),
    placeOfBirth: val(PORTAL_PROFILE_REF.placeOfBirth),
    religion: val(PORTAL_PROFILE_REF.religion),
    ethnicity: val(PORTAL_PROFILE_REF.ethnicity),
    sexualOrientation: val(PORTAL_PROFILE_REF.sexualOrientation),
    disability: val(PORTAL_PROFILE_REF.disability),
    maternity: val(PORTAL_PROFILE_REF.maternity),
    language: val(PORTAL_PROFILE_REF.language),
    preferredContactMethod: val(PORTAL_PROFILE_REF.preferredContactMethod),
    emailType: val(PORTAL_PROFILE_REF.emailType),
    otherContactMethod: val(PORTAL_PROFILE_REF.otherContactMethod),
    dateOfDeath: val(PORTAL_PROFILE_REF.dateOfDeath),
    asNumber: val('AS_NUMBER'),
  };
}
