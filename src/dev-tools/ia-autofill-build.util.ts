/**
 * Server-side initial assessment autofill — mirrors care-admin E2E helpers
 * (tests/e2e/helpers/initial-assessment-autofill.ts + ia-holistic-metadata-autofill.ts).
 */
import { enrichWaterlowMetadata } from '../initial-assessments/initial-assessment-waterlow.util';

export type IaAutofillLevel = 'low' | 'normal' | 'critical';

const HOLISTIC_TAB_COUNT = 18;

export type TemplateQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
  options?: unknown;
  sectionNumber: number;
};

export type AnswerInput = {
  questionId: string;
  checked?: boolean;
  booleanValue?: boolean;
  textValue?: string;
  numberValue?: number;
  dateValue?: string;
  timeValue?: string;
  selectedOptions?: Record<string, unknown> | unknown[];
  notes?: string;
};

function specRef(q: TemplateQuestion): string | undefined {
  const m = q.metadata;
  return typeof m?.specRef === 'string' ? m.specRef : undefined;
}

function fieldKey(q: TemplateQuestion): string | undefined {
  const m = q.metadata;
  return typeof m?.fieldKey === 'string' ? m.fieldKey : undefined;
}

function parseSelectOptions(raw: unknown): { value: string; label: string }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return { value: entry, label: entry };
        if (entry && typeof entry === 'object') {
          const o = entry as Record<string, unknown>;
          const value = String(o.value ?? o.id ?? o.label ?? '');
          const label = String(o.label ?? o.value ?? o.id ?? '');
          if (!value && !label) return null;
          return { value: value || label, label: label || value };
        }
        return null;
      })
      .filter((x): x is { value: string; label: string } => x != null);
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const list = (raw as { options?: unknown[] }).options;
    if (Array.isArray(list)) return parseSelectOptions(list);
  }
  return [];
}

function isoDate(offsetMonths = 0): string {
  const d = new Date();
  if (offsetMonths) d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 10);
}

export type IaDemoIdentity = {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  nhsNumber?: string | null;
  nationalInsuranceNumber?: string | null;
  gender?: string | null;
  ethnicity?: string | null;
  language?: string | null;
  addressContact?: string | null;
  gpContact?: string | null;
  gpName?: string | null;
  emergencyContact?: string | null;
  allergies?: string | null;
  accessInstruction?: string | null;
};

/**
 * Synthetic QA identifiers — reserved dummy ranges, never a real person's NHS/NI.
 * NHS 999 prefix is unused in live allocation; QQ is the HMRC dummy NINO prefix.
 */
export const QA_DEMO_DOB = '1948-06-15';
export const QA_DEMO_NHS_NUMBER = '999 000 0001';
export const QA_DEMO_NI_NUMBER = 'QQ123456C';
export const QA_DEMO_GENDER = 'female';
export const QA_DEMO_ETHNICITY = 'white_english_welsh_scottish_northern_irish_or_british';
export const QA_DEMO_LANGUAGE = 'english';

/**
 * All three QA scenarios fill every applicable (visible) field.
 * Hidden follow-ups, secure fields, and occupied profile values are excluded separately.
 */
function shouldFillQuestion(q: TemplateQuestion, _level: IaAutofillLevel): boolean {
  return q.sectionNumber >= 1 && q.sectionNumber <= HOLISTIC_TAB_COUNT;
}

/** Profile identity keys. Fill only when the Service User has no existing value. */
const IDENTITY_PREFILL_KEYS = new Set([
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'dateOfBirth',
  'gender',
  'nhsNumber',
  'nationalInsuranceNumber',
  'ethnicity',
  'language',
  'languagesSpoken',
  'addressContact',
  'gpContact',
  'gpName',
  'emergencyContact',
  'allergies',
  'accessInstruction',
  'doorCode',
]);

const IDENTITY_KEY_TO_PROFILE: Record<string, keyof IaDemoIdentity> = {
  firstName: 'firstName',
  middleName: 'middleName',
  lastName: 'lastName',
  preferredName: 'preferredName',
  dateOfBirth: 'dateOfBirth',
  gender: 'gender',
  nhsNumber: 'nhsNumber',
  nationalInsuranceNumber: 'nationalInsuranceNumber',
  ethnicity: 'ethnicity',
  language: 'language',
  languagesSpoken: 'language',
  addressContact: 'addressContact',
  gpContact: 'gpContact',
  gpContactDetails: 'gpContact',
  gpName: 'gpName',
  emergencyContact: 'emergencyContact',
  allergies: 'allergies',
  allergiesSummary: 'allergies',
  accessInstruction: 'accessInstruction',
  accessInstructions: 'accessInstruction',
};

/** Do not invent these clinical measurements (worksheet tools already own Waterlow/MUST). */
const SKIP_INVENTED_MEASUREMENT_KEYS = new Set(['weightKg', 'muacCm', 'muacNutritionalRisk']);
const SKIP_INVENTED_MEASUREMENT_TEXT = [
  'bmi value',
  'must score',
  'amt score',
  'weight (kg)',
  'mid upper arm circumference',
  'muac nutritional risk',
];

function isSecureQuestion(q: TemplateQuestion): boolean {
  const m = q.metadata;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  return m.secureField === true;
}

function identityLookupKey(q: TemplateQuestion): string | null {
  const m = q.metadata;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (m.aboutMeProfileField === true) return null;
  const prefill = typeof m.prefillKey === 'string' ? m.prefillKey : '';
  if (prefill.startsWith('aboutMe_')) return null;
  const field = typeof m.fieldKey === 'string' ? m.fieldKey : '';
  if (prefill && IDENTITY_PREFILL_KEYS.has(prefill)) return prefill;
  if (field && IDENTITY_PREFILL_KEYS.has(field)) return field;
  if (field && field in IDENTITY_KEY_TO_PROFILE) return field;
  return null;
}

function isIdentityPrefillQuestion(q: TemplateQuestion): boolean {
  return identityLookupKey(q) != null;
}

function existingIdentityValue(q: TemplateQuestion, identity?: IaDemoIdentity | null): string | null {
  const lookup = identityLookupKey(q);
  if (!lookup) return null;
  const profileKey = IDENTITY_KEY_TO_PROFILE[lookup] ?? (lookup as keyof IaDemoIdentity);
  const raw = identity?.[profileKey];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

function hasOccupiedIdentityValue(q: TemplateQuestion, identity?: IaDemoIdentity | null): boolean {
  return existingIdentityValue(q, identity) != null;
}

function identityDemoAnswer(q: TemplateQuestion, identity?: IaDemoIdentity | null): AnswerInput {
  const lookup = identityLookupKey(q) ?? '';
  const base: AnswerInput = { questionId: q.id };
  const opts = parseSelectOptions(q.options);
  const profileKey = IDENTITY_KEY_TO_PROFILE[lookup] ?? lookup;

  if (profileKey === 'dateOfBirth' || lookup === 'dateOfBirth') {
    return { ...base, dateValue: QA_DEMO_DOB };
  }
  if (profileKey === 'gender' || lookup === 'gender') {
    const value = opts.find((o) => o.value === QA_DEMO_GENDER)?.value ?? opts[0]?.value ?? QA_DEMO_GENDER;
    return { ...base, selectedOptions: value as unknown as Record<string, unknown> };
  }
  if (profileKey === 'ethnicity' || lookup === 'ethnicity') {
    const value =
      opts.find((o) => o.value.toLowerCase() === QA_DEMO_ETHNICITY)?.value ?? QA_DEMO_ETHNICITY;
    return { ...base, selectedOptions: value as unknown as Record<string, unknown> };
  }
  if (profileKey === 'language' || lookup === 'language' || lookup === 'languagesSpoken') {
    if (q.questionType === 'SINGLE_SELECT' || q.questionType === 'MULTI_SELECT') {
      const value =
        opts.find((o) => o.value.toLowerCase() === QA_DEMO_LANGUAGE)?.value ?? QA_DEMO_LANGUAGE;
      return { ...base, selectedOptions: value as unknown as Record<string, unknown> };
    }
    return { ...base, textValue: 'English' };
  }
  if (profileKey === 'nhsNumber' || lookup === 'nhsNumber') {
    return { ...base, textValue: QA_DEMO_NHS_NUMBER };
  }
  if (profileKey === 'nationalInsuranceNumber' || lookup === 'nationalInsuranceNumber') {
    return { ...base, textValue: QA_DEMO_NI_NUMBER };
  }
  if (profileKey === 'firstName') return { ...base, textValue: identity?.firstName?.trim() || 'Helen' };
  if (profileKey === 'lastName') return { ...base, textValue: identity?.lastName?.trim() || 'Wright' };
  if (profileKey === 'middleName') return { ...base, textValue: identity?.middleName?.trim() || 'Anne' };
  if (profileKey === 'preferredName') {
    return {
      ...base,
      textValue: identity?.preferredName?.trim() || identity?.firstName?.trim() || 'Helen',
    };
  }
  if (profileKey === 'addressContact') {
    return { ...base, textValue: '12 Maple Close, Leeds, LS1 4AP\nTel: 0113 496 0123' };
  }
  if (profileKey === 'gpContact' || profileKey === 'gpName') {
    return { ...base, textValue: 'Dr A. Patel, Oak Tree Medical Practice\nTel: 0113 496 0456' };
  }
  if (profileKey === 'emergencyContact') {
    return { ...base, textValue: 'Sarah Wright · Daughter · 07700 900123' };
  }
  if (profileKey === 'allergies') {
    return { ...base, textValue: 'No known allergies.' };
  }
  if (profileKey === 'accessInstruction') {
    return { ...base, textValue: 'Key safe to the right of the front door. Please ring the bell and wait to be let in.' };
  }
  if (q.questionType === 'DATE') return { ...base, dateValue: QA_DEMO_DOB };
  if (q.questionType === 'SINGLE_SELECT') {
    const value = opts[0]?.value ?? QA_DEMO_GENDER;
    return { ...base, selectedOptions: value as unknown as Record<string, unknown> };
  }
  return { ...base, textValue: 'Recorded on the Service User profile.' };
}

function isIdentityOrSecureQuestion(q: TemplateQuestion): boolean {
  return isSecureQuestion(q) || isIdentityPrefillQuestion(q);
}

/** Secure, invented measurements, and not-applicable "other" details — never generated. */
export function isGenericDemoSkipQuestion(q: TemplateQuestion): boolean {
  return isSecureQuestion(q) || isInventedClinicalMeasurement(q) || isIntentionalBlankDemoQuestion(q);
}

/** True when this identity field already has a Service User / profile value and must not be overwritten. */
export function isOccupiedIdentityQuestion(
  q: TemplateQuestion,
  identity?: IaDemoIdentity | null,
): boolean {
  return isIdentityPrefillQuestion(q) && hasOccupiedIdentityValue(q, identity);
}

function isInventedClinicalMeasurement(q: TemplateQuestion): boolean {
  const key = fieldKey(q);
  if (key && SKIP_INVENTED_MEASUREMENT_KEYS.has(key)) return true;
  const text = q.questionText.toLowerCase();
  return SKIP_INVENTED_MEASUREMENT_TEXT.some((needle) => text === needle || text.startsWith(needle));
}

/** Visible but not applicable unless a parent "Other" option is selected — leave empty. */
function isIntentionalBlankDemoQuestion(q: TemplateQuestion): boolean {
  return q.questionText.toLowerCase().includes('other accommodation');
}

const FIRE_SAFETY_FIELD_KEYS = new Set([
  'fireSafetyRisksIdentified',
  'fireSafetyRisksDetails',
  'fireSafetyRisks',
  'londonFireBrigadeInformed',
  'londonFireBrigadeDetails',
  'manageHomeEnvironmentSafely',
  'homeEnvironmentSafetyMeasures',
]);

function isFireSafetyQuestion(q: TemplateQuestion): boolean {
  const key = fieldKey(q);
  if (key && FIRE_SAFETY_FIELD_KEYS.has(key)) return true;
  const ref = specRef(q);
  return ref === '3.1' || ref === '3.2' || ref === '3.3' || ref === '3.4';
}

function isProfileOrSecureQuestion(q: TemplateQuestion): boolean {
  return isIdentityOrSecureQuestion(q);
}

type ShowWhenRule = {
  gateTextIncludes?: string;
  gateFieldKey?: string;
  yes?: boolean;
  no?: boolean;
};

/** Same follow-up gates as the admin `conditional-visibility` inferred rules + seed `showWhen`. */
const INFERRED_FOLLOW_UP_RULES: { questionTextIncludes: string; when: ShowWhenRule }[] = [
  { questionTextIncludes: 'mca completed', when: { gateTextIncludes: 'mca required', yes: true } },
  {
    questionTextIncludes: 'best interest decision details',
    when: { gateTextIncludes: 'best interest decision required', yes: true },
  },
  { questionTextIncludes: 'language required', when: { gateTextIncludes: 'interpreter required', yes: true } },
  {
    questionTextIncludes: 'measures needed if home is unsafe',
    when: { gateTextIncludes: 'manage home environment safely', no: true },
  },
  {
    questionTextIncludes: 'if no, what measure should be taken',
    when: { gateTextIncludes: 'manage home environment safely', no: true },
  },
  { questionTextIncludes: 'key safe code', when: { gateTextIncludes: 'key safe present', yes: true } },
  { questionTextIncludes: 'key safe location', when: { gateTextIncludes: 'key safe present', yes: true } },
  { questionTextIncludes: 'pets secured during visits', when: { gateFieldKey: 'petsPresent', yes: true } },
  { questionTextIncludes: 'pet infestation', when: { gateFieldKey: 'petsPresent', yes: true } },
  { questionTextIncludes: 'oxygen care notes', when: { gateTextIncludes: 'oxygen dependent', yes: true } },
  { questionTextIncludes: 'pain location', when: { gateTextIncludes: 'pain or distress identified', yes: true } },
  { questionTextIncludes: 'pain score', when: { gateTextIncludes: 'pain or distress identified', yes: true } },
  { questionTextIncludes: 'pain trigger', when: { gateTextIncludes: 'pain or distress identified', yes: true } },
  { questionTextIncludes: 'current pain relief', when: { gateTextIncludes: 'pain or distress identified', yes: true } },
  { questionTextIncludes: 'pain assessment date', when: { gateTextIncludes: 'pain assessment completed', yes: true } },
  {
    questionTextIncludes: 'choking history details',
    when: { gateTextIncludes: 'swallowing or choking concerns', yes: true },
  },
  {
    questionTextIncludes: 'swallowing action plan',
    when: { gateTextIncludes: 'swallowing or choking concerns', yes: true },
  },
  { questionTextIncludes: 'salt referral made', when: { gateTextIncludes: 'salt referral required', yes: true } },
  { questionTextIncludes: 'salt referral date', when: { gateTextIncludes: 'salt referral made', yes: true } },
  { questionTextIncludes: 'hydration comment', when: { gateTextIncludes: 'adequately hydrated', no: true } },
  { questionTextIncludes: 'food allergy details', when: { gateTextIncludes: 'food allergies documented', yes: true } },
  { questionTextIncludes: 'bmi value', when: { gateTextIncludes: 'bmi completed', yes: true } },
  { questionTextIncludes: 'must score', when: { gateTextIncludes: 'must assessment completed', yes: true } },
  {
    questionTextIncludes: 'eating / drinking equipment details',
    when: { gateTextIncludes: 'requires aids for eating or drinking', yes: true },
  },
  { questionTextIncludes: 'wound type', when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true } },
  {
    questionTextIncludes: 'has wound assessment been completed',
    when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true },
  },
  { questionTextIncludes: 'wound assessment comment', when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true } },
  {
    questionTextIncludes: 'equipment ordered',
    when: { gateTextIncludes: 'further pressure equipment required', yes: true },
  },
  { questionTextIncludes: 'date equipment ordered', when: { gateTextIncludes: 'equipment ordered', yes: true } },
  { questionTextIncludes: 'prosthesis care notes', when: { gateTextIncludes: 'uses prosthesis', yes: true } },
  { questionTextIncludes: 'number of falls', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'most recent fall date', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'injury caused by fall', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'falls assessment date', when: { gateTextIncludes: 'falls assessment completed', yes: true } },
  { questionTextIncludes: 'representative name', when: { gateTextIncludes: 'representative involved', yes: true } },
  {
    questionTextIncludes: 'safeguarding concern types',
    when: { gateTextIncludes: 'safeguarding concerns identified', yes: true },
  },
  {
    questionTextIncludes: 'safeguarding concern details',
    when: { gateTextIncludes: 'safeguarding concerns identified', yes: true },
  },
  {
    questionTextIncludes: 'immediate action taken',
    when: { gateTextIncludes: 'safeguarding concerns identified', yes: true },
  },
  { questionTextIncludes: 'manager informed', when: { gateTextIncludes: 'safeguarding concerns identified', yes: true } },
  {
    questionTextIncludes: 'local authority safeguarding referral required',
    when: { gateTextIncludes: 'safeguarding concerns identified', yes: true },
  },
  {
    questionTextIncludes: 'safeguarding referral made',
    when: { gateTextIncludes: 'local authority safeguarding referral required', yes: true },
  },
  { questionTextIncludes: 'safeguarding referral date', when: { gateTextIncludes: 'safeguarding referral made', yes: true } },
  { questionTextIncludes: 'type of diabetes', when: { gateTextIncludes: 'service user is diabetic', yes: true } },
  {
    questionTextIncludes: 'what should staff do if no answer',
    when: { gateTextIncludes: 'no response procedure agreed', yes: true },
  },
  { questionTextIncludes: 'salt referral required', when: { gateTextIncludes: 'swallowing or choking concerns', yes: true } },
  {
    questionTextIncludes: 'london fire brigade informed — details',
    when: { gateTextIncludes: 'london fire brigade informed', yes: true },
  },
  {
    questionTextIncludes: 'london fire brigade contact',
    when: { gateTextIncludes: 'london fire brigade informed', yes: true },
  },
  { questionTextIncludes: 'informal carer name', when: { gateTextIncludes: 'informal carer', yes: true } },
  { questionTextIncludes: 'informal carer contact', when: { gateTextIncludes: 'informal carer', yes: true } },
  {
    questionTextIncludes: 'representative relationship',
    when: { gateTextIncludes: 'representative involved', yes: true },
  },
  { questionTextIncludes: 'carer assessment referral made', when: { gateTextIncludes: 'carer’s assessment', yes: true } },
  { questionTextIncludes: 'carer assessment referral date', when: { gateTextIncludes: 'referral made', yes: true } },
  { questionTextIncludes: 'continence product details', when: { gateTextIncludes: 'continence products in use', yes: true } },
  { questionTextIncludes: 'catheter type', when: { gateTextIncludes: 'catheter in situ', yes: true } },
  { questionTextIncludes: 'stoma care', when: { gateTextIncludes: 'urostomy or stoma present', yes: true } },
  { questionTextIncludes: 'continence referral date', when: { gateTextIncludes: 'continence service referral required', yes: true } },
  { questionTextIncludes: 'staff communication instructions', when: { gateTextIncludes: 'speech impairment or concern', yes: true } },
  { questionTextIncludes: 'hearing aid in use', when: { gateTextIncludes: 'hearing impairment', yes: true } },
  { questionTextIncludes: 'hearing aid details', when: { gateTextIncludes: 'hearing aid in use', yes: true } },
  { questionTextIncludes: 'glasses or visual aids in use', when: { gateTextIncludes: 'sight impairment', yes: true } },
  { questionTextIncludes: 'visual aid details', when: { gateTextIncludes: 'glasses or visual aids in use', yes: true } },
  { questionTextIncludes: 'professional interpreter needed', when: { gateTextIncludes: 'interpreter required', yes: true } },
  { questionTextIncludes: 'current mental health details', when: { gateTextIncludes: 'current mental health issues reported', yes: true } },
  { questionTextIncludes: 'cpn name', when: { gateTextIncludes: 'community psychiatric nurse involved', yes: true } },
  {
    questionTextIncludes: 'gp referral for sleep concern made',
    when: { gateTextIncludes: 'gp referral for sleep concern requested', yes: true },
  },
  {
    questionTextIncludes: 'gp referral for sleep concern date',
    when: { gateTextIncludes: 'gp referral for sleep concern made', yes: true },
  },
  {
    questionTextIncludes: 'gp referral for mental health made',
    when: { gateTextIncludes: 'gp referral for mental health requested', yes: true },
  },
  { questionTextIncludes: 'gp referral date', when: { gateTextIncludes: 'gp referral for mental health made', yes: true } },
  { questionTextIncludes: 'amt date', when: { gateTextIncludes: 'amt completed', yes: true } },
  {
    questionTextIncludes: 'gp referral for cognition made',
    when: { gateTextIncludes: 'gp referral for cognition requested', yes: true },
  },
  {
    questionTextIncludes: 'gp referral for cognition date',
    when: { gateTextIncludes: 'gp referral for cognition made', yes: true },
  },
  { questionTextIncludes: 'dietitian referral date', when: { gateTextIncludes: 'dietitian referral', yes: true } },
  {
    questionTextIncludes: 'skin condition comment',
    when: { gateTextIncludes: 'skin condition or concern', yes: true },
  },
  {
    questionTextIncludes: 'ulcers or wounds comment',
    when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true },
  },
  {
    questionTextIncludes: 'pressure equipment details',
    when: { gateTextIncludes: 'pressure relieving equipment in use', yes: true },
  },
  { questionTextIncludes: 'uses prosthesis', when: { gateTextIncludes: 'any amputation', yes: true } },
  {
    questionTextIncludes: 'further equipment details',
    when: { gateTextIncludes: 'further equipment required to be ordered', yes: true },
  },
  { questionTextIncludes: 'falls assessment completed', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'reason unable to weigh', when: { gateFieldKey: 'unableToWeigh', yes: true } },
  { questionTextIncludes: 'pain management plan', when: { gateTextIncludes: 'pain or distress identified', yes: true } },
];

function parseMetadataShowWhen(metadata: Record<string, unknown> | null): ShowWhenRule | null {
  const raw = metadata?.showWhen;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const gateTextIncludes = typeof row.gateTextIncludes === 'string' ? row.gateTextIncludes : undefined;
  const gateFieldKey = typeof row.gateFieldKey === 'string' ? row.gateFieldKey : undefined;
  if (!gateTextIncludes && !gateFieldKey) return null;
  return {
    gateTextIncludes,
    gateFieldKey,
    yes: row.yes === true ? true : undefined,
    no: row.no === true ? true : undefined,
  };
}

function inferredFollowUpRule(q: TemplateQuestion): ShowWhenRule | null {
  const needle = q.questionText.toLowerCase();
  for (const row of INFERRED_FOLLOW_UP_RULES) {
    if (needle.includes(row.questionTextIncludes)) return row.when;
  }
  return null;
}

function followUpRuleFor(q: TemplateQuestion): ShowWhenRule | null {
  return parseMetadataShowWhen(q.metadata) ?? inferredFollowUpRule(q);
}

function findGateQuestion(questions: TemplateQuestion[], rule: ShowWhenRule): TemplateQuestion | undefined {
  if (rule.gateFieldKey) {
    const byKey = questions.find((q) => fieldKey(q) === rule.gateFieldKey);
    if (byKey) return byKey;
  }
  if (rule.gateTextIncludes) {
    const needle = rule.gateTextIncludes.toLowerCase();
    const matches = questions.filter((q) => q.questionText.toLowerCase().includes(needle));
    return (
      matches.find((q) => q.questionType === 'YES_NO' || q.questionType === 'CHECKBOX') ?? matches[0]
    );
  }
  return undefined;
}

function answerIsYes(a: AnswerInput | undefined): boolean {
  return a?.checked === true || a?.booleanValue === true;
}

function answerIsNo(a: AnswerInput | undefined): boolean {
  return a?.checked === false || a?.booleanValue === false;
}

function gateMatchesGeneratedAnswer(rule: ShowWhenRule, gateAnswer: AnswerInput | undefined): boolean {
  if (rule.yes) return answerIsYes(gateAnswer);
  if (rule.no) return answerIsNo(gateAnswer);
  return false;
}

/**
 * Template questions this holistic tab owns beyond the IDs currently visible in the UI
 * (worksheet-only tabs, hidden §1 assessorName, fire §3.1–3.4 on tab 1, etc.).
 */
export function extraQuestionsForHolisticTab(
  tabId: number,
  questions: TemplateQuestion[],
): TemplateQuestion[] {
  const consentRefs = new Set(['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8']);
  switch (tabId) {
    case 1:
      return questions.filter(
        (q) => isFireSafetyQuestion(q) || (q.sectionNumber === 1 && fieldKey(q) === 'assessorName'),
      );
    case 3:
      return questions.filter((q) => {
        const ref = specRef(q);
        return ref != null && consentRefs.has(ref);
      });
    case 8:
      return questions.filter((q) => specRef(q) === '12.7');
    case 12:
      return questions.filter((q) => q.sectionNumber === 3 && !isFireSafetyQuestion(q));
    case 13:
      return questions.filter((q) => q.sectionNumber === 13);
    case 16:
      return questions.filter((q) => specRef(q) === '14.1');
    default:
      return [];
  }
}

/**
 * Add same-section showWhen / inferred follow-ups whose gates are being generated.
 * Never includes secure fields or invented clinical measurements.
 */
export function expandFollowUpQuestionIds(
  seedIds: Set<string>,
  questions: TemplateQuestion[],
  generatedAnswers: Map<string, AnswerInput>,
): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ownedSections = new Set<number>();
  for (const id of seedIds) {
    const q = byId.get(id);
    if (q) ownedSections.add(q.sectionNumber);
  }

  const expanded = new Set(seedIds);
  let added = true;
  while (added) {
    added = false;
    for (const q of questions) {
      if (expanded.has(q.id)) continue;
      if (isSecureQuestion(q) || isInventedClinicalMeasurement(q) || isIntentionalBlankDemoQuestion(q)) continue;
      if (!ownedSections.has(q.sectionNumber)) continue;
      const rule = followUpRuleFor(q);
      if (!rule) continue;
      const gate = findGateQuestion(questions, rule);
      if (!gate || !expanded.has(gate.id)) continue;
      if (!gateMatchesGeneratedAnswer(rule, generatedAnswers.get(gate.id))) continue;
      expanded.add(q.id);
      added = true;
    }
  }
  return expanded;
}

/** Paper §7 / spec §12.2–12.5 ADL worksheet activity ids — must match admin `ADL_WORKSHEET_ACTIVITY_IDS`. */
export const IA_DEMO_ADL_ACTIVITY_IDS = [
  'eating_drinking',
  'toileting',
  'walking',
  'dressing_undressing',
  'bathing',
  'grooming',
  'preparing_food',
  'laundry',
  'housework',
  'shopping',
  'room_to_room',
  'turning_in_bed',
  'stairs',
  'lying_to_sitting',
  'chair_transfer',
  'toilet_transfer',
  'bed_transfer',
  'enter_leave_home',
  'public_transport',
  'short_walks',
  'long_walks',
] as const;

function e2eYesNoValue(q: TemplateQuestion): { checked: boolean; booleanValue: boolean } {
  const key = fieldKey(q);
  const ref = specRef(q);
  const text = q.questionText.toLowerCase();
  const m = q.metadata;

  // Do not invent a weight; hide Weight (kg) and fill the unable-to-weigh reason instead.
  if (key === 'unableToWeigh' || text.includes('unable to weigh')) {
    return { checked: true, booleanValue: true };
  }
  // Keep extra lying/sitting/standing BP hidden — core vitals already have approved values.
  if (key === 'standingBpRequired' || text.includes('standing blood pressure required')) {
    return { checked: false, booleanValue: false };
  }
  // Keep section detail fields visible so the fill can complete them.
  if (m?.noConcernMaster === true || text.includes('no concerns identified in this section')) {
    return { checked: false, booleanValue: false };
  }

  const negative =
    key === 'safeguardingConcern' ||
    key === 'fallsLast12Months' ||
    key === 'hasWounds' ||
    key === 'usesHoistOrSling' ||
    key === 'financeSupportRequired' ||
    key === 'clinicalEquipmentInUse' ||
    key === 'petsPresent' ||
    text.includes('safeguarding concerns identified') ||
    text.includes('falls in last') ||
    text.includes('currently has ulcers') ||
    text.includes('finance support required') ||
    text.includes('representative involved') ||
    text.includes('mca required') ||
    text.includes('capacity not intact') ||
    text.includes('salt referral required') ||
    text.includes('local authority safeguarding referral required') ||
    text.includes('interpreter required') ||
    text.includes('swallowing or choking concerns') ||
    text.includes('diagnosed dementia') ||
    text.includes('learning disability') ||
    text.includes('brain injury') ||
    text.includes('amt completed') ||
    text.includes('bmi completed') ||
    text.includes('must assessment completed') ||
    text.includes('pets present') ||
    text.includes('are there pets');

  const positive =
    ref === '2.1' ||
    ref === '2.2' ||
    key === 'noResponseProcedureAgreed' ||
    key === 'suSignatureObtained' ||
    key === 'assessorDeclarationConfirmed' ||
    text.includes('consented to this assessment') ||
    text.includes('consented to receive care') ||
    text.includes('capacity intact') ||
    text.includes('mca completed') ||
    text.includes('no response procedure agreed') ||
    text.includes('signature obtained') ||
    text.includes('assessor declaration confirmed') ||
    text.includes('competent to record vital signs') ||
    text.includes('emergency contact') ||
    text.includes('waterlow assessment completed');

  if (positive) return { checked: true, booleanValue: true };
  if (negative) return { checked: false, booleanValue: false };
  return { checked: true, booleanValue: true };
}

function severeYesNoValue(q: TemplateQuestion): { checked: boolean; booleanValue: boolean } {
  const key = fieldKey(q);
  const text = q.questionText.toLowerCase();

  const riskNo =
    key === 'manageHomeEnvironmentSafely' ||
    key === 'adequatelyHydrated' ||
    text.includes('manage home environment safely') ||
    text.includes('adequately hydrated');

  const riskYes =
    key === 'safeguardingConcern' ||
    key === 'fallsLast12Months' ||
    key === 'hasWounds' ||
    key === 'financeSupportRequired' ||
    key === 'clinicalEquipmentInUse' ||
    key === 'petsPresent' ||
    text.includes('safeguarding concerns identified') ||
    text.includes('falls in last') ||
    text.includes('currently has ulcers') ||
    text.includes('wound assessment been completed') ||
    text.includes('finance support required') ||
    text.includes('feels low') ||
    text.includes('low in mood') ||
    text.includes('pain concern') ||
    text.includes('pain or distress identified') ||
    text.includes('swallowing or choking concerns') ||
    text.includes('mca required') ||
    text.includes('pets present') ||
    text.includes('are there pets') ||
    text.includes('salt referral required') ||
    text.includes('controlled drugs in use') ||
    text.includes('covert medication required') ||
    text.includes('local authority safeguarding referral required');

  if (riskNo) return { checked: false, booleanValue: false };
  if (riskYes) return { checked: true, booleanValue: true };
  return e2eYesNoValue(q);
}

/** Deterministic index from a seed string (stable across runs; no Math.random). */
function stableIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

/** Realistic UK assessor names (never obvious placeholders like "Test User"). */
const DEMO_ASSESSOR_NAMES = [
  'Sarah Thompson',
  'David Okafor',
  'Priya Nair',
  'Karen McAllister',
  "Michael O'Brien",
];

function realisticName(seed: string): string {
  return DEMO_ASSESSOR_NAMES[stableIndex(seed, DEMO_ASSESSOR_NAMES.length)]!;
}

/**
 * Realistic, severity-appropriate UK care-service free text for a question. Keyed off the
 * question wording so notes read coherently; falls back to a plausible per-severity sentence.
 * Never emits placeholder markers ("E2E", "@", "Lorem ipsum", "Sample data", etc.).
 */
function isPersonCentredNarrative(q: TemplateQuestion): boolean {
  const m = q.metadata;
  if (m?.aboutMeProfileField === true) return true;
  const key = fieldKey(q) ?? (typeof m?.prefillKey === 'string' ? m.prefillKey : '');
  if (
    [
      'whatMattersMost',
      'supportGoals',
      'howAndWhenToSupportMe',
      'personalHygiene',
      'nightSupport',
      'howICommunicate',
      'communicationNeeds',
      'aboutMePriorities',
      'aboutMeRoutine',
      'foodLikes',
      'activityLikes',
    ].includes(key)
  ) {
    return true;
  }
  const spec = specRef(q) ?? '';
  if (spec === '1.3' || spec.startsWith('1.3') || spec === '1.4' || spec === '1.5' || spec === '1.6' || spec === '1.7') {
    return true;
  }
  const t = q.questionText.toLowerCase();
  return (
    t.includes('what matters most') ||
    t.includes('what do they want support to achieve') ||
    t.includes('what are they worried about') ||
    t.includes('how and when to support me') ||
    t.includes('how i communicate') ||
    t.includes('bathing / shower') ||
    t.includes('how should staff support privacy') ||
    t.includes('things they want to keep doing') ||
    t.includes('things they do not want support') ||
    t.includes('care preferences') ||
    t.includes('personal hygiene') ||
    t.includes('night support') ||
    t.includes('food likes and dislikes') ||
    t.includes('communication needs') ||
    t.includes('lifestyle, role and choices') ||
    t.includes('beliefs') ||
    t.includes('modesty')
  );
}

function firstPersonFreeText(q: TemplateQuestion, level: IaAutofillLevel): string {
  const t = q.questionText.toLowerCase();
  const critical = level === 'critical';
  if (t.includes('what matters most') || t.includes('most important')) {
    return critical
      ? 'I need help to stay safe at home. I worry about falling, and I want carers who explain what they are doing and do not rush me.'
      : level === 'normal'
        ? 'I want to stay in my own home with a bit of help each day. Seeing my family matters most to me.'
        : 'I like to do as much as I can for myself. A little help with shopping and meals is enough.';
  }
  if (t.includes('worried')) {
    return critical
      ? 'I worry about falling when I am on my own, and about not being able to get to the toilet in time.'
      : 'I worry a little about being a burden to my family. Please tell me if anything changes in my care.';
  }
  if (t.includes('support to achieve') || t.includes('priorities') || t.includes('goals')) {
    return critical
      ? 'I want to stay comfortable at home with the right support, and to feel safe when I am washed and moved.'
      : 'I want prompting with my daily routine so I can stay as independent as I can.';
  }
  if (t.includes('privacy') || t.includes('prefer to be addressed') || t.includes('care preferences')) {
    return 'I prefer staff to explain what they are doing before providing personal care. Please keep me covered and close the door.';
  }
  if (t.includes('bathing') || t.includes('personal hygiene') || t.includes('washing')) {
    return critical
      ? 'I need full help with washing and dressing. Please tell me what you are going to do first.'
      : level === 'normal'
        ? 'I need some prompting when washing and dressing. Please let me do what I can myself.'
        : 'I manage most of my washing myself. Please prompt me and stay nearby if I ask.';
  }
  if (t.includes('how and when to support') || t.includes('how to support')) {
    return critical
      ? 'I need two carers for personal care and transfers. Please do not rush me, and tell me before you start.'
      : 'I prefer a regular carer. Please prompt me rather than doing everything for me.';
  }
  if (t.includes('communicate')) {
    return 'I speak English. Please speak clearly, face me, and give me time to answer.';
  }
  if (t.includes('night')) {
    return critical
      ? 'I get unsettled at night and I may try to get out of bed. Please leave a night light on.'
      : 'I usually sleep through. I do not need anyone overnight.';
  }
  if (t.includes('food') || t.includes('likes and dislikes') || t.includes('i like') || t.includes("i don't like")) {
    return 'I like simple home-cooked meals and a cup of tea. Please tell me what is on the plate.';
  }
  if (t.includes('routine') || t.includes('keep doing') || t.includes('independently') || t.includes('breakfast') || t.includes('get up') || t.includes('bedtime') || t.includes('tea time')) {
    return 'I like a morning wash, breakfast, and my tablets on time. Please let me do what I can for myself.';
  }
  if (t.includes('supported to write')) {
    return 'My daughter helped me write this.';
  }
  if (t.includes('people who are important') || t.includes('family and friends')) {
    return 'My daughter visits most days and my sister rings in the evening.';
  }
  if (t.includes('hobbies') || t.includes('interests') || t.includes('talk about') || t.includes('tv programmes') || t.includes('activities')) {
    return 'I enjoy the radio, a cup of tea, and chatting about my family.';
  }
  if (t.includes('where i am from') || t.includes('childhood') || t.includes('education') || t.includes('occupation') || t.includes('adulthood')) {
    return 'I grew up nearby, worked locally, and I am proud of my family.';
  }
  if (t.includes('identification characteristics') || t.includes('recognise me')) {
    return 'I have short grey hair and I usually wear my glasses on a chain.';
  }
  if (t.includes('religion') || t.includes('spiritual') || t.includes('prayer') || t.includes('worship') || t.includes('culture') || t.includes('beliefs')) {
    return 'Please give me quiet time for prayer in the morning. I do not eat pork.';
  }
  if (t.includes('modesty') || t.includes('privacy')) {
    return 'I prefer staff to explain what they are doing before providing personal care. Please keep me covered and close the door.';
  }
  if (t.includes('link') || t.includes('url')) {
    return 'https://www.nhs.uk';
  }
  return critical
    ? 'Please explain what you are doing and do not rush me. I need more support in this area at the moment.'
    : 'Please tell me before you start, and let me do what I can myself.';
}

function realisticFreeText(q: TemplateQuestion, level: IaAutofillLevel): string {
  if (isPersonCentredNarrative(q)) return firstPersonFreeText(q, level);

  const t = q.questionText.toLowerCase();
  const critical = level === 'critical';

  if (t.includes('reason for admission') || t.includes('reason for referral') || t.includes('starting care')) {
    return critical
      ? 'Referred following a fall at home with reduced mobility and increasing confusion; needs support with personal care, meals and medication.'
      : level === 'normal'
        ? 'Referred by their GP for support with daily living after a chest infection left them less mobile and less confident at home.'
        : 'Requires low-level support with shopping, meal preparation and prompting to maintain independence at home.';
  }
  if (t.includes('medical history')) {
    return 'Hypertension, type 2 diabetes (diet-controlled), osteoarthritis of the knees and mild hearing loss. No recent hospital admissions.';
  }
  if (t.includes('allergies')) {
    return 'Penicillin — causes a skin rash. No known food allergies.';
  }
  if (t.includes('safeguarding')) {
    return critical
      ? 'Concerns raised about self-neglect and a recent unexplained bruise; safeguarding referral made to the local authority and being monitored.'
      : 'No current safeguarding concerns. Family and the care team maintain regular contact.';
  }
  if (t.includes('review') && t.includes('sign')) {
    return 'Assessment discussed with the service user and reviewed by the registered manager; agreed as an accurate reflection of current needs.';
  }
  if (t.includes('emotional') || t.includes('mood') || t.includes('mental health')) {
    return critical
      ? 'Low in mood recently, tearful at times and withdrawn from usual activities; GP review requested and being monitored closely.'
      : 'Generally settled in mood, enjoys company and a regular routine; no significant concerns at present.';
  }
  if (t.includes('communication')) {
    return 'Communicates verbally in English. Wears hearing aids — speak clearly and face the person. Reads large print with glasses.';
  }
  if (t.includes('mobility') || t.includes('moving') || t.includes('handling')) {
    return critical
      ? 'Mobilises short distances with a frame and the assistance of two carers; high falls risk and uses a wheelchair for longer distances.'
      : 'Mobilises independently with a walking stick; steady indoors but needs supervision on the stairs and outdoors.';
  }
  if (t.includes('nutrition') || t.includes('eating') || t.includes('diet') || t.includes('drinking') || t.includes('fluid')) {
    return critical
      ? 'Reduced appetite with recent unplanned weight loss; needs a soft diet, encouragement and fortified drinks. Monitor fluid intake.'
      : 'Eats a normal diet and drinks well with prompting; enjoys home-cooked meals and a cup of tea mid-morning.';
  }
  if (t.includes('continence') || t.includes('toilet')) {
    return critical
      ? 'Requires full support with continence care and regular repositioning; uses continence products day and night.'
      : 'Continent of bladder and bowel; needs prompting and easy access to the toilet at night.';
  }
  if (t.includes('skin') || t.includes('pressure') || t.includes('wound')) {
    return critical
      ? 'Fragile skin with a Grade 2 pressure area to the sacrum; repositioning chart in place and the district nurse is involved.'
      : 'Skin intact and in good condition; encourage regular repositioning and daily skin checks.';
  }
  if (t.includes('medication')) {
    return 'Takes regular medication via a monitored dosage system; needs prompting and observation at each visit.';
  }
  if (t.includes('goal') || t.includes('outcome') || t.includes('wishes')) {
    return critical
      ? 'To remain safe and comfortable at home with the right support, and to reduce the risk of further falls and hospital admission.'
      : 'To stay independent at home for as long as possible and continue enjoying visits from family and friends.';
  }
  if (t.includes('support') && (t.includes('required') || t.includes('needs') || t.includes('achieve'))) {
    return critical
      ? 'Four care calls a day from two carers for personal care, medication, meals and repositioning.'
      : 'One care call a day to support with washing, dressing and medication prompts.';
  }
  if (t.includes('people present') || t.includes('who was present') || t.includes('present at')) {
    return 'Service user, their daughter (main family contact) and the assessing care coordinator.';
  }

  return critical
    ? 'Significant needs identified in this area; requires close support and regular review by the care team.'
    : level === 'normal'
      ? 'Some support needs identified in this area; being monitored as part of the ongoing care plan.'
      : 'Stable and largely independent in this area; no additional support currently required.';
}

function buildPreferredVisitTimesAnswer(): Record<string, unknown> {
  return {
    MORNING: { selected: true, from: '08:00', to: '12:00', roundName: 'Morning' },
    AFTERNOON: { selected: true, from: '13:00', to: '17:00', roundName: 'Afternoon' },
  };
}

/**
 * IDs this tab is allowed to generate: requested ∩ template, plus tab-owned extras,
 * minus secure / occupied-identity / invented measurements, plus same-section follow-ups
 * whose generated gates match. Empty identity fields are included so they receive QA values.
 */
export function collectWritableDemoQuestionIds(
  tabId: number,
  questions: TemplateQuestion[],
  requestedIds: string[],
  level: IaAutofillLevel,
  identity?: IaDemoIdentity | null,
): Set<string> {
  const extras = extraQuestionsForHolisticTab(tabId, questions);
  const extraIds = new Set(extras.map((e) => e.id));
  const requested = new Set(requestedIds);
  const seed = new Set<string>();
  for (const q of questions) {
    if (isGenericDemoSkipQuestion(q) || isOccupiedIdentityQuestion(q, identity)) continue;
    if (!requested.has(q.id) && !extraIds.has(q.id)) continue;
    // Dependents belong to this tab's result only when their generated gate matches.
    if (followUpRuleFor(q)) continue;
    seed.add(q.id);
  }

  const preview = buildAutofillAnswers(questions, level, undefined, identity);
  const previewMap = new Map(preview.map((a) => [a.questionId, a]));
  for (const id of seed) {
    if (previewMap.has(id)) continue;
    const q = questions.find((x) => x.id === id);
    if (!q) continue;
    const forced = buildAutofillAnswers([q], level, new Set([id]), identity);
    if (forced[0]) previewMap.set(id, forced[0]);
  }

  return expandFollowUpQuestionIds(seed, questions, previewMap);
}

export function buildAutofillAnswers(
  questions: TemplateQuestion[],
  level: IaAutofillLevel,
  onlyIds?: Set<string>,
  identity?: IaDemoIdentity | null,
): AnswerInput[] {
  const answers: AnswerInput[] = [];
  for (const q of questions) {
    if (onlyIds && !onlyIds.has(q.id)) continue;
    const a = buildAnswer(q, level, { force: Boolean(onlyIds?.has(q.id)) }, identity);
    if (a) answers.push(a);
  }
  return answers;
}

function buildAnswer(
  q: TemplateQuestion,
  level: IaAutofillLevel,
  fillOpts?: { force?: boolean },
  identity?: IaDemoIdentity | null,
): AnswerInput | null {
  const force = fillOpts?.force === true;
  if (isSecureQuestion(q) || isInventedClinicalMeasurement(q) || isIntentionalBlankDemoQuestion(q)) return null;
  if (isOccupiedIdentityQuestion(q, identity)) return null;
  if (!force && !shouldFillQuestion(q, level)) return null;

  if (isIdentityPrefillQuestion(q)) {
    return identityDemoAnswer(q, identity);
  }

  const base: AnswerInput = { questionId: q.id };
  const key = fieldKey(q);
  const ref = specRef(q);
  const opts = parseSelectOptions(q.options);
  const textNeedle = q.questionText.toLowerCase();

  if (key === 'preferredVisitTimes' || textNeedle.includes('preferred visit times')) {
    return { ...base, selectedOptions: buildPreferredVisitTimesAnswer() };
  }

  if ((ref === '2.1' || ref === '2.2') && (q.questionType === 'YES_NO' || q.questionType === 'CHECKBOX')) {
    return { ...base, checked: true, booleanValue: true };
  }

  switch (q.questionType) {
    case 'YES_NO':
    case 'CHECKBOX': {
      if (level === 'critical') return { ...base, ...severeYesNoValue(q) };
      if (level === 'normal' || level === 'low') return { ...base, ...e2eYesNoValue(q) };
      return { ...base, checked: false, booleanValue: false };
    }
    case 'NUMBER': {
      if (key === 'temperature') return { ...base, numberValue: 36.6 };
      if (key === 'pulse') return { ...base, numberValue: 72 };
      if (key === 'respirations') return { ...base, numberValue: 16 };
      if (key === 'bpSystolic') return { ...base, numberValue: 120 };
      if (key === 'bpDiastolic') return { ...base, numberValue: 80 };
      if (key === 'spo2') return { ...base, numberValue: 98 };
      if (key === 'bloodGlucose') return { ...base, numberValue: 5.5 };
      if (key === 'plannedCarers' || textNeedle.includes('planned number of carers')) {
        return { ...base, numberValue: level === 'critical' ? 2 : 1 };
      }
      if (textNeedle.includes('pain score')) {
        return { ...base, numberValue: level === 'critical' ? 7 : level === 'normal' ? 4 : 1 };
      }
      if (textNeedle.includes('fluid target')) {
        return { ...base, numberValue: 1500 };
      }
      if (textNeedle.includes('number of falls')) {
        return { ...base, numberValue: level === 'critical' ? 3 : 1 };
      }
      return { ...base, numberValue: 1 };
    }
    case 'DATE': {
      if (key === 'nextReviewDate' || key === 'assessorSignDate') {
        return { ...base, dateValue: isoDate(key === 'nextReviewDate' ? 6 : 0) };
      }
      return { ...base, dateValue: isoDate() };
    }
    case 'TIME':
      return { ...base, timeValue: '09:00' };
    case 'TEXT':
    case 'TEXTAREA': {
      if (key === 'assessorName') return { ...base, textValue: realisticName(q.id) };
      if (key === 'assessorRole' || key === 'assessorDesignation') return { ...base, textValue: 'Registered Manager' };
      return { ...base, textValue: realisticFreeText(q, level) };
    }
    case 'SINGLE_SELECT': {
      if (key === 'fundingType' || (typeof q.metadata?.optionsLookup === 'string' && q.metadata.optionsLookup === 'service_user_funding_types')) {
        const funding = opts.find((o) => o.value === 'local_authority') ?? opts[0];
        return { ...base, selectedOptions: (funding?.value ?? 'local_authority') as unknown as Record<string, unknown> };
      }
      if (key === 'lpoaAppointed') {
        const pick =
          opts.find((o) => o.value === (level === 'critical' ? 'both' : 'health')) ??
          opts.find((o) => o.value !== 'none') ??
          opts[0];
        if (pick) return { ...base, selectedOptions: pick.value as unknown as Record<string, unknown> };
      }
      if (opts[0]) return { ...base, selectedOptions: opts[0].value as unknown as Record<string, unknown> };
      return null;
    }
    case 'MULTI_SELECT': {
      if (opts.length) {
        const pick = level === 'critical' ? opts.slice(0, Math.min(3, opts.length)) : [opts[0]!];
        return { ...base, selectedOptions: pick.map((o) => o.value) };
      }
      return null;
    }
    default:
      return null;
  }
}

function enrichMustMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const bmiScores: Record<string, number> = { gt20: 0, '18_5to20': 1, lt18_5: 2 };
  const wlScores: Record<string, number> = { lt5: 0, '5to10': 1, gt10: 2 };
  const acuteScores: Record<string, number> = { no: 0, yes: 2 };
  const bmiOptionId = String(meta.bmiOptionId ?? 'gt20');
  const weightLossOptionId = String(meta.weightLossOptionId ?? 'lt5');
  const acuteDiseaseOptionId = String(meta.acuteDiseaseOptionId ?? 'no');
  const score =
    (bmiScores[bmiOptionId] ?? 0) +
    (wlScores[weightLossOptionId] ?? 0) +
    (acuteScores[acuteDiseaseOptionId] ?? 0);
  const riskLevel = score >= 2 ? 'high' : score === 1 ? 'medium' : 'low';
  return { ...meta, score, riskLevel };
}

function demoSubjectName(identity?: IaDemoIdentity | null): string {
  const preferred = identity?.preferredName?.trim();
  if (preferred) return preferred;
  const legal = [identity?.firstName?.trim(), identity?.lastName?.trim()].filter(Boolean).join(' ');
  return legal || 'Helen Wright';
}

function conditionPrefix(level: IaAutofillLevel): string {
  if (level === 'critical') return 'High needs identified';
  if (level === 'normal') return 'Moderate needs identified';
  return 'Stable and largely independent';
}

export function buildHolisticWorksheetMetadata(
  level: IaAutofillLevel,
  identity?: IaDemoIdentity | null,
): Record<string, unknown> {
  const prefix = conditionPrefix(level);
  const displayName = demoSubjectName(identity);
  const firstNames = identity?.firstName?.trim() || displayName.split(' ')[0] || 'Helen';
  const surname =
    identity?.lastName?.trim() || (displayName.includes(' ') ? displayName.split(' ').slice(-1)[0] : 'Wright');
  const dob = identity?.dateOfBirth?.trim()?.slice(0, 10) || QA_DEMO_DOB;
  const nhs = identity?.nhsNumber?.trim() || QA_DEMO_NHS_NUMBER;
  const gender = identity?.gender?.trim() || 'Female';

  const adlScore = level === 'critical' ? 3 : level === 'normal' ? 1 : 0;
  const adlRows = IA_DEMO_ADL_ACTIVITY_IDS.map((id) => ({
    id,
    activity: id.replace(/_/g, ' '),
    score: adlScore,
    notes: '',
  }));
  const transferRows = [
    { id: 'bedToChair', label: 'Bed to chair', level: level === 'critical' ? 1 : null },
  ];
  const skinRows = [{ id: 'sacrum', label: 'Sacrum', right: `${prefix} — clear`, left: `${prefix} — clear` }];

  const waterlow = enrichWaterlowMetadata(
    level === 'critical'
      ? {
          gender: 1,
          age: 3,
          build: 2,
          appetite: 2,
          mobility: 3,
          continence: 2,
          neurological: 2,
          surgery: 1,
          medication: 1,
          weightLoss: 2,
          skinTypes: ['broken', 'discoloured'],
          tissueMalnutrition: ['cachexia'],
          comments: 'Very critical — elevated Waterlow',
        }
      : level === 'low'
        ? {
            gender: 1,
            age: 0,
            build: 0,
            appetite: 0,
            mobility: 0,
            continence: 0,
            neurological: 0,
            surgery: 0,
            medication: 0,
            weightLoss: 0,
            skinTypes: ['healthy'],
            tissueMalnutrition: [],
            comments: 'Stable — low pressure risk',
          }
        : { gender: 1, age: 1, score: 2 },
  );

  const sectionComments: Record<string, { text: string }> = {};
  const sectionFooters: Record<string, { dateCompleted?: string; assessorNameDesignation?: string }> = {};
  for (let n = 1; n <= HOLISTIC_TAB_COUNT; n++) {
    sectionComments[String(n)] = { text: `${prefix} — holistic tab ${n}` };
    sectionFooters[String(n)] = {
      dateCompleted: isoDate(),
      assessorNameDesignation: 'Sarah Thompson — Registered Manager',
    };
  }

  const movingTaskIds = [
    'walking',
    'gettingInOutOfBed',
    'transfersBedToChair',
    'moveUpBed',
    'toileting',
    'bathOrShower',
  ];
  const movingTasks = movingTaskIds.reduce<Record<string, unknown>>((acc, id) => {
    acc[id] = {
      capability: level === 'low' ? 'independent' : 'assistance',
      staffCount: level === 'low' ? null : 2,
      methods: level === 'critical' ? ['hoist'] : [],
    };
    return acc;
  }, {});

  const envIds = [
    'homeHazards',
    'furniturePosition',
    'lightingRequirements',
    'temperatureSupport',
    'pets',
    'externalHazards',
    'infectionControlRisks',
    'carePlanCompleted',
  ];
  const environmentAssessment = envIds.reduce<Record<string, unknown>>((acc, id) => {
    acc[id] = level === 'critical';
    return acc;
  }, {});
  environmentAssessment.goalsAchieve = `${prefix} — goals`;
  environmentAssessment.goalsCarePriorities = `${prefix} — care priorities`;
  environmentAssessment.riskAssessmentsCompleted = true;
  environmentAssessment.referralRequired = level === 'critical';
  environmentAssessment.equipmentAvailable = true;
  environmentAssessment.staffNotes = 'Home environment assessed; minor hazards addressed with the family.';

  const visitIds = ['morning', 'lunch', 'tea', 'evening', 'night'];
  const visits = visitIds.reduce<Record<string, unknown>>((acc, id) => {
    acc[id] = {
      agreedTask: `${prefix} — ${id} task`,
      objectives: `${prefix} — objectives`,
      outcomes: `${prefix} — outcomes`,
    };
    return acc;
  }, {});

  const clinicalRowIds = [
    'waterlow',
    'must',
    'pain',
    'movingHandling',
    'skinIntegrity',
    'bloodPressure',
    'pulseRate',
    'pulseRhythm',
    'o2Saturations',
    'respirationRate',
    'temperature',
    'others',
  ];
  const clinicalRows = clinicalRowIds.reduce<Record<string, unknown>>((acc, id) => {
    acc[id] = { initial: `${prefix} — ${id}`, reviews: Array(6).fill('') };
    return acc;
  }, {});

  return {
    adl: {
      rows: adlRows,
      mobilityAidsRequired: level === 'critical',
      mobilityAidsList: level === 'critical' ? 'Hoist, profiling bed' : '',
      fallsAssessmentCompleted: level === 'critical',
      fallsAssessmentDate: level === 'critical' ? isoDate() : null,
      additionalComments: level === 'critical' ? 'Very critical — ADL / falls' : '',
    },
    waterlow,
    transfers: { rows: transferRows, independentWithAll: false, comments: level === 'critical' ? 'Transfers with the assistance of two carers and a hoist.' : '' },
    equipmentChecklist: {
      hoistServiced: true,
      profilingBedServiced: true,
      staffTrainingCoversHoist: true,
      otGuidanceRequired: false,
      comments: 'Equipment serviced and staff trained; no outstanding actions.',
    },
    dailyLivingAids: {
      aidsInUseOrRequired: false,
      aidsList: '',
      furtherEquipmentRequired: false,
      additionalComments: 'Daily living aids reviewed; none currently required.',
    },
    practicalCare: {
      laundry: 'Minimal support',
      cleaning: 'Minimal support',
      shopping: 'Carer support',
      financeAssistance: 'Not required',
      otherComment: 'Support with laundry, cleaning and shopping as agreed.',
    },
    financeSupport: {
      required: level === 'critical',
      supportTypes: level === 'critical' ? ['benefits'] : [],
      staffHandleCash: false,
      familyInvolved: level === 'critical',
      consentRecorded: level === 'critical',
      details: level === 'critical' ? 'Very critical — finance support' : '',
    },
    sectionComments,
    sectionFooters,
    skinIntegrityCheck: { rows: skinRows },
    mustAssessment: enrichMustMetadata(
      level === 'critical'
        ? { bmiOptionId: 'lt18_5', weightLossOptionId: 'gt10', acuteDiseaseOptionId: 'yes' }
        : { bmiOptionId: 'gt20', weightLossOptionId: 'lt5', acuteDiseaseOptionId: 'no' },
    ),
    fallsScreening: {
      fallOrConcern: level === 'critical',
      firstScreenSinceLastFall: level === 'critical' ? 'yes' : 'na',
      consentToSixQuestions: level !== 'low',
      q1FallsNeedInvestigating: level === 'critical',
      q2DizzyOrBlackouts: false,
      q3WalkingBalanceUnassessed: level === 'critical',
      q4FourPlusMedsNoReview: false,
      q5TrippingMore: level === 'critical',
      q6FearOfFalling: false,
      additionalComments: `${prefix} — falls screening`,
    },
    movingHandlingOperations: {
      riskFilter: {
        historyOfFalls: level === 'critical',
        unsteadyMobilising: level === 'critical',
        anxiousAboutFalls: level === 'critical',
        confused: level === 'critical',
        aged65PlusFallRiskMeds: level === 'critical',
        sensoryOrMotorImpairment: level === 'critical',
        totallyIndependentLowRisk: level === 'low',
      },
      tasks: movingTasks,
    },
    painAssessment: {
      nrsScore: level === 'critical' ? 7 : level === 'normal' ? 4 : 1,
      therapyAideMemoire: {
        furtherReferralRequired: false,
        referralCompleted: false,
        additionalComments: `${prefix} — therapy aide memoire`,
      },
    },
    environmentAssessment,
    advanceCarePlanning: {
      patientName: displayName,
      dateCompleted: isoDate(),
      legalAdvanceDecision: false,
      personalValues: `${prefix} — personal values`,
      carePreferences: `${prefix} — care preferences`,
      concernsAndFears: `${prefix} — concerns`,
    },
    endOfLifeAssessment: { endOfLifeCarePlanAnswer: level === 'critical' },
    clinicalOutcomeSummary: {
      initial: { assessmentDate: isoDate(), practitioner: 'Sarah Thompson' },
      reviews: Array(6).fill({}),
      rows: clinicalRows,
    },
    carePlanObjectives: {
      visits,
      professionalInterventionOutcome: {
        agreedTask: 'District nurse review of wound care.',
        objectives: 'Promote healing and prevent deterioration.',
        outcomes: 'Wound reviewed weekly; healing as expected.',
      },
      professionalVisit: {
        whichProfessionalVisit: 'District nurse',
        agreedTask: 'District nurse to review pressure areas.',
        objectives: 'Maintain skin integrity.',
        outcomes: 'Skin remains intact.',
      },
      otherEquipmentRequired: level === 'critical' ? 'Profiling bed' : '',
    },
    mentalCapacityChecklist: {
      assessmentType: 'preliminary',
      impairmentAnswer: false,
      unableKeyDecisionAnswer: false,
      assessorName: 'Sarah Thompson',
      assessorPosition: 'Registered Manager',
      assessorDate: isoDate(),
    },
    photographyConsent: {
      surname,
      firstNames,
      dateOfBirth: dob,
      nhsNumber: nhs,
      gender,
      professionalName: 'Sarah Thompson',
      professionalJobTitle: 'Care Coordinator',
      consentSubjectName: displayName,
      consentSignature: displayName,
      consentDate: isoDate(),
      consentPrintName: displayName,
    },
    equipmentSelection: {
      waterlowScore: level === 'critical' ? '18' : level === 'normal' ? '12' : '8',
      selectedRiskLevel: level === 'critical' ? 'High risk' : 'At risk',
      selectedEquipment:
        level === 'critical' ? 'Full replacement mattress' : 'High risk foam mattress / alternating overlay',
      equipmentInPlace: level === 'low',
      otReferralRequired: level === 'critical',
      notes: `${prefix} — equipment selection`,
    },
  };
}

export function mergeMetadataPatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}
