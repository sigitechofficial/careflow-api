import { sharedLinkBurstNote, sharedLinkBursts } from './survey-shared-link-bursts';

const days = (o: Record<string, number>) => new Map(Object.entries(o));

describe('shared-link bursts (counts by day only)', () => {
  it('flags a day with far more answers than the others', () => {
    expect(sharedLinkBursts(days({ '2026-11-02': 3, '2026-11-03': 4, '2026-11-04': 40, '2026-11-05': 2 }))).toEqual([{ day: '2026-11-04', answers: 40 }]);
  });

  it('a steady flow, or a small day, is not flagged', () => {
    expect(sharedLinkBursts(days({ '2026-11-02': 12, '2026-11-03': 15, '2026-11-04': 11 }))).toEqual([]);
    expect(sharedLinkBursts(days({ '2026-11-02': 1, '2026-11-03': 9 }))).toEqual([]);
  });

  it('answers on one day only (a team meeting) are flagged only when there are a great many', () => {
    expect(sharedLinkBursts(days({ '2026-11-04': 25 }))).toEqual([]);
    expect(sharedLinkBursts(days({ '2026-11-04': 30 }))).toEqual([{ day: '2026-11-04', answers: 30 }]);
  });

  it('the note names the days in words and says what it might mean', () => {
    expect(sharedLinkBurstNote([{ day: '2026-11-04', answers: 40 }])).toMatch(/40 on 4 Nov 2026.*more than once/);
    expect(sharedLinkBurstNote([])).toBeNull();
  });
});
