import { MedicationRecordStatus, Prisma, PrismaClient } from '@prisma/client';

type QuestionRow = {
  id: string;
  questionText: string;
  metadata: Prisma.JsonValue;
};

type AnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
};

export type VitalsReadingSnapshot = {
  temperature?: number;
  pulse?: number;
  respirations?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  spo2?: number;
  bloodGlucose?: number;
};

export type VitalsSnapshot = {
  recordedAt: string;
  competentAssessor: boolean | null;
  clinicalObservationsCompleted: boolean | null;
  readings: VitalsReadingSnapshot;
  observationIds: string[];
  sourceSubmissionId?: string;
};

export type MedicationSnapshotItem = {
  id: string;
  medicationName: string;
  dose: string | null;
  strength: string | null;
  status: MedicationRecordStatus;
  route: string | null;
  isControlledMedication: boolean;
};

export type MedicationListSnapshot = {
  capturedAt: string;
  verified: boolean;
  verifiedDate: string | null;
  listAvailable: boolean | null;
  itemCount: number;
  items: MedicationSnapshotItem[];
};

export type FallsRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type FallsAssessmentSnapshot = {
  fallsLast12Months: boolean | null;
  numberOfFalls: number | null;
  mostRecentFallDate: string | null;
  injuryCaused: boolean | null;
  assessmentCompleted: boolean | null;
  assessmentDate: string | null;
  riskScore: number;
  riskLevel: FallsRiskLevel | null;
  adlMobilityScore: number | null;
  observationId?: string;
};

function metaOf(q: QuestionRow): Record<string, unknown> | null {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return null;
  return q.metadata as Record<string, unknown>;
}

function fieldKeyOf(q: QuestionRow): string | undefined {
  const key = metaOf(q)?.fieldKey;
  return typeof key === 'string' ? key : undefined;
}

function findByFieldKey(questions: QuestionRow[], fieldKey: string): QuestionRow | undefined {
  return questions.find((q) => fieldKeyOf(q) === fieldKey);
}

function findByTextIncludes(questions: QuestionRow[], fragment: string): QuestionRow | undefined {
  const needle = fragment.toLowerCase();
  return questions.find((q) => q.questionText.toLowerCase().includes(needle));
}

function answerFor(map: Map<string, AnswerRow>, questionId: string): AnswerRow | undefined {
  return map.get(questionId);
}

function isYes(map: Map<string, AnswerRow>, q?: QuestionRow): boolean {
  if (!q) return false;
  const a = answerFor(map, q.id);
  return a?.checked === true || a?.booleanValue === true;
}

function numberFromAnswer(a?: AnswerRow): number | null {
  if (!a?.numberValue) return null;
  const n = Number(a.numberValue);
  return Number.isNaN(n) ? null : n;
}

function dateIso(a?: AnswerRow): string | null {
  if (!a?.dateValue) return null;
  return a.dateValue.toISOString();
}

function adlMobilityScore(metadata: Prisma.JsonValue | null | undefined): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const adl = (metadata as Record<string, unknown>).adl;
  if (!adl || typeof adl !== 'object' || Array.isArray(adl)) return null;
  const rows = (adl as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const mobility = rows.find(
    (r) =>
      r &&
      typeof r === 'object' &&
      !Array.isArray(r) &&
      (r as { activity?: string }).activity === 'Mobility',
  ) as { score?: number } | undefined;
  return mobility != null && typeof mobility.score === 'number' ? mobility.score : null;
}

export function buildVitalsSnapshot(params: {
  submissionId: string;
  questions: QuestionRow[];
  answers: AnswerRow[];
  recordedAt?: Date;
}): VitalsSnapshot | null {
  const { submissionId, questions, answers, recordedAt = new Date() } = params;
  const map = new Map(answers.map((a) => [a.questionId, a]));

  const readings: VitalsReadingSnapshot = {};
  for (const fieldKey of [
    'temperature',
    'pulse',
    'respirations',
    'bpSystolic',
    'bpDiastolic',
    'spo2',
    'bloodGlucose',
  ] as const) {
    const q = findByFieldKey(questions, fieldKey);
    const value = q ? numberFromAnswer(answerFor(map, q.id)) : null;
    if (value != null) readings[fieldKey] = value;
  }

  const hasAny = Object.keys(readings).length > 0;
  if (!hasAny) return null;

  const competentQ = findByTextIncludes(questions, 'competent to record vital');
  const clinicalQ = findByTextIncludes(questions, 'clinical observations completed');

  return {
    recordedAt: recordedAt.toISOString(),
    competentAssessor: competentQ ? (isYes(map, competentQ) ? true : isExplicitNo(map, competentQ) ? false : null) : null,
    clinicalObservationsCompleted: clinicalQ
      ? isYes(map, clinicalQ)
        ? true
        : isExplicitNo(map, clinicalQ)
          ? false
          : null
      : null,
    readings,
    observationIds: [],
    sourceSubmissionId: submissionId,
  };
}

function isExplicitNo(map: Map<string, AnswerRow>, q?: QuestionRow): boolean {
  if (!q) return false;
  const a = answerFor(map, q.id);
  return a?.checked === false || a?.booleanValue === false;
}

export function computeFallsRisk(params: {
  fallsLast12Months: boolean | null;
  numberOfFalls: number | null;
  injuryCaused: boolean | null;
  adlMobilityScore: number | null;
}): { riskScore: number; riskLevel: FallsRiskLevel | null } {
  if (params.fallsLast12Months !== true) {
    return { riskScore: 0, riskLevel: null };
  }

  let score = 35;
  const count = params.numberOfFalls ?? 0;
  if (count >= 3) score += 30;
  else if (count >= 2) score += 20;
  else if (count >= 1) score += 10;

  if (params.injuryCaused === true) score += 20;
  if (params.adlMobilityScore != null && params.adlMobilityScore >= 3) score += 15;

  const riskLevel: FallsRiskLevel = score >= 65 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  return { riskScore: score, riskLevel };
}

export function buildFallsAssessmentSnapshot(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata?: Prisma.JsonValue | null;
}): FallsAssessmentSnapshot {
  const { questions, answers, metadata } = params;
  const map = new Map(answers.map((a) => [a.questionId, a]));

  const fallsQ = findByFieldKey(questions, 'fallsLast12Months') ?? findByTextIncludes(questions, 'falls in last');
  const countQ = findByTextIncludes(questions, 'number of falls');
  const recentQ = findByTextIncludes(questions, 'most recent fall date');
  const injuryQ = findByTextIncludes(questions, 'injury caused by fall');
  const assessedQ = findByTextIncludes(questions, 'falls assessment completed');
  const assessedDateQ = findByTextIncludes(questions, 'falls assessment date');

  const fallsLast12Months = fallsQ ? (isYes(map, fallsQ) ? true : isExplicitNo(map, fallsQ) ? false : null) : null;
  const numberOfFalls = countQ ? numberFromAnswer(answerFor(map, countQ.id)) : null;
  const mostRecentFallDate = recentQ ? dateIso(answerFor(map, recentQ.id)) : null;
  const injuryCaused = injuryQ ? (isYes(map, injuryQ) ? true : isExplicitNo(map, injuryQ) ? false : null) : null;
  const assessmentCompleted = assessedQ
    ? isYes(map, assessedQ)
      ? true
      : isExplicitNo(map, assessedQ)
        ? false
        : null
    : null;
  const assessmentDate = assessedDateQ ? dateIso(answerFor(map, assessedDateQ.id)) : null;
  const mobilityScore = adlMobilityScore(metadata);
  const { riskScore, riskLevel } = computeFallsRisk({
    fallsLast12Months,
    numberOfFalls,
    injuryCaused,
    adlMobilityScore: mobilityScore,
  });

  return {
    fallsLast12Months,
    numberOfFalls,
    mostRecentFallDate,
    injuryCaused,
    assessmentCompleted,
    assessmentDate,
    riskScore,
    riskLevel,
    adlMobilityScore: mobilityScore,
  };
}

export async function buildMedicationListSnapshot(
  prisma: Prisma.TransactionClient | PrismaClient,
  params: {
    serviceUserId: string;
    questions: QuestionRow[];
    answers: AnswerRow[];
    capturedAt?: Date;
  },
): Promise<MedicationListSnapshot> {
  const { serviceUserId, questions, answers, capturedAt = new Date() } = params;
  const map = new Map(answers.map((a) => [a.questionId, a]));

  const verifiedQ = findByTextIncludes(questions, 'medication list verified');
  const verifiedDateQ = findByTextIncludes(questions, 'date medication list verified');
  const listAvailableQ = findByTextIncludes(questions, 'current medication list available');

  const rows = await prisma.serviceUserMedication.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      status: { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] },
    },
    orderBy: [{ medicationName: 'asc' }],
    select: {
      id: true,
      medicationName: true,
      dose: true,
      strength: true,
      status: true,
      isControlledMedication: true,
      route: { select: { name: true } },
    },
  });

  return {
    capturedAt: capturedAt.toISOString(),
    verified: verifiedQ ? isYes(map, verifiedQ) : false,
    verifiedDate: verifiedDateQ ? dateIso(answerFor(map, verifiedDateQ.id)) : null,
    listAvailable: listAvailableQ
      ? isYes(map, listAvailableQ)
        ? true
        : isExplicitNo(map, listAvailableQ)
          ? false
          : null
      : null,
    itemCount: rows.length,
    items: rows.map((r: (typeof rows)[number]) => ({
      id: r.id,
      medicationName: r.medicationName,
      dose: r.dose,
      strength: r.strength,
      status: r.status,
      route: r.route?.name ?? null,
      isControlledMedication: r.isControlledMedication,
    })),
  };
}

export function buildClinicalMetadataPatch(params: {
  submissionId: string;
  questions: QuestionRow[];
  answers: AnswerRow[];
  metadata?: Prisma.JsonValue | null;
  capturedAt?: Date;
}): {
  vitals: VitalsSnapshot | null;
  medications: MedicationListSnapshot | null;
  falls: FallsAssessmentSnapshot;
} {
  const vitals = buildVitalsSnapshot({
    submissionId: params.submissionId,
    questions: params.questions,
    answers: params.answers,
    recordedAt: params.capturedAt,
  });
  const falls = buildFallsAssessmentSnapshot({
    questions: params.questions,
    answers: params.answers,
    metadata: params.metadata,
  });
  return { vitals, medications: null, falls };
}

type ObservationTypeRow = { id: string; code: string; unitLabel: string | null };

export async function syncVitalsToObservations(
  tx: Prisma.TransactionClient,
  params: {
    serviceUserId: string;
    userId: string;
    submissionId: string;
    vitals: VitalsSnapshot;
  },
): Promise<string[]> {
  const { serviceUserId, userId, submissionId, vitals } = params;
  if (vitals.observationIds.length > 0) return vitals.observationIds;

  const codes = ['TEMPERATURE', 'PULSE', 'RESPIRATION', 'OXYGEN_SATURATION', 'BLOOD_SUGAR', 'BLOOD_PRESSURE'];
  const types = await tx.observationType.findMany({
    where: { code: { in: codes }, isActive: true },
  });
  const typeByCode = new Map(types.map((t) => [t.code, t as ObservationTypeRow]));
  const recordedAt = new Date(vitals.recordedAt);
  const note = `Initial assessment submission ${submissionId}`;
  const ids: string[] = [];

  const createNumeric = async (code: string, value: number, unit?: string) => {
    const type = typeByCode.get(code);
    if (!type) return;
    const row = await tx.serviceUserObservation.create({
      data: {
        serviceUserId,
        observationTypeId: type.id,
        recordedAt,
        notes: note,
        numericValue: value,
        unit: unit ?? type.unitLabel,
        recordedByUserId: userId,
        createdById: userId,
      },
    });
    ids.push(row.id);
  };

  const { readings } = vitals;
  if (readings.temperature != null) await createNumeric('TEMPERATURE', readings.temperature, 'C');
  if (readings.pulse != null) await createNumeric('PULSE', readings.pulse, 'BPM');
  if (readings.respirations != null) await createNumeric('RESPIRATION', readings.respirations, 'RPM');
  if (readings.spo2 != null) await createNumeric('OXYGEN_SATURATION', readings.spo2, '%');
  if (readings.bloodGlucose != null) await createNumeric('BLOOD_SUGAR', readings.bloodGlucose, 'MMOL/L');

  if (readings.bpSystolic != null && readings.bpDiastolic != null) {
    const bpType = typeByCode.get('BLOOD_PRESSURE');
    if (bpType) {
      const row = await tx.serviceUserObservation.create({
        data: {
          serviceUserId,
          observationTypeId: bpType.id,
          recordedAt,
          notes: note,
          payload: {
            systolic: readings.bpSystolic,
            diastolic: readings.bpDiastolic,
            situation: 'INITIAL_ASSESSMENT',
          },
          recordedByUserId: userId,
          createdById: userId,
        },
      });
      ids.push(row.id);
    }
  }

  return ids;
}

export async function syncFallsToObservation(
  tx: Prisma.TransactionClient,
  params: {
    serviceUserId: string;
    userId: string;
    submissionId: string;
    falls: FallsAssessmentSnapshot;
  },
): Promise<string | null> {
  const { serviceUserId, userId, submissionId, falls } = params;
  if (falls.observationId || falls.fallsLast12Months !== true) return falls.observationId ?? null;

  const type = await tx.observationType.findFirst({
    where: { code: 'FALLS', isActive: true },
  });
  if (!type) return null;

  const row = await tx.serviceUserObservation.create({
    data: {
      serviceUserId,
      observationTypeId: type.id,
      recordedAt: new Date(),
      notes: `Initial assessment submission ${submissionId}`,
      payload: {
        fallsLast12Months: falls.fallsLast12Months,
        numberOfFalls: falls.numberOfFalls,
        mostRecentFallDate: falls.mostRecentFallDate,
        injuryCaused: falls.injuryCaused,
        assessmentCompleted: falls.assessmentCompleted,
        assessmentDate: falls.assessmentDate,
        riskLevel: falls.riskLevel,
        riskScore: falls.riskScore,
        sourceSubmissionId: submissionId,
      },
      recordedByUserId: userId,
      createdById: userId,
    },
  });
  return row.id;
}

export function parseStoredClinicalMetadata(metadata: Prisma.JsonValue | null | undefined): {
  vitals: VitalsSnapshot | null;
  medications: MedicationListSnapshot | null;
  falls: FallsAssessmentSnapshot | null;
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { vitals: null, medications: null, falls: null };
  }
  const meta = metadata as Record<string, unknown>;
  return {
    vitals: (meta.vitals as VitalsSnapshot | undefined) ?? null,
    medications: (meta.medications as MedicationListSnapshot | undefined) ?? null,
    falls: (meta.falls as FallsAssessmentSnapshot | undefined) ?? null,
  };
}
