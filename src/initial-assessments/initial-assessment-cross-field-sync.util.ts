import { Prisma } from '@prisma/client';

type QuestionRow = {
  id: string;
  questionText: string;
  questionType: string;
  metadata: Prisma.JsonValue;
};

type AnswerInput = {
  questionId: string;
  checked?: boolean | null;
  booleanValue?: boolean | null;
  textValue?: string | null;
  numberValue?: number | null;
  dateValue?: string | null;
  timeValue?: string | null;
  selectedOptions?: unknown;
  notes?: string | null;
};

function metaString(q: QuestionRow, key: string): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const v = (q.metadata as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function syncKeyOf(q: QuestionRow): string | undefined {
  return metaString(q, 'syncKey');
}

function syncFromKeyOf(q: QuestionRow): string | undefined {
  return metaString(q, 'syncFromKey');
}

function textOf(a: AnswerInput | undefined): string {
  return a?.textValue?.trim() ?? '';
}

function expandForQuestion(
  questions: QuestionRow[],
  sourceId: string,
  item: AnswerInput,
  map: Map<string, AnswerInput>,
): void {
  const source = questions.find((q) => q.id === sourceId);
  if (!source) return;

  const key = syncKeyOf(source);
  if (key) {
    const peers = questions.filter((q) => q.id !== sourceId && syncKeyOf(q) === key);
    for (const peer of peers) {
      if (source.questionType === 'YES_NO' || source.questionType === 'CHECKBOX') {
        const yes = item.checked === true || item.booleanValue === true;
        map.set(peer.id, {
          questionId: peer.id,
          checked: yes,
          booleanValue: yes,
        });
      } else if (source.questionType === 'TEXT' || source.questionType === 'TEXTAREA') {
        const text = item.textValue?.trim() ?? '';
        if (text) {
          map.set(peer.id, { questionId: peer.id, textValue: text });
        }
      }
    }

    const targets = questions.filter((q) => syncFromKeyOf(q) === key);
    const text = item.textValue?.trim() ?? '';
    if (text) {
      for (const target of targets) {
        const mode = metaString(target, 'syncMode') ?? 'mirror';
        const existing = textOf(map.get(target.id));
        if (mode === 'append-if-empty' && existing) continue;
        map.set(target.id, { questionId: target.id, textValue: text });
      }
    }
  }
}

export function expandAnswersWithCrossFieldSync(
  questions: QuestionRow[],
  incoming: AnswerInput[],
): AnswerInput[] {
  const map = new Map<string, AnswerInput>();
  for (const item of incoming) {
    map.set(item.questionId, item);
  }

  for (const item of incoming) {
    expandForQuestion(questions, item.questionId, item, map);
  }

  return [...map.values()];
}
