import {
  createMarMonthStatsAccumulator,
  dateInMarCompletionWindow,
  finalizeMarMonthStats,
  isMarGivenOutcomeCode,
  isMarNotGivenOutcomeCode,
  marCompletionThroughDate,
  recordScheduledMarCompletion,
} from './medication-mar-completion.util';

describe('marCompletionThroughDate', () => {
  it('uses today when inside the period', () => {
    expect(marCompletionThroughDate('2026-05-01', '2026-05-31', '2026-05-28')).toBe(
      '2026-05-28',
    );
  });

  it('uses period end when viewing a past period', () => {
    expect(marCompletionThroughDate('2026-05-01', '2026-05-31', '2026-06-15')).toBe(
      '2026-05-31',
    );
  });
});

describe('dateInMarCompletionWindow', () => {
  it('excludes future days in the current month', () => {
    expect(
      dateInMarCompletionWindow('2026-05-30', '2026-05-01', '2026-05-31', '2026-05-28'),
    ).toBe(false);
    expect(
      dateInMarCompletionWindow('2026-05-28', '2026-05-01', '2026-05-31', '2026-05-28'),
    ).toBe(true);
  });

  it('excludes entire future periods', () => {
    expect(
      dateInMarCompletionWindow('2026-06-01', '2026-06-01', '2026-06-30', '2026-05-28'),
    ).toBe(false);
  });
});

describe('recordScheduledMarCompletion', () => {
  it('computes completion percent from documented vs still open only', () => {
    const acc = createMarMonthStatsAccumulator();
    recordScheduledMarCompletion(acc, { cellState: 'recorded', statusCode: 'G' });
    recordScheduledMarCompletion(acc, { cellState: 'recorded', statusCode: 'R' });
    recordScheduledMarCompletion(acc, { cellState: 'due', statusCode: 'Due' });
    const stats = finalizeMarMonthStats(acc, '2026-05-01', '2026-05-31', '2026-05-31');
    expect(stats.documented).toBe(2);
    expect(stats.stillOpen).toBe(1);
    expect(stats.given).toBe(1);
    expect(stats.notGiven).toBe(1);
    expect(stats.marCompletionPercent).toBe(66.7);
    expect(stats.compliancePercent).toBe(66.7);
  });
});

describe('outcome code helpers', () => {
  it('classifies given codes', () => {
    expect(isMarGivenOutcomeCode('G')).toBe(true);
    expect(isMarNotGivenOutcomeCode('G')).toBe(false);
  });

  it('classifies refused and missed', () => {
    expect(isMarNotGivenOutcomeCode('R')).toBe(true);
    expect(isMarNotGivenOutcomeCode('N')).toBe(true);
    expect(isMarNotGivenOutcomeCode('PG')).toBe(true);
    expect(isMarGivenOutcomeCode('PG')).toBe(false);
  });
});
