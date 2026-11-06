import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadPolicyLibrary } from './policy-library';

/**
 * CareFlow survey library: ready-made surveys for a CQC-registered home care provider. An
 * organisation adopts one as its own (company-wide) survey template from Surveys → Ready-made
 * surveys, then uses the template to start a survey as usual.
 *
 * Files: prisma/seed-data/survey-library/<group>/group.json plus one SUR-XXX-NNN.json per survey
 * (format: see the file format notes in the survey library brief). `{{organisation}}` in the text
 * becomes the organisation's name (company profile) when a survey is shown or adopted.
 *
 * Seeds must not import from src/, so the question rules below repeat
 * src/surveys/survey-question-config.util.ts; a spec checks that both agree.
 */

import { SURVEY_LOOKUP_SOURCE_KEYS, lookupSourceKey } from './survey-lookup-sources';
import { WHO_ARE_YOU_KEY, audienceGroupsFor, defaultLibraryAudienceGroup, whoAreYouOptionProblems, WHO_ARE_YOU_PREFER_NOT } from './survey-audience-groups';
import { SURVEY_ALERT_OWNER_KEYS, alertRuleProblems, type LibraryAlertRule, type SurveyAlertOwnerKey } from './survey-alert-rules';
export const ORGANISATION_TOKEN = '{{organisation}}';
/** Where the manager's name goes in a survey about each manager (perManager). */
export const MANAGER_MERGE_TOKEN = '{{manager}}';

/** Library groups: short code (used in references), folder code, name, order. */
export const SURVEY_LIBRARY_GROUPS = [
  { short: 'PWS', code: 'PEOPLE_WE_SUPPORT', name: 'People we support', displayOrder: 10 },
  { short: 'FAM', code: 'FAMILIES_AND_REPRESENTATIVES', name: 'Families and representatives', displayOrder: 20 },
  { short: 'STF', code: 'STAFF', name: 'Staff', displayOrder: 30 },
  { short: 'PRO', code: 'PROFESSIONALS_AND_PARTNERS', name: 'Professionals and partners', displayOrder: 40 },
  { short: 'CQC', code: 'INSPECTION_READINESS', name: 'Inspection readiness', displayOrder: 45 },
  { short: 'ORG', code: 'ORGANISATION_WIDE', name: 'Organisation-wide', displayOrder: 50 },
  { short: 'APP', code: 'JOB_APPLICANTS', name: 'Job applicants', displayOrder: 60 },
] as const;
export type SurveyGroupShort = (typeof SURVEY_LIBRARY_GROUPS)[number]['short'];

export const SURVEY_AUDIENCES = ['EMPLOYEE', 'SERVICE_USER', 'PUBLIC'] as const;
export const SURVEY_CHANNELS = ['ONLINE', 'PORTAL', 'TELEPHONE', 'PAPER', 'IN_PERSON'] as const;
export const SURVEY_RECURRENCES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const SURVEY_QUESTION_TYPES = [
  'YES_NO',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'RATING',
  'LIKERT',
] as const;
export const CQC_KEY_QUESTIONS = ['SAFE', 'EFFECTIVE', 'CARING', 'RESPONSIVE', 'WELL_LED'] as const;

/** Which CareFlow survey audience (targetKind) each group may use. */
const GROUP_AUDIENCES: Record<SurveyGroupShort, ReadonlyArray<(typeof SURVEY_AUDIENCES)[number]>> = {
  // PUBLIC: open forms with a public link or QR code (for example feedback at any time); still person-facing.
  PWS: ['SERVICE_USER', 'PUBLIC'],
  FAM: ['SERVICE_USER', 'PUBLIC'],
  STF: ['EMPLOYEE'],
  PRO: ['PUBLIC'],
  // Inspection readiness: the independent quality review with people we support, its staff
  // questionnaire and the Registered Manager's self-assessment; each survey picks its audience.
  CQC: ['EMPLOYEE', 'SERVICE_USER', 'PUBLIC'],
  ORG: ['EMPLOYEE', 'SERVICE_USER', 'PUBLIC'],
  APP: ['PUBLIC'],
};

export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];
export type LibrarySurveyQuestion = {
  text: string;
  type: SurveyQuestionType;
  required: boolean;
  helpText?: string;
  options?: string[];
  config?: { min: number; max: number };
  /** CQC quality statement the answer evidences (managers only). */
  evidence?: string;
  /** SINGLE_SELECT / MULTI_SELECT: an "Other" choice; choosing it shows a text box. */
  otherOption?: { label?: string; textPrompt?: string; textRequired?: boolean };
  /** MULTI_SELECT: options that clear every other tick ("None of these"). */
  exclusiveOptions?: string[];
  /**
   * SINGLE_SELECT / MULTI_SELECT / LIKERT: answers left out of percentages ("Don't know", "Prefer
   * not to say", "Not applicable", "Does not apply to me"); stored in the question's config.
   */
  notCountedOptions?: string[];
  /** A text box alongside the answer; showWhen omitted = after any answer. Not TEXT / TEXTAREA. */
  comment?: { prompt?: string; showWhen?: string[] };
  /** Ask only when an earlier question (by its id) has one of these answers. */
  showIf?: { question: string; answers: string[] };
  /** Stable id, needed only when another question's showIf refers to this one. */
  id?: string;
  /**
   * SINGLE_SELECT / MULTI_SELECT: take the options from a CareFlow list instead of `options`
   * ("ethnicity", "sexual_orientation", "gender", "sex", "language", "marital_status"), so the
   * organisation's own list (Settings) is used. Equality questions: answers are reported by group.
   */
  optionsFrom?: string;
};
export type LibrarySurveySection = {
  title: string;
  /** Optional: one or two short sentences shown under the heading to people answering (at most 300 characters). */
  introduction?: string;
  questions: LibrarySurveyQuestion[];
};
export type LibrarySource = { source: string; url: string };
/** An alert in words; `rule` (optional) makes it a task when the answers match (see survey-alert-rules.ts). */
/**
 * An alert in words; `rule` (optional) makes it a task when the answers match (see survey-alert-rules.ts).
 * Its position is its identity once released: one no longer wanted stays in place with `retired: true`.
 */
export type LibrarySurveyAlert = { when: string; action: string; rule?: LibraryAlertRule; retired?: boolean };
export type LibrarySurveyGuidance = { howToRun: string[]; actingOnResults: string[]; alerts: LibrarySurveyAlert[] };

export type LibrarySurvey = {
  reference: string;
  /** Library revision, from 1. Raised whenever the survey changes after release; adopters are told. */
  revision: number;
  /** What changed in this revision (required from revision 2). */
  revisionNote?: string;
  title: string;
  audience: (typeof SURVEY_AUDIENCES)[number];
  respondents: string;
  summary: string;
  purpose: string;
  timing: {
    when: string;
    recurrence: (typeof SURVEY_RECURRENCES)[number] | null;
    trigger: string | null;
    /**
     * The 4-week contact rule (optional; absent = both true). holdBack false: this survey is sent even to
     * people surveyed in the last 4 weeks (its timing is set by an event or a schedule the guidance says
     * comes first). countsAsContact false: being sent it does not hold people back from other surveys.
     * whenHeld (optional, default "delay"): "skip" means people held back are not sent it at all this time
     * (routine and sampled surveys, staff priority tier 4). reason (required, 5–300 characters): why this
     * survey differs from the default, shown to managers. Absent rule: both true, except anonymous staff
     * surveys, which follow the all-staff calendar (neither). CareFlow enforces it
     * (src/surveys/survey-contact-rule.util.ts).
     */
    contactRule?: { holdBack: boolean; countsAsContact: boolean; whenHeld?: 'delay' | 'skip'; reason: string };
    /**
     * Linked parts sent together as one contact (e.g. SUR-STF-001 with SUR-STF-012): copies sent within a
     * few days of each other never hold each other back. Each reference must exist and list this one back.
     */
    sentWith?: string[];
    /** Required when recurrence is WEEKLY (asks the same people more often than every 4 weeks): why (5–300 characters). */
    repeatReason?: string;
  };
  anonymous: boolean;
  /**
   * Named surveys only (optional, default false): each person may choose to answer online without
   * their name; the answer is then kept like an anonymous one and the contact-me question is not
   * asked. The privacy notice must then say people can answer without their name.
   */
  allowAnonymousResponses?: boolean;
  channels: Array<(typeof SURVEY_CHANNELS)[number]>;
  estimatedMinutes: number;
  cqc: { keyQuestions: Array<(typeof CQC_KEY_QUESTIONS)[number]>; qualityStatements: string[] };
  introduction: string;
  privacyNotice: string;
  /**
   * Staff surveys about each manager (SUR-STF-018): true lets the text say {{manager}} where the
   * manager's name goes. Organisations then use "Make a copy for each manager"; the survey itself
   * is never sent. Not in answer options (alert rules check them word for word).
   */
  perManager?: boolean;
  /**
   * With perManager: library roles (SURVEY_ALERT_OWNERS keys, resolved through the organisation's
   * who-handles-alerts role mapping) whose own staff are never asked (e.g. REGISTERED_MANAGER:
   * their direct reports include whoever reads the answers). No copy, and never pooled.
   */
  perManagerExclude?: SurveyAlertOwnerKey[];
  /**
   * With perManager: the fewest staff a manager's own copy is sent to (default 5, PER_MANAGER_MIN_TEAM
   * to PER_MANAGER_MAX_TEAM). Smaller teams share the pooled copy, which needs this many in all too.
   * Raise it where a few answers could still point at someone (e.g. a team that knows each other well).
   */
  perManagerMinTeam?: number;
  /**
   * Optional: shown to people after they submit (the closing screen), at most 600 characters, e.g.
   * where the right answers to knowledge questions are, what happens next or where to get help.
   */
  closingMessage?: string;
  sections: LibrarySurveySection[];
  managerGuidance: LibrarySurveyGuidance;
  relatedPolicies: string[];
  regulatoryBasis: LibrarySource[];
  /**
   * Optional default access (organisations can change it): who may see individual responses and
   * written answers (`responses`) and the figures (`results`), as library roles
   * (SURVEY_ALERT_OWNERS keys, mapped to the organisation's roles); survey managers and admins
   * keep access. `reportingThreshold`: fewest responses before any figures show (5–50; anonymous
   * surveys and ones offering "answer without my name" at least 5).
   */
  access?: LibrarySurveyAccess;
  /**
   * Who it's for (survey-audience-groups.ts; not OTHER). Omitted: from the library group (families,
   * professionals, applicants) or the audience (all staff, all people we support, general public).
   * SEVERAL needs the standard "Who are you?" question (id "who-are-you").
   */
  audienceGroup?: string;
  /**
   * Library roles this survey's alerts must never go to, because the survey rates them (e.g.
   * CARE_COORDINATOR on a survey about the rota): an alert for them goes to the next role up.
   */
  alertsNeverTo?: SurveyAlertOwnerKey[];
  /**
   * Released questions taken out (see ReleasedSurveyIds): the id, the revision it went in and why.
   * Their ids are never used again. Kept for good, so every adopter's update can be mapped.
   */
  retiredQuestions?: Array<{ id: string; revision: number; reason: string }>;
  /**
   * Released answers renamed or taken out: what an organisation's alert rule on `from` should check
   * instead (`to`), or null when nothing replaces it. Kept for good.
   */
  answerChanges?: Array<{ question: string; from: string; to: string | null; revision: number }>;
  /**
   * Named surveys only: an anonymous version an organisation can choose instead at New survey (then
   * fixed). It has its own introduction and privacy notice. The contact-me question (and its own
   * contact-details questions), the questions listed in leaveOut (ids of questions that only make
   * sense with a name) and any alert rule on them or for contact-me are left out; leaveOutAlerts
   * (alert numbers, from 1) leaves out alerts in words that need a name. Optional access replaces
   * the survey's (anonymous: at least 5 responses before any figures show).
   */
  anonymousVariant?: LibraryAnonymousVariant;
};

export type LibraryAnonymousVariant = {
  introduction: string;
  privacyNotice: string;
  /** Its own closing message (else the survey's). */
  closingMessage?: string;
  leaveOut?: string[];
  leaveOutAlerts?: number[];
  access?: LibrarySurveyAccess;
};

export type LibrarySurveyAccess = {
  responses?: SurveyAlertOwnerKey[];
  results?: SurveyAlertOwnerKey[];
  reportingThreshold?: number;
};

export type SurveyLibraryGroup = { code: string; name: string; researchedOn: string; displayOrder: number };
export type SurveyLibraryFile = { group: SurveyLibraryGroup & { short: SurveyGroupShort }; surveys: LibrarySurvey[] };

export const REFERENCE_PATTERN = /^SUR-(PWS|FAM|STF|PRO|CQC|ORG|APP)-\d{3}$/;
const POLICY_REFERENCE_PATTERN = /^POL-[A-Z]+-\d{3}$/;

const TEXT_LIMITS = { introduction: [30, 150], privacyNotice: [40, 200], questionWords: 25 } as const;

/** Wording that belongs in an unfinished draft, never in a survey. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\[|\]/, 'square-bracket placeholder'],
  [/\b(TBC|TBA|TODO|XXX?)\b/, 'unfinished marker'],
  [/lorem ipsum|placeholder|insert (name|date|details|here)/i, 'placeholder text'],
  [/<\/?[a-z][^>]*>/i, 'HTML markup'],
  [/\{\{(?!organisation\}\})/, 'an unknown {{token}}'],
];
/** Respondents never see the word "template" (the adopted survey is a template in CareFlow, not to them). */
const RESPONDENT_FORBIDDEN: Array<[RegExp, string]> = [[/\btemplates?\b/i, 'the word "template"']];

/** Personal details an anonymous survey must never ask for. */
const IDENTIFYING: Array<[RegExp, string]> = [
  [/\bdate of birth\b|\bD\.?O\.?B\b|\bwhen were you born\b/i, 'date of birth'],
  [/\bNHS (number|no\.?)\b/i, 'NHS number'],
  [/\b(staff|employee|payroll|personnel) (number|no\.?|id)\b/i, 'staff number'],
  [/\b(your|their)\s+e-?mail\b|\be-?mail address\b/i, 'email address'],
];
/** Asked for in a free-entry question ("What is your name?", "Your phone number"). */
const IDENTIFYING_ENTRY: Array<[RegExp, string]> = [
  [/\b(your|their|the person's|full|first|last|sur)\s*name\b|^\s*name\b/i, 'name'],
  [/\b(your|their|home|postal)\s+(address|post ?code)\b|^\s*(address|post ?code)\b/i, 'address'],
  [/\b(your|their|contact|tele)?\s*(phone|mobile|telephone)\s*(number|no\.?)\b/i, 'phone number'],
];
const NEGATED = /\b(do not|don't|does not|doesn't|without|no need to|never|not)\b/i;
const FREE_ENTRY: SurveyQuestionType[] = ['TEXT', 'TEXTAREA', 'NUMBER'];

export const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Respondents read the introduction then the privacy notice as the survey description. The API
 * accepts descriptions of at most 2000 characters (CreateSurveyDto / UpdateSurveyDto), and the
 * builder sends the description back whenever a template's details are saved, so a longer one
 * could not be edited. 200 characters are left for the organisation name that replaces the token.
 */
export const MAX_DESCRIPTION_LENGTH = 1800;

/** What respondents read before the questions: the introduction, then the privacy notice. */
export function surveyDescription(s: Pick<LibrarySurvey, 'introduction' | 'privacyNotice'>): string {
  return `${s.introduction.trim()}\n\n${s.privacyNotice.trim()}`;
}

// ─── House style for respondent-facing surveys ───

/** The first question of every survey for people we support and their families. */
export const OVERALL_QUESTION = 'Overall, how was your experience of our service?';
export const OVERALL_OPTIONS = ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor', "Don't know"] as const;
/** The last question of a named survey for people we support and their families (optional YES_NO). */
export const CONTACT_ME_PREFIX = 'Would you like someone to contact you';
/** A privacy notice offering people the choice to answer without their name says so in these words. */
export const ANSWER_WITHOUT_NAME_WORDING = /\bwithout (your|their) name\b/i;
/** Every survey for people we support, families and staff says so in its introduction. */
export const URGENT_CONCERNS_SENTENCE = 'This survey is not for urgent concerns';

/** The five-point answer scales surveys use (LIKERT custom labels, and SINGLE_SELECT scales). */
export const STANDARD_SCALES: ReadonlyArray<readonly string[]> = [
  ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'],
  ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor'],
  ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'],
  ['Very satisfied', 'Satisfied', 'Neither satisfied nor dissatisfied', 'Dissatisfied', 'Very dissatisfied'],
];
/** The only answers a SINGLE_SELECT may add after a standard scale. */
export const SCALE_EXTRAS = ['Does not apply to me', "Don't know"] as const;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Why a question's scale breaks the house style, or null. */
export function scaleProblem(q: Pick<LibrarySurveyQuestion, 'type' | 'options'>): string | null {
  const options = (q.options ?? []).map((o) => (typeof o === 'string' ? o.trim() : String(o)));
  if (q.type === 'LIKERT') {
    if (!options.length || STANDARD_SCALES.some((scale) => sameList(scale, options))) return null;
    return `custom LIKERT labels must be one of the standard scales: ${STANDARD_SCALES.map((sc) => sc.join(' / ')).join('; or ')}`;
  }
  if (q.type !== 'SINGLE_SELECT') return null;
  // A SINGLE_SELECT "uses" a scale when three or more of its labels appear.
  const scale = STANDARD_SCALES.find((sc) => sc.filter((label) => options.includes(label)).length >= 3);
  if (!scale) return null;
  const extras = options.slice(scale.length);
  const extrasOk =
    new Set(extras).size === extras.length && extras.every((e) => (SCALE_EXTRAS as readonly string[]).includes(e));
  if (sameList(options.slice(0, scale.length), scale) && extrasOk) return null;
  return `a scale answer must list ${scale.join(' / ')} in that order, then only "${SCALE_EXTRAS.join('" or "')}" at the end`;
}

/** Surveys answered by people we support and their families or representatives. */
export function isPersonFacing(s: Pick<LibrarySurvey, 'reference' | 'audience'>): boolean {
  const group = REFERENCE_PATTERN.exec(s.reference ?? '')?.[1];
  return s.audience === 'SERVICE_USER' || (s.audience === 'PUBLIC' && (group === 'PWS' || group === 'FAM'));
}

/** Surveys answered by the organisation's own staff. */
export function isStaffSurvey(s: Pick<LibrarySurvey, 'reference' | 'audience'>): boolean {
  return s.audience === 'EMPLOYEE' || REFERENCE_PATTERN.exec(s.reference ?? '')?.[1] === 'STF';
}

const isContactMeText = (q: LibrarySurveyQuestion | undefined) =>
  !!q && typeof q.text === 'string' && q.text.trim().startsWith(CONTACT_ME_PREFIX);

/** A contact-details question shown only when the contact-me question (by its id) is answered Yes. */
function isContactDetailOf(q: LibrarySurveyQuestion, contactMe: LibrarySurveyQuestion): boolean {
  const id = typeof contactMe.id === 'string' ? contactMe.id.trim() : '';
  const rule = q.showIf;
  if (!id || !isObject(rule) || typeof rule.question !== 'string' || rule.question.trim() !== id) return false;
  const answers = strings(rule.answers).map((a) => a.trim());
  return answers.length > 0 && answers.every((a) => a === 'Yes');
}

/**
 * The optional "Would you like someone to contact you…" YES_NO that closes the survey: the last
 * question, or followed only by its own contact-details questions (shown only if it is answered Yes).
 */
export function contactMeQuestion(s: Pick<LibrarySurvey, 'sections'>): LibrarySurveyQuestion | null {
  const all = surveyQuestions(s);
  for (let i = all.length - 1; i >= 0; i--) {
    if (isContactMeText(all[i])) {
      const contactMe = all[i];
      return all.slice(i + 1).every((q) => isContactDetailOf(q, contactMe)) ? contactMe : null;
    }
    // Anything after the contact-me question must be one of its own contact-details questions.
    if (!all[i]?.showIf) return null;
  }
  return null;
}

/**
 * Rated questions: every question except optional written answers
 * (TEXT / TEXTAREA) and the closing contact-me question (see contactMeQuestion) when it is an
 * optional YES_NO, as the house style sets it (a required or other-type one is rated like any other).
 */
export function ratedQuestions(s: Pick<LibrarySurvey, 'sections'>): LibrarySurveyQuestion[] {
  const closing = contactMeQuestion(s);
  const contactMe = closing && closing.type === 'YES_NO' && closing.required === false ? closing : null;
  return surveyQuestions(s).filter(
    (q) => q !== contactMe && !((q.type === 'TEXT' || q.type === 'TEXTAREA') && q.required === false),
  );
}

/** "anonymous" in a named survey's text, outside "not anonymous" / "cannot be anonymous". */
export function mentionsAnonymity(text: string): boolean {
  return /\banonym/i.test(text.replace(/\b(not|cannot be) anonymous\b/gi, ''));
}

// ─── Question options and settings (kept in step with src/surveys/survey-question-config.util.ts) ───

const CHOICE_TYPES: SurveyQuestionType[] = ['SINGLE_SELECT', 'MULTI_SELECT'];
const MAX_OPTIONS = 50;
const MAX_OPTION_LENGTH = 200;
const RATING_LIMITS = { min: 0, max: 100 } as const;

const isEmptyValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);

function optionListProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'options must be a list of answers';
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) return 'every option needs some text';
    const option = raw.trim();
    if (option.length > MAX_OPTION_LENGTH) return `options can be at most ${MAX_OPTION_LENGTH} characters`;
    const key = option.toLocaleLowerCase('en-GB');
    if (seen.has(key)) return `"${option}" is listed more than once`;
    seen.add(key);
  }
  if (seen.size < 2) return 'add at least two options';
  if (seen.size > MAX_OPTIONS) return `at most ${MAX_OPTIONS} options`;
  return null;
}

function ratingConfigProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'rating settings must give a lowest and highest score';
  }
  const extra = Object.keys(value).filter((k) => k !== 'min' && k !== 'max');
  if (extra.length) return `unknown rating setting "${extra[0]}"`;
  const { min, max } = value as { min?: unknown; max?: unknown };
  if (!Number.isInteger(min) || !Number.isInteger(max)) return 'the lowest and highest score must be whole numbers';
  if ((min as number) < RATING_LIMITS.min || (max as number) > RATING_LIMITS.max) {
    return `scores must be between ${RATING_LIMITS.min} and ${RATING_LIMITS.max}`;
  }
  if ((min as number) >= (max as number)) return 'the highest score must be above the lowest';
  return null;
}

/**
 * Why a question's options / config cannot be saved for its type, or null when they can. Same rules
 * as normaliseQuestionSettings in the API: choice questions need two or more distinct options,
 * Likert may give custom scale labels, a rating may give whole-number bounds, nothing else has either.
 */
export function questionSettingsProblem(type: string, options: unknown, config: unknown): string | null {
  if (!(SURVEY_QUESTION_TYPES as readonly string[]).includes(type)) return `unknown question type ${type}`;
  const t = type as SurveyQuestionType;
  if (CHOICE_TYPES.includes(t)) {
    const problem = optionListProblem(options ?? []);
    if (problem) return problem;
  } else if (t === 'LIKERT') {
    if (!isEmptyValue(options)) {
      const problem = optionListProblem(options);
      if (problem) return problem;
    }
  } else if (!isEmptyValue(options)) {
    return 'options only apply to choice questions';
  }
  if (t === 'RATING') {
    if (!isEmptyValue(config)) return ratingConfigProblem(config);
  } else if (NOT_COUNTED_TYPES.includes(t)) {
    if (!isEmptyValue(config)) {
      const answers = (t === 'LIKERT' && isEmptyValue(options) ? [...DEFAULT_LIKERT_LABELS] : (options as string[])).map((o) =>
        String(o).trim(),
      );
      return notCountedConfigProblem(config, answers);
    }
  } else if (!isEmptyValue(config)) {
    return 'settings only apply to rating, choice and scale questions';
  }
  return null;
}

/** Question types whose answers can be marked "Not counted in percentages". */
const NOT_COUNTED_TYPES: SurveyQuestionType[] = ['SINGLE_SELECT', 'MULTI_SELECT', 'LIKERT'];
/** The built-in agree-disagree scale (a LIKERT question without its own labels). */
const DEFAULT_LIKERT_LABELS = ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'] as const;

function notCountedConfigProblem(value: unknown, answers: readonly string[]): string | null {
  if (!isObject(value)) return 'settings must list the answers not counted in percentages';
  const extra = Object.keys(value).find((k) => k !== 'notCountedOptions');
  if (extra) return `unknown setting "${extra}"`;
  const raw = value.notCountedOptions;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return null;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !v.trim())) {
    return 'answers not counted in percentages must be a list of answers';
  }
  const marked = new Set<string>();
  for (const v of raw as string[]) {
    if (!answers.includes(v.trim())) return `"${v.trim()}" is marked not counted, but it is not one of the answers`;
    marked.add(v.trim());
  }
  if (marked.size >= answers.length) return 'at least one answer must be counted in the percentages';
  return null;
}

/**
 * Answers that are always left out of percentages ("Don't know" and the like): a library question
 * offering one must mark it in notCountedOptions.
 */
export const STANDARD_NOT_COUNTED = ["Don't know", 'Prefer not to say', 'Not applicable', 'Does not apply to me'] as const;

/** A library question's settings as stored (config): a rating's bounds, or the answers not counted. */
export function libraryQuestionConfig(q: Pick<LibrarySurveyQuestion, 'type' | 'config' | 'notCountedOptions'>): unknown {
  if (q.type === 'RATING') return q.config ?? null;
  if (q.notCountedOptions !== undefined) return { notCountedOptions: q.notCountedOptions };
  return q.config ?? null;
}

// ─── Respondent text and conditional questions (kept in step with survey-question-config.util.ts) ───

const MAX_PROMPT_LENGTH = 200;
const MAX_SHOW_IF_ANSWERS = 50;
const DEFAULT_LIKERT = ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'];
const DEFAULT_OTHER_LABEL = 'Other (please tell us)';
export const QUESTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Keys given to questions without an id (q1, q2 … by position); ids must not look like them. */
const GENERATED_KEY = /^q\d+$/;
const NO_COMMENT_TYPES: SurveyQuestionType[] = ['TEXT', 'TEXTAREA'];
const SHOW_IF_SOURCE_TYPES: SurveyQuestionType[] = ['YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT', 'LIKERT', 'RATING'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const promptOk = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && !!v.trim() && v.trim().length <= MAX_PROMPT_LENGTH);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((o): o is string => typeof o === 'string') : []);

function otherLabelOf(otherOption: unknown): string | null {
  if (!isObject(otherOption)) return null;
  return typeof otherOption.label === 'string' && otherOption.label.trim() ? otherOption.label.trim() : DEFAULT_OTHER_LABEL;
}

/** Every answer a question can be given (YES_NO, choices plus Other, scale labels, rating scores); null for free entry. */
export function questionAnswerChoices(type: string, options: unknown, config: unknown, otherOption: unknown): string[] | null {
  const list = strings(options);
  switch (type) {
    case 'YES_NO':
      return ['Yes', 'No'];
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT': {
      const other = otherLabelOf(otherOption);
      return other ? [...list, other] : list;
    }
    case 'LIKERT':
      return list.length ? list : [...DEFAULT_LIKERT];
    case 'RATING': {
      const c = isObject(config) ? config : {};
      const ok = Number.isInteger(c.min) && Number.isInteger(c.max) && (c.min as number) < (c.max as number);
      const [min, max] = ok ? [c.min as number, c.max as number] : [0, 10];
      return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
    }
    default:
      return null;
  }
}

/**
 * Why a question's Other choice, exclusive options, comment box or show-if rule cannot be saved,
 * or null. Takes the stored shape (commentConfig, showIf.questionKey); same rules as
 * normaliseQuestionLogic in the API.
 */
export function questionLogicProblem(
  type: string,
  options: unknown,
  config: unknown,
  logic: { otherOption?: unknown; exclusiveOptions?: unknown; commentConfig?: unknown; showIf?: unknown },
): string | null {
  const t = type as SurveyQuestionType;
  const optionList = Array.isArray(options) ? strings(options) : null;
  const { otherOption, exclusiveOptions, commentConfig, showIf } = logic;
  if (otherOption !== undefined && otherOption !== null) {
    if (!CHOICE_TYPES.includes(t)) return 'an Other choice only applies to single and multiple choice questions';
    if (!isObject(otherOption)) return 'the Other choice must give a label and a text prompt';
    const extra = Object.keys(otherOption).find((k) => !['label', 'textPrompt', 'textRequired'].includes(k));
    if (extra) return `unknown Other setting "${extra}"`;
    if (!promptOk(otherOption.label)) return `the Other choice needs a label of at most ${MAX_PROMPT_LENGTH} characters`;
    if (!promptOk(otherOption.textPrompt)) {
      return `the Other text box needs a prompt of at most ${MAX_PROMPT_LENGTH} characters`;
    }
    if (otherOption.textRequired !== undefined && typeof otherOption.textRequired !== 'boolean') {
      return 'the Other choice must say whether its text is required (true or false)';
    }
    const label = otherLabelOf(otherOption)!;
    if ((optionList ?? []).some((o) => o.trim().toLocaleLowerCase('en-GB') === label.toLocaleLowerCase('en-GB'))) {
      return `"${label}" is already one of the options; give the Other choice a different label`;
    }
  }
  const noExclusive =
    exclusiveOptions === undefined || exclusiveOptions === null || (Array.isArray(exclusiveOptions) && !exclusiveOptions.length);
  if (!noExclusive) {
    if (t !== 'MULTI_SELECT') return 'only multiple choice questions can have answers that clear the others';
    if (!Array.isArray(exclusiveOptions) || exclusiveOptions.some((v) => typeof v !== 'string' || !v.trim())) {
      return 'answers that clear the others (exclusiveOptions) must be a list of options';
    }
    const missing = (exclusiveOptions as string[]).find((o) => !(optionList ?? []).includes(o.trim()));
    if (missing !== undefined) {
      return `"${missing.trim()}" is set to clear the other answers, but it is not one of the options`;
    }
  }
  if (commentConfig !== undefined && commentConfig !== null) {
    if (NO_COMMENT_TYPES.includes(t)) return 'a comment box does not apply to written-answer questions';
    if (!isObject(commentConfig)) return 'the comment box must give a prompt';
    const extra = Object.keys(commentConfig).find((k) => !['prompt', 'showWhen'].includes(k));
    if (extra) return `unknown comment setting "${extra}"`;
    if (!promptOk(commentConfig.prompt)) return `the comment box needs a prompt of at most ${MAX_PROMPT_LENGTH} characters`;
    const raw = commentConfig.showWhen;
    if (!(raw === undefined || raw === null || (Array.isArray(raw) && !raw.length))) {
      if (!Array.isArray(raw) || raw.some((a) => typeof a !== 'string' || !a.trim())) {
        return 'the comment box answers (showWhen) must be a list of answers';
      }
      const choices = questionAnswerChoices(t, options, config, otherOption);
      if (!choices) return 'a comment box on this question is offered after any answer, so leave out showWhen';
      const missing = (raw as string[]).find((a) => !choices.includes(a.trim()));
      if (missing !== undefined) {
        return `the comment box is set to show after "${missing.trim()}", which is not one of this question's answers`;
      }
    }
  }
  if (showIf !== undefined && showIf !== null) {
    const problem = '"Show only if" needs an earlier question and at least one of its answers';
    if (!isObject(showIf)) return problem;
    const extra = Object.keys(showIf).find((k) => !['questionKey', 'answers'].includes(k));
    if (extra) return `unknown "Show only if" setting "${extra}"`;
    const { questionKey, answers } = showIf;
    if (typeof questionKey !== 'string' || !QUESTION_KEY_PATTERN.test(questionKey.trim())) return problem;
    if (!Array.isArray(answers) || !answers.length || answers.some((a) => typeof a !== 'string' || !a.trim())) {
      return problem;
    }
    if (new Set((answers as string[]).map((a) => a.trim())).size > MAX_SHOW_IF_ANSWERS) {
      return `"Show only if" can list at most ${MAX_SHOW_IF_ANSWERS} answers`;
    }
  }
  return null;
}

export type LogicQuestion = {
  key: string | null;
  questionText: string;
  questionType: string;
  options: unknown;
  config: unknown;
  otherOption: unknown;
  showIf: unknown;
};

const showIfRule = (v: unknown): { questionKey: string; answers: string[] } | null =>
  isObject(v) && typeof v.questionKey === 'string' && Array.isArray(v.answers) && strings(v.answers).length
    ? { questionKey: v.questionKey, answers: strings(v.answers) }
    : null;

/** Survey-wide show-if checks, questions in order; same rules as surveyLogicProblems in the API. */
export function surveyLogicProblems(questions: readonly LogicQuestion[]): string[] {
  const problems: string[] = [];
  const indexByKey = new Map<string, number>();
  questions.forEach((q, i) => {
    if (!q.key) return;
    if (indexByKey.has(q.key)) problems.push(`two questions share the id "${q.key}"`);
    else indexByKey.set(q.key, i);
  });
  questions.forEach((q, i) => {
    const rule = showIfRule(q.showIf);
    if (!rule) return;
    const label = `"${q.questionText.trim().slice(0, 80)}"`;
    const refIndex = indexByKey.get(rule.questionKey);
    if (refIndex === undefined) {
      problems.push(`${label}: "Show only if" refers to a question that is not in this survey`);
      return;
    }
    if (refIndex >= i) {
      problems.push(`${label}: "Show only if" must refer to an earlier question`);
      return;
    }
    const ref = questions[refIndex];
    if (showIfRule(ref.showIf)) {
      problems.push(`${label}: "Show only if" can only refer to a question that is always asked`);
      return;
    }
    if (!SHOW_IF_SOURCE_TYPES.includes(ref.questionType as SurveyQuestionType)) {
      problems.push(`${label}: "Show only if" cannot refer to a written or number answer`);
      return;
    }
    const choices = questionAnswerChoices(ref.questionType, ref.options, ref.config, ref.otherOption) ?? [];
    const missing = rule.answers.find((a) => !choices.includes(a.trim()));
    if (missing !== undefined) {
      problems.push(
        `${label}: "Show only if": "${missing.trim()}" is not one of the answers to "${ref.questionText.trim().slice(0, 80)}"`,
      );
    }
  });
  return problems;
}

/** A library question's settings in the stored shape (comment → commentConfig, showIf.question → questionKey). */
export function storedLogic(q: LibrarySurveyQuestion) {
  const showIf: unknown = q.showIf;
  return {
    otherOption: q.otherOption ?? null,
    exclusiveOptions: Array.isArray(q.exclusiveOptions) && q.exclusiveOptions.length ? q.exclusiveOptions : null,
    commentConfig: q.comment ?? null,
    showIf:
      showIf === undefined || showIf === null
        ? null
        : isObject(showIf) && !('questionKey' in showIf)
          ? { questionKey: showIf.question, answers: showIf.answers }
          : showIf,
  };
}

/**
 * Each question's key: its id; else, once the survey is released, the released key of the question
 * with the same text (so adding a question never moves the others' keys); else q1, q2 … by position
 * (a question added after release takes the next number never used).
 */
export function questionKeys(s: Pick<LibrarySurvey, 'sections'>, released?: ReleasedSurveyIds | null): string[] {
  const questions = surveyQuestions(s);
  const explicit = questions.map((q) => (typeof q.id === 'string' && q.id.trim() ? q.id.trim() : null));
  if (!released) return questions.map((_, i) => explicit[i] ?? `q${i + 1}`);
  const taken = new Set(explicit.filter((k): k is string => k !== null));
  const byText = new Map<string, string>();
  for (const [key, entry] of Object.entries(released.questions)) {
    if (GENERATED_KEY.test(key) && !entry.retiredIn && !taken.has(key)) byText.set(releasedText(entry.text), key);
  }
  let next = Math.max(0, ...Object.keys(released.questions).filter((k) => GENERATED_KEY.test(k)).map((k) => Number(k.slice(1))));
  return questions.map((q, i) => {
    if (explicit[i]) return explicit[i]!;
    const kept = typeof q.text === 'string' ? byText.get(releasedText(q.text)) : undefined;
    if (kept) {
      byText.delete(releasedText(q.text));
      return kept;
    }
    let key: string;
    do key = `q${++next}`;
    while (taken.has(key));
    taken.add(key);
    return key;
  });
}

// ─── Released question ids (frozen against the library revision) ───

/**
 * What was released of one survey (prisma/seed-data/survey-library-released-ids.json, written by
 * prisma/scripts/freeze-survey-library-ids.ts). Organisations' templates, alert rules and results
 * point at question keys, so a released key keeps its question for good: it may be reworded, never
 * reused, given another answer type or dropped without a recorded retirement.
 */
export type ReleasedSurveyIds = {
  revision: number;
  /** Every key ever released, with the question's type, text and answers then (retired ones kept). */
  questions: Record<
    string,
    {
      type: string;
      text: string;
      /** Every answer ever released (an answer dropped later needs an answerChanges entry for good). */
      answers: string[] | null;
      /** Released answers whose answerChanges entry is frozen. */
      changed?: string[];
      retiredIn?: number;
    }
  >;
  /** Each alert's task (or "when" without a rule), by position: an alert's position is its identity. */
  alerts: string[];
  /** Positions (from 0) of alerts retired in place. */
  retiredAlerts?: number[];
};
export type ReleasedLibraryIds = Record<string, ReleasedSurveyIds>;

export const RELEASED_IDS_PATH = join(__dirname, '..', 'seed-data', 'survey-library-released-ids.json');

const releasedText = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');

/** The released ids on disk ({} when nothing has been frozen yet). */
export function readReleasedLibraryIds(path = RELEASED_IDS_PATH): ReleasedLibraryIds {
  if (!existsSync(path)) return {};
  const parsed = readJson(path);
  if (!isObject(parsed)) throw new Error(`${path}: not a JSON object`);
  return parsed as ReleasedLibraryIds;
}

/** An alert's identity text: its rule's task, else its "when". */
export const alertIdentity = (a: LibrarySurveyAlert) =>
  (isObject(a?.rule) && typeof a.rule.task === 'string' ? a.rule.task : String(a?.when ?? '')).trim();

/** Every answer a library question offers (null for written answers and CareFlow lists). */
function libraryAnswerChoices(q: LibrarySurveyQuestion): string[] | null {
  return q.optionsFrom ? null : questionAnswerChoices(q.type, q.options, libraryQuestionConfig(q), q.otherOption ?? null);
}

/**
 * Problems with a survey against what was released: a released key gone without a retirement, a
 * key reused or given another answer type, an answer dropped without saying what became of it,
 * alerts moved or dropped. Retiring needs a new revision (adopters are told and their alert rules
 * are mapped: see SurveyLibraryService.applyUpdate).
 */
export function releasedIdProblems(s: LibrarySurvey, released: ReleasedSurveyIds, at: string): string[] {
  const errors: string[] = [];
  const questions = surveyQuestions(s);
  const keys = questionKeys(s, released);
  const byKey = new Map(questions.map((q, i) => [keys[i], q]));
  const retiredNow = new Map((Array.isArray(s.retiredQuestions) ? s.retiredQuestions : []).map((r) => [r?.id, r]));
  const changes = Array.isArray(s.answerChanges) ? s.answerChanges : [];
  const raised = s.revision > released.revision;
  const fix = `raise "revision" above ${released.revision} (with a revisionNote)`;

  for (const [key, was] of Object.entries(released.questions)) {
    const q = byKey.get(key);
    if (was.retiredIn) {
      if (q) errors.push(`${at}: question id "${key}" was retired in revision ${was.retiredIn} and can never be used again; give this question a new id`);
      continue;
    }
    if (!q) {
      const r = retiredNow.get(key);
      if (!r) {
        errors.push(
          `${at}: question "${key}" ("${was.text.slice(0, 60)}") was released in revision ${released.revision} and is missing. ` +
            (GENERATED_KEY.test(key)
              ? `If you reworded it, give the reworded question "id": "${key}". `
              : '') +
            `To remove it, ${fix} and list it in retiredQuestions as { "id": "${key}", "revision": ${Math.max(s.revision, released.revision + 1)}, "reason": "…" }`,
        );
      }
      continue;
    }
    if (q.type !== was.type) {
      errors.push(
        `${at}: question "${key}" was released as ${was.type} and is now ${q.type}. Answers already given cannot change type: retire "${key}" (retiredQuestions, new revision) and add the new question with a new id`,
      );
      continue;
    }
    if (!was.answers) continue;
    const now = libraryAnswerChoices(q) ?? [];
    for (const answer of was.answers) {
      if (now.includes(answer)) continue;
      const change = changes.find((c) => c?.question === key && c?.from === answer);
      if (!change) {
        errors.push(
          `${at}: question "${key}" no longer offers "${answer}" (released in revision ${released.revision}). Alert rules may check it: ${fix} and add to answerChanges { "question": "${key}", "from": "${answer}", "to": "<the answer that replaces it, or null>", "revision": … }`,
        );
      }
    }
  }
  for (const r of retiredNow.values()) {
    const was = released.questions[r?.id as string];
    if (!r || typeof r.id !== 'string' || !isText(r.reason) || !Number.isInteger(r.revision)) {
      errors.push(`${at}: every retiredQuestions entry needs an id, a revision and a reason`);
    } else if (!was) {
      errors.push(`${at}: retiredQuestions "${r.id}" was never released, so just remove the question (and this entry)`);
    } else if (byKey.has(r.id)) {
      errors.push(`${at}: retiredQuestions "${r.id}" is retired but still asked`);
    } else if (was.retiredIn ? r.revision !== was.retiredIn : r.revision <= released.revision || r.revision > s.revision) {
      errors.push(
        was.retiredIn
          ? `${at}: retiredQuestions "${r.id}" was retired in revision ${was.retiredIn}; keep that revision`
          : `${at}: retiring "${r.id}" needs a new revision: ${fix}, and give that revision in its entry`,
      );
    }
  }
  for (const c of changes) {
    const was = released.questions[c?.question as string];
    const q = byKey.get(c?.question as string);
    const offered = q ? (libraryAnswerChoices(q) ?? []) : [];
    if (!c || typeof c.question !== 'string' || typeof c.from !== 'string' || !(c.to === null || typeof c.to === 'string') || !Number.isInteger(c.revision)) {
      errors.push(`${at}: every answerChanges entry needs a question, from, to (an answer or null) and a revision`);
    } else if (!was || !was.answers?.includes(c.from)) {
      errors.push(`${at}: answerChanges: "${c.from}" was never a released answer to "${c.question}"`);
    } else if (offered.includes(c.from)) {
      errors.push(`${at}: answerChanges: "${c.question}" still offers "${c.from}"`);
    } else if (c.to !== null && q && !offered.includes(c.to)) {
      errors.push(`${at}: answerChanges: "${c.to}" is not an answer to "${c.question}"`);
    } else if (c.revision > s.revision || (!was.changed?.includes(c.from) && c.revision <= released.revision)) {
      errors.push(`${at}: answerChanges for "${c.question}" ("${c.from}") needs a new revision: ${fix}, and give that revision in its entry`);
    }
  }

  // Alerts: kept in place (an organisation's rule from alert 3 stays alert 3). New ones go at the end;
  // one no longer wanted stays where it is with "retired": true.
  const alerts = Array.isArray(s.managerGuidance?.alerts) ? s.managerGuidance.alerts : [];
  const identities = alerts.map(alertIdentity);
  released.alerts.forEach((was, i) => {
    if (i >= alerts.length) {
      errors.push(`${at}: alert ${i + 1} ("${was.slice(0, 60)}") was released and is missing: keep it where it is with "retired": true (and ${fix})`);
    } else if (identities[i] !== was && identities.indexOf(was) !== -1) {
      errors.push(`${at}: alert "${was.slice(0, 60)}" was released as alert ${i + 1} and is now alert ${identities.indexOf(was) + 1}: keep alerts in their released order and add new ones at the end`);
    } else if (alerts[i]?.retired === true && !raised && !released.retiredAlerts?.includes(i)) {
      errors.push(`${at}: retiring alert ${i + 1} needs a new revision: ${fix}`);
    }
  });
  return errors;
}

/** The released ids after this survey's content (append-only: a released key is never forgotten). */
export function freezeSurveyIds(s: LibrarySurvey, released: ReleasedSurveyIds | null): ReleasedSurveyIds {
  const questions = surveyQuestions(s);
  const keys = questionKeys(s, released);
  const out: ReleasedSurveyIds['questions'] = { ...(released?.questions ?? {}) };
  for (const r of s.retiredQuestions ?? []) {
    if (out[r.id] && !out[r.id].retiredIn) out[r.id] = { ...out[r.id], retiredIn: r.revision };
  }
  questions.forEach((q, i) => {
    const before = out[keys[i]];
    const now = libraryAnswerChoices(q);
    const answers = now ? [...new Set([...now, ...(before?.answers ?? [])])] : null;
    const changed = (s.answerChanges ?? []).filter((c) => c.question === keys[i]).map((c) => c.from);
    out[keys[i]] = { type: q.type, text: q.text.trim(), answers, ...(changed.length ? { changed } : {}) };
  });
  const alerts = s.managerGuidance.alerts.map(alertIdentity);
  const retiredAlerts = [
    ...new Set([...(released?.retiredAlerts ?? []), ...s.managerGuidance.alerts.flatMap((a, i) => (a.retired === true ? [i] : []))]),
  ].sort((a, b) => a - b);
  return {
    revision: s.revision,
    questions: out,
    alerts: alerts.length >= (released?.alerts.length ?? 0) ? alerts : [...alerts, ...released!.alerts.slice(alerts.length)],
    ...(retiredAlerts.length ? { retiredAlerts } : {}),
  };
}

/** Problems with question ids and the Other / exclusive / comment / show-if settings of a survey. */
function logicProblems(s: LibrarySurvey, at: string, released: ReleasedSurveyIds | null): string[] {
  const errors: string[] = [];
  const questions = surveyQuestions(s);
  questions.forEach((q) => {
    const qAt = `${at} "${q.text.slice(0, 50)}"`;
    if (q.id !== undefined) {
      if (typeof q.id !== 'string' || !QUESTION_KEY_PATTERN.test(q.id)) {
        errors.push(`${qAt}: id must be letters, digits, - or _ (up to 64), e.g. q-office-contact`);
      } else if (GENERATED_KEY.test(q.id) && !(released?.questions[q.id] && !released.questions[q.id].retiredIn)) {
        errors.push(`${qAt}: ids like "${q.id}" are kept for questions without an id; use a name such as q-office-contact`);
      }
    }
    if (q.showIf !== undefined && (!isObject(q.showIf) || Object.keys(q.showIf).some((k) => k !== 'question' && k !== 'answers'))) {
      errors.push(`${qAt}: showIf must give "question" (an earlier question's id) and "answers"`);
      return;
    }
    if (q.otherOption !== undefined && (!isObject(q.otherOption) || isEmptyValue(q.otherOption))) {
      errors.push(`${qAt}: otherOption must give a label and a textPrompt`);
      return;
    }
    const problem = questionLogicProblem(q.type, q.options, q.config, storedLogic(q));
    if (problem) errors.push(`${qAt}: ${problem}`);
  });
  if (errors.length) return errors;
  const keys = questionKeys(s, released);
  return surveyLogicProblems(
    questions.map((q, i) => ({
      key: keys[i],
      questionText: q.text,
      questionType: q.type,
      options: q.options ?? null,
      config: q.config ?? null,
      otherOption: q.otherOption ?? null,
      showIf: storedLogic(q).showIf,
    })),
  ).map((p) => `${at} ${p}`);
}

// ─── Survey ───


export const surveyQuestions = (s: Pick<LibrarySurvey, 'sections'>): LibrarySurveyQuestion[] =>
  (s.sections ?? []).flatMap((sec) => sec?.questions ?? []);

/** Seconds the minutes estimate allows: reading the introduction, then each question by type. */
export const MINUTES_ESTIMATE_SECONDS = { reading: 30, closed: 12, TEXT: 40, TEXTAREA: 75 } as const;

/**
 * About how long the survey takes, in whole minutes (rounded up): 30 seconds to read the
 * introduction, about 12 seconds a closed question, 40 seconds a short answer and 75 seconds a
 * longer comment. Every question counts, including those shown only after an earlier answer.
 */
export function expectedMinutes(s: Pick<LibrarySurvey, 'sections'>): number {
  const t = MINUTES_ESTIMATE_SECONDS;
  const seconds = surveyQuestions(s).reduce(
    (n, q) => n + (q.type === 'TEXTAREA' ? t.TEXTAREA : q.type === 'TEXT' ? t.TEXT : t.closed),
    t.reading,
  );
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * Range of estimatedMinutes accepted: at least the estimate, with no upper limit. There is no length
 * or time limit: how long a survey takes depends on what it asks and how it is given (read aloud,
 * interviewer-led, with breaks), decided per survey at review. The floor stops a survey telling
 * people it is quicker than it is.
 */
export function minutesRange(s: Pick<LibrarySurvey, 'sections'>): [number, number] {
  return [expectedMinutes(s), Number.POSITIVE_INFINITY];
}

/** Text respondents see (title, introduction, privacy notice, sections, questions, help, options). */
export function respondentTexts(s: LibrarySurvey): string[] {
  const out = [s.title, s.introduction, s.privacyNotice, ...(typeof s.closingMessage === 'string' ? [s.closingMessage] : [])];
  for (const sec of s.sections) {
    out.push(sec.title);
    if (sec.introduction) out.push(sec.introduction);
    for (const q of sec.questions) {
      out.push(q.text);
      if (q.helpText) out.push(q.helpText);
      out.push(...(q.options ?? []));
      if (q.otherOption?.label) out.push(q.otherOption.label);
      if (q.otherOption?.textPrompt) out.push(q.otherOption.textPrompt);
      if (q.comment?.prompt) out.push(q.comment.prompt);
    }
  }
  return out;
}

/** Text only managers see in the library. */
export function managerTexts(s: LibrarySurvey): string[] {
  return [
    s.summary,
    s.purpose,
    s.respondents,
    s.timing.when,
    ...(s.timing.trigger ? [s.timing.trigger] : []),
    ...s.cqc.qualityStatements,
    ...surveyQuestions(s).flatMap((q) => (q.evidence ? [q.evidence] : [])),
    ...s.managerGuidance.howToRun,
    ...s.managerGuidance.actingOnResults,
    ...s.managerGuidance.alerts.flatMap((a) => [a.when, a.action]),
    ...s.regulatoryBasis.map((r) => r.source),
  ];
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isTextList = (v: unknown, min = 1): v is string[] => Array.isArray(v) && v.length >= min && v.every(isText);

export type ValidateSurveyOptions = {
  /** Policy library references; when given, relatedPolicies must be among them. */
  policyReferences?: ReadonlySet<string>;
  /** What was released of this survey: its question ids and alerts are then frozen (releasedIdProblems). */
  released?: ReleasedSurveyIds | null;
};

/** The closing screen people see after submitting (the API accepts up to 1000 for an organisation's own). */
export const MAX_CLOSING_MESSAGE = 600;

export const MIN_REPORTING_THRESHOLD_UNLINKED = 5;
/** perManagerMinTeam: the default and lowest (CareFlow never sends an anonymous survey to fewer than 5), and the highest. */
export const PER_MANAGER_MIN_TEAM = 5;
export const PER_MANAGER_MAX_TEAM = 50;
export const MAX_REPORTING_THRESHOLD = 50;

/** Problems with a survey's default access (none when it has none). */
export function accessProblems(access: unknown, s: Partial<Pick<LibrarySurvey, 'anonymous' | 'allowAnonymousResponses'>>): string[] {
  if (!access || typeof access !== 'object' || Array.isArray(access)) return ['access must be an object'];
  const a = access as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(a)) if (!['responses', 'results', 'reportingThreshold'].includes(k)) errors.push(`access has an unknown field "${k}"`);
  for (const level of ['responses', 'results'] as const) {
    const v = a[level];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.length || !v.every((k) => (SURVEY_ALERT_OWNER_KEYS as unknown[]).includes(k))) {
      errors.push(`access.${level} must be a list of ${SURVEY_ALERT_OWNER_KEYS.join(', ')}`);
    }
  }
  // Whoever may see individual answers may see the figures.
  if (Array.isArray(a.responses) && Array.isArray(a.results) && !a.responses.every((k) => (a.results as unknown[]).includes(k))) {
    errors.push('access.results must include every role in access.responses');
  }
  if (a.reportingThreshold !== undefined) {
    const t = a.reportingThreshold;
    const min = s.anonymous || s.allowAnonymousResponses ? MIN_REPORTING_THRESHOLD_UNLINKED : 1;
    if (!Number.isInteger(t) || (t as number) < min || (t as number) > MAX_REPORTING_THRESHOLD) {
      errors.push(`access.reportingThreshold must be a whole number from ${min} to ${MAX_REPORTING_THRESHOLD}`);
    }
  }
  return errors;
}

/** Problems in one survey file; empty when it can be seeded. */
export function validateLibrarySurvey(value: unknown, name: string, opts: ValidateSurveyOptions = {}): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${name}: not an object`];
  const errors: string[] = [];
  const s = value as Partial<LibrarySurvey>;
  const at = `${name} ${s.reference ?? '(no reference)'}`;

  if (!s.reference || !REFERENCE_PATTERN.test(s.reference)) errors.push(`${at}: reference must look like SUR-PWS-001 (PWS, FAM, STF, PRO, CQC, ORG or APP)`);
  if (!Number.isInteger(s.revision) || s.revision! < 1) errors.push(`${at}: revision must be a whole number from 1`);
  if ((s.revision ?? 1) > 1 && !s.revisionNote?.trim()) errors.push(`${at}: revisionNote is required from revision 2`);
  if (!isText(s.title)) errors.push(`${at}: title is required`);
  else if (s.title.length > 100) errors.push(`${at}: title must be at most 100 characters`);
  if (!s.audience || !(SURVEY_AUDIENCES as readonly string[]).includes(s.audience)) {
    errors.push(`${at}: audience must be one of ${SURVEY_AUDIENCES.join(', ')}`);
  } else {
    const group = REFERENCE_PATTERN.exec(s.reference ?? '')?.[1] as SurveyGroupShort | undefined;
    if (group && !GROUP_AUDIENCES[group].includes(s.audience)) {
      errors.push(`${at}: a ${group} survey's audience must be ${GROUP_AUDIENCES[group].join(' or ')}`);
    }
  }
  if (!isText(s.respondents)) errors.push(`${at}: respondents is required`);
  if (!isText(s.summary) || s.summary.length < 40 || s.summary.length > 400) errors.push(`${at}: summary must be 40–400 characters`);
  if (!isText(s.purpose)) errors.push(`${at}: purpose is required`);
  const timing = s.timing;
  if (!timing || typeof timing !== 'object' || !isText(timing.when)) {
    errors.push(`${at}: timing.when is required`);
  } else {
    if (timing.recurrence !== null && !(SURVEY_RECURRENCES as readonly string[]).includes(timing.recurrence as string)) {
      errors.push(`${at}: timing.recurrence must be null or one of ${SURVEY_RECURRENCES.join(', ')}`);
    }
    if (timing.trigger !== null && !isText(timing.trigger)) errors.push(`${at}: timing.trigger must be null or text`);
    const rule = (timing as { contactRule?: unknown }).contactRule;
    if (rule !== undefined) {
      const r = rule as Record<string, unknown> | null;
      if (
        !r ||
        typeof r !== 'object' ||
        typeof r.holdBack !== 'boolean' ||
        typeof r.countsAsContact !== 'boolean' ||
        (r.whenHeld !== undefined && r.whenHeld !== 'delay' && r.whenHeld !== 'skip') ||
        Object.keys(r).some((k) => !['holdBack', 'countsAsContact', 'whenHeld', 'reason'].includes(k))
      ) {
        errors.push(`${at}: timing.contactRule must be { holdBack, countsAsContact, whenHeld?: "delay" | "skip", reason } when given`);
      } else if (r.holdBack && r.countsAsContact && (r.whenHeld ?? 'delay') === 'delay') {
        errors.push(`${at}: timing.contactRule with both true and whenHeld "delay" is the default: leave it out`);
      } else {
        if (typeof r.reason !== 'string' || r.reason.trim().length < 5 || r.reason.trim().length > 300) {
          errors.push(`${at}: timing.contactRule.reason (5–300 characters) must say why this survey differs from the 4-week rule's default`);
        }
        if (r.whenHeld === 'skip' && !r.holdBack) errors.push(`${at}: timing.contactRule.whenHeld "skip" only applies when holdBack is true`);
      }
    }
    const repeatReason = (timing as { repeatReason?: unknown }).repeatReason;
    if (repeatReason !== undefined && (typeof repeatReason !== 'string' || repeatReason.trim().length < 5 || repeatReason.trim().length > 300)) {
      errors.push(`${at}: timing.repeatReason must be 5–300 characters when given`);
    }
    if (timing.recurrence === 'WEEKLY' && typeof repeatReason !== 'string') {
      errors.push(`${at}: a WEEKLY survey asks people more often than the 4-week rule allows: give timing.repeatReason`);
    }
    const sentWith = (timing as { sentWith?: unknown }).sentWith;
    if (sentWith !== undefined) {
      if (!Array.isArray(sentWith) || !sentWith.length || sentWith.some((x) => typeof x !== 'string' || !REFERENCE_PATTERN.test(x))) {
        errors.push(`${at}: timing.sentWith must be a list of survey references (e.g. ["SUR-STF-012"]) when given`);
      } else if (sentWith.includes(s.reference)) {
        errors.push(`${at}: timing.sentWith cannot list the survey itself`);
      }
    }
  }
  if (typeof s.anonymous !== 'boolean') errors.push(`${at}: anonymous must be true or false`);
  if (s.allowAnonymousResponses !== undefined && typeof s.allowAnonymousResponses !== 'boolean') {
    errors.push(`${at}: allowAnonymousResponses must be true or false when given`);
  } else if (s.allowAnonymousResponses === true && s.anonymous === true) {
    errors.push(`${at}: allowAnonymousResponses is for named surveys only (every answer to an anonymous survey is anonymous)`);
  }
  if (!Array.isArray(s.channels) || !s.channels.length) errors.push(`${at}: channels is required`);
  for (const c of s.channels ?? []) {
    if (!(SURVEY_CHANNELS as readonly string[]).includes(c)) errors.push(`${at}: unknown channel ${c}`);
    else if (c === 'PORTAL' && s.audience !== 'SERVICE_USER') errors.push(`${at}: only SERVICE_USER surveys can use the PORTAL channel`);
  }
  if (new Set(s.channels ?? []).size !== (s.channels ?? []).length) errors.push(`${at}: a channel is listed twice`);
  if (!Number.isInteger(s.estimatedMinutes) || s.estimatedMinutes! < 1) {
    errors.push(`${at}: estimatedMinutes must be a whole number of at least 1`);
  }
  if (!s.cqc || !Array.isArray(s.cqc.keyQuestions) || !s.cqc.keyQuestions.length) {
    errors.push(`${at}: cqc.keyQuestions needs at least one key question`);
  } else {
    for (const k of s.cqc.keyQuestions) {
      if (!(CQC_KEY_QUESTIONS as readonly string[]).includes(k)) errors.push(`${at}: unknown CQC key question ${k}`);
    }
    if (!Array.isArray(s.cqc.qualityStatements) || !s.cqc.qualityStatements.every(isText)) {
      errors.push(`${at}: cqc.qualityStatements must be a list of quality statements`);
    }
  }
  if (!isText(s.introduction)) errors.push(`${at}: introduction is required`);
  if (!isText(s.privacyNotice)) errors.push(`${at}: privacyNotice is required`);
  if (s.closingMessage !== undefined && (!isText(s.closingMessage) || s.closingMessage.trim().length > MAX_CLOSING_MESSAGE)) {
    errors.push(`${at}: closingMessage must be text of at most ${MAX_CLOSING_MESSAGE} characters when given`);
  }
  const g = s.managerGuidance;
  if (!g || !isTextList(g.howToRun) || !isTextList(g.actingOnResults) || !Array.isArray(g.alerts)) {
    errors.push(`${at}: managerGuidance needs howToRun, actingOnResults and alerts`);
  } else if (!g.alerts.every((a) => isText(a?.when) && isText(a?.action))) {
    errors.push(`${at}: every alert needs a when and an action`);
  }
  if (s.access !== undefined) errors.push(...accessProblems(s.access, s).map((p) => `${at}: ${p}`));
  if (s.audienceGroup !== undefined) {
    const codes = audienceGroupsFor(s.audience ?? '').map((g) => g.code).filter((c) => c !== 'OTHER');
    if (!codes.includes(s.audienceGroup)) errors.push(`${at}: audienceGroup must be one of ${codes.join(', ')}`);
    else if (s.audienceGroup === 'SEVERAL' && !(s.sections ?? []).some((sec) => sec?.questions?.some((q) => q?.id === WHO_ARE_YOU_KEY))) {
      errors.push(`${at}: audienceGroup SEVERAL needs the standard "Who are you?" question (id "${WHO_ARE_YOU_KEY}")`);
    }
  }
  for (const q of (s.sections ?? []).flatMap((sec) => sec?.questions ?? [])) {
    if (q?.id !== WHO_ARE_YOU_KEY) continue;
    if (q.type !== 'SINGLE_SELECT') errors.push(`${at}: "Who are you?" must be a single choice`);
    errors.push(...whoAreYouOptionProblems(s.audience ?? '', q.options).map((p) => `${at}: ${p}`));
    if (!(q.notCountedOptions ?? []).includes(WHO_ARE_YOU_PREFER_NOT)) {
      errors.push(`${at}: "Who are you?" must not count "${WHO_ARE_YOU_PREFER_NOT}" (notCountedOptions)`);
    }
  }
  if (!Array.isArray(s.relatedPolicies)) errors.push(`${at}: relatedPolicies must be a list`);
  for (const r of s.relatedPolicies ?? []) {
    if (!POLICY_REFERENCE_PATTERN.test(r)) errors.push(`${at}: related policy ${r} must look like POL-XX-001`);
    else if (opts.policyReferences && !opts.policyReferences.has(r)) errors.push(`${at}: related policy ${r} is not in the policy library`);
  }
  if (!Array.isArray(s.regulatoryBasis) || !s.regulatoryBasis.length) errors.push(`${at}: at least one legislation or guidance source is required`);
  for (const r of s.regulatoryBasis ?? []) {
    if (!isText(r?.source) || !/^https:\/\//.test(r?.url ?? '')) errors.push(`${at}: every source needs a name and an https URL`);
  }

  const sections = Array.isArray(s.sections) ? s.sections : [];
  if (!sections.length) errors.push(`${at}: needs at least one section`);
  const titles = sections.map((sec) => sec?.title?.trim() ?? '');
  if (new Set(titles).size !== titles.length) errors.push(`${at}: duplicate section titles`);
  for (const sec of sections) {
    if (!isText(sec?.title)) errors.push(`${at}: a section has no title`);
    if (sec?.introduction !== undefined) {
      const intro = sec.introduction;
      if (!isText(intro) || intro.length > 300) {
        errors.push(`${at} "${sec?.title}": introduction must be text of at most 300 characters when given`);
      } else if ((intro.match(/[.!?](\s|$)/g) ?? []).length > 2) {
        errors.push(`${at} "${sec?.title}": introduction must be one or two sentences`);
      }
    }
    if (!Array.isArray(sec?.questions) || !sec.questions.length) {
      errors.push(`${at} "${sec?.title}": section has no questions`);
      continue;
    }
    for (const q of sec.questions) {
      const qAt = `${at} "${String(q?.text ?? '').slice(0, 50)}"`;
      if (!isText(q?.text)) {
        errors.push(`${at} "${sec.title}": a question has no text`);
        continue;
      }
      if (words(q.text) > TEXT_LIMITS.questionWords) errors.push(`${qAt}: question over ${TEXT_LIMITS.questionWords} words`);
      if (/\band\s*\/\s*or\b/i.test(q.text)) errors.push(`${qAt}: "and/or" asks two things; split the question or pick one`);
      if (typeof q.required !== 'boolean') errors.push(`${qAt}: required must be true or false`);
      if (q.helpText !== undefined && (!isText(q.helpText) || q.helpText.length > 500)) {
        errors.push(`${qAt}: helpText must be text of at most 500 characters when given`);
      }
      if (q.evidence !== undefined && !isText(q.evidence)) errors.push(`${qAt}: evidence must be text when given`);
      if (q.optionsFrom !== undefined) {
        if (!lookupSourceKey(q.optionsFrom)) errors.push(`${qAt}: optionsFrom must be one of ${SURVEY_LOOKUP_SOURCE_KEYS.map((k) => k.toLowerCase()).join(', ')}`);
        if (q.type !== 'SINGLE_SELECT' && q.type !== 'MULTI_SELECT') errors.push(`${qAt}: optionsFrom is for SINGLE_SELECT or MULTI_SELECT questions`);
        if (q.options !== undefined) errors.push(`${qAt}: a question with optionsFrom has no options of its own`);
        if (q.otherOption || q.exclusiveOptions || q.notCountedOptions) {
          errors.push(`${qAt}: a question with optionsFrom cannot have otherOption, exclusiveOptions or notCountedOptions (the list has its own entries)`);
        }
        continue;
      }
      const problem = questionSettingsProblem(q.type, q.options, libraryQuestionConfig(q));
      if (problem) errors.push(`${qAt}: ${problem}`);
      // "Don't know" and the like are always left out of percentages.
      const unmarked = (q.options ?? []).filter(
        (o) =>
          typeof o === 'string' &&
          (STANDARD_NOT_COUNTED as readonly string[]).includes(o.trim()) &&
          !(q.notCountedOptions ?? []).includes(o.trim()),
      );
      if (!problem && unmarked.length && NOT_COUNTED_TYPES.includes(q.type)) {
        errors.push(`${qAt}: mark "${unmarked.join('", "')}" in notCountedOptions (left out of percentages)`);
      }
      if (s.anonymous === true) {
        const asks = [
          ...IDENTIFYING.filter(([re]) => re.test(q.text)),
          ...(FREE_ENTRY.includes(q.type) ? IDENTIFYING_ENTRY.filter(([re]) => re.test(q.text)) : []),
        ];
        if (asks.length && !NEGATED.test(q.text)) errors.push(`${qAt}: an anonymous survey must not ask for a ${asks[0][1]}`);
      }
    }
  }
  if (errors.length) return errors;

  const survey = s as LibrarySurvey;
  const released = opts.released ?? null;
  const questions = surveyQuestions(survey);
  errors.push(...logicProblems(survey, at, released));
  if (errors.length) return errors;
  if (!questions.some((q) => (q.type === 'TEXT' || q.type === 'TEXTAREA') && q.required === false)) {
    errors.push(`${at}: needs at least one optional free-text question (TEXT or TEXTAREA, not required)`);
  }
  const [minMinutes, maxMinutes] = minutesRange(survey);
  if (survey.estimatedMinutes < minMinutes || survey.estimatedMinutes > maxMinutes) {
    errors.push(
      `${at}: estimatedMinutes ${survey.estimatedMinutes} is less than the time ${questions.length} questions take (estimate ${expectedMinutes(survey)}; at least ${minMinutes})`,
    );
  }
  const introWords = words(survey.introduction);
  const [minIntro, maxIntro] = TEXT_LIMITS.introduction;
  if (introWords < minIntro || introWords > maxIntro) errors.push(`${at}: introduction is ${introWords} words; it must be ${minIntro}–${maxIntro}`);
  if (!survey.introduction.includes(ORGANISATION_TOKEN)) errors.push(`${at}: the introduction never names the organisation (${ORGANISATION_TOKEN})`);
  if (survey.allowAnonymousResponses === true && !ANSWER_WITHOUT_NAME_WORDING.test(survey.privacyNotice)) {
    errors.push(`${at}: allowAnonymousResponses is true, so the privacy notice must tell people they can answer without their name`);
  }
  const privacyWords = words(survey.privacyNotice);
  const [minPrivacy, maxPrivacy] = TEXT_LIMITS.privacyNotice;
  if (privacyWords < minPrivacy || privacyWords > maxPrivacy) {
    errors.push(`${at}: privacyNotice is ${privacyWords} words; it must be ${minPrivacy}–${maxPrivacy}`);
  }
  // Respondents see the introduction then the privacy notice as the survey description (2000 characters).
  const descriptionLength = surveyDescription(survey).length;
  if (descriptionLength > MAX_DESCRIPTION_LENGTH) {
    errors.push(`${at}: introduction and privacy notice together are ${descriptionLength} characters; at most ${MAX_DESCRIPTION_LENGTH}`);
  }
  // House style.
  for (const q of questions) {
    const problem = scaleProblem(q);
    if (problem) errors.push(`${at} "${q.text.slice(0, 50)}": ${problem}`);
  }
  const personFacing = isPersonFacing(survey);
  if (personFacing) {
    const first = survey.sections[0].questions[0];
    if (first.text.trim() !== OVERALL_QUESTION || first.type !== 'SINGLE_SELECT' || !sameList(first.options ?? [], OVERALL_OPTIONS)) {
      errors.push(
        `${at}: must start with a section whose first question is "${OVERALL_QUESTION}" (SINGLE_SELECT: ${OVERALL_OPTIONS.join(' / ')})`,
      );
    }
    if (!survey.anonymous) {
      const contactMe = contactMeQuestion(survey);
      if (!contactMe || contactMe.type !== 'YES_NO' || contactMe.required !== false) {
        errors.push(
          `${at}: a named survey must end with the optional YES_NO "${CONTACT_ME_PREFIX} …?" (only its own contact-details questions, shown if it is answered Yes, may follow it)`,
        );
      }
    }
  }
  // Structured alert rules: questions, answers, owner and timescale must all be real.
  const ruleKeys = questionKeys(survey, released);
  const ruleQuestions = questions.map((q, i) => ({
    key: ruleKeys[i],
    text: q.text.trim(),
    type: q.type,
    // A CareFlow-list question's entries are the organisation's, so library rules cannot name them.
    choices: q.optionsFrom ? null : questionAnswerChoices(q.type, q.options, libraryQuestionConfig(q), q.otherOption ?? null),
    contactMe: isContactMeText(q) && q.type === 'YES_NO',
    lookup: Boolean(q.optionsFrom),
  }));
  const neverTo = survey.alertsNeverTo;
  if (neverTo !== undefined && (!Array.isArray(neverTo) || !neverTo.every((k) => (SURVEY_ALERT_OWNER_KEYS as readonly string[]).includes(k)))) {
    errors.push(`${at}: alertsNeverTo must be a list of ${SURVEY_ALERT_OWNER_KEYS.join(', ')}`);
  }
  // With results limited to some roles, every alert must go to one of them: otherwise it would be
  // rerouted to someone else and its "what to do" would name the wrong person.
  const resultsRoles = Array.isArray(survey.access?.results)
    ? new Set<string>([...survey.access!.results!, ...(survey.access?.responses ?? [])])
    : null;
  if (resultsRoles) {
    survey.managerGuidance.alerts.forEach((a, i) => {
      if (a.retired === true) return;
      const owner = (a.rule as { owner?: unknown } | undefined)?.owner;
      if (typeof owner === 'string' && !resultsRoles.has(owner)) {
        errors.push(`${at} alert ${i + 1}: rule.owner ${owner} cannot see this survey's results (access.results); add it there or choose an owner who can`);
      }
    });
  }
  survey.managerGuidance.alerts.forEach((a, i) => {
    if (a.retired !== undefined && typeof a.retired !== 'boolean') errors.push(`${at} alert ${i + 1}: retired must be true or false`);
    if (a.retired === true) return;
    for (const p of alertRuleProblems(a.rule, ruleQuestions, { anonymous: survey.anonymous, neverRouteTo: Array.isArray(neverTo) ? neverTo : [] })) {
      errors.push(`${at} alert ${i + 1}: ${p}`);
    }
  });
  if (survey.anonymous) {
    // Answers are linked to no one, so nobody could be contacted (CareFlow refuses the question too).
    for (const sec of survey.sections) {
      for (const q of sec.questions) {
        if (isContactMeText(q)) errors.push(`${at}: an anonymous survey must not ask "${CONTACT_ME_PREFIX} …?" — nobody could be contacted`);
      }
    }
  }
  if ((personFacing || isStaffSurvey(survey)) && !survey.introduction.includes(URGENT_CONCERNS_SENTENCE)) {
    errors.push(`${at}: the introduction must say "${URGENT_CONCERNS_SENTENCE}" (and where to go instead)`);
  }
  const respondent = respondentTexts(survey);
  if (!survey.anonymous) {
    for (const t of respondent) {
      if (mentionsAnonymity(t)) errors.push(`${at}: a named survey must not call itself anonymous: "${t.slice(0, 90)}"`);
    }
  }
  if (survey.perManager !== undefined && typeof survey.perManager !== 'boolean') errors.push(`${at}: perManager must be true or false`);
  if (survey.perManager === true) {
    if (survey.audience !== 'EMPLOYEE') errors.push(`${at}: perManager is for staff surveys`);
    if (!respondent.some((t) => t.includes(MANAGER_MERGE_TOKEN))) errors.push(`${at}: perManager is set but the text never says ${MANAGER_MERGE_TOKEN}`);
    for (const q of questions) {
      const answers = [...(q.options ?? []), q.otherOption?.label ?? ''];
      if (answers.some((o) => typeof o === 'string' && o.includes(MANAGER_MERGE_TOKEN))) {
        errors.push(`${at} "${q.text.slice(0, 50)}": ${MANAGER_MERGE_TOKEN} cannot be in an answer (alert rules check answers word for word)`);
      }
    }
  }
  const exclude = survey.perManagerExclude as unknown;
  if (exclude !== undefined) {
    if (survey.perManager !== true) errors.push(`${at}: perManagerExclude needs perManager`);
    if (!Array.isArray(exclude) || !exclude.length || !exclude.every((k) => (SURVEY_ALERT_OWNER_KEYS as readonly unknown[]).includes(k))) {
      errors.push(`${at}: perManagerExclude must be a list of ${SURVEY_ALERT_OWNER_KEYS.join(', ')}`);
    }
  }
  const minTeam = survey.perManagerMinTeam as unknown;
  if (minTeam !== undefined) {
    if (survey.perManager !== true) errors.push(`${at}: perManagerMinTeam needs perManager`);
    if (!Number.isInteger(minTeam) || (minTeam as number) < PER_MANAGER_MIN_TEAM || (minTeam as number) > PER_MANAGER_MAX_TEAM) {
      errors.push(`${at}: perManagerMinTeam must be a whole number from ${PER_MANAGER_MIN_TEAM} to ${PER_MANAGER_MAX_TEAM}`);
    }
  }
  const merge = (t: string) => (survey.perManager === true ? t.split(MANAGER_MERGE_TOKEN).join('the manager') : t);
  for (const t of [...respondent, ...managerTexts(survey)]) {
    for (const [re, what] of FORBIDDEN) if (re.test(merge(t))) errors.push(`${at}: contains ${what}: "${t.slice(0, 90)}"`);
  }
  for (const t of respondent) {
    for (const [re, what] of RESPONDENT_FORBIDDEN) if (re.test(t)) errors.push(`${at}: respondents would see ${what}: "${t.slice(0, 90)}"`);
  }
  if (released) errors.push(...releasedIdProblems(survey, released, at));
  else if (survey.retiredQuestions?.length || survey.answerChanges?.length) {
    errors.push(`${at}: retiredQuestions and answerChanges are for surveys already released; before release just change the questions`);
  }
  if (survey.anonymousVariant !== undefined) errors.push(...anonymousVariantProblems(survey, at, opts));
  return errors;
}

/** The anonymous version of a named survey as its own library survey, and what it leaves out. */
export function anonymousVariantOf(
  s: LibrarySurvey,
  released?: ReleasedSurveyIds | null,
): { survey: LibrarySurvey; leaveOut: string[]; leaveOutAlerts: number[]; keys: Map<LibrarySurveyQuestion, string> } | null {
  const v = s.anonymousVariant;
  if (!v || s.anonymous) return null;
  const questions = surveyQuestions(s);
  const keyList = questionKeys(s, released);
  const keys = new Map(questions.map((q, i) => [q, keyList[i]]));
  const out = new Set<string>(Array.isArray(v.leaveOut) ? v.leaveOut.filter((k) => typeof k === 'string') : []);
  const contactMe = contactMeQuestion(s);
  if (contactMe) out.add(keys.get(contactMe)!);
  // A question asked only after one left out goes too (its contact details, for example).
  let grew = true;
  while (grew) {
    grew = false;
    for (const q of questions) {
      const k = keys.get(q)!;
      if (!out.has(k) && q.showIf && out.has(String(q.showIf.question).trim())) {
        out.add(k);
        grew = true;
      }
    }
  }
  const textOf = new Map(questions.map((q) => [keys.get(q)!, q.text.trim()]));
  const leftOutTexts = new Set([...out].map((k) => textOf.get(k)).filter((t): t is string => Boolean(t)));
  const ruleNames = (rule: unknown): string[] => {
    if (!isObject(rule) || !Array.isArray(rule.if)) return [];
    return rule.if.flatMap((e: unknown) =>
      isObject(e) && Array.isArray(e.all) ? e.all.map((c: unknown) => String((c as { question?: unknown })?.question ?? '').trim()) : [String((e as { question?: unknown })?.question ?? '').trim()],
    );
  };
  const asked = new Set((Array.isArray(v.leaveOutAlerts) ? v.leaveOutAlerts : []).map((n) => n - 1));
  const leaveOutAlerts: number[] = [];
  const alerts = s.managerGuidance.alerts.map((a, i) => {
    const rule = a.rule as unknown;
    const drop =
      a.retired === true ||
      asked.has(i) ||
      (isObject(rule) && rule.contactRequest === true) ||
      ruleNames(rule).some((n) => out.has(n) || leftOutTexts.has(n));
    if (drop && a.retired !== true) leaveOutAlerts.push(i);
    return drop ? { ...a, retired: true } : a;
  });
  const sections = s.sections
    .map((sec) => ({
      ...sec,
      // Each kept question carries its key as its id, so its key is the same in both versions.
      questions: sec.questions.filter((q) => !out.has(keys.get(q)!)).map((q) => ({ ...q, id: keys.get(q)! })),
    }))
    .filter((sec) => sec.questions.length > 0);
  const { anonymousVariant: _v, allowAnonymousResponses: _a, retiredQuestions: _r, answerChanges: _c, ...rest } = s;
  return {
    survey: {
      ...rest,
      anonymous: true,
      introduction: v.introduction,
      privacyNotice: v.privacyNotice,
      ...(v.closingMessage !== undefined ? { closingMessage: v.closingMessage } : {}),
      ...(v.access ? { access: v.access } : {}),
      sections,
      managerGuidance: { ...s.managerGuidance, alerts },
    },
    leaveOut: [...out],
    leaveOutAlerts,
    keys,
  };
}

/** Problems with a named survey's anonymous version: it must pass every check an anonymous survey does. */
function anonymousVariantProblems(s: LibrarySurvey, at: string, opts: ValidateSurveyOptions): string[] {
  const vat = `${at} (anonymous version)`;
  const v = s.anonymousVariant as unknown;
  if (s.anonymous) return [`${at}: anonymousVariant is for named surveys (this survey is already anonymous)`];
  if (!isObject(v)) return [`${vat}: anonymousVariant must give an introduction and a privacyNotice`];
  const errors: string[] = [];
  for (const k of Object.keys(v)) {
    if (!['introduction', 'privacyNotice', 'closingMessage', 'leaveOut', 'leaveOutAlerts', 'access'].includes(k)) errors.push(`${vat}: unknown field "${k}"`);
  }
  const keys = new Set(questionKeys(s, opts.released));
  if (v.leaveOut !== undefined && (!Array.isArray(v.leaveOut) || v.leaveOut.some((k) => typeof k !== 'string' || !keys.has(k)))) {
    errors.push(`${vat}: leaveOut must list ids of this survey's questions`);
  }
  const count = s.managerGuidance.alerts.length;
  if (v.leaveOutAlerts !== undefined && (!Array.isArray(v.leaveOutAlerts) || v.leaveOutAlerts.some((n) => !Number.isInteger(n) || n < 1 || n > count))) {
    errors.push(`${vat}: leaveOutAlerts must list alert numbers from 1 to ${count}`);
  }
  if (errors.length) return errors;
  const variant = anonymousVariantOf(s, opts.released)!;
  // The kept questions carry their keys as ids; released numbered keys are allowed as ids.
  const ids: ReleasedSurveyIds = {
    revision: s.revision,
    questions: Object.fromEntries(
      surveyQuestions(variant.survey).map((q) => [q.id!, { type: q.type, text: q.text, answers: libraryAnswerChoices(q) }]),
    ),
    alerts: [],
  };
  if (!surveyQuestions(variant.survey).length) return [`${vat}: leaves out every question`];
  return validateLibrarySurvey(variant.survey, vat, { ...opts, released: ids }).map((p) => p.replace(`${vat} ${s.reference}`, vat));
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));

/**
 * References in the policy library (for relatedPolicies). Uses the policy library loader; while a
 * policy file is being rewritten and does not pass its own checks, its file name still counts, so
 * policy work in progress never breaks the survey library.
 */
export function policyLibraryReferences(dir = join(__dirname, '..', 'seed-data', 'policy-library')): Set<string> {
  try {
    return new Set(loadPolicyLibrary(dir).flatMap((f) => f.documents.map((d) => d.reference)));
  } catch {
    const refs = new Set<string>();
    const folders = existsSync(dir) ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()) : [];
    for (const folder of folders) {
      for (const name of readdirSync(join(dir, folder))) {
        const m = /^(POL-[A-Z]+-\d{3})\.json$/.exec(name);
        if (m) refs.add(m[1]);
      }
    }
    return refs;
  }
}

const DEFAULT_LIBRARY_DIR = join(__dirname, '..', 'seed-data', 'survey-library');

export type LoadSurveyLibraryOptions = {
  /**
   * Local previews while the library is still being written: skip unfinished files with a warning
   * instead of failing.
   */
  partial?: boolean;
  /**
   * Partial mode only: filled with the references of the files skipped (the file name and, when it
   * differs, the reference inside it), so the seed can keep those catalogue surveys instead of
   * retiring them as "no longer in the library".
   */
  skipped?: string[];
  /** Policy references for relatedPolicies (default: the policy library on disk). */
  policyReferences?: ReadonlySet<string>;
  /**
   * Released question ids and alerts (default: survey-library-released-ids.json when loading the
   * library itself; none for another folder).
   */
  released?: ReleasedLibraryIds;
};

/**
 * Every group folder in the library, validated. Throws listing every problem found. Groups are
 * returned even when they have no surveys yet. relatedPolicies must exist in the policy library.
 */
export function loadSurveyLibrary(
  dir = DEFAULT_LIBRARY_DIR,
  opts: LoadSurveyLibraryOptions = {},
): SurveyLibraryFile[] {
  const errors: string[] = [];
  const files: SurveyLibraryFile[] = [];
  const policyReferences = opts.policyReferences ?? policyLibraryReferences();
  const released = opts.released ?? (dir === DEFAULT_LIBRARY_DIR ? readReleasedLibraryIds() : {});
  const folders = existsSync(dir) ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort() : [];
  const seenGroups = new Set<string>();
  for (const folder of folders) {
    const groupPath = join(dir, folder, 'group.json');
    if (!existsSync(groupPath)) {
      errors.push(`${folder}: group.json is missing`);
      continue;
    }
    let group: SurveyLibraryGroup;
    try {
      group = readJson(groupPath) as SurveyLibraryGroup;
    } catch (err) {
      errors.push(`${folder}/group.json: not valid JSON (${(err as Error).message})`);
      continue;
    }
    const known = SURVEY_LIBRARY_GROUPS.find((g) => g.code === group?.code);
    if (!known || !isText(group.name) || !/^\d{4}-\d{2}-\d{2}$/.test(group.researchedOn ?? '') || !Number.isInteger(group.displayOrder)) {
      errors.push(
        `${folder}/group.json: code (one of ${SURVEY_LIBRARY_GROUPS.map((g) => g.code).join(', ')}), name, researchedOn (YYYY-MM-DD) and displayOrder are required`,
      );
      continue;
    }
    if (seenGroups.has(known.code)) {
      errors.push(`${folder}/group.json: group ${known.code} is used by two folders`);
      continue;
    }
    seenGroups.add(known.code);
    const surveys: LibrarySurvey[] = [];
    const noteSkipped = (name: string, parsed?: unknown) => {
      const refs = [name.replace(/\.json$/, ''), (parsed as Partial<LibrarySurvey> | undefined)?.reference];
      for (const r of refs) if (typeof r === 'string' && r && !opts.skipped?.includes(r)) opts.skipped?.push(r);
    };
    for (const name of readdirSync(join(dir, folder)).filter((f) => /^SUR-.*\.json$/.test(f)).sort()) {
      let parsed: unknown;
      try {
        parsed = readJson(join(dir, folder, name));
      } catch (err) {
        const problem = `${folder}/${name}: not valid JSON (${(err as Error).message})`;
        if (opts.partial) {
          console.warn(`[survey-library] skipped ${problem}`);
          noteSkipped(name);
        } else errors.push(problem);
        continue;
      }
      const ref = (parsed as Partial<LibrarySurvey>)?.reference;
      const problems = validateLibrarySurvey(parsed, `${folder}/${name}`, {
        policyReferences,
        released: typeof ref === 'string' ? (released[ref] ?? null) : null,
      });
      const reference = (parsed as LibrarySurvey)?.reference;
      if (reference && `${reference}.json` !== name) problems.push(`${folder}/${name}: file name must match the reference`);
      if (reference && REFERENCE_PATTERN.test(reference) && !reference.startsWith(`SUR-${known.short}-`)) {
        problems.push(`${folder}/${name}: a survey in ${known.name} must have a SUR-${known.short}- reference`);
      }
      if (problems.length && opts.partial) {
        console.warn(`[survey-library] skipped ${folder}/${name}: ${problems[0]}`);
        noteSkipped(name, parsed);
      } else errors.push(...problems);
      if (!problems.length) surveys.push(parsed as LibrarySurvey);
    }
    files.push({ group: { ...group, short: known.short }, surveys });
  }

  const refs = new Set<string>();
  for (const f of files) {
    for (const s of f.surveys) {
      if (refs.has(s.reference)) errors.push(`${s.reference}: used twice in the library`);
      refs.add(s.reference);
    }
  }
  if (!opts.partial) errors.push(...sentWithProblems(files.flatMap((f) => f.surveys)));
  // A released survey stays in the library (organisations' templates point at it). Partial previews
  // skip unfinished files, so only a full load checks this.
  if (!opts.partial) {
    for (const reference of Object.keys(released)) {
      if (!refs.has(reference) && !errors.some((e) => e.includes(reference))) {
        errors.push(`${reference}: was released and is missing from the library; withdrawing a released survey is a product decision (remove its entry from survey-library-released-ids.json deliberately)`);
      }
    }
  }
  if (errors.length) throw new Error(`Survey library has problems:\n- ${errors.join('\n- ')}`);
  return files.sort((a, b) => a.group.displayOrder - b.group.displayOrder);
}

/** Linked parts (timing.sentWith): each reference exists, is for the same audience, and links back. */
export function sentWithProblems(surveys: ReadonlyArray<Pick<LibrarySurvey, 'reference' | 'audience' | 'timing'>>): string[] {
  const errors: string[] = [];
  const byRef = new Map(surveys.map((s) => [s.reference, s]));
  for (const s of surveys) {
    for (const other of s.timing.sentWith ?? []) {
      const o = byRef.get(other);
      if (!o) {
        errors.push(`${s.reference}: timing.sentWith names ${other}, which is not in the library`);
        continue;
      }
      // Same audience, or the one accepted cross-audience pairing: a person's survey and their family's
      // (e.g. SUR-PWS-003 with SUR-FAM-001, decision P10: the representative's one contact).
      const pair = new Set([o.audience, s.audience]);
      if (o.audience !== s.audience && !(pair.has('SERVICE_USER') && pair.has('PUBLIC'))) {
        errors.push(`${s.reference}: timing.sentWith ${other} is for a different audience`);
      }
      if (!(o.timing.sentWith ?? []).includes(s.reference)) errors.push(`${s.reference}: timing.sentWith ${other} must list ${s.reference} back`);
    }
  }
  return errors;
}

/** Library details kept on a survey (Survey.libraryMeta): what the library page shows managers. */
export type SurveyLibraryMeta = {
  type: 'survey-library';
  version: 1;
  group: { code: string; short: SurveyGroupShort; name: string; displayOrder: number; researchedOn: string };
  revisionNote: string | null;
  respondents: string;
  summary: string;
  purpose: string;
  timing: LibrarySurvey['timing'];
  channels: LibrarySurvey['channels'];
  cqc: LibrarySurvey['cqc'];
  estimatedMinutes: number;
  introduction: string;
  privacyNotice: string;
  managerGuidance: LibrarySurveyGuidance;
  relatedPolicies: string[];
  regulatoryBasis: LibrarySource[];
  sections: Array<{ title: string; questionCount: number; evidence: string[]; introduction?: string }>;
  /** Default access (see LibrarySurvey.access); absent = open to everyone with survey access. */
  access?: LibrarySurveyAccess;
  /** Who it's for (always set: the survey's own, else from its group). */
  audienceGroup: string;
  /** Library roles alerts must never go to (see LibrarySurvey.alertsNeverTo). */
  alertsNeverTo?: SurveyAlertOwnerKey[];
  /** A survey about each manager: its text says {{manager}} (see LibrarySurvey.perManager). */
  perManager?: true;
  /** Library roles whose own staff are never asked (see LibrarySurvey.perManagerExclude). */
  perManagerExclude?: SurveyAlertOwnerKey[];
  /** The fewest staff a manager's own copy goes to (see LibrarySurvey.perManagerMinTeam); absent = 5. */
  perManagerMinTeam?: number;
  /** Released questions taken out and answers renamed (applying an update maps alert rules with them). */
  keyChanges?: {
    retiredQuestions: NonNullable<LibrarySurvey['retiredQuestions']>;
    answerChanges: NonNullable<LibrarySurvey['answerChanges']>;
  };
  /**
   * Named surveys with an anonymous version: its introduction and privacy notice, the question keys
   * and alert positions (from 0) it leaves out, and its own default access when it has one.
   */
  anonymousVariant?: {
    introduction: string;
    privacyNotice: string;
    closingMessage?: string;
    leaveOut: string[];
    leaveOutAlerts: number[];
    access?: LibrarySurveyAccess;
  };
};

export function surveyLibraryMeta(
  s: LibrarySurvey,
  group: SurveyLibraryFile['group'],
  released?: ReleasedSurveyIds | null,
): SurveyLibraryMeta {
  const variant = anonymousVariantOf(s, released);
  return {
    type: 'survey-library',
    version: 1,
    group: { code: group.code, short: group.short, name: group.name, displayOrder: group.displayOrder, researchedOn: group.researchedOn },
    revisionNote: s.revisionNote ?? null,
    respondents: s.respondents,
    summary: s.summary,
    purpose: s.purpose,
    timing: s.timing,
    channels: s.channels,
    cqc: s.cqc,
    estimatedMinutes: s.estimatedMinutes,
    introduction: s.introduction,
    privacyNotice: s.privacyNotice,
    managerGuidance: s.managerGuidance,
    relatedPolicies: s.relatedPolicies,
    regulatoryBasis: s.regulatoryBasis,
    ...(s.access ? { access: s.access } : {}),
    audienceGroup: s.audienceGroup ?? defaultLibraryAudienceGroup(group.short, s.audience),
    ...(s.alertsNeverTo?.length ? { alertsNeverTo: s.alertsNeverTo } : {}),
    ...(s.perManager === true ? { perManager: true } : {}),
    ...(s.perManager === true && s.perManagerExclude?.length ? { perManagerExclude: s.perManagerExclude } : {}),
    ...(s.perManager === true && s.perManagerMinTeam !== undefined ? { perManagerMinTeam: s.perManagerMinTeam } : {}),
    ...(s.retiredQuestions?.length || s.answerChanges?.length
      ? { keyChanges: { retiredQuestions: s.retiredQuestions ?? [], answerChanges: s.answerChanges ?? [] } }
      : {}),
    ...(variant && s.anonymousVariant
      ? {
          anonymousVariant: {
            introduction: s.anonymousVariant.introduction,
            privacyNotice: s.anonymousVariant.privacyNotice,
            ...(s.anonymousVariant.closingMessage?.trim() ? { closingMessage: s.anonymousVariant.closingMessage.trim() } : {}),
            leaveOut: variant.leaveOut,
            leaveOutAlerts: variant.leaveOutAlerts,
            ...(s.anonymousVariant.access ? { access: s.anonymousVariant.access } : {}),
          },
        }
      : {}),
    sections: s.sections.map((sec) => ({
      title: sec.title,
      ...(sec.introduction?.trim() ? { introduction: sec.introduction.trim() } : {}),
      questionCount: sec.questions.length,
      evidence: [...new Set(sec.questions.flatMap((q) => (q.evidence ? [q.evidence] : [])))],
    })),
  };
}

export type StoredOtherOption = { label: string; textPrompt: string; textRequired: boolean };
export type StoredCommentConfig = { prompt: string; showWhen: string[] | null };
export type StoredShowIf = { questionKey: string; answers: string[] };

/**
 * Questions as survey question rows, in order, each carrying its section heading, its key (its id,
 * or q1, q2 … by position) and its Other choice, exclusive options, comment box and show-if rule in
 * the stored shape (defaults filled in, text trimmed).
 */
export function surveyQuestionRows(s: LibrarySurvey, released?: ReleasedSurveyIds | null) {
  let sortOrder = 0;
  const keys = questionKeys(s, released);
  return s.sections.flatMap((sec) =>
    sec.questions.map((q) => {
      const index = sortOrder++;
      const otherOption: StoredOtherOption | null = q.otherOption
        ? {
            label: q.otherOption.label?.trim() || DEFAULT_OTHER_LABEL,
            textPrompt: q.otherOption.textPrompt?.trim() || 'Please tell us',
            textRequired: q.otherOption.textRequired ?? true,
          }
        : null;
      const commentConfig: StoredCommentConfig | null = q.comment
        ? {
            prompt: q.comment.prompt?.trim() || 'Please tell us why',
            showWhen: q.comment.showWhen?.length ? [...new Set(q.comment.showWhen.map((a) => a.trim()))] : null,
          }
        : null;
      const showIf: StoredShowIf | null = q.showIf
        ? { questionKey: q.showIf.question.trim(), answers: [...new Set(q.showIf.answers.map((a) => a.trim()))] }
        : null;
      return {
        questionText: q.text.trim(),
        helpText: q.helpText?.trim() || null,
        questionType: q.type,
        options: q.options?.length ? q.options.map((o) => o.trim()) : null,
        optionsFrom: lookupSourceKey(q.optionsFrom),
        config:
          q.type === 'RATING' && q.config
            ? { min: q.config.min, max: q.config.max }
            : q.notCountedOptions?.length
              ? { notCountedOptions: [...new Set(q.notCountedOptions.map((o) => o.trim()))] }
              : null,
        isRequired: q.required,
        sortOrder: index,
        sectionTitle: sec.title.trim(),
        key: keys[index],
        otherOption,
        exclusiveOptions: q.exclusiveOptions?.length ? [...new Set(q.exclusiveOptions.map((o) => o.trim()))] : null,
        commentConfig,
        showIf,
      };
    }),
  );
}


/** Replace the organisation token with the organisation's name (plain text, not HTML). */
export function fillOrganisation(text: string, organisationName: string): string {
  return text.split(ORGANISATION_TOKEN).join(organisationName);
}
