import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from './dto/generate-ia-section.dto';
import {
  CARE_PLAN_IA_DEMO_OVERLAYS,
} from '../../prisma/seeds/care-plan-ia-demo-overlay.data';
import {
  buildAutofillAnswers,
  buildDemoProfilePatch,
  buildHolisticWorksheetMetadata,
  classifyDemoTextRole,
  CLINICAL_NEEDS_NARRATIVE_RE,
  collectWritableDemoQuestionIds,
  isIntentionalBlankDemoQuestion,
  isInventedClinicalMeasurement,
  isSecureQuestion,
  isTypedDemoTextRole,
  QA_DEMO_DOB,
  QA_DEMO_ETHNICITY,
  QA_DEMO_GENDER,
  QA_DEMO_LANGUAGE,
  QA_DEMO_NHS_NUMBER,
  QA_DEMO_NI_NUMBER,
  QA_DEMO_PO_NUMBER,
  type AnswerInput,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';

const GENERIC_IDENTITY = {
  firstName: 'Helen',
  lastName: 'Wright',
  preferredName: 'Helen',
  dateOfBirth: '1948-03-12',
  nhsNumber: '943 476 5919',
  gender: 'Female',
};

const PERSONA_NUMBERS = ['SU-1042', 'SU-TEST-P01', 'SU-TEST-P02', 'SU-TEST-P04', 'SU-TEST-P10'] as const;

function flattenCatalog(): TemplateQuestion[] {
  const out: TemplateQuestion[] = [];
  for (const section of ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS) {
    for (const [i, q] of section.questions.entries()) {
      out.push({
        id: `s${section.sectionNumber}-q${i}`,
        questionText: q.questionText,
        questionType: String(q.questionType ?? 'YES_NO'),
        isRequired: q.isRequired ?? false,
        sortOrder: q.sortOrder,
        metadata: q.metadata ?? null,
        options: q.options,
        sectionNumber: section.sectionNumber,
      });
    }
  }
  return out;
}

function fillAllTabs(
  questions: TemplateQuestion[],
  level: IaAutofillLevel,
  identity?: import('./ia-autofill-build.util').IaDemoIdentity | null,
): Map<string, AnswerInput> {
  const requested = questions.map((q) => q.id);
  const merged = new Map<string, AnswerInput>();
  for (const tabId of IA_REGISTERED_HOLISTIC_TAB_IDS) {
    const writable = collectWritableDemoQuestionIds(tabId, questions, requested, level, identity);
    for (const a of buildAutofillAnswers(questions, level, writable, identity)) {
      merged.set(a.questionId, a);
    }
  }
  return merged;
}

function answerIsPopulated(q: TemplateQuestion, a: AnswerInput | undefined): boolean {
  if (!a) return false;
  switch (q.questionType) {
    case 'YES_NO':
    case 'CHECKBOX':
      return a.checked === true || a.checked === false || a.booleanValue === true || a.booleanValue === false;
    case 'NUMBER':
      return typeof a.numberValue === 'number' && !Number.isNaN(a.numberValue);
    case 'DATE':
      return typeof a.dateValue === 'string' && a.dateValue.length >= 8;
    case 'TIME':
      return typeof a.timeValue === 'string' && a.timeValue.length > 0;
    case 'TEXT':
    case 'TEXTAREA':
      return typeof a.textValue === 'string' && a.textValue.trim().length > 0;
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return a.selectedOptions != null && (Array.isArray(a.selectedOptions) ? a.selectedOptions.length > 0 : true);
    default:
      return false;
  }
}

const PERSONA_NAMES = /Margaret Hughes|Doris Clarke|James Okafor|Fatima Al-Rashid|Betty Henderson/;
const MH_CLINICAL_PARAGRAPH = /low in mood recently|tearful at times|withdrawn from usual activities/;
const SG_INCIDENT_NARRATIVE = /self-neglect and a recent unexplained bruise|safeguarding referral made to the local authority and being monitored/;

function prohibitedPlaceholder(text: string): boolean {
  return /\bN\/A\b|\bnot applicable\b|\bdemo\b|\btest user\b|\blorem ipsum\b/i.test(text);
}

type CatalogBucket =
  | 'FILLED_CORRECTLY'
  | 'WRONG_VALUE'
  | 'BLANK_BUT_SHOULD_BE_FILLED'
  | 'CONDITIONAL_HIDDEN'
  | 'SECURE'
  | 'CLINICAL_MEASUREMENT';

function typedValueIsCorrect(q: TemplateQuestion, text: string): boolean {
  if (CLINICAL_NEEDS_NARRATIVE_RE.test(text)) return false;
  if (PERSONA_NAMES.test(text)) return false;
  const role = classifyDemoTextRole(q);
  const label = q.questionText.toLowerCase();
  const key = String((q.metadata as { fieldKey?: string } | null)?.fieldKey ?? '').toLowerCase();
  switch (role) {
    case 'identifier':
      if (key === 'ponumber' || /\bpo number\b/.test(label)) return text === QA_DEMO_PO_NUMBER;
      if (/local authority/.test(label)) return /^LA-/i.test(text);
      return /^(QA|PO|LA|SG)-|\d{3}/.test(text);
    case 'reference':
      return /^(SG|QA|REF)-/i.test(text) && !SG_INCIDENT_NARRATIVE.test(text);
    case 'personName':
      return text.trim().length >= 2 && text.length < 80 && !/\bneeds identified\b/i.test(text);
    case 'phone':
      return /\d{5,}/.test(text);
    case 'email':
      return /@/.test(text);
    case 'postcode':
      return /[A-Z]{1,2}\d/i.test(text);
    case 'contact':
      if (/mental health/.test(label) && MH_CLINICAL_PARAGRAPH.test(text)) return false;
      if (/safeguarding/.test(label) && SG_INCIDENT_NARRATIVE.test(text)) return false;
      return /Tel:|\d{5,}/i.test(text);
    case 'datetimeText':
      return /\d{4}-\d{2}-\d{2}/.test(text);
    case 'location':
      return text.trim().length >= 4;
    case 'schedule':
      return /daily|visit|week|needed/i.test(text);
    case 'measurementBand':
      return /\d+\s*cm|average/i.test(text);
    case 'bodySite':
      return text.trim().length >= 4;
    case 'professionalRole':
      return text.trim().length >= 4;
    default:
      return text.trim().length > 0 && !CLINICAL_NEEDS_NARRATIVE_RE.test(text);
  }
}

function classifyCatalogField(
  q: TemplateQuestion,
  answer: AnswerInput | undefined,
  writable: Set<string>,
): CatalogBucket {
  const filled = answerIsPopulated(q, answer);
  if (isSecureQuestion(q)) return filled ? 'WRONG_VALUE' : 'SECURE';
  if (isInventedClinicalMeasurement(q)) return filled ? 'WRONG_VALUE' : 'CLINICAL_MEASUREMENT';
  if (isIntentionalBlankDemoQuestion(q) || !writable.has(q.id)) {
    return filled ? 'WRONG_VALUE' : 'CONDITIONAL_HIDDEN';
  }
  if (!filled) return 'BLANK_BUT_SHOULD_BE_FILLED';
  if (q.questionType === 'TEXT' || q.questionType === 'TEXTAREA') {
    const text = answer?.textValue ?? '';
    const role = classifyDemoTextRole(q);
    if (isTypedDemoTextRole(role) && !typedValueIsCorrect(q, text)) return 'WRONG_VALUE';
    if (prohibitedPlaceholder(text) || PERSONA_NAMES.test(text)) return 'WRONG_VALUE';
  }
  return 'FILLED_CORRECTLY';
}

describe('generic IA QA demo generator — complete catalog (non-persona)', () => {
  const catalog = flattenCatalog();

  it('enterprise catalog includes dedicated infection (§15) and fire safety (§18) sections', () => {
    const sections = new Set(catalog.map((q) => q.sectionNumber));
    expect(sections.size).toBeGreaterThanOrEqual(16);
    expect(sections.has(15)).toBe(true);
    expect(sections.has(18)).toBe(true);
    expect(catalog.length).toBeGreaterThan(100);
  });

  it.each(['critical', 'normal', 'low'] as const)(
    '%s classifies every catalog field (typed correctness, not merely non-empty text)',
    (level) => {
      const answers = fillAllTabs(catalog, level);
      const requested = catalog.map((q) => q.id);
      const writable = new Set<string>();
      for (const tabId of IA_REGISTERED_HOLISTIC_TAB_IDS) {
        for (const id of collectWritableDemoQuestionIds(tabId, catalog, requested, level)) {
          writable.add(id);
        }
      }

      const counts: Record<CatalogBucket, number> = {
        FILLED_CORRECTLY: 0,
        WRONG_VALUE: 0,
        BLANK_BUT_SHOULD_BE_FILLED: 0,
        CONDITIONAL_HIDDEN: 0,
        SECURE: 0,
        CLINICAL_MEASUREMENT: 0,
      };
      const wrong: string[] = [];
      const blank: string[] = [];

      for (const q of catalog) {
        const bucket = classifyCatalogField(q, answers.get(q.id), writable);
        counts[bucket] += 1;
        if (bucket === 'WRONG_VALUE') {
          wrong.push(`${q.id} [${classifyDemoTextRole(q)}] ${q.questionText} => ${JSON.stringify(answers.get(q.id)?.textValue)}`);
        }
        if (bucket === 'BLANK_BUT_SHOULD_BE_FILLED') {
          blank.push(`${q.id} [${q.questionType}] ${q.questionText}`);
        }
      }

      expect(catalog.length).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
      expect(wrong).toEqual([]);
      expect(blank).toEqual([]);
      expect(counts.FILLED_CORRECTLY).toBeGreaterThan(0);
      expect(counts.WRONG_VALUE).toBe(0);
      expect(counts.BLANK_BUT_SHOULD_BE_FILLED).toBe(0);

      const patch = buildDemoProfilePatch();

      const report = {
        catalog: catalog.length,
        correctlyFilled: counts.FILLED_CORRECTLY,
        wronglyFilled: counts.WRONG_VALUE,
        blankButRequired: counts.BLANK_BUT_SHOULD_BE_FILLED,
        hidden: counts.CONDITIONAL_HIDDEN,
        secure: counts.SECURE,
        clinicalMeasurement: counts.CLINICAL_MEASUREMENT,
        profileBacked: [
          patch.address?.addressLine1,
          patch.address?.addressLine2,
          patch.address?.town,
          patch.address?.county,
          patch.address?.postcode,
          patch.phone,
          patch.mobile,
          patch.email,
          patch.gp?.name,
          patch.gp?.phone,
          patch.gp?.practice,
        ].filter(Boolean).length,
      };
      const expected = {
        critical: { correctlyFilled: 515, hidden: 33 },
        normal: { correctlyFilled: 455, hidden: 93 },
        low: { correctlyFilled: 441, hidden: 107 },
      } as const;
      expect(report).toEqual({
        catalog: 555,
        wronglyFilled: 0,
        blankButRequired: 0,
        secure: 1,
        clinicalMeasurement: 6,
        profileBacked: 11,
        ...expected[level],
      });
    },
  );

  it.each(['critical', 'normal', 'low'] as const)(
    '%s empty profile populates Gender, DOB, NHS, NI, Ethnicity and Languages with synthetic QA values',
    (level) => {
      const answers = fillAllTabs(catalog, level);
      const byField = (key: string) =>
        catalog.find((q) => (q.metadata as { fieldKey?: string; prefillKey?: string } | null)?.fieldKey === key
          || (q.metadata as { prefillKey?: string } | null)?.prefillKey === key);

      const gender = byField('gender')!;
      const dob = byField('dateOfBirth')!;
      const nhs = byField('nhsNumber')!;
      const ni = byField('nationalInsuranceNumber')!;
      const ethnicity = byField('ethnicity')!;
      const languages = byField('languagesSpoken') ?? byField('language');
      const languagesQ = catalog.find((q) => q.questionText === 'Languages spoken') ?? languages!;

      expect(answers.get(gender.id)?.selectedOptions).toBe(QA_DEMO_GENDER);
      expect(answers.get(dob.id)?.dateValue).toBe(QA_DEMO_DOB);
      expect(answers.get(nhs.id)?.textValue).toBe(QA_DEMO_NHS_NUMBER);
      expect(answers.get(ni.id)?.textValue).toBe(QA_DEMO_NI_NUMBER);
      expect(String(answers.get(ethnicity.id)?.selectedOptions).toLowerCase()).toBe(QA_DEMO_ETHNICITY);
      expect(String(answers.get(languagesQ.id)?.selectedOptions).toLowerCase()).toBe(QA_DEMO_LANGUAGE);
      expect(QA_DEMO_NHS_NUMBER.startsWith('999')).toBe(true);
      expect(QA_DEMO_NI_NUMBER.startsWith('QQ')).toBe(true);
    },
  );

  it('does not overwrite occupied profile identity values', () => {
    const identity = {
      dateOfBirth: '1944-03-12',
      nhsNumber: '999 111 2222',
      nationalInsuranceNumber: 'QQ654321A',
      gender: 'male',
      ethnicity: 'black_african',
      language: 'welsh',
    };
    const answers = fillAllTabs(catalog, 'normal', identity);
    const byField = (key: string) =>
      catalog.find((q) => (q.metadata as { fieldKey?: string; prefillKey?: string } | null)?.fieldKey === key
        || (q.metadata as { prefillKey?: string } | null)?.prefillKey === key);
    expect(answers.has(byField('dateOfBirth')!.id)).toBe(false);
    expect(answers.has(byField('nhsNumber')!.id)).toBe(false);
    expect(answers.has(byField('nationalInsuranceNumber')!.id)).toBe(false);
    expect(answers.has(byField('gender')!.id)).toBe(false);
    expect(answers.has(byField('ethnicity')!.id)).toBe(false);
    expect(answers.has(catalog.find((q) => q.questionText === 'Languages spoken')!.id)).toBe(false);
  });

  it('Critical activates swallowing, MCA, pets and home-safety follow-ups; Moderate/Stable leave them empty', () => {
    const byText = (needle: string) =>
      catalog.find((q) => q.questionText.toLowerCase().includes(needle.toLowerCase()));

    const interpreter = byText('Interpreter required?')!;
    const language = catalog.find((q) => q.questionText === 'Language required')!;
    const swallowing = byText('Swallowing or choking concerns?')!;
    const choking = byText('Choking history details')!;
    const mcaRequired = catalog.find((q) => q.questionText === 'MCA required?')!;
    const mcaCompleted = catalog.find((q) => q.questionText === 'MCA completed?')!;
    const pets = byText('Pets present?')!;
    const petsSecured = byText('Pets secured during visits?')!;
    const dementia = byText('diagnosed dementia')!;
    const bmiCompleted = byText('BMI completed?')!;
    const bmiValue = byText('BMI value')!;
    const mustCompleted = byText('MUST assessment completed?')!;
    const mustScore = byText('MUST score')!;
    const weight = catalog.find((q) => q.metadata && (q.metadata as { fieldKey?: string }).fieldKey === 'weightKg')!;
    const unable = catalog.find((q) => q.metadata && (q.metadata as { fieldKey?: string }).fieldKey === 'unableToWeigh')!;
    const unableReason = byText('Reason unable to weigh')!;

    const critical = fillAllTabs(catalog, 'critical');
    expect(critical.get(interpreter.id)?.booleanValue).toBe(false);
    expect(critical.has(language.id)).toBe(false);
    expect(critical.get(swallowing.id)?.booleanValue).toBe(true);
    expect(critical.get(choking.id)?.textValue).toBeTruthy();
    expect(critical.get(mcaRequired.id)?.booleanValue).toBe(true);
    expect(critical.has(mcaCompleted.id)).toBe(true);
    expect(critical.get(pets.id)?.booleanValue).toBe(true);
    expect(critical.has(petsSecured.id)).toBe(true);
    expect(critical.get(dementia.id)?.booleanValue).toBe(false);
    expect(critical.get(bmiCompleted.id)?.booleanValue).toBe(false);
    expect(critical.has(bmiValue.id)).toBe(false);
    expect(critical.get(mustCompleted.id)?.booleanValue).toBe(false);
    expect(critical.has(mustScore.id)).toBe(false);
    expect(critical.has(weight.id)).toBe(false);
    expect(critical.get(unable.id)?.booleanValue).toBe(true);
    expect(critical.get(unableReason.id)?.textValue).toBeTruthy();

    for (const level of ['normal', 'low'] as const) {
      const answers = fillAllTabs(catalog, level);
      expect(answers.get(interpreter.id)?.booleanValue).toBe(false);
      expect(answers.has(language.id)).toBe(false);
      expect(answers.get(swallowing.id)?.booleanValue).toBe(false);
      expect(answers.has(choking.id)).toBe(false);
      expect(answers.get(mcaRequired.id)?.booleanValue).toBe(false);
      expect(answers.has(mcaCompleted.id)).toBe(false);
      expect(answers.get(pets.id)?.booleanValue).toBe(false);
      expect(answers.has(petsSecured.id)).toBe(false);
      expect(answers.has(weight.id)).toBe(false);
    }
  });

  it('person-centred narratives are first person; assessor fields are not', () => {
    const answers = fillAllTabs(catalog, 'normal');
    const whatMatters = catalog.find((q) => q.questionText.toLowerCase().includes('what matters most'))!;
    const assessor = catalog.find((q) => (q.metadata as { fieldKey?: string } | null)?.fieldKey === 'assessorName')!;
    const medical = catalog.find((q) => q.questionText.toLowerCase().includes('previous medical history'))!;

    const matters = answers.get(whatMatters.id)?.textValue ?? '';
    expect(matters).toMatch(/^(I |I'm |Please |My )/i);
    expect(matters).not.toMatch(/the service user prefers/i);

    const assessorName = answers.get(assessor.id)?.textValue ?? '';
    expect(assessorName).toBeTruthy();
    expect(assessorName).not.toMatch(/^(I |I'm )/i);

    const history = answers.get(medical.id)?.textValue ?? '';
    expect(history).toBeTruthy();
    expect(history).not.toMatch(/^(I |I'm |Please |My )/i);
  });

  it.each(['critical', 'normal', 'low'] as const)(
    '%s worksheet metadata for tabs 13 and 14 is complete (ACP + EOL)',
    (level) => {
      const meta = buildHolisticWorksheetMetadata(level, GENERIC_IDENTITY);
      const acp = meta.advanceCarePlanning as Record<string, unknown>;
      const eol = meta.endOfLifeAssessment as Record<string, unknown>;

      expect(String(acp.dateCompleted ?? '').trim()).toBeTruthy();
      expect(acp.legalAdvanceDecision).toBe(false);
      expect(String(acp.personalValues ?? '').trim()).toBeTruthy();
      expect(String(acp.carePreferences ?? '').trim()).toBeTruthy();
      expect(String(acp.concernsAndFears ?? '').trim()).toBeTruthy();
      expect(String(acp.placeOfCareFirstChoice ?? '').trim()).toBeTruthy();
      expect(String(acp.patientSignature ?? '').trim()).toBeTruthy();
      expect(acp.patientName).toBe('Helen');

      expect(eol.endOfLifeCarePlanAnswer === true || eol.endOfLifeCarePlanAnswer === false).toBe(true);
      expect(eol.awareOfDyingAnswer === true || eol.awareOfDyingAnswer === false).toBe(true);
      expect(eol.dnrInPlaceAnswer).toBe(false);
      expect(['yes', 'no', 'unknown']).toContain(eol.medicalAidRecoveryTriAnswer);
      expect(String(eol.significantBeliefsNotes ?? '').trim()).toBeTruthy();
      expect(String(eol.consentMethodNotes ?? '').trim()).toBeTruthy();
    },
  );

  it('does not invent identity — photography metadata uses the Service User', () => {
    const meta = buildHolisticWorksheetMetadata('critical', GENERIC_IDENTITY);
    const photo = meta.photographyConsent as Record<string, string>;
    expect(photo.firstNames).toBe('Helen');
    expect(photo.surname).toBe('Wright');
    expect(photo.consentSubjectName).toBe('Helen');
    expect(photo.nhsNumber).toBe('943 476 5919');
    expect(JSON.stringify(photo)).not.toMatch(/Margaret Hughes/);

    const unnamed = buildHolisticWorksheetMetadata('low');
    const unnamedPhoto = unnamed.photographyConsent as Record<string, string>;
    expect(unnamedPhoto.consentSubjectName).toBe('Helen Wright');
    expect(unnamedPhoto.nhsNumber).toBe('999 000 0001');
    expect(JSON.stringify(unnamedPhoto)).not.toMatch(/Margaret Hughes/);
  });

  it('does not invent funding-type options — uses a valid lookup code when the catalog is empty', () => {
    const q: TemplateQuestion = {
      id: 'funding',
      questionText: 'Funding type',
      questionType: 'SINGLE_SELECT',
      isRequired: true,
      sortOrder: 1,
      metadata: { specRef: '1.1', fieldKey: 'fundingType', optionsLookup: 'service_user_funding_types' },
      sectionNumber: 1,
    };
    const answers = buildAutofillAnswers([q], 'normal', new Set(['funding']));
    expect(answers[0]?.selectedOptions).toBe('local_authority');
  });

  it('Fill again is deterministic (existing overwrite/replace contract)', () => {
    const first = fillAllTabs(catalog, 'critical');
    const second = fillAllTabs(catalog, 'critical');
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it('five persona overlays remain unchanged regression fixtures', () => {
    expect(CARE_PLAN_IA_DEMO_OVERLAYS).toHaveLength(5);
    expect(CARE_PLAN_IA_DEMO_OVERLAYS.map((p) => p.serviceUserNumber)).toEqual([...PERSONA_NUMBERS]);
    expect(CARE_PLAN_IA_DEMO_OVERLAYS.map((p) => p.displayName)).toEqual([
      'Margaret Hughes',
      'Doris Clarke',
      'James Okafor',
      'Fatima Al-Rashid',
      'Betty Henderson',
    ]);
  });
});
