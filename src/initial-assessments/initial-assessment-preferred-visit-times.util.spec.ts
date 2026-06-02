import {
  formatPreferredVisitTimesForExport,
  preferredVisitTimesIsAnswered,
} from './initial-assessment-preferred-visit-times.util';

describe('initial-assessment-preferred-visit-times.util', () => {
  it('formats structured selections with administration round times', () => {
    const text = formatPreferredVisitTimesForExport(
      { MORNING: { selected: true, from: '08:00', to: '10:30', roundName: 'Morning' } },
      null,
    );
    expect(text).toBe('Morning (08:00–10:30)');
  });

  it('supports legacy string array values', () => {
    const text = formatPreferredVisitTimesForExport(['morning'], null);
    expect(text).toBe('Morning');
  });

  it('detects answered structured values', () => {
    expect(preferredVisitTimesIsAnswered({ MORNING: { selected: true } })).toBe(true);
    expect(preferredVisitTimesIsAnswered({ MORNING: { selected: false } })).toBe(false);
  });
});
