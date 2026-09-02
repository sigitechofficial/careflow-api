import { InitialAssessmentQuestionType } from '@prisma/client';
import {
  DIABETES_TYPE_OPTIONS,
  GENERAL_PHYSICAL_WELLBEING_OPTIONS,
  MUAC_NUTRITIONAL_RISK_OPTIONS,
  PULSE_RHYTHM_OPTIONS,
} from './initial-assessment-enterprise-options';
import { iaMeta, whenFieldYes, whenYes } from './initial-assessment-enterprise-metadata';
import type { EnterpriseQuestionSeed } from './initial-assessment-enterprise-sections-5-10.seed';

const SINGLE_SELECT = InitialAssessmentQuestionType.SINGLE_SELECT;
const YES_NO = InitialAssessmentQuestionType.YES_NO;
const NUMBER = InitialAssessmentQuestionType.NUMBER;
const TEXT = InitialAssessmentQuestionType.TEXT;
const TEXTAREA = InitialAssessmentQuestionType.TEXTAREA;

export const SECTION_4_QUESTIONS: EnterpriseQuestionSeed[] = [
  { questionText: 'Assessor competent to record vital signs?', questionType: YES_NO, isRequired: true, sortOrder: 1, metadata: { specRef: '4.1' } },
  { questionText: 'Clinical observations completed?', questionType: YES_NO, sortOrder: 2, metadata: { specRef: '4.1' } },
  { questionText: 'Temperature (°C)', questionType: NUMBER, sortOrder: 3, metadata: { specRef: '4.2', fieldKey: 'temperature' } },
  { questionText: 'Pulse (bpm)', questionType: NUMBER, sortOrder: 4, metadata: { specRef: '4.2', fieldKey: 'pulse' } },
  {
    questionText: 'Pulse rhythm',
    questionType: SINGLE_SELECT,
    sortOrder: 5,
    options: PULSE_RHYTHM_OPTIONS,
    metadata: { specRef: '4.2', fieldKey: 'pulseRhythm' },
  },
  { questionText: 'Respirations (per minute)', questionType: NUMBER, sortOrder: 6, metadata: { specRef: '4.2', fieldKey: 'respirations' } },
  { questionText: 'Blood pressure — systolic (mmHg)', questionType: NUMBER, sortOrder: 7, metadata: { specRef: '4.2', fieldKey: 'bpSystolic' } },
  { questionText: 'Blood pressure — diastolic (mmHg)', questionType: NUMBER, sortOrder: 8, metadata: { specRef: '4.2', fieldKey: 'bpDiastolic' } },
  {
    questionText: 'Standing blood pressure required?',
    questionType: YES_NO,
    sortOrder: 9,
    helpText: 'Lying, sitting and standing BP must be recorded where indicated on the paper form.',
    metadata: { specRef: '4.2', fieldKey: 'standingBpRequired' },
  },
  {
    questionText: 'Blood pressure — lying systolic (mmHg)',
    questionType: NUMBER,
    sortOrder: 10,
    metadata: iaMeta('4.2', { fieldKey: 'bpLyingSystolic', ...whenFieldYes('standingBpRequired') }),
  },
  {
    questionText: 'Blood pressure — lying diastolic (mmHg)',
    questionType: NUMBER,
    sortOrder: 11,
    metadata: iaMeta('4.2', { fieldKey: 'bpLyingDiastolic', ...whenFieldYes('standingBpRequired') }),
  },
  {
    questionText: 'Blood pressure — sitting systolic (mmHg)',
    questionType: NUMBER,
    sortOrder: 12,
    metadata: iaMeta('4.2', { fieldKey: 'bpSittingSystolic', ...whenFieldYes('standingBpRequired') }),
  },
  {
    questionText: 'Blood pressure — sitting diastolic (mmHg)',
    questionType: NUMBER,
    sortOrder: 13,
    metadata: iaMeta('4.2', { fieldKey: 'bpSittingDiastolic', ...whenFieldYes('standingBpRequired') }),
  },
  {
    questionText: 'Blood pressure — standing systolic (mmHg)',
    questionType: NUMBER,
    sortOrder: 14,
    metadata: iaMeta('4.2', { fieldKey: 'bpStandingSystolic', ...whenFieldYes('standingBpRequired') }),
  },
  {
    questionText: 'Blood pressure — standing diastolic (mmHg)',
    questionType: NUMBER,
    sortOrder: 15,
    metadata: iaMeta('4.2', { fieldKey: 'bpStandingDiastolic', ...whenFieldYes('standingBpRequired') }),
  },
  { questionText: 'Oxygen saturation (SpO2 %)', questionType: NUMBER, sortOrder: 16, metadata: { specRef: '4.2', fieldKey: 'spo2' } },
  {
    questionText: 'Vital signs context (optional)',
    questionType: TEXTAREA,
    sortOrder: 17,
    helpText:
      'Cuff size, position, post-exertion, refused reading, or other context for the observations above — only when needed.',
    metadata: { specRef: '4.2', fieldKey: 'vitalsContext' },
  },
  { questionText: 'Blood glucose (mmol/L)', questionType: NUMBER, sortOrder: 18, metadata: { specRef: '4.4', fieldKey: 'bloodGlucose' } },
  { questionText: 'Service User is diabetic?', questionType: YES_NO, isRequired: true, sortOrder: 19, metadata: { specRef: '4.4', fieldKey: 'serviceUserIsDiabetic' } },
  {
    questionText: 'Type of diabetes',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 20,
    options: DIABETES_TYPE_OPTIONS,
    metadata: iaMeta('4.4', { fieldKey: 'diabetesType', ...whenYes('service user is diabetic') }),
  },
  { questionText: 'Ongoing vital signs monitoring required?', questionType: YES_NO, isRequired: true, sortOrder: 21, metadata: { specRef: '4.5' } },
  { questionText: 'Monitoring schedule / frequency', questionType: TEXT, sortOrder: 22, metadata: { specRef: '4.5' } },
  {
    questionText: 'General physical wellbeing status',
    questionType: SINGLE_SELECT,
    isRequired: true,
    sortOrder: 23,
    options: GENERAL_PHYSICAL_WELLBEING_OPTIONS,
    metadata: iaMeta('4.6', { fieldKey: 'generalPhysicalWellbeing' }),
  },
  {
    questionText: 'GP review requested for physical wellbeing?',
    questionType: YES_NO,
    carePlanTrigger: true,
    sortOrder: 24,
    metadata: iaMeta('4.6'),
  },
  {
    questionText: 'General physical wellbeing comment',
    questionType: TEXTAREA,
    sortOrder: 25,
    metadata: iaMeta('4.6'),
  },
  {
    questionText: 'Build type (frail / small / medium / large / obese)',
    questionType: SINGLE_SELECT,
    sortOrder: 26,
    options: {
      options: [
        { value: 'frail', label: 'Frail' },
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
        { value: 'obese', label: 'Obese' },
      ],
    },
    metadata: { specRef: '4.10' },
  },
  { questionText: 'Height band or height (cm)', questionType: TEXT, sortOrder: 27, metadata: { specRef: '4.10' } },
  {
    questionText: 'Unable to weigh using standard scales?',
    questionType: YES_NO,
    sortOrder: 28,
    helpText: 'Select Yes when weight cannot be obtained on standing, chair, bed, or hoist scales.',
    metadata: iaMeta('4.10', { fieldKey: 'unableToWeigh' }),
  },
  {
    questionText: 'Weight (kg)',
    questionType: NUMBER,
    sortOrder: 29,
    metadata: iaMeta('4.10', { fieldKey: 'weightKg' }),
  },
  {
    questionText: 'Reason unable to weigh',
    questionType: TEXTAREA,
    sortOrder: 30,
    metadata: iaMeta('4.10', { fieldKey: 'unableToWeighReason', ...whenFieldYes('unableToWeigh') }),
  },
  {
    questionText: 'Mid upper arm circumference (MUAC) (cm)',
    questionType: NUMBER,
    sortOrder: 31,
    helpText:
      'Nutritional risk using MUAC — aligns with the optional pre-assessment MUAC form. Measure at mid-point between acromion and olecranon.',
    metadata: iaMeta('4.10', {
      fieldKey: 'muacCm',
      preAssessmentFormKey: 'nutritional_risk_muac',
      ...whenFieldYes('unableToWeigh'),
    }),
  },
  {
    questionText: 'MUAC nutritional risk band',
    questionType: SINGLE_SELECT,
    sortOrder: 32,
    options: MUAC_NUTRITIONAL_RISK_OPTIONS,
    metadata: iaMeta('4.10', {
      fieldKey: 'muacNutritionalRisk',
      preAssessmentFormKey: 'nutritional_risk_muac',
      ...whenFieldYes('unableToWeigh'),
    }),
  },
  { questionText: 'Physical assessment additional comments', questionType: TEXTAREA, sortOrder: 33, metadata: { specRef: '4.7' } },
];

const DIABETES_TYPE_REMAP: Record<string, string> = {
  'type a': 'type_1',
  type_a: 'type_1',
  typea: 'type_1',
  'type b': 'type_2',
  type_b: 'type_2',
  typeb: 'type_2',
};

function normalizeDiabetesTypeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function remapDiabetesSelectedOptions(value: unknown): { next: unknown; changed: boolean } {
  const mapToken = (token: string): string => DIABETES_TYPE_REMAP[normalizeDiabetesTypeToken(token)] ?? token;
  if (typeof value === 'string') {
    const next = mapToken(value);
    return { next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    const next = value.map((entry) => (typeof entry === 'string' ? mapToken(entry) : entry));
    const changed = next.some((entry, i) => entry !== value[i]);
    return { next, changed };
  }
  return { next: value, changed: false };
}

/** Preserve historical Type A / Type B answers as type_1 / type_2. Never delete rows. */
export async function remapDiabetesTypeHistoricalAnswers(
  prisma: import('@prisma/client').PrismaClient,
): Promise<number> {
  const questions = await prisma.initialAssessmentQuestion.findMany({
    where: { deletedAt: null },
    select: { id: true, questionText: true, metadata: true },
  });
  const diabetesIds = questions
    .filter((q) => {
      const meta = q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
        ? (q.metadata as Record<string, unknown>)
        : null;
      return meta?.fieldKey === 'diabetesType' || q.questionText.trim() === 'Type of diabetes';
    })
    .map((q) => q.id);
  if (diabetesIds.length === 0) return 0;

  const answers = await prisma.initialAssessmentAnswer.findMany({
    where: { questionId: { in: diabetesIds } },
    select: { id: true, selectedOptions: true },
  });

  let updated = 0;
  for (const row of answers) {
    const { next, changed } = remapDiabetesSelectedOptions(row.selectedOptions);
    if (!changed) continue;
    await prisma.initialAssessmentAnswer.update({
      where: { id: row.id },
      data: { selectedOptions: next as object },
    });
    updated += 1;
  }
  return updated;
}

