import { Prisma } from '@prisma/client';

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

type ShowWhenRule = {
  gateTextIncludes?: string;
  gateFieldKey?: string;
  yes?: boolean;
  no?: boolean;
};

/** Follow-up questions that depend on a prior Yes/No gate (mirrors care-admin conditional-visibility). */
const INFERRED_RULES: { questionTextIncludes: string; when: ShowWhenRule }[] = [
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
  {
    questionTextIncludes: 'pain trigger',
    when: { gateTextIncludes: 'pain or distress identified', yes: true },
  },
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
  {
    questionTextIncludes: 'skin condition comment',
    when: { gateTextIncludes: 'skin condition or concern', yes: true },
  },
  {
    questionTextIncludes: 'ulcers or wounds comment',
    when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true },
  },
  {
    questionTextIncludes: 'wound type',
    when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true },
  },
  {
    questionTextIncludes: 'has wound assessment been completed',
    when: { gateTextIncludes: 'currently has ulcers or wounds', yes: true },
  },
  {
    questionTextIncludes: 'pressure equipment details',
    when: { gateTextIncludes: 'pressure relieving equipment in use', yes: true },
  },
  { questionTextIncludes: 'equipment ordered', when: { gateTextIncludes: 'further pressure equipment required', yes: true } },
  { questionTextIncludes: 'date equipment ordered', when: { gateTextIncludes: 'equipment ordered', yes: true } },
  { questionTextIncludes: 'prosthesis care notes', when: { gateTextIncludes: 'uses prosthesis', yes: true } },
  { questionTextIncludes: 'number of falls', when: { gateTextIncludes: 'falls in last', yes: true } },
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
  {
    questionTextIncludes: 'safeguarding referral made',
    when: { gateTextIncludes: 'local authority safeguarding referral required', yes: true },
  },
  {
    questionTextIncludes: 'safeguarding referral date',
    when: { gateTextIncludes: 'safeguarding referral made', yes: true },
  },
  {
    questionTextIncludes: 'representative name',
    when: { gateTextIncludes: 'representative involved', yes: true },
  },
  {
    questionTextIncludes: 'falls assessment completed',
    when: { gateTextIncludes: 'falls in last', yes: true },
  },
];

function metaOf(q: QuestionRow): Record<string, unknown> | null {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return null;
  return q.metadata as Record<string, unknown>;
}

function fieldKeyOf(q: QuestionRow): string | undefined {
  const key = metaOf(q)?.fieldKey;
  return typeof key === 'string' ? key : undefined;
}

function parseMetadataShowWhen(q: QuestionRow): ShowWhenRule | null {
  const raw = metaOf(q)?.showWhen;
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

function findByTextIncludes(questions: QuestionRow[], fragment: string): QuestionRow | undefined {
  const needle = fragment.toLowerCase();
  return questions.find((q) => q.questionText.toLowerCase().includes(needle));
}

function findByFieldKey(questions: QuestionRow[], fieldKey: string): QuestionRow | undefined {
  return questions.find((q) => fieldKeyOf(q) === fieldKey);
}

function isYes(map: Map<string, AnswerRow>, q?: QuestionRow): boolean {
  if (!q) return false;
  const a = map.get(q.id);
  return a?.checked === true || a?.booleanValue === true;
}

function isExplicitNo(map: Map<string, AnswerRow>, q?: QuestionRow): boolean {
  if (!q) return false;
  const a = map.get(q.id);
  return a?.checked === false || a?.booleanValue === false;
}

function gateAnswerMatches(
  questions: QuestionRow[],
  rule: ShowWhenRule,
  map: Map<string, AnswerRow>,
): boolean {
  const gate = rule.gateFieldKey
    ? findByFieldKey(questions, rule.gateFieldKey)
    : rule.gateTextIncludes
      ? findByTextIncludes(questions, rule.gateTextIncludes)
      : undefined;
  if (!gate) return true;
  if (rule.yes) return isYes(map, gate);
  if (rule.no) return isExplicitNo(map, gate);
  return true;
}

function inferredRuleForQuestion(q: QuestionRow): ShowWhenRule | null {
  const needle = q.questionText.toLowerCase();
  for (const row of INFERRED_RULES) {
    if (needle.includes(row.questionTextIncludes)) return row.when;
  }
  return null;
}

export function shouldShowQuestionForValidation(
  q: QuestionRow,
  questions: QuestionRow[],
  map: Map<string, AnswerRow>,
): boolean {
  const specRef = metaOf(q)?.specRef;
  if (specRef === '2.mca') {
    const requiredQ = findByFieldKey(questions, 'mcaRequired') ?? findByTextIncludes(questions, 'mca required');
    if (requiredQ && !isYes(map, requiredQ)) return false;
  }

  const metaRule = parseMetadataShowWhen(q);
  if (metaRule) return gateAnswerMatches(questions, metaRule, map);

  const inferred = inferredRuleForQuestion(q);
  if (inferred) return gateAnswerMatches(questions, inferred, map);

  if (q.questionText.toLowerCase().includes('mca completed')) {
    const capacityQ = questions.find((x) => metaOf(x)?.specRef === '2.4');
    if (capacityQ && isExplicitNo(map, capacityQ)) return true;
  }

  const fieldKey = fieldKeyOf(q);
  if (fieldKey && ['assessorName', 'assessorRole', 'assessorSignDate'].includes(fieldKey)) {
    return q.section.sectionNumber === 14;
  }

  return true;
}
