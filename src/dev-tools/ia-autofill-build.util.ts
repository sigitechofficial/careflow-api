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

function shouldFillQuestion(q: TemplateQuestion, level: IaAutofillLevel): boolean {
  if (level === 'critical') return q.sectionNumber >= 1 && q.sectionNumber <= HOLISTIC_TAB_COUNT;
  if (level === 'low' || level === 'normal') {
    if (q.isRequired) return true;
    return q.sectionNumber <= 12 && q.sortOrder <= 8;
  }
  return false;
}

function skipOptionalStableField(level: IaAutofillLevel, q: TemplateQuestion): boolean {
  return level === 'low' && !q.isRequired && q.sectionNumber > 3;
}

function e2eYesNoValue(q: TemplateQuestion): { checked: boolean; booleanValue: boolean } {
  const key = fieldKey(q);
  const ref = specRef(q);
  const text = q.questionText.toLowerCase();

  const negative =
    key === 'safeguardingConcern' ||
    key === 'fallsLast12Months' ||
    key === 'hasWounds' ||
    key === 'usesHoistOrSling' ||
    key === 'financeSupportRequired' ||
    key === 'clinicalEquipmentInUse' ||
    text.includes('safeguarding concerns identified') ||
    text.includes('falls in last') ||
    text.includes('currently has ulcers') ||
    text.includes('finance support required') ||
    text.includes('representative involved') ||
    text.includes('mca required') ||
    text.includes('capacity not intact') ||
    text.includes('salt referral required') ||
    text.includes('local authority safeguarding referral required');

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

  const riskYes =
    key === 'safeguardingConcern' ||
    key === 'fallsLast12Months' ||
    key === 'hasWounds' ||
    key === 'financeSupportRequired' ||
    key === 'clinicalEquipmentInUse' ||
    text.includes('safeguarding concerns identified') ||
    text.includes('falls in last') ||
    text.includes('currently has ulcers') ||
    text.includes('wound assessment been completed') ||
    text.includes('finance support required') ||
    text.includes('feels low') ||
    text.includes('low in mood') ||
    text.includes('pain concern') ||
    text.includes('salt referral required') ||
    text.includes('controlled drugs in use') ||
    text.includes('covert medication required') ||
    text.includes('local authority safeguarding referral required');

  if (riskYes) return { checked: true, booleanValue: true };
  return e2eYesNoValue(q);
}

function conditionTextPrefix(level: IaAutofillLevel): string {
  if (level === 'critical') return 'Very critical condition';
  if (level === 'normal') return 'Moderate condition';
  return 'Stable condition — out of danger';
}

function buildPreferredVisitTimesAnswer(): Record<string, unknown> {
  return {
    MORNING: { selected: true, from: '08:00', to: '12:00', roundName: 'Morning' },
    AFTERNOON: { selected: true, from: '13:00', to: '17:00', roundName: 'Afternoon' },
  };
}

export function buildAutofillAnswers(
  questions: TemplateQuestion[],
  level: IaAutofillLevel,
): AnswerInput[] {
  const answers: AnswerInput[] = [];
  for (const q of questions) {
    const a = buildAnswer(q, level);
    if (a) answers.push(a);
  }
  return answers;
}

function buildAnswer(q: TemplateQuestion, level: IaAutofillLevel): AnswerInput | null {
  if (!shouldFillQuestion(q, level)) return null;

  const base: AnswerInput = { questionId: q.id };
  const key = fieldKey(q);
  const ref = specRef(q);
  const opts = parseSelectOptions(q.options);
  const textNeedle = q.questionText.toLowerCase();

  if (key === 'preferredVisitTimes' || textNeedle.includes('preferred visit times')) {
    return { ...base, selectedOptions: buildPreferredVisitTimesAnswer() };
  }

  if (ref === '2.1' || ref === '2.2') {
    if (level === 'low' && q.sectionNumber > 2 && !q.isRequired) return null;
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
      if (skipOptionalStableField(level, q)) return null;
      return { ...base, numberValue: 1 };
    }
    case 'DATE': {
      if (skipOptionalStableField(level, q)) return null;
      if (key === 'nextReviewDate' || key === 'assessorSignDate') {
        return { ...base, dateValue: isoDate(key === 'nextReviewDate' ? 6 : 0) };
      }
      return { ...base, dateValue: isoDate() };
    }
    case 'TIME':
      if (skipOptionalStableField(level, q)) return null;
      return { ...base, timeValue: '09:00' };
    case 'TEXT':
    case 'TEXTAREA': {
      if (key === 'assessorName') return { ...base, textValue: 'E2E Assessor' };
      if (key === 'assessorRole') return { ...base, textValue: 'Registered Manager' };
      if (skipOptionalStableField(level, q)) return null;
      if (textNeedle.includes('safeguarding concern details')) {
        return {
          ...base,
          textValue: `${conditionTextPrefix(level)} — safeguarding details documented for E2E.`,
        };
      }
      if (textNeedle.includes('review and sign-off')) {
        return {
          ...base,
          textValue: `${conditionTextPrefix(level)} — assessment sign-off (E2E).`,
        };
      }
      return {
        ...base,
        textValue: `${conditionTextPrefix(level)} — ${q.questionText.slice(0, 48)}`,
      };
    }
    case 'SINGLE_SELECT': {
      if (skipOptionalStableField(level, q)) return null;
      if (opts[0]) return { ...base, selectedOptions: opts[0].value as unknown as Record<string, unknown> };
      return level === 'critical' ? { ...base, textValue: 'E2E selected' } : null;
    }
    case 'MULTI_SELECT': {
      if (skipOptionalStableField(level, q)) return null;
      if (opts.length) {
        const pick = level === 'critical' ? opts.slice(0, Math.min(3, opts.length)) : [opts[0]!];
        return { ...base, selectedOptions: pick.map((o) => o.value) };
      }
      return level === 'critical' ? { ...base, selectedOptions: ['e2e_option'] } : null;
    }
    default:
      return level === 'critical' ? { ...base, textValue: 'E2E' } : null;
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

function conditionPrefix(level: IaAutofillLevel): string {
  return conditionTextPrefix(level);
}

export function buildHolisticWorksheetMetadata(level: IaAutofillLevel): Record<string, unknown> {
  const prefix = conditionPrefix(level);

  const adlRows = [{ id: 'dressing', activity: 'Dressing', score: level === 'critical' ? 3 : 0, notes: '' }];
  const transferRows = [
    { id: 'bedToChair', label: 'Bed to chair', level: level === 'critical' ? 1 : null },
  ];
  const skinRows = [{ id: 'sacrum', label: 'Sacrum', right: `${prefix} — clear (E2E)`, left: `${prefix} — clear (E2E)` }];

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
          comments: 'Very critical — elevated Waterlow (E2E)',
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
            comments: 'Stable — low pressure risk (E2E)',
          }
        : { gender: 1, age: 1, score: 2 },
  );

  const sectionComments: Record<string, { text: string }> = {};
  const sectionFooters: Record<string, { dateCompleted?: string; assessorNameDesignation?: string }> = {};
  for (let n = 1; n <= HOLISTIC_TAB_COUNT; n++) {
    sectionComments[String(n)] = { text: `${prefix} — holistic tab ${n} (E2E)` };
    sectionFooters[String(n)] = {
      dateCompleted: isoDate(),
      assessorNameDesignation: 'E2E Assessor — RM',
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
  environmentAssessment.goalsAchieve = `${prefix} — goals (E2E)`;
  environmentAssessment.goalsCarePriorities = `${prefix} — care priorities (E2E)`;
  environmentAssessment.riskAssessmentsCompleted = true;
  environmentAssessment.referralRequired = level === 'critical';
  environmentAssessment.equipmentAvailable = true;
  environmentAssessment.staffNotes = 'E2E environment assessment';

  const visitIds = ['morning', 'lunch', 'tea', 'evening', 'night'];
  const visits = visitIds.reduce<Record<string, unknown>>((acc, id) => {
    acc[id] = {
      agreedTask: `${prefix} — ${id} task (E2E)`,
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
    acc[id] = { initial: `${prefix} — ${id} (E2E)`, reviews: Array(6).fill('') };
    return acc;
  }, {});

  return {
    adl: {
      rows: adlRows,
      mobilityAidsRequired: level === 'critical',
      mobilityAidsList: level === 'critical' ? 'Hoist, profiling bed' : '',
      fallsAssessmentCompleted: level === 'critical',
      additionalComments: level === 'critical' ? 'Very critical — ADL / falls (E2E)' : '',
    },
    waterlow,
    transfers: { rows: transferRows, independentWithAll: false, comments: level === 'critical' ? 'E2E transfer matrix' : '' },
    equipmentChecklist: {
      hoistServiced: true,
      profilingBedServiced: true,
      staffTrainingCoversHoist: true,
      otGuidanceRequired: false,
      comments: 'E2E equipment checklist',
    },
    dailyLivingAids: {
      aidsInUseOrRequired: false,
      aidsList: '',
      furtherEquipmentRequired: false,
      additionalComments: 'E2E daily living aids',
    },
    practicalCare: {
      laundry: 'Minimal support',
      cleaning: 'Minimal support',
      shopping: 'Carer support',
      financeAssistance: 'Not required',
      otherComment: 'E2E practical care tasks',
    },
    financeSupport: {
      required: level === 'critical',
      supportTypes: level === 'critical' ? ['benefits'] : [],
      staffHandleCash: false,
      familyInvolved: level === 'critical',
      consentRecorded: level === 'critical',
      details: level === 'critical' ? 'Very critical — finance support (E2E)' : '',
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
      additionalComments: `${prefix} — falls screening (E2E)`,
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
        additionalComments: `${prefix} — therapy aide memoire (E2E)`,
      },
    },
    environmentAssessment,
    advanceCarePlanning: {
      patientName: 'E2E Client',
      dateCompleted: isoDate(),
      legalAdvanceDecision: false,
      personalValues: `${prefix} — personal values (E2E)`,
      carePreferences: `${prefix} — care preferences (E2E)`,
      concernsAndFears: `${prefix} — concerns (E2E)`,
    },
    endOfLifeAssessment: { endOfLifeCarePlanAnswer: level === 'critical' },
    clinicalOutcomeSummary: {
      initial: { assessmentDate: isoDate(), practitioner: 'E2E Assessor' },
      reviews: Array(6).fill({}),
      rows: clinicalRows,
    },
    carePlanObjectives: {
      visits,
      professionalInterventionOutcome: {
        agreedTask: 'E2E professional intervention',
        objectives: 'E2E objectives',
        outcomes: 'E2E outcomes',
      },
      professionalVisit: {
        whichProfessionalVisit: 'District nurse',
        agreedTask: 'E2E visit task',
        objectives: 'E2E visit objectives',
        outcomes: 'E2E visit outcomes',
      },
      otherEquipmentRequired: level === 'critical' ? 'Profiling bed (E2E)' : '',
    },
    mentalCapacityChecklist: {
      assessmentType: 'preliminary',
      impairmentAnswer: false,
      unableKeyDecisionAnswer: false,
      assessorName: 'E2E Assessor',
      assessorPosition: 'Registered Manager',
      assessorDate: isoDate(),
    },
    photographyConsent: {
      surname: 'E2E',
      firstNames: 'Client',
      dateOfBirth: isoDate(-900),
      nhsNumber: 'E2E-123456',
      gender: 'female',
      professionalName: 'E2E Assessor',
      professionalJobTitle: 'Care Coordinator',
      consentSubjectName: 'E2E Client',
      consentSignature: 'E2E Signature',
      consentDate: isoDate(),
      consentPrintName: 'E2E Client',
    },
    equipmentSelection: {
      waterlowScore: level === 'critical' ? '18' : level === 'normal' ? '12' : '8',
      selectedRiskLevel: level === 'critical' ? 'High risk' : 'At risk',
      selectedEquipment:
        level === 'critical' ? 'Full replacement mattress' : 'High risk foam mattress / alternating overlay',
      equipmentInPlace: level === 'low',
      otReferralRequired: level === 'critical',
      notes: `${prefix} — equipment selection (E2E)`,
    },
  };
}

export function mergeMetadataPatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}
