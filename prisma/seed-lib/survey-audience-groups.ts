/**
 * "Who it's for": the group a survey is for, on top of its audience type (staff, people we support,
 * public). Shown in the survey list (and its filter), on Results, in the CSV and in CQC evidence.
 * SEVERAL = more than one group in one survey: the survey then asks the standard "Who are you?"
 * question (WHO_ARE_YOU_KEY) and Results can be split by it. Kept free of src/ imports; src imports it.
 */
export const SURVEY_AUDIENCE_GROUPS = {
  PUBLIC: [
    { code: 'PEOPLE_WE_SUPPORT', label: 'People we support' },
    { code: 'FAMILIES', label: 'Families and representatives' },
    { code: 'PROFESSIONALS', label: 'Health and social care professionals' },
    { code: 'COMMISSIONERS', label: 'Commissioners and local authority' },
    { code: 'ADVOCATES', label: 'Advocates and community organisations' },
    { code: 'JOB_APPLICANTS', label: 'Job applicants' },
    { code: 'VOLUNTEERS', label: 'Volunteers' },
    { code: 'GENERAL_PUBLIC', label: 'General public' },
    { code: 'OTHER', label: 'Other' },
    { code: 'SEVERAL', label: 'Several groups' },
  ],
  EMPLOYEE: [
    { code: 'ALL_STAFF', label: 'All staff' },
    { code: 'CARE_WORKERS', label: 'Care workers' },
    { code: 'OFFICE_STAFF', label: 'Office staff' },
    { code: 'NEW_STARTERS', label: 'New starters' },
    { code: 'LEAVERS', label: 'Leavers' },
    { code: 'MANAGERS', label: 'Managers' },
    { code: 'OTHER', label: 'Other' },
    { code: 'SEVERAL', label: 'Several groups' },
  ],
  SERVICE_USER: [
    { code: 'ALL_PEOPLE', label: 'All people we support' },
    { code: 'NEW_CLIENTS', label: 'People new to our care' },
    { code: 'REVIEW_DUE', label: 'People due a care review' },
    { code: 'HOME_FROM_HOSPITAL', label: 'People home from hospital' },
    { code: 'LEAVING_CARE', label: 'People leaving our care' },
    { code: 'MADE_A_COMPLAINT', label: 'People who made a complaint' },
    { code: 'OTHER', label: 'Other' },
    { code: 'SEVERAL', label: 'Several groups' },
  ],
} as const;

export type SurveyAudienceKind = keyof typeof SURVEY_AUDIENCE_GROUPS;

/** The standard "Who are you?" question of a Several groups survey (its key). */
export const WHO_ARE_YOU_KEY = 'who-are-you';
export const WHO_ARE_YOU_TEXT = 'Who are you?';

/** The groups a survey of this audience type can be for. */
export function audienceGroupsFor(kind: string): ReadonlyArray<{ code: string; label: string }> {
  return (SURVEY_AUDIENCE_GROUPS as Record<string, ReadonlyArray<{ code: string; label: string }>>)[kind] ?? [];
}

/** The label of a group ("Other" shows the organisation's words). */
export function audienceGroupLabel(kind: string, code: string | null | undefined, other?: string | null): string | null {
  if (!code) return null;
  if (code === 'OTHER' && other?.trim()) return other.trim();
  return audienceGroupsFor(kind).find((g) => g.code === code)?.label ?? null;
}

/**
 * "Prefer not to say" on the standard "Who are you?" question: counted in the overall figures, never a
 * group of its own (no group view, no count beside the groups). Its answers still block single-group
 * views while they are fewer than the reporting threshold, or overall minus the groups would show them.
 */
export const WHO_ARE_YOU_PREFER_NOT = 'Prefer not to say';
/** The "Other" choice of the standard question (its otherOption, shown after the answers). */
export const WHO_ARE_YOU_OTHER = 'Other (please tell us)';

/**
 * The answers of the standard "Who are you?" question: the audience's groups (not Several or Other),
 * then "Prefer not to say". "Other (please tell us)" is the question's Other choice, not an answer here.
 */
export function whoAreYouOptions(kind: string): string[] {
  return audienceGroupsFor(kind)
    .filter((g) => g.code !== 'SEVERAL' && g.code !== 'OTHER')
    .map((g) => g.label)
    .concat(WHO_ARE_YOU_PREFER_NOT);
}

/**
 * Problems with a "Who are you?" question's answers: each must be one of the audience's groups, and
 * "Prefer not to say" must be there, last.
 */
export function whoAreYouOptionProblems(kind: string, options: unknown): string[] {
  const list = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
  const allowed = whoAreYouOptions(kind);
  const problems: string[] = [];
  const unknown = list.filter((o) => !allowed.includes(o));
  if (unknown.length) problems.push(`"Who are you?" answers must be the audience's groups (${allowed.join(', ')}); not ${unknown.join(', ')}`);
  if (list[list.length - 1] !== WHO_ARE_YOU_PREFER_NOT) problems.push(`"Who are you?" must end with "${WHO_ARE_YOU_PREFER_NOT}"`);
  if (list.filter((o) => o !== WHO_ARE_YOU_PREFER_NOT).length < 2) problems.push('"Who are you?" needs at least two groups');
  return problems;
}

/** A ready-made survey's group when its file does not say: from its library group. */
export function defaultLibraryAudienceGroup(groupShort: string, audience: string): string {
  if (groupShort === 'FAM') return 'FAMILIES';
  if (groupShort === 'PRO') return 'PROFESSIONALS';
  if (groupShort === 'APP') return 'JOB_APPLICANTS';
  if (audience === 'EMPLOYEE') return 'ALL_STAFF';
  if (audience === 'SERVICE_USER') return 'ALL_PEOPLE';
  return 'GENERAL_PUBLIC';
}
