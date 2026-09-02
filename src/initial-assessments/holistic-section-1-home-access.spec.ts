import { HOLISTIC_SECTION_1_EXTRA_QUESTIONS } from '../../prisma/seeds/initial-assessment-holistic-section-1.seed';

const HOME_ACCESS_FIELD_KEYS = [
  'livesAlone',
  'canAnswerFrontDoor',
  'keySafePresentHolistic',
  'keySafeCodeHolistic',
  'homeAccessInstructions',
] as const;

describe('Holistic §1 home-access grouping', () => {
  const byKey = new Map(
    HOLISTIC_SECTION_1_EXTRA_QUESTIONS.filter((q) => q.metadata.fieldKey).map((q) => [
      q.metadata.fieldKey,
      q,
    ]),
  );

  it('keeps a single existing field for each home-access question (no duplicates)', () => {
    const keys = HOLISTIC_SECTION_1_EXTRA_QUESTIONS.map((q) => q.metadata.fieldKey).filter(Boolean);
    for (const key of HOME_ACCESS_FIELD_KEYS) {
      expect(keys.filter((k) => k === key)).toHaveLength(1);
    }
    expect(HOLISTIC_SECTION_1_EXTRA_QUESTIONS.filter((q) => q.questionText === 'Key safe present?')).toHaveLength(1);
    expect(HOLISTIC_SECTION_1_EXTRA_QUESTIONS.filter((q) => q.questionText === 'Key safe code')).toHaveLength(1);
  });

  it('places the five home-access questions in spec 1.2 in the agreed order', () => {
    const ordered = HOME_ACCESS_FIELD_KEYS.map((key) => {
      const row = byKey.get(key);
      expect(row).toBeDefined();
      return row!;
    });

    for (const row of ordered) {
      expect(row.metadata.specRef).toBe('1.2');
    }

    const sortOrders = ordered.map((row) => row.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
    expect(ordered.map((row) => row.questionText)).toEqual([
      'Does the client live alone?',
      'Is client able to answer front door?',
      'Key safe present?',
      'Key safe code',
      'Instructions for gaining access to client’s home',
    ]);
  });

  it('keeps Key safe code as a secure follow-up of the existing Keysafe Yes/No field', () => {
    const code = byKey.get('keySafeCodeHolistic');
    expect(code?.metadata.secureField).toBe(true);
    expect(code?.metadata.fieldKey).toBe('keySafeCodeHolistic');
    expect(byKey.get('keySafePresentHolistic')?.questionType).toBe('YES_NO');
  });
});
