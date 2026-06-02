import { Prisma } from '@prisma/client';

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
  dateValue: Date | null;
};

export type SignOffSnapshot = {
  capturedAt: string;
  serviceUserAgrees: boolean | null;
  representativeInvolved: boolean | null;
  representativeName: string | null;
  representativeRelationship: string | null;
  signatureObtained: boolean | null;
  assessorDeclarationConfirmed: boolean | null;
  assessorName: string | null;
  assessorRole: string | null;
  assessorSignDate: string | null;
  submittedAt: string | null;
};

function fieldKeyOf(q: QuestionRow): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const key = (q.metadata as Record<string, unknown>).fieldKey;
  return typeof key === 'string' ? key : undefined;
}

function findByFieldKey(questions: QuestionRow[], fieldKey: string): QuestionRow | undefined {
  return questions.find((q) => fieldKeyOf(q) === fieldKey);
}

function findByTextIncludes(questions: QuestionRow[], fragment: string): QuestionRow | undefined {
  const needle = fragment.toLowerCase();
  return questions.find((q) => q.questionText.toLowerCase().includes(needle));
}

function isYes(map: Map<string, AnswerRow>, q?: QuestionRow): boolean | null {
  if (!q) return null;
  const a = map.get(q.id);
  if (!a) return null;
  if (a.checked === true || a.booleanValue === true) return true;
  if (a.checked === false || a.booleanValue === false) return false;
  return null;
}

function textValue(map: Map<string, AnswerRow>, q?: QuestionRow): string | null {
  if (!q) return null;
  return map.get(q.id)?.textValue?.trim() ?? null;
}

function dateValue(map: Map<string, AnswerRow>, q?: QuestionRow): string | null {
  if (!q) return null;
  const d = map.get(q.id)?.dateValue;
  return d ? d.toISOString().slice(0, 10) : null;
}

export function buildSignOffSnapshot(params: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  submittedAt?: Date | null;
}): SignOffSnapshot {
  const map = new Map(params.answers.map((a) => [a.questionId, a]));
  const questions = params.questions;

  const suAgreesQ = findByTextIncludes(questions, 'service user agrees with assessment');
  const repInvolvedQ = findByFieldKey(questions, 'representativeInvolved');
  const repNameQ = findByTextIncludes(questions, 'representative name');
  const repRelQ = findByTextIncludes(questions, 'representative relationship');
  const sigQ = findByFieldKey(questions, 'suSignatureObtained') ?? findByTextIncludes(questions, 'signature obtained');
  const declQ = findByTextIncludes(questions, 'assessor declaration confirmed');
  const nameQ = findByFieldKey(questions, 'assessorName');
  const roleQ = findByFieldKey(questions, 'assessorRole');
  const dateQ = findByFieldKey(questions, 'assessorSignDate');

  return {
    capturedAt: new Date().toISOString(),
    serviceUserAgrees: isYes(map, suAgreesQ),
    representativeInvolved: isYes(map, repInvolvedQ),
    representativeName: textValue(map, repNameQ),
    representativeRelationship: textValue(map, repRelQ),
    signatureObtained: isYes(map, sigQ),
    assessorDeclarationConfirmed: isYes(map, declQ),
    assessorName: textValue(map, nameQ),
    assessorRole: textValue(map, roleQ),
    assessorSignDate: dateValue(map, dateQ),
    submittedAt: params.submittedAt?.toISOString() ?? null,
  };
}
