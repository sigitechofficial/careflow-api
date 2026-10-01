import { HOLISTIC_SECTION_1_EXTRA_QUESTIONS } from '../../prisma/seeds/initial-assessment-holistic-section-1.seed';
import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';

const HOME_ACCESS_FIELD_KEYS = ['livesAlone', 'canAnswerFrontDoor', 'keySafePresentHolistic'] as const;

describe('Holistic §1 home-access grouping', () => {
  const fieldKeyOf = (q: { metadata?: unknown }) =>
    (q.metadata as Record<string, unknown> | undefined)?.fieldKey as string | undefined;
  const byKey = new Map(
    HOLISTIC_SECTION_1_EXTRA_QUESTIONS.filter((q) => fieldKeyOf(q)).map((q) => [fieldKeyOf(q), q]),
  );

  it('keeps a single existing field for each §1.2 home-access question (no duplicates)', () => {
    const keys = HOLISTIC_SECTION_1_EXTRA_QUESTIONS.map((q) => fieldKeyOf(q)).filter(Boolean);
    for (const key of HOME_ACCESS_FIELD_KEYS) {
      expect(keys.filter((k) => k === key)).toHaveLength(1);
    }
    expect(HOLISTIC_SECTION_1_EXTRA_QUESTIONS.filter((q) => q.questionText === 'Key safe present?')).toHaveLength(1);
  });

  it('places the §1.2 home-access questions in the agreed order', () => {
    const ordered = HOME_ACCESS_FIELD_KEYS.map((key) => {
      const row = byKey.get(key);
      expect(row).toBeDefined();
      return row!;
    });
    for (const row of ordered) {
      expect((row.metadata as Record<string, unknown>).specRef).toBe('1.2');
    }
    const sortOrders = ordered.map((row) => row.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
    expect(ordered.map((row) => row.questionText)).toEqual([
      'Does the client live alone?',
      'Is client able to answer front door?',
      'Key safe present?',
    ]);
  });

  it('no longer duplicates the key-safe code / access instructions in §1.2 (owned by §3.5 / §3.6)', () => {
    const texts = HOLISTIC_SECTION_1_EXTRA_QUESTIONS.map((q) => q.questionText as string);
    expect(texts).not.toContain('Key safe code');
    expect(texts).not.toContain('Instructions for gaining access to client’s home');
    expect(byKey.has('keySafeCodeHolistic')).toBe(false);
    expect(byKey.has('homeAccessInstructions')).toBe(false);
  });

  it('keeps the §3.5 door code as the single secure key-safe field', () => {
    const section3 = ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS.find((s) => s.sectionNumber === 3);
    const doorCode = section3?.questions.filter((q) => fieldKeyOf(q) === 'doorCode') ?? [];
    expect(doorCode).toHaveLength(1);
    expect((doorCode[0]!.metadata as Record<string, unknown>).secureField).toBe(true);
    expect(section3?.questions.some((q) => fieldKeyOf(q) === 'keySafeLocation')).toBe(true);
    expect(section3?.questions.some((q) => fieldKeyOf(q) === 'accessInstructions')).toBe(true);
  });
});
