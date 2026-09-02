/**
 * Server-side initial assessment autofill — mirrors care-admin E2E helpers
 * (tests/e2e/helpers/initial-assessment-autofill.ts + ia-holistic-metadata-autofill.ts).
 */
import { enrichWaterlowMetadata } from '../initial-assessments/initial-assessment-waterlow.util';
import { enrichAbbeyMetadata } from '../initial-assessments/initial-assessment-abbey.util';
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from './dto/generate-ia-section.dto';

export type IaAutofillLevel = 'low' | 'normal' | 'critical';

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
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  gpContact?: string | null;
  gpName?: string | null;
  gpPhone?: string | null;
  gpPractice?: string | null;
  emergencyContact?: string | null;
  allergies?: string | null;
  accessInstruction?: string | null;
};

/** Structured empty-profile values for IA address/GP widgets (never overwrite occupied keys). */
export type IaDemoProfilePatch = {
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    town?: string;
    county?: string;
    postcode?: string;
  };
  phone?: string;
  mobile?: string;
  email?: string;
  gp?: {
    name?: string;
    phone?: string;
    practice?: string;
  };
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
export const QA_DEMO_PO_NUMBER = 'PO-QA-0001';
export const QA_DEMO_LOCAL_AUTHORITY_ID = 'LA-QA-1001';
export const QA_DEMO_SAFEGUARDING_REF = 'SG-QA-0142';
export const QA_DEMO_ADDRESS_LINE1 = '12 Maple Close';
export const QA_DEMO_ADDRESS_LINE2 = 'Little Woodhouse';
export const QA_DEMO_TOWN = 'Leeds';
export const QA_DEMO_COUNTY = 'West Yorkshire';
export const QA_DEMO_POSTCODE = 'LS1 4AP';
export const QA_DEMO_PHONE = '0113 496 0123';
export const QA_DEMO_MOBILE = '07700 900123';
export const QA_DEMO_EMAIL = 'qa.client@example.net';
export const QA_DEMO_GP_NAME = 'Dr A. Patel';
export const QA_DEMO_GP_PHONE = '0113 496 0456';
export const QA_DEMO_GP_PRACTICE = 'Oak Tree Medical Practice';
export const QA_DEMO_HOSPITAL = 'Leeds General Infirmary';
export const QA_DEMO_KEY_SAFE_LOCATION = 'To the right of the front door, above the letterbox';
export const QA_DEMO_FAMILY_NAME = 'Sarah Wright';
export const QA_DEMO_LPOA_NAME = 'Alex Wright';

export function formatQaAddressAssessmentText(parts?: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
}): string {
  const p = parts ?? {};
  const address = [
    p.addressLine1 ?? QA_DEMO_ADDRESS_LINE1,
    p.addressLine2 ?? QA_DEMO_ADDRESS_LINE2,
    p.town ?? QA_DEMO_TOWN,
    p.county ?? QA_DEMO_COUNTY,
    p.postcode ?? QA_DEMO_POSTCODE,
  ]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join(', ');
  return [
    address,
    `Tel: ${p.phone ?? QA_DEMO_PHONE}`,
    `Mobile: ${p.mobile ?? QA_DEMO_MOBILE}`,
    `Email: ${p.email ?? QA_DEMO_EMAIL}`,
  ].join('\n');
}

/** Exact format `InitialAssessmentGpContactField.parseGpContactAssessmentText` consumes. */
export function formatQaGpWidgetText(parts?: { name?: string; phone?: string; practice?: string }): string {
  return [
    `Name: ${parts?.name ?? QA_DEMO_GP_NAME}`,
    `Tel: ${parts?.phone ?? QA_DEMO_GP_PHONE}`,
    parts?.practice ?? QA_DEMO_GP_PRACTICE,
  ].join('\n');
}

/**
 * All three QA scenarios fill every applicable (visible) field.
 * Hidden follow-ups, secure fields, and occupied profile values are excluded separately.
 */
function shouldFillQuestion(q: TemplateQuestion, _level: IaAutofillLevel): boolean {
  return q.sectionNumber >= 1;
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
  'waterlow score',
  'waterlow numeric',
];

export function isSecureQuestion(q: TemplateQuestion): boolean {
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
    return { ...base, textValue: formatQaAddressAssessmentText(identity ?? undefined) };
  }
  if (profileKey === 'gpName') {
    return { ...base, textValue: identityText(identity?.gpName) ?? QA_DEMO_GP_NAME };
  }
  if (profileKey === 'gpContact') {
    return {
      ...base,
      textValue: formatQaGpWidgetText({
        name: identityText(identity?.gpName),
        phone: identityText(identity?.gpPhone),
        practice: identityText(identity?.gpPractice),
      }),
    };
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

export function isInventedClinicalMeasurement(q: TemplateQuestion): boolean {
  const key = fieldKey(q);
  if (key && SKIP_INVENTED_MEASUREMENT_KEYS.has(key)) return true;
  const text = q.questionText.toLowerCase();
  return SKIP_INVENTED_MEASUREMENT_TEXT.some((needle) => text === needle || text.startsWith(needle));
}

/** Visible but not applicable unless a parent "Other" option is selected — leave empty. */
export function isIntentionalBlankDemoQuestion(q: TemplateQuestion): boolean {
  return q.questionText.toLowerCase().includes('other accommodation');
}

const FIRE_SAFETY_FIELD_KEYS = new Set([
  'fireSafetyRisksIdentified',
  'fireSafetyRisksDetails',
  'fireSafetyRisks',
  'londonFireBrigadeInformed',
  'londonFireBrigadeDetails',
  'smokeAlarmFittedWorking',
  'smokeCoFireAlarmReferral',
  'smokingInProperty',
  'cookingLeftUnattendedRisk',
  'cookingFireRiskDetails',
  'primaryEscapeRoute',
  'fireEmergencyArrangements',
]);

function isFireSafetyQuestion(q: TemplateQuestion): boolean {
  const key = fieldKey(q);
  if (key && FIRE_SAFETY_FIELD_KEYS.has(key)) return true;
  const ref = specRef(q);
  return ref === '18.1' || ref === '18.2' || ref === '18.3' || ref === '18.4' || ref === '18.5' || ref === '18.6';
}

function isProfileOrSecureQuestion(q: TemplateQuestion): boolean {
  return isIdentityOrSecureQuestion(q);
}

type ShowWhenRule = {
  gateTextIncludes?: string;
  gateFieldKey?: string;
  yes?: boolean;
  no?: boolean;
  selectedIncludes?: string;
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
  {
    questionTextIncludes: 'other accommodation',
    when: { gateFieldKey: 'accommodationType', selectedIncludes: 'other' },
  },
  {
    questionTextIncludes: 'informal carer contact',
    when: { gateFieldKey: 'informalCarerSupport', yes: true },
  },
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
  {
    questionTextIncludes: 'safeguarding reference',
    when: { gateTextIncludes: 'safeguarding concerns identified', yes: true },
  },
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
    selectedIncludes: typeof row.selectedIncludes === 'string' ? row.selectedIncludes : undefined,
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

function answerSelectedValues(a: AnswerInput | undefined): string[] {
  const opts: unknown = a?.selectedOptions;
  if (!opts) return [];
  if (Array.isArray(opts)) return opts.map(String);
  if (typeof opts === 'string' && opts.trim()) return [opts.trim()];
  return [];
}

function gateMatchesGeneratedAnswer(rule: ShowWhenRule, gateAnswer: AnswerInput | undefined): boolean {
  if (rule.selectedIncludes) {
    const needle = rule.selectedIncludes.toLowerCase();
    return answerSelectedValues(gateAnswer).some((v) => v.toLowerCase() === needle);
  }
  if (rule.yes) return answerIsYes(gateAnswer);
  if (rule.no) return answerIsNo(gateAnswer);
  return false;
}

/**
 * Template questions this holistic tab owns beyond the IDs currently visible in the UI
 * (worksheet-only tabs, hidden §1 assessorName, Environment §3 on tab 12, etc.).
 */
export function extraQuestionsForHolisticTab(
  tabId: number,
  questions: TemplateQuestion[],
): TemplateQuestion[] {
  const consentRefs = new Set(['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9']);
  switch (tabId) {
    case 1:
      return questions.filter((q) => q.sectionNumber === 1 && fieldKey(q) === 'assessorName');
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
    case 21:
      return questions.filter((q) => q.sectionNumber === 15);
    case 19:
      return questions.filter((q) => q.sectionNumber === 16);
    case 20:
      return questions.filter((q) => q.sectionNumber === 17);
    case 22:
      return questions.filter((q) => q.sectionNumber === 18 || isFireSafetyQuestion(q));
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
    text.includes('are there pets') ||
    text.includes('covert medication') ||
    text.includes('controlled drugs in use') ||
    text.includes('dols / lps authorisation') ||
    text.includes('infection control precautions required') ||
    text.includes('oral health concern') ||
    key === 'covertMedicationRequired' ||
    key === 'controlledDrugsInUse' ||
    key === 'dolsLpsAuthorisationInPlace' ||
    key === 'infectionPrecautionsRequired' ||
    key === 'oralHealthConcern' ||
    key === 'fireSafetyRisksIdentified' ||
    key === 'cookingLeftUnattendedRisk' ||
    key === 'insulinAdministrationRequired';

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
    text.includes('local authority safeguarding referral required') ||
    key === 'infectionPrecautionsRequired' ||
    key === 'oralHealthConcern' ||
    key === 'fireSafetyRisksIdentified' ||
    key === 'cookingLeftUnattendedRisk' ||
    key === 'insulinAdministrationRequired';

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
  if (t.includes('safeguarding') && !t.includes('reference')) {
    return critical
      ? 'Concerns raised about self-neglect and a recent unexplained bruise; safeguarding referral made to the local authority and being monitored.'
      : 'No current safeguarding concerns. Family and the care team maintain regular contact.';
  }
  if (t.includes('review') && t.includes('sign')) {
    return 'Assessment discussed with the service user and reviewed by the registered manager; agreed as an accurate reflection of current needs.';
  }
  if (
    (t.includes('emotional') || t.includes('mood') || t.includes('mental health')) &&
    !t.includes('contact')
  ) {
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
  if (t.includes('medication safety notes')) {
    return 'Record any refused or missed dose in the MAR and inform the office. Keep medicines in original packaging in the kitchen cupboard.';
  }
  if (t.includes('medication')) {
    return 'Takes regular medication via a monitored dosage system; needs prompting and observation at each visit.';
  }
  if (t.includes('mouth-care') || t.includes('mouth care')) {
    return 'Needs prompting to brush twice daily. Staff offer a soft toothbrush and stay nearby if they become tired.';
  }
  if (t.includes('positioning or supervision') && t.includes('choking')) {
    return 'Sit fully upright in the chair. One staff member stays with them until they have finished eating and drinking.';
  }
  if (t.includes('staff precautions') || t.includes('hygiene instructions')) {
    return 'Wash hands on arrival and departure. Use gloves and an apron for personal care. Do not share towels.';
  }
  if (t.includes('escalation or reporting')) {
    return 'If a high temperature, cough or diarrhoea is noticed, record it and inform the office and GP the same day.';
  }
  if (t.includes('primary escape') || t.includes('escape route from the property')) {
    return 'The usual exit is the front door onto the pavement. The back door leads to a small yard with a side gate.';
  }
  if (t.includes('emergency fire')) {
    return 'Smoke alarm in the hallway. Meeting point is the front garden away from the property. Call 999 from outside.';
  }
  if (t.includes('cooking-related fire') || t.includes('cooking left unattended')) {
    return 'The hob is electric. Pans must not be left unattended. Staff switch the cooker off at the wall after use.';
  }
  if (t.includes('fire safety risks identified') && t.includes('please state')) {
    return 'There is a plug-in heater in the living room. Keep it clear of furniture and switch it off when leaving.';
  }
  if (t.includes('wandering or exit-seeking support')) {
    return 'If they walk towards the front door, walk with them, offer a cup of tea and redirect to the living room.';
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

  // Typed fields never reach here. Unclassified narrative must not receive a generic needs sentence.
  return 'Documented during this assessment; see related notes for supporting detail.';
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

export type DemoTextRole =
  | 'identifier'
  | 'personName'
  | 'professionalRole'
  | 'phone'
  | 'email'
  | 'postcode'
  | 'location'
  | 'datetimeText'
  | 'reference'
  | 'contact'
  | 'schedule'
  | 'measurementBand'
  | 'bodySite'
  | 'narrative';

function lookupKeys(q: TemplateQuestion): string[] {
  return [fieldKey(q), typeof q.metadata?.prefillKey === 'string' ? q.metadata.prefillKey : ''].filter(
    (k): k is string => Boolean(k),
  );
}

/**
 * Typed vs narrative role from fieldKey / prefillKey / structural label — not clinical topic words.
 * Identifiers, names, phones, locations, and contacts must never use realisticFreeText().
 */
export function classifyDemoTextRole(q: TemplateQuestion): DemoTextRole {
  if (isPersonCentredNarrative(q)) return 'narrative';

  const keys = lookupKeys(q).map((k) => k.toLowerCase());
  const text = q.questionText.toLowerCase().trim();

  if (keys.some((k) => /email/.test(k)) || /^e-?mail$/.test(text)) return 'email';
  if (keys.some((k) => /postcode|post_code/.test(k)) || /^post ?code$/.test(text)) return 'postcode';
  if (
    (keys.some((k) => /^(phone|mobile|tel)|phone$|mobile$/.test(k)) || /^(phone|mobile|telephone)$/.test(text)) &&
    !/and phone/.test(text)
  ) {
    return 'phone';
  }

  if (keys.some((k) => k.includes('reference')) || /\breference number\b/.test(text)) return 'reference';

  if (
    keys.some(
      (k) =>
        k === 'ponumber' ||
        k === 'nhsnumber' ||
        k === 'nationalinsurancenumber' ||
        k === 'localauthorityid' ||
        (k.endsWith('number') && !/phone|mobile|reference/.test(k)),
    ) ||
    /\bpo number\b/.test(text) ||
    /local authority id/.test(text)
  ) {
    return 'identifier';
  }

  if (/date and time/.test(text) || (q.questionType === 'TEXT' && keys.some((k) => /(date|time)$/.test(k)))) {
    return 'datetimeText';
  }
  if (/height band|height \(cm\)/.test(text) || keys.some((k) => /(^|_)height/.test(k))) return 'measurementBand';
  if (/monitoring schedule/.test(text) || keys.some((k) => k.includes('schedule'))) return 'schedule';
  if (/pain location/.test(text) || keys.some((k) => k.includes('pain') && k.includes('location'))) {
    return 'bodySite';
  }
  if (
    keys.some((k) => /designation|assessorrole/.test(k) || k.endsWith('role')) ||
    /designation$/.test(text)
  ) {
    return 'professionalRole';
  }
  if (
    keys.some((k) => k.includes('contact')) ||
    /contact details$|team contact|worker contact|manager contact|advocate contact|carer contact/.test(text) ||
    /practice and phone|pharmacy name and phone/.test(text)
  ) {
    return 'contact';
  }
  if (
    keys.some((k) => k.endsWith('name') || k === 'responsiblereviewer') ||
    /prefer to be addressed/.test(text) ||
    (q.questionType === 'TEXT' && / name$/.test(text) && !/organisation|pharmacy/.test(text))
  ) {
    return 'personName';
  }
  if (
    keys.some((k) => /location|hospital/.test(k) && !k.includes('addresscontact')) ||
    /key safe location|preferred hospital|personal care location/.test(text)
  ) {
    return 'location';
  }

  return 'narrative';
}

export function isTypedDemoTextRole(role: DemoTextRole): boolean {
  return role !== 'narrative';
}

/** Clinical-needs fallback that typed fields must never contain. */
export const CLINICAL_NEEDS_NARRATIVE_RE =
  /Significant needs identified|Some support needs identified|Stable and largely independent in this area/;

function typedDemoTextValue(q: TemplateQuestion, role: DemoTextRole, identity?: IaDemoIdentity | null): string {
  const text = q.questionText.toLowerCase();
  const key = (fieldKey(q) ?? '').toLowerCase();
  const blob = `${key} ${text}`;

  switch (role) {
    case 'identifier':
      if (/\bpo\b/.test(text) || key.includes('ponumber')) return QA_DEMO_PO_NUMBER;
      if (/local.?authority/.test(blob)) return QA_DEMO_LOCAL_AUTHORITY_ID;
      return 'QA-ID-0001';
    case 'reference':
      return QA_DEMO_SAFEGUARDING_REF;
    case 'personName': {
      if (key.includes('gp') || /^gp name$/.test(text)) return identityText(identity?.gpName) ?? QA_DEMO_GP_NAME;
      if (key.includes('assessor') || /responsible reviewer/.test(text)) return realisticName(q.id);
      if (key.includes('lpoa')) return QA_DEMO_LPOA_NAME;
      if (key.includes('carer')) return QA_DEMO_FAMILY_NAME;
      if (key.includes('preferred') || /prefer to be addressed|preferred name/.test(text)) {
        return identity?.preferredName?.trim() || identity?.firstName?.trim() || 'Helen';
      }
      return QA_DEMO_FAMILY_NAME;
    }
    case 'professionalRole':
      if (key.includes('lpoa') || /\blpoa\b/.test(text)) return 'Lasting Power of Attorney (Health & Welfare)';
      return 'Registered Manager';
    case 'phone':
      return QA_DEMO_GP_PHONE;
    case 'email':
      return QA_DEMO_EMAIL;
    case 'postcode':
      return QA_DEMO_POSTCODE;
    case 'location':
      if (/key.?safe/.test(blob)) return QA_DEMO_KEY_SAFE_LOCATION;
      if (/hospital/.test(blob)) return QA_DEMO_HOSPITAL;
      if (/personal care location/.test(text)) return 'Bathroom on the ground floor';
      return 'Own home, Leeds';
    case 'datetimeText':
      return `${isoDate()} 10:30`;
    case 'contact': {
      if (/gp/.test(blob) && !/pharmacy/.test(blob)) {
        return formatQaGpWidgetText({
          name: identityText(identity?.gpName),
          phone: identityText(identity?.gpPhone),
          practice: identityText(identity?.gpPractice),
        });
      }
      if (/pharmacy/.test(blob)) return `Oak Tree Pharmacy\nTel: ${QA_DEMO_GP_PHONE}`;
      if (/lpoa/.test(blob)) {
        return `${QA_DEMO_LPOA_NAME}, Lasting Power of Attorney (Health & Welfare)\nTel: 07700 900456`;
      }
      if (/social.?worker/.test(blob)) return `Leeds Adult Social Care, duty desk\nTel: 0113 222 4444`;
      if (/care.?manager/.test(blob)) return `Priya Nair, Care Coordinator\nTel: 0113 496 0789`;
      if (/mental.?health/.test(blob)) return `Community Mental Health Team\nTel: 0113 206 1234`;
      if (/advocate/.test(blob)) return `Independent advocate via VoiceAbility\nTel: 0300 303 1660`;
      if (/carer/.test(blob)) return `${QA_DEMO_FAMILY_NAME}\nTel: ${QA_DEMO_MOBILE}`;
      return `${QA_DEMO_FAMILY_NAME}\nTel: ${QA_DEMO_MOBILE}`;
    }
    case 'schedule':
      return 'Twice daily with care visits, and as needed if unwell.';
    case 'measurementBand':
      return 'Average — 162 cm';
    case 'bodySite':
      return 'Lower back and both knees';
    default:
      return '';
  }
}

function occupiedIdentityText(value?: string | null): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** Empty profile keys receive QA values; occupied profile keys are omitted. */
export function buildDemoProfilePatch(identity?: IaDemoIdentity | null): IaDemoProfilePatch {
  const patch: IaDemoProfilePatch = {};
  const address: NonNullable<IaDemoProfilePatch['address']> = {};
  if (!occupiedIdentityText(identity?.addressLine1)) address.addressLine1 = QA_DEMO_ADDRESS_LINE1;
  if (!occupiedIdentityText(identity?.addressLine2)) address.addressLine2 = QA_DEMO_ADDRESS_LINE2;
  if (!occupiedIdentityText(identity?.town)) address.town = QA_DEMO_TOWN;
  if (!occupiedIdentityText(identity?.county)) address.county = QA_DEMO_COUNTY;
  if (!occupiedIdentityText(identity?.postcode)) address.postcode = QA_DEMO_POSTCODE;
  if (Object.keys(address).length) patch.address = address;
  if (!occupiedIdentityText(identity?.phone)) patch.phone = QA_DEMO_PHONE;
  if (!occupiedIdentityText(identity?.mobile)) patch.mobile = QA_DEMO_MOBILE;
  if (!occupiedIdentityText(identity?.email)) patch.email = QA_DEMO_EMAIL;

  const gp: NonNullable<IaDemoProfilePatch['gp']> = {};
  if (!occupiedIdentityText(identity?.gpName)) gp.name = QA_DEMO_GP_NAME;
  if (!occupiedIdentityText(identity?.gpPhone)) gp.phone = QA_DEMO_GP_PHONE;
  if (!occupiedIdentityText(identity?.gpPractice)) gp.practice = QA_DEMO_GP_PRACTICE;
  if (Object.keys(gp).length) patch.gp = gp;

  return patch;
}

export function profilePatchHasValues(patch: IaDemoProfilePatch | undefined): boolean {
  if (!patch) return false;
  if (patch.phone || patch.mobile || patch.email) return true;
  if (patch.address && Object.keys(patch.address).length) return true;
  if (patch.gp && Object.keys(patch.gp).length) return true;
  return false;
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
      if (key === 'independentSelfAdministration') {
        const independent = level === 'low';
        return { ...base, checked: independent, booleanValue: independent };
      }
      if (key === 'canSelfEvacuate') {
        const independent = level === 'low';
        return { ...base, checked: independent, booleanValue: independent };
      }
      if (key === 'bedRailsInUseOrConsidered') {
        const considered = level !== 'low';
        return { ...base, checked: considered, booleanValue: considered };
      }
      if (key === 'bedRailsEntrapmentRisk') {
        const risk = level === 'critical';
        return { ...base, checked: risk, booleanValue: risk };
      }
      if (key === 'peepDiscussedWithPerson') {
        return { ...base, checked: true, booleanValue: true };
      }
      if (
        level === 'low' &&
        (key === 'medicationPromptingRequired' ||
          key === 'packagingHelpRequired' ||
          key === 'medicationAssistanceAdministering')
      ) {
        return { ...base, checked: false, booleanValue: false };
      }
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
        return { ...base, numberValue: level === 'critical' ? 7 : level === 'normal' ? 4 : 0 };
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
      if (key === 'nextReviewDate' || key === 'assessorSignDate' || key === 'peepReviewDate' || key === 'bedRailsReviewDate') {
        return { ...base, dateValue: isoDate(key === 'assessorSignDate' ? 0 : 6) };
      }
      return { ...base, dateValue: isoDate() };
    }
    case 'TIME':
      return { ...base, timeValue: '09:00' };
    case 'TEXT':
    case 'TEXTAREA': {
      if (key === 'assessorName') return { ...base, textValue: realisticName(q.id) };
      if (key === 'assessorRole' || key === 'assessorDesignation') return { ...base, textValue: 'Registered Manager' };
      if (key === 'peepAssistanceRequired') {
        return {
          ...base,
          textValue:
            'I need one carer beside me on the stairs and a second person to carry my walking frame. Please give me extra time and do not rush me.',
        };
      }
      if (key === 'peepEquipmentRequired') {
        return { ...base, textValue: 'Walking frame. Keep it by the lounge chair so it is to hand if the alarm sounds.' };
      }
      if (key === 'peepEvacuationProcedure') {
        return {
          ...base,
          textValue:
            'Leave by the front door if it is clear. If the hall is blocked, wait at the top of the stairs until staff reach me. Do not use the back kitchen door at night because the step is uneven.',
        };
      }
      if (key === 'peepAlarmWarningConsiderations') {
        return {
          ...base,
          textValue:
            'I hear the smoke alarm in the hall. Please also knock on the lounge door and say my name, because I may have the radio on.',
        };
      }
      if (key === 'peepRefugeLocation') {
        return { ...base, textValue: 'Top of the stairs, by the bedroom door, if the front hall is not clear.' };
      }
      if (key === 'bedRailsReason') {
        return {
          ...base,
          textValue:
            level === 'critical'
              ? 'I have rolled towards the edge of the bed at night. Staff and I agreed rails while I settle, with the gap checked each visit.'
              : 'We talked about rails after I felt unsteady getting into bed. They are not needed at present.',
        };
      }
      if (key === 'bedRailsAlternativesConsidered') {
        return {
          ...base,
          textValue:
            'We considered a lower bed, a sensor mat, and leaving the rail down on my getting-out side. I prefer to try those first unless I start rolling in the night.',
        };
      }
      if (key === 'bedRailsEntrapmentDetails') {
        return {
          ...base,
          textValue:
            'There is a gap at the head of the bed between the mattress and the rail. Staff must check the mattress sits flush before leaving.',
        };
      }
      if (key === 'bedRailsConsentCapacityNotes') {
        return {
          ...base,
          textValue:
            'I was part of the discussion today. I understand the rails are to stop me rolling, not to stop me getting up, and I can ask for them to be reviewed.',
        };
      }
      const role = classifyDemoTextRole(q);
      if (role !== 'narrative') {
        const typed = typedDemoTextValue(q, role, identity);
        if (!typed.trim()) return null;
        return { ...base, textValue: typed };
      }
      return { ...base, textValue: realisticFreeText(q, level) };
    }
    case 'SINGLE_SELECT': {
      if (key === 'fundingType' || (typeof q.metadata?.optionsLookup === 'string' && q.metadata.optionsLookup === 'service_user_funding_types')) {
        const funding = opts.find((o) => o.value === 'local_authority') ?? opts[0];
        return { ...base, selectedOptions: (funding?.value ?? 'local_authority') as unknown as Record<string, unknown> };
      }
      if (key === 'bedRailsRequiredInPlace') {
        const code = level === 'critical' ? 'required_in_place' : 'not_required';
        const pick = opts.find((o) => o.value === code) ?? opts[0];
        if (pick) return { ...base, selectedOptions: pick.value as unknown as Record<string, unknown> };
      }
      if (key === 'medicationSupportLevel') {
        const code = level === 'critical' ? 'level_2a' : level === 'normal' ? 'level_1a' : 'level_0';
        const pick = opts.find((o) => o.value === code) ?? opts[0];
        if (pick) return { ...base, selectedOptions: pick.value as unknown as Record<string, unknown> };
      }
      if (key === 'medicationAdministeredBy') {
        const code = level === 'critical' ? 'care_staff' : level === 'normal' ? 'family' : 'self';
        const pick = opts.find((o) => o.value === code) ?? opts[0];
        if (pick) return { ...base, selectedOptions: pick.value as unknown as Record<string, unknown> };
      }
      if (key === 'diabetesType') {
        const pick =
          opts.find((o) => o.value === 'type_2' || o.label === 'Type 2') ??
          opts.find((o) => o.value === 'type_1') ??
          opts[0];
        if (pick) return { ...base, selectedOptions: pick.value as unknown as Record<string, unknown> };
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

const QA_FAMILY_NAME = 'Sarah Wright';
const QA_FAMILY_TEL = '07700 900123';
const QA_GP_DETAILS = 'Dr A. Patel, Oak Tree Medical Practice\nTel: 0113 496 0456';
const QA_ADDRESS = '12 Maple Close, Leeds, LS1 4AP\nTel: 0113 496 0123';
const QA_HOSPITAL_CONTACT = 'Leeds Teaching Hospitals NHS Trust, switchboard 0113 243 2799';
const QA_PROFESSIONAL_NAME = 'Sarah Thompson';
const QA_PROFESSIONAL_ROLE = 'Registered Manager';
const QA_PROFESSIONAL_TEL = '0113 496 0789';

function identityText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function qaFamilyName(identity?: IaDemoIdentity | null): string {
  const raw = identityText(identity?.emergencyContact);
  if (!raw) return QA_FAMILY_NAME;
  const name = raw.split('·')[0]?.trim();
  return name || QA_FAMILY_NAME;
}

function qaFamilyTel(identity?: IaDemoIdentity | null): string {
  const raw = identityText(identity?.emergencyContact) ?? '';
  const match = raw.match(/(\+?\d[\d\s]{8,}\d)/);
  return match ? match[1]!.replace(/\s+/g, ' ').trim() : QA_FAMILY_TEL;
}

/** Same shape as admin `AdvanceCarePlanningMetadata` (submission.metadata.advanceCarePlanning). */
export type AdvanceCarePlanningDemoMetadata = {
  patientName: string;
  address: string;
  dateOfBirth: string;
  hospitalOrNhsNumber: string;
  dateCompleted: string;
  gpDetails: string;
  hospitalContact: string;
  familyMemberName: string;
  familyContactTel: string;
  professionalName: string;
  professionalRole: string;
  professionalContactTel: string;
  patientSignature: string;
  patientSignatureDate: string;
  nextOfKinSignature: string;
  nextOfKinSignatureDate: string;
  homecareProfessionalSignature: string;
  homecareProfessionalSignatureDate: string;
  reviewDate: string;
  personalValues: string;
  carePreferences: string;
  concernsAndFears: string;
  legalAdvanceDecision: boolean;
  legalAdvanceDecisionDetails?: string;
  proxyContact1: { name: string; tel: string; lpoa: boolean };
  proxyContact2: { name: string; tel: string; lpoa: boolean };
  placeOfCareFirstChoice: string;
  placeOfCareSecondChoice: string;
  placeOfCareComments: string;
  specialRequests: string;
  thirdPartyComments: string;
};

/**
 * End of Life worksheet question ids — must match admin `END_OF_LIFE_ASSESSMENT_QUESTIONS`.
 * Persistence is submission.metadata.endOfLifeAssessment (`{id}Answer` / `{id}TriAnswer` / `{id}Notes`).
 */
export const EOL_YES_NO_QUESTION_IDS = [
  'endOfLifeCarePlan',
  'awareOfDying',
  'medicationAssessed',
  'medicationAvailable',
  'interventionDiscussion',
  'carersAwareWishes',
  'capacityEndOfLife',
  'comfortDiscussWishes',
  'terminalResidence',
  'hospiceHospitalTransfer',
  'funeralArrangements',
  'contactNextOfKin',
  'reviewWishesFuture',
  'capacityLastWishes',
  'dnrInPlace',
] as const;

export const EOL_TRI_QUESTION_IDS = ['medicalAidRecovery', 'lastWill'] as const;

export const EOL_NOTES_ONLY_QUESTION_IDS = ['significantBeliefs', 'consentMethod'] as const;

export const EOL_ALL_QUESTION_IDS = [
  ...EOL_YES_NO_QUESTION_IDS,
  ...EOL_TRI_QUESTION_IDS,
  ...EOL_NOTES_ONLY_QUESTION_IDS,
] as const;

export type EndOfLifeDemoTriAnswer = 'yes' | 'no' | 'unknown';

export type EndOfLifeAssessmentDemoMetadata = Record<string, boolean | EndOfLifeDemoTriAnswer | string>;

function firstPersonAcpValues(level: IaAutofillLevel): Pick<
  AdvanceCarePlanningDemoMetadata,
  | 'personalValues'
  | 'carePreferences'
  | 'concernsAndFears'
  | 'placeOfCareComments'
  | 'specialRequests'
> {
  if (level === 'critical') {
    return {
      personalValues:
        'I want to stay in my own home for as long as I can, with my family nearby. Quiet time, my radio, and not being rushed matter most to me.',
      carePreferences:
        'If I become more unwell I want care to focus on comfort, dignity, and being kept informed. Please explain what you are doing and do not leave me alone when I am distressed.',
      concernsAndFears:
        'I do not want to be moved from home unless it is the only way to keep me comfortable. I worry about being in pain or about my family not being called in time.',
      placeOfCareComments:
        'My first wish is to remain at home with extra support. If that is no longer possible I would prefer a hospice to a busy hospital ward.',
      specialRequests:
        'Please keep a night light on, play the radio quietly in the morning, and call my daughter before any transfer is arranged.',
    };
  }
  if (level === 'normal') {
    return {
      personalValues:
        'I want to stay in my own home with a bit of help each day. Seeing my family and keeping my usual routine matter most to me.',
      carePreferences:
        'I would like staff to explain what they are doing, let me do what I can myself, and involve my family if decisions become harder.',
      concernsAndFears:
        'I worry about becoming a burden and about being moved without my family knowing. I do not want treatment that would only prolong distress.',
      placeOfCareComments:
        'Home is my first choice. If I needed more support I would consider a short hospital stay and then return home.',
      specialRequests:
        'Please keep me covered during personal care, offer a cup of tea in the morning, and speak to me before speaking about me.',
    };
  }
  return {
    personalValues:
      'I like to do as much as I can for myself. A regular cup of tea, seeing my family, and staying in my own home are what matter most.',
    carePreferences:
      'I prefer a regular carer, to be told before anyone starts, and to keep my independence with only the help I ask for.',
    concernsAndFears:
      'I do not want to be rushed or spoken over. I worry a little about falling at night, but I am not looking for hospital care now.',
    placeOfCareComments:
      'I would like to stay at home. If I ever needed a short stay elsewhere I would prefer to be with family rather than in hospital.',
    specialRequests:
      'Please ring the bell and wait to be asked in. I like the curtains opened in the morning and my glasses left on the bedside table.',
  };
}

/**
 * Complete Advance Care Planning worksheet values (holistic tab 13).
 * Identity fields reuse the Service User when present; empty profile keys get synthetic QA values.
 * `legalAdvanceDecisionDetails` is only set when the ADRT answer is Yes (matches the live UI gate).
 */
export function buildAdvanceCarePlanningDemoMetadata(
  level: IaAutofillLevel,
  identity?: IaDemoIdentity | null,
): AdvanceCarePlanningDemoMetadata {
  const displayName = demoSubjectName(identity);
  const familyName = qaFamilyName(identity);
  const familyTel = qaFamilyTel(identity);
  const completed = isoDate();
  const review = isoDate(6);
  const hasAdrt = false;
  const wishes = firstPersonAcpValues(level);

  const meta: AdvanceCarePlanningDemoMetadata = {
    patientName: displayName,
    address: identityText(identity?.addressContact) ?? QA_ADDRESS,
    dateOfBirth: identityText(identity?.dateOfBirth)?.slice(0, 10) ?? QA_DEMO_DOB,
    hospitalOrNhsNumber: identityText(identity?.nhsNumber) ?? QA_DEMO_NHS_NUMBER,
    dateCompleted: completed,
    gpDetails: identityText(identity?.gpContact) ?? identityText(identity?.gpName) ?? QA_GP_DETAILS,
    hospitalContact: QA_HOSPITAL_CONTACT,
    familyMemberName: familyName,
    familyContactTel: familyTel,
    professionalName: QA_PROFESSIONAL_NAME,
    professionalRole: QA_PROFESSIONAL_ROLE,
    professionalContactTel: QA_PROFESSIONAL_TEL,
    patientSignature: displayName,
    patientSignatureDate: completed,
    nextOfKinSignature: familyName,
    nextOfKinSignatureDate: completed,
    homecareProfessionalSignature: QA_PROFESSIONAL_NAME,
    homecareProfessionalSignatureDate: completed,
    reviewDate: review,
    ...wishes,
    legalAdvanceDecision: hasAdrt,
    proxyContact1: { name: familyName, tel: familyTel, lpoa: hasAdrt },
    proxyContact2: {
      name: 'James Wright',
      tel: '07700 900456',
      lpoa: false,
    },
    placeOfCareFirstChoice: level === 'critical' ? 'Home with full homecare support' : 'Own home',
    placeOfCareSecondChoice: level === 'critical' ? 'Hospice' : level === 'normal' ? 'Hospital, then home' : 'With family',
    thirdPartyComments: `${familyName} (daughter) agrees that remaining at home with familiar carers is the priority, and asked to be called first in an emergency.`,
  };

  if (hasAdrt) {
    meta.legalAdvanceDecisionDetails = `A copy of the ADRT is held by the GP, the homecare office, and ${familyName}.`;
  }

  return meta;
}

function eolYesNoAnswers(level: IaAutofillLevel): Record<(typeof EOL_YES_NO_QUESTION_IDS)[number], boolean> {
  const critical = level === 'critical';
  const moderate = level === 'normal';
  return {
    endOfLifeCarePlan: critical,
    awareOfDying: critical,
    medicationAssessed: critical,
    medicationAvailable: true,
    interventionDiscussion: critical,
    carersAwareWishes: true,
    capacityEndOfLife: true,
    comfortDiscussWishes: true,
    terminalResidence: true,
    hospiceHospitalTransfer: critical || moderate,
    funeralArrangements: critical,
    contactNextOfKin: true,
    reviewWishesFuture: true,
    capacityLastWishes: true,
    dnrInPlace: false,
  };
}

function eolTriAnswers(level: IaAutofillLevel): Record<(typeof EOL_TRI_QUESTION_IDS)[number], EndOfLifeDemoTriAnswer> {
  if (level === 'critical') return { medicalAidRecovery: 'no', lastWill: 'yes' };
  if (level === 'normal') return { medicalAidRecovery: 'unknown', lastWill: 'unknown' };
  return { medicalAidRecovery: 'yes', lastWill: 'no' };
}

function eolNotesFor(
  id: (typeof EOL_ALL_QUESTION_IDS)[number],
  level: IaAutofillLevel,
  yesNo: ReturnType<typeof eolYesNoAnswers>,
  tri: ReturnType<typeof eolTriAnswers>,
  familyName: string,
  familyTel: string,
): string {
  switch (id) {
    case 'endOfLifeCarePlan':
      return yesNo.endOfLifeCarePlan
        ? 'An end of life care plan is in place. The agreed objective is comfort at home, with district nurse support and family involvement.'
        : 'No end of life care plan is in place at present. Current support is for day-to-day needs, and wishes can be reviewed if health changes.';
    case 'awareOfDying':
      return yesNo.awareOfDying
        ? 'The person is aware that their condition is deteriorating and has asked to talk openly with family and the care team.'
        : 'The person is not currently dying. They understand their long-term conditions and have agreed that this can be reviewed if their health changes.';
    case 'medicationAssessed':
      return yesNo.medicationAssessed
        ? 'Medicines have been reviewed with the GP. Non-essential tablets have been stopped; analgesia and anticipatory medicines remain available.'
        : 'A specific end-of-life medicines review has not been required. Regular medicines continue as prescribed and will be reviewed if needs change.';
    case 'medicationAvailable':
      return 'Prescribed medicines are in the home and are prompted or administered by homecare staff at each visit, with a MAR chart in place.';
    case 'interventionDiscussion':
      return yesNo.interventionDiscussion
        ? 'The GP, family and the person have discussed avoiding burdensome interventions such as hospital transfer solely for feeding or turning when comfort can be maintained at home.'
        : 'There has been no discussion about stopping feeding, turning or similar interventions. Current care remains active and is reviewed at each assessment.';
    case 'significantBeliefs':
      return level === 'critical'
        ? 'Please allow quiet time in the morning. A local minister may be called if asked; no pork products. Family to be present for prayer if wished.'
        : 'No specific religious rites are requested. Please offer quiet time and respect privacy; family will advise if a faith contact is needed.';
    case 'carersAwareWishes':
      return `Homecare staff and ${familyName} have been told about the recorded wishes, including preferred place of care and who to call in an emergency.`;
    case 'capacityEndOfLife':
      return 'The person can understand, retain and weigh information about future care and can communicate a decision. No Mental Capacity Act assessment is indicated for this decision.';
    case 'comfortDiscussWishes':
      return 'The person was comfortable discussing last wishes today and agreed that they should be written down and reviewed with family.';
    case 'medicalAidRecovery':
      return tri.medicalAidRecovery === 'yes'
        ? 'They would want medical help to recover from a life-threatening event, including calling 999 and hospital treatment if needed.'
        : tri.medicalAidRecovery === 'no'
          ? 'They would not want aggressive treatment aimed only at prolonging life. Comfort measures and family contact are the priority.'
          : `They have not made a firm decision about medical aid to recover. Staff should call ${familyName} and the GP if a life-threatening event occurs.`;
    case 'terminalResidence':
      return 'If a terminal illness developed they would want to remain at home for as long as it is safe and comfortable, with family nearby.';
    case 'hospiceHospitalTransfer':
      return yesNo.hospiceHospitalTransfer
        ? 'If home care could no longer keep them comfortable they would accept transfer to a hospice, or to hospital if that is the only way to manage symptoms.'
        : 'They would prefer not to be transferred to hospice or hospital if needs can still be met at home. This can be reviewed if support needs increase.';
    case 'funeralArrangements':
      return yesNo.funeralArrangements
        ? `${familyName} holds the funeral plan with Co-op Funeralcare in Leeds. A simple service is preferred; details are in the household file.`
        : 'No funeral plan has been arranged yet. The family will discuss this later; staff should not make funeral decisions.';
    case 'lastWill':
      return tri.lastWill === 'yes'
        ? `${familyName} holds a copy of the will. The solicitor is at Oak Tree Legal, Leeds. Staff should direct enquiries to the family.`
        : tri.lastWill === 'no'
          ? 'No last will has been made. The family are aware and may seek advice later; this is not a care-team action.'
          : 'It is not known whether a will is in place. Staff should ask the family before giving out any information.';
    case 'contactNextOfKin':
      return `Yes. If they become dangerously ill, call ${familyName} on ${familyTel} first, then the GP out-of-hours service.`;
    case 'reviewWishesFuture':
      return 'They are willing to review these wishes at the next assessment and sooner if their health or family situation changes.';
    case 'capacityLastWishes':
      return 'They have capacity to decide their last wishes. They understood the questions, took time to think, and signed the record.';
    case 'dnrInPlace':
      return yesNo.dnrInPlace
        ? 'A DNACPR / ReSPECT form is in place and is kept in the homecare file and with the GP. Staff must follow the recorded decision.'
        : 'No DNACPR or ReSPECT form is in place. If collapse occurs, staff should call 999 unless a later decision is recorded.';
    case 'consentMethod':
      return 'Consented verbally and by signing the assessment with the registered manager present. Family were invited and the person agreed they could see the record.';
    default:
      return 'Recorded during the initial assessment discussion with the person and their family.';
  }
}

/**
 * Complete End of Life Assessment worksheet values (holistic tab 14).
 * Every visible question is answered. The live worksheet has no hidden follow-ups;
 * notes sit beside every question and are therefore filled at every scenario.
 */
export function buildEndOfLifeAssessmentDemoMetadata(
  level: IaAutofillLevel,
  identity?: IaDemoIdentity | null,
): EndOfLifeAssessmentDemoMetadata {
  const familyName = qaFamilyName(identity);
  const familyTel = qaFamilyTel(identity);
  const yesNo = eolYesNoAnswers(level);
  const tri = eolTriAnswers(level);
  const out: EndOfLifeAssessmentDemoMetadata = {};

  for (const id of EOL_YES_NO_QUESTION_IDS) {
    out[`${id}Answer`] = yesNo[id];
    out[`${id}Notes`] = eolNotesFor(id, level, yesNo, tri, familyName, familyTel);
  }
  for (const id of EOL_TRI_QUESTION_IDS) {
    out[`${id}TriAnswer`] = tri[id];
    out[`${id}Notes`] = eolNotesFor(id, level, yesNo, tri, familyName, familyTel);
  }
  for (const id of EOL_NOTES_ONLY_QUESTION_IDS) {
    out[`${id}Notes`] = eolNotesFor(id, level, yesNo, tri, familyName, familyTel);
  }

  return out;
}

function buildTherapyAideMemoireDemo(level: IaAutofillLevel, prefix: string) {
  const critical = level === 'critical';
  return {
    choking: { checked: false },
    chestInfections: { checked: false },
    speechConcern: { checked: false },
    mobilityChange: {
      checked: critical,
      details: critical ? 'Walking and transfers have become slower this month. I need more time on the stairs.' : undefined,
    },
    selfCareChange: {
      checked: critical,
      details: critical ? 'I need more help to wash and dress than I did a few weeks ago.' : undefined,
    },
    carePackageConcern: { checked: false },
    furtherReferralRequired: false,
    additionalComments: `${prefix} — therapy aide memoire`,
  };
}

function abbeyDomainScoresForLevel(level: IaAutofillLevel) {
  if (level === 'critical') {
    return {
      vocalisation: 3 as const,
      facialExpression: 3 as const,
      bodyLanguage: 2 as const,
      behaviouralChange: 3 as const,
      physiologicalChange: 2 as const,
      physicalChanges: 2 as const,
    };
  }
  if (level === 'normal') {
    return {
      vocalisation: 2 as const,
      facialExpression: 2 as const,
      bodyLanguage: 2 as const,
      behaviouralChange: 2 as const,
      physiologicalChange: 2 as const,
      physicalChanges: 1 as const,
    };
  }
  return {
    vocalisation: 0 as const,
    facialExpression: 0 as const,
    bodyLanguage: 0 as const,
    behaviouralChange: 0 as const,
    physiologicalChange: 0 as const,
    physicalChanges: 0 as const,
  };
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
  const commentKeys = new Set<number>([...IA_REGISTERED_HOLISTIC_TAB_IDS, 15, 16, 17, 18]);
  for (const n of commentKeys) {
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
      hoistServiced: level === 'critical',
      profilingBedServiced: level === 'critical',
      staffTrainingCoversHoist: level === 'critical',
      otGuidanceRequired: false,
      comments:
        level === 'critical'
          ? 'Hoist and profiling bed are in use. Servicing and staff training were checked at this assessment.'
          : 'No hoist or profiling bed is in use. No additional moving-handling equipment is required at present.',
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
      additionalComments: `${prefix} — falls screening`,
      ...(level === 'low'
        ? {}
        : {
            q1FallsNeedInvestigating: level === 'critical',
            q2DizzyOrBlackouts: false,
            q3WalkingBalanceUnassessed: level === 'critical',
            q4FourPlusMedsNoReview: false,
            q5TrippingMore: level === 'critical',
            q6FearOfFalling: false,
          }),
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
      nrsScore: level === 'critical' ? 7 : level === 'normal' ? 4 : 0,
      scaleUsed: 'both',
      abbey: enrichAbbeyMetadata({
        ...abbeyDomainScoresForLevel(level),
        painType: level === 'critical' ? 'acute_on_chronic' : level === 'normal' ? 'chronic' : undefined,
        dateCompleted: isoDate(),
        assessorNameDesignation: 'Sarah Thompson — Registered Manager',
      }),
      therapyAideMemoire: buildTherapyAideMemoireDemo(level, prefix),
    },
    environmentAssessment,
    advanceCarePlanning: buildAdvanceCarePlanningDemoMetadata(level, identity),
    endOfLifeAssessment: buildEndOfLifeAssessmentDemoMetadata(level, identity),
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
      selectedRiskLevel: level === 'critical' ? 'High risk' : level === 'normal' ? 'At risk' : 'Low risk',
      selectedEquipment:
        level === 'critical'
          ? 'Full replacement mattress'
          : level === 'normal'
            ? 'High risk foam mattress / alternating overlay'
            : 'Standard foam mattress — no additional pressure equipment',
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
