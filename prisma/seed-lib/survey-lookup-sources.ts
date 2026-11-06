/**
 * CareFlow lists a survey choice question can take its options from (instead of fixed options), so
 * equality questions use the organisation's own lists, managed in Settings. Library questions name
 * them in lower case ("optionsFrom": "ethnicity"); stored on SurveyQuestion.optionsFrom in upper case.
 * Kept free of src/ imports (the seed runs without it); src imports it.
 */
export const SURVEY_LOOKUP_SOURCES = {
  ETHNICITY: { table: 'ServiceUserEthnicity', label: 'Ethnic group' },
  SEXUAL_ORIENTATION: { table: 'ServiceUserSexualOrientation', label: 'Sexual orientation' },
  GENDER: { table: 'ServiceUserGender', label: 'Gender' },
  SEX: { table: 'ServiceUserSex', label: 'Sex' },
  LANGUAGE: { table: 'ServiceUserLanguage', label: 'Language' },
  MARITAL_STATUS: { table: 'ServiceUserMaritalStatus', label: 'Marriage or civil partnership' },
} as const;

export type SurveyLookupSource = keyof typeof SURVEY_LOOKUP_SOURCES;
export const SURVEY_LOOKUP_SOURCE_KEYS = Object.keys(SURVEY_LOOKUP_SOURCES) as SurveyLookupSource[];

/** "ethnicity" / "ETHNICITY" → "ETHNICITY"; null when it is not a CareFlow list. */
export function lookupSourceKey(value: unknown): SurveyLookupSource | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (SURVEY_LOOKUP_SOURCE_KEYS as string[]).includes(key) ? (key as SurveyLookupSource) : null;
}

/** Question types that can take their options from a CareFlow list. */
export const LOOKUP_QUESTION_TYPES = ['SINGLE_SELECT', 'MULTI_SELECT'] as const;
