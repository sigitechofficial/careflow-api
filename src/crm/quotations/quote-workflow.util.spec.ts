import { diffVersions, formatDiffValue } from './quote-workflow.util';

describe('version comparison in plain words', () => {
  it('formats money, days, lengths, dates and options', () => {
    expect(formatDiffValue(1516.667, 'money')).toBe('£1,516.67');
    expect(formatDiffValue([0, 1, 5, 6], 'days')).toBe('Mon, Fri, Sat, Sun');
    expect(formatDiffValue([0, 1, 2, 3, 4, 5, 6], 'days')).toBe('Every day');
    expect(formatDiffValue(30, 'minutes')).toBe('30 min');
    expect(formatDiffValue('2026-11-29', 'date')).toBe('29 Nov 2026');
    expect(formatDiffValue('SLEEPING_NIGHT', 'enum')).toBe('Sleeping night');
    expect(formatDiffValue('SUMMARY', 'enum')).toBe(
      'Total amount & visit slots',
    );
  });

  it('groups visit changes under the visit and gives money differences', () => {
    const rows = diffVersions(
      {
        weeklyTotal: 140,
        patterns: [
          {
            label: 'Midday',
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            chargePerOccurrence: 10,
          },
        ],
      },
      {
        weeklyTotal: 350,
        patterns: [
          {
            label: 'Morning visit',
            daysOfWeek: [0, 1, 5, 6],
            chargePerOccurrence: null,
          },
          { label: 'Evening visit' },
        ],
      },
      [['Price', 'weeklyTotal', 'Weekly total', 'money']],
    );
    expect(rows).toEqual([
      {
        section: 'Price',
        item: null,
        field: 'Weekly total',
        from: '£140.00',
        to: '£350.00',
        change: 'changed',
        delta: 210,
      },
      {
        section: 'Visits',
        item: 'Visit 1 · Morning visit',
        field: 'Name',
        from: 'Midday',
        to: 'Morning visit',
        change: 'changed',
        delta: null,
      },
      {
        section: 'Visits',
        item: 'Visit 1 · Morning visit',
        field: 'Days',
        from: 'Every day',
        to: 'Mon, Fri, Sat, Sun',
        change: 'changed',
        delta: null,
      },
      {
        section: 'Visits',
        item: 'Visit 1 · Morning visit',
        field: 'Price per visit',
        from: '£10.00',
        to: null,
        change: 'changed',
        delta: null,
      },
      {
        section: 'Visits',
        item: 'Visit 2 · Evening visit',
        field: 'Visit',
        from: null,
        to: 'Added',
        change: 'added',
        delta: null,
      },
    ]);
  });
});
