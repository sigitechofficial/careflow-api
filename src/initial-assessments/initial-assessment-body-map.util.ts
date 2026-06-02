import {
  BodyMapAuditAction,
  BodyMapBodyView,
  BodyMapRecordStatus,
  BodyMapRecordType,
  BodyMapRiskLevel,
  BodyMapSide,
  Prisma,
} from '@prisma/client';

type QuestionRow = {
  id: string;
  questionText: string;
  metadata: Prisma.JsonValue;
  section: { sectionNumber: number };
};

type AnswerRow = {
  questionId: string;
  checked: boolean | null;
  booleanValue: boolean | null;
};

function isYes(answer: AnswerRow | undefined): boolean {
  return answer?.checked === true || answer?.booleanValue === true;
}

function metaFlag(q: QuestionRow, key: string): boolean {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return false;
  return (q.metadata as Record<string, unknown>)[key] === true;
}

export function bodyMapRequiredFromSubmission(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
}): { required: boolean; recordType: BodyMapRecordType; sourceQuestionId?: string } {
  const answerMap = new Map(params.answers.map((a) => [a.questionId, a]));
  let recordType: BodyMapRecordType = BodyMapRecordType.SKIN;
  let sourceQuestionId: string | undefined;

  for (const q of params.questions) {
    const answer = answerMap.get(q.id);
    if (!isYes(answer)) continue;

    if (metaFlag(q, 'bodyMapModule')) {
      return { required: true, recordType: BodyMapRecordType.WOUND, sourceQuestionId: q.id };
    }

    if (q.section.sectionNumber === 11 && /ulcer|wound/i.test(q.questionText)) {
      recordType = BodyMapRecordType.WOUND;
      sourceQuestionId = q.id;
    }
  }

  if (sourceQuestionId) {
    return { required: true, recordType, sourceQuestionId };
  }

  return { required: false, recordType: BodyMapRecordType.SKIN };
}

const ACTIVE_STATUSES: BodyMapRecordStatus[] = [
  BodyMapRecordStatus.ACTIVE,
  BodyMapRecordStatus.MONITORING,
  BodyMapRecordStatus.REVIEW_DUE,
  BodyMapRecordStatus.AWAITING_REVIEW,
];

export async function ensureBodyMapBaseline(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    serviceUserId: string;
    submissionId: string;
    recordType: BodyMapRecordType;
    existingRecordId?: string | null;
  },
): Promise<{ recordId: string; created: boolean } | null> {
  if (params.existingRecordId) {
    const linked = await tx.bodyMapRecord.findFirst({
      where: {
        id: params.existingRecordId,
        serviceUserId: params.serviceUserId,
        status: { in: ACTIVE_STATUSES },
      },
      select: { id: true },
    });
    if (linked) return { recordId: linked.id, created: false };
  }

  const existing = await tx.bodyMapRecord.findFirst({
    where: {
      serviceUserId: params.serviceUserId,
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) return { recordId: existing.id, created: false };

  const record = await tx.bodyMapRecord.create({
    data: {
      serviceUserId: params.serviceUserId,
      recordType: params.recordType,
      title: 'Initial assessment — locate wound or pressure area',
      description:
        'Baseline placeholder created from initial assessment §11. Open the body map to place the marker and complete wound details.',
      riskLevel: BodyMapRiskLevel.MEDIUM,
      status: BodyMapRecordStatus.ACTIVE,
      reviewRequired: true,
      createdById: params.userId,
      updatedById: params.userId,
    },
  });

  await tx.bodyMapMarker.create({
    data: {
      bodyMapRecordId: record.id,
      bodyView: BodyMapBodyView.FRONT,
      side: BodyMapSide.CENTRE,
      bodyPart: 'To be located',
      specificLocation: 'Pending placement from initial assessment',
      xCoordinate: 50,
      yCoordinate: 50,
      markerNumber: 1,
      markerType: params.recordType,
      riskLevel: BodyMapRiskLevel.MEDIUM,
      status: BodyMapRecordStatus.ACTIVE,
      createdById: params.userId,
    },
  });

  await tx.bodyMapAuditLog.create({
    data: {
      bodyMapRecordId: record.id,
      action: BodyMapAuditAction.CREATE,
      actorUserId: params.userId,
      payload: {
        source: 'initial_assessment',
        submissionId: params.submissionId,
      } as Prisma.InputJsonValue,
    },
  });

  return { recordId: record.id, created: true };
}

export function bodyMapMetadataPatch(
  current: Prisma.JsonValue | Prisma.InputJsonValue,
  patch: { required: boolean; recordId: string; created: boolean; submissionId: string },
): Prisma.InputJsonValue {
  const base =
    typeof current === 'object' && current && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  return {
    ...base,
    bodyMap: {
      required: patch.required,
      recordId: patch.recordId,
      baselineCreated: patch.created,
      submissionId: patch.submissionId,
      linkedAt: new Date().toISOString(),
    },
  } as Prisma.InputJsonValue;
}

export function existingBodyMapRecordId(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const bodyMap = (metadata as Record<string, unknown>).bodyMap;
  if (!bodyMap || typeof bodyMap !== 'object' || Array.isArray(bodyMap)) return null;
  const id = (bodyMap as Record<string, unknown>).recordId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
