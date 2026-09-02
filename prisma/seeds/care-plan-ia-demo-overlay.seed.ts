/**
 * Apply persona-specific enterprise IA answers + About Me patches for five demo people.
 * Idempotent: upserts overlay answers only; clears hidden follow-ups when the parent gate is No.
 * Does not change the IA schema, Care Plan compose, or the generic IA autofill generator.
 */
import {
  InitialAssessmentStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { ENTERPRISE_TEMPLATE_NAME } from './initial-assessment-enterprise.seed';
import {
  CARE_PLAN_IA_DEMO_OVERLAY_META_FLAG,
  CARE_PLAN_IA_DEMO_OVERLAY_VERSION,
  CARE_PLAN_IA_DEMO_OVERLAYS,
  type IaDemoOverlayAnswer,
  type IaDemoOverlayPersona,
} from './care-plan-ia-demo-overlay.data';
import {
  expandIaDemoOverlayPersona,
  IA_DEMO_DETERMINISTIC_DATES,
} from './care-plan-ia-demo-expansion.data';

const ABOUT_ME_REF_TYPE = 'SU_ABOUT_ME_V1';

type ShowWhenRule = {
  gateTextIncludes?: string;
  gateFieldKey?: string;
  yes?: boolean;
  no?: boolean;
};

const INFERRED_FOLLOW_UP_RULES: { questionTextIncludes: string; when: ShowWhenRule }[] = [
  { questionTextIncludes: 'mca completed', when: { gateTextIncludes: 'mca required', yes: true } },
  {
    questionTextIncludes: 'best interest decision details',
    when: { gateTextIncludes: 'best interest decision required', yes: true },
  },
  { questionTextIncludes: 'language required', when: { gateTextIncludes: 'interpreter required', yes: true } },
  {
    questionTextIncludes: 'london fire brigade contact',
    when: { gateTextIncludes: 'london fire brigade informed', yes: true },
  },
  {
    questionTextIncludes: 'london fire brigade informed — details',
    when: { gateTextIncludes: 'london fire brigade informed', yes: true },
  },
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
  { questionTextIncludes: 'salt referral required', when: { gateTextIncludes: 'swallowing or choking concerns', yes: true } },
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
  { questionTextIncludes: 'equipment ordered', when: { gateTextIncludes: 'further pressure equipment required', yes: true } },
  { questionTextIncludes: 'date equipment ordered', when: { gateTextIncludes: 'equipment ordered', yes: true } },
  { questionTextIncludes: 'prosthesis care notes', when: { gateTextIncludes: 'uses prosthesis', yes: true } },
  { questionTextIncludes: 'number of falls', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'most recent fall date', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'injury caused by fall', when: { gateTextIncludes: 'falls in last', yes: true } },
  { questionTextIncludes: 'falls assessment date', when: { gateTextIncludes: 'falls assessment completed', yes: true } },
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
];

type TemplateQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  carePlanTrigger: boolean;
  riskFlag: boolean;
  metadata: Prisma.JsonValue;
  sectionNumber?: number;
};

export type CarePlanIaDemoOverlayPersonResult = {
  serviceUserNumber: string;
  displayName: string;
  skipped?: string;
  submissionId?: string;
  upserted: number;
  unmatched: string[];
  hiddenCleared: number;
  aboutMeUpdated: boolean;
};

function fieldKeyOf(metadata: Prisma.JsonValue): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const key = (metadata as Record<string, unknown>).fieldKey;
  return typeof key === 'string' && key.trim() ? key : undefined;
}

function metaRecord(metadata: Prisma.JsonValue): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

export function matchOverlayQuestions(
  questions: TemplateQuestion[],
  answer: IaDemoOverlayAnswer,
): TemplateQuestion[] {
  if (answer.fieldKey) {
    const byKey = questions.filter((q) => fieldKeyOf(q.metadata) === answer.fieldKey);
    if (answer.questionText) {
      const exact = byKey.filter((q) => q.questionText === answer.questionText);
      if (exact.length > 0) return exact;
    }
    if (byKey.length > 0) return byKey;
  }
  if (answer.questionText) {
    return questions.filter((q) => q.questionText === answer.questionText);
  }
  return [];
}

export function matchOverlayQuestion(
  questions: TemplateQuestion[],
  answer: IaDemoOverlayAnswer,
): TemplateQuestion | undefined {
  return matchOverlayQuestions(questions, answer)[0];
}

type AnswerWrite = {
  textValue: string | null;
  booleanValue: boolean | null;
  checked: boolean | null;
  selectedOptions: Prisma.InputJsonValue;
  notes: string | null;
  numberValue: number | null;
  dateValue: Date | null;
};

const EMPTY_ANSWER: AnswerWrite = {
  textValue: null,
  booleanValue: null,
  checked: null,
  selectedOptions: Prisma.JsonNull,
  notes: null,
  numberValue: null,
  dateValue: null,
};

export function overlayAnswerWriteData(answer: IaDemoOverlayAnswer): AnswerWrite {
  if (answer.kind === 'clear') return { ...EMPTY_ANSWER };
  if (answer.kind === 'text') {
    return { ...EMPTY_ANSWER, textValue: String(answer.value) };
  }
  if (answer.kind === 'yesNo') {
    const flag = Boolean(answer.value);
    return { ...EMPTY_ANSWER, booleanValue: flag, checked: flag };
  }
  if (answer.kind === 'select') {
    return { ...EMPTY_ANSWER, selectedOptions: [String(answer.value)] };
  }
  if (answer.kind === 'multi') {
    return { ...EMPTY_ANSWER, selectedOptions: [...(answer.value as string[])] };
  }
  if (answer.kind === 'date') {
    return { ...EMPTY_ANSWER, dateValue: new Date(`${String(answer.value)}T12:00:00.000Z`) };
  }
  if (answer.kind === 'number') {
    return { ...EMPTY_ANSWER, numberValue: Number(answer.value) };
  }
  return { ...EMPTY_ANSWER, selectedOptions: answer.value as Prisma.InputJsonValue };
}

function parseMetadataShowWhen(metadata: Prisma.JsonValue): ShowWhenRule | null {
  const raw = metaRecord(metadata)?.showWhen;
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
  const key = fieldKeyOf(q.metadata);
  if (key === 'londonFireBrigadeDetails') {
    return { gateFieldKey: 'londonFireBrigadeInformed', yes: true };
  }
  return parseMetadataShowWhen(q.metadata) ?? inferredFollowUpRule(q);
}

function findGateQuestion(questions: TemplateQuestion[], rule: ShowWhenRule): TemplateQuestion | undefined {
  if (rule.gateFieldKey) {
    const byKey = questions.find((q) => fieldKeyOf(q.metadata) === rule.gateFieldKey);
    if (byKey) return byKey;
  }
  if (rule.gateTextIncludes) {
    const needle = rule.gateTextIncludes.toLowerCase();
    const matches = questions.filter((q) => q.questionText.toLowerCase().includes(needle));
    if (matches.length === 0) return undefined;
    matches.sort(
      (a, b) => (a.sectionNumber ?? 0) - (b.sectionNumber ?? 0) || a.questionText.length - b.questionText.length,
    );
    const yesNo = matches.find((q) => q.questionType === 'YES_NO');
    return yesNo ?? matches[0];
  }
  return undefined;
}

function isYes(map: Map<string, { checked: boolean | null; booleanValue: boolean | null }>, q?: TemplateQuestion): boolean {
  if (!q) return false;
  const a = map.get(q.id);
  return a?.checked === true || a?.booleanValue === true;
}

function isExplicitNo(
  map: Map<string, { checked: boolean | null; booleanValue: boolean | null }>,
  q?: TemplateQuestion,
): boolean {
  if (!q) return false;
  const a = map.get(q.id);
  return a?.checked === false || a?.booleanValue === false;
}

function followUpIsHidden(
  q: TemplateQuestion,
  questions: TemplateQuestion[],
  map: Map<string, { checked: boolean | null; booleanValue: boolean | null }>,
): boolean {
  const rule = followUpRuleFor(q);
  if (!rule) return false;
  const gate = findGateQuestion(questions, rule);
  if (!gate) return false;
  if (rule.yes) return !isYes(map, gate);
  if (rule.no) return !isExplicitNo(map, gate);
  return false;
}

function answerHasValue(row: {
  textValue: string | null;
  booleanValue: boolean | null;
  checked: boolean | null;
  selectedOptions: Prisma.JsonValue;
  notes: string | null;
  numberValue: Prisma.Decimal | number | null;
  dateValue: Date | null;
}): boolean {
  if (row.textValue != null && String(row.textValue).trim() !== '') return true;
  if (row.booleanValue != null || row.checked != null) return true;
  if (row.numberValue != null) return true;
  if (row.dateValue != null) return true;
  if (row.notes != null && String(row.notes).trim() !== '') return true;
  const selected = row.selectedOptions;
  if (selected == null) return false;
  if (Array.isArray(selected)) return selected.length > 0;
  if (typeof selected === 'object') return Object.keys(selected as object).length > 0;
  return true;
}

function isNaFiller(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === 'not applicable' || t === 'n/a' || t === 'na' || t === 'none.' || t === 'not involved';
}

function mergeMetadata(
  existing: Prisma.JsonValue | null | undefined,
  worksheet?: Record<string, unknown>,
): Prisma.InputJsonValue {
  const current =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  current[CARE_PLAN_IA_DEMO_OVERLAY_META_FLAG] = true;
  current.overlayVersion = CARE_PLAN_IA_DEMO_OVERLAY_VERSION;
  if (worksheet) {
    for (const [key, value] of Object.entries(worksheet)) {
      current[key] = value;
    }
  }
  return current as Prisma.InputJsonValue;
}

function emptyRoutine() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const slots = ['getUp', 'breakfast', 'lunch', 'afternoon', 'teaTime', 'bedtime'] as const;
  const routine: Record<string, Record<string, string>> = {};
  for (const d of days) {
    routine[d] = Object.fromEntries(slots.map((s) => [s, '']));
  }
  return routine;
}

async function mergeAboutMe(
  prisma: PrismaClient,
  serviceUserId: string,
  patch: Record<string, string>,
  routine?: Record<string, Record<string, string>>,
): Promise<boolean> {
  if (Object.keys(patch).length === 0 && !routine) return false;

  const existing = await prisma.serviceUserReference.findFirst({
    where: { serviceUserId, referenceType: ABOUT_ME_REF_TYPE, deletedAt: null },
  });

  let parsed: Record<string, unknown> = { version: 1, routine: emptyRoutine() };
  if (existing?.referenceValue) {
    try {
      const raw = JSON.parse(existing.referenceValue) as Record<string, unknown>;
      if (raw && typeof raw === 'object') parsed = raw;
    } catch {
      parsed = { version: 1, routine: emptyRoutine() };
    }
  }
  Object.assign(parsed, patch);
  if (routine) parsed.routine = routine;
  const json = JSON.stringify(parsed);

  if (existing) {
    await prisma.serviceUserReference.update({
      where: { id: existing.id },
      data: { referenceValue: json },
    });
  } else {
    await prisma.serviceUserReference.create({
      data: {
        serviceUserId,
        referenceType: ABOUT_ME_REF_TYPE,
        referenceValue: json,
      },
    });
  }
  return true;
}

async function loadTemplateQuestions(prisma: PrismaClient, templateId: string): Promise<TemplateQuestion[]> {
  const sections = await prisma.initialAssessmentSection.findMany({
    where: { templateId, deletedAt: null, isActive: true },
    orderBy: { sectionNumber: 'asc' },
    select: {
      sectionNumber: true,
      questions: {
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          questionText: true,
          questionType: true,
          carePlanTrigger: true,
          riskFlag: true,
          metadata: true,
        },
      },
    },
  });
  return sections.flatMap((s) =>
    s.questions.map((q) => ({
      ...q,
      sectionNumber: s.sectionNumber,
    })),
  );
}

async function ensureSubmission(
  prisma: PrismaClient,
  serviceUserId: string,
  templateId: string,
  persona: IaDemoOverlayPersona,
): Promise<{ id: string; created: boolean }> {
  const dates = IA_DEMO_DETERMINISTIC_DATES[persona.serviceUserNumber];
  const assessmentAt = dates ? new Date(`${dates.assessment}T12:00:00.000Z`) : new Date();

  const existing = await prisma.initialAssessmentSubmission.findFirst({
    where: {
      serviceUserId,
      templateId,
      deletedAt: null,
      status: { notIn: [InitialAssessmentStatus.ARCHIVED, InitialAssessmentStatus.CANCELLED] },
    },
    orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
  });

  if (existing) {
    const eligible =
      existing.status === InitialAssessmentStatus.SUBMITTED ||
      existing.status === InitialAssessmentStatus.REVIEWED;
    await prisma.initialAssessmentSubmission.update({
      where: { id: existing.id },
      data: {
        metadata: mergeMetadata(existing.metadata, persona.worksheet),
        isActive: true,
        ...(eligible
          ? {}
          : {
              status: InitialAssessmentStatus.SUBMITTED,
              submittedAt: existing.submittedAt ?? assessmentAt,
              completedAt: existing.completedAt ?? assessmentAt,
            }),
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await prisma.initialAssessmentSubmission.create({
    data: {
      serviceUserId,
      templateId,
      status: InitialAssessmentStatus.SUBMITTED,
      startedAt: assessmentAt,
      completedAt: assessmentAt,
      submittedAt: assessmentAt,
      overallNotes: 'Enterprise IA demo overlay (persona-specific; not generic autofill).',
      metadata: mergeMetadata(null, persona.worksheet),
      isActive: true,
    },
  });
  return { id: created.id, created: true };
}

async function upsertAnswer(
  prisma: PrismaClient,
  submissionId: string,
  question: TemplateQuestion,
  data: AnswerWrite,
) {
  await prisma.initialAssessmentAnswer.upsert({
    where: {
      submissionId_questionId: { submissionId, questionId: question.id },
    },
    create: {
      submissionId,
      questionId: question.id,
      ...data,
      carePlanTrigger: question.carePlanTrigger,
      riskFlag: question.riskFlag,
    },
    update: {
      ...data,
      carePlanTrigger: question.carePlanTrigger,
      riskFlag: question.riskFlag,
    },
  });
}

async function applyPersona(
  prisma: PrismaClient,
  templateId: string,
  questions: TemplateQuestion[],
  rawPersona: IaDemoOverlayPersona,
): Promise<CarePlanIaDemoOverlayPersonResult> {
  const persona = expandIaDemoOverlayPersona(rawPersona);
  const su = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: persona.serviceUserNumber, deletedAt: null },
    select: { id: true },
  });
  if (!su) {
    return {
      serviceUserNumber: persona.serviceUserNumber,
      displayName: persona.displayName,
      skipped: 'service user not found',
      upserted: 0,
      unmatched: [],
      hiddenCleared: 0,
      aboutMeUpdated: false,
    };
  }

  const submission = await ensureSubmission(prisma, su.id, templateId, persona);
  const unmatched: string[] = [];
  let upserted = 0;

  for (const answer of persona.answers) {
    const matches = matchOverlayQuestions(questions, answer);
    if (matches.length === 0) {
      unmatched.push(answer.fieldKey ?? answer.questionText ?? '(unknown)');
      continue;
    }
    const data = overlayAnswerWriteData(answer);
    for (const question of matches) {
      await upsertAnswer(prisma, submission.id, question, data);
      upserted += 1;
    }
  }

  const stored = await prisma.initialAssessmentAnswer.findMany({
    where: { submissionId: submission.id },
    select: {
      questionId: true,
      textValue: true,
      booleanValue: true,
      checked: true,
      selectedOptions: true,
      notes: true,
      numberValue: true,
      dateValue: true,
    },
  });
  const byQuestion = new Map(stored.map((row) => [row.questionId, row]));
  const gateMap = new Map(
    stored.map((row) => [row.questionId, { checked: row.checked, booleanValue: row.booleanValue }]),
  );

  let hiddenCleared = 0;
  for (const question of questions) {
    const row = byQuestion.get(question.id);
    if (!row || !answerHasValue(row)) continue;
    const hideFollowUp = followUpIsHidden(question, questions, gateMap);
    const naText = typeof row.textValue === 'string' && isNaFiller(row.textValue);
    if (!hideFollowUp && !naText) continue;
    await upsertAnswer(prisma, submission.id, question, { ...EMPTY_ANSWER });
    hiddenCleared += 1;
  }

  const aboutMeUpdated = await mergeAboutMe(prisma, su.id, persona.aboutMe, persona.aboutMeRoutine);

  return {
    serviceUserNumber: persona.serviceUserNumber,
    displayName: persona.displayName,
    submissionId: submission.id,
    upserted,
    unmatched,
    hiddenCleared,
    aboutMeUpdated,
  };
}

export function expandedCarePlanIaDemoOverlays(): IaDemoOverlayPersona[] {
  return CARE_PLAN_IA_DEMO_OVERLAYS.map(expandIaDemoOverlayPersona);
}

export async function applyCarePlanIaDemoOverlay(prisma: PrismaClient): Promise<{
  templateId: string;
  people: CarePlanIaDemoOverlayPersonResult[];
}> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
    select: { id: true },
  });
  if (!template) {
    throw new Error(`Enterprise IA template "${ENTERPRISE_TEMPLATE_NAME}" not found`);
  }

  const questions = await loadTemplateQuestions(prisma, template.id);
  const people: CarePlanIaDemoOverlayPersonResult[] = [];
  for (const persona of CARE_PLAN_IA_DEMO_OVERLAYS) {
    people.push(await applyPersona(prisma, template.id, questions, persona));
  }
  return { templateId: template.id, people };
}
