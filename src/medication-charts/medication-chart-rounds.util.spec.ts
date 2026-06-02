import {
  chartEventDueHm,
  formatHm,
  resolveChartSlotEvent,
  resolvePackRowDueTime,
  resolveScheduleSlot,
  roundNameFromDueTime,
  indexRoundsByTime,
} from './medication-chart-rounds.util';

describe('medication-chart-rounds.util', () => {
  const rounds = [
    {
      id: '1',
      name: 'Morning',
      code: 'MORNING',
      time: '08:00',
      windowStart: '07:00',
      windowEnd: '10:00',
      sortOrder: 1,
    },
    {
      id: '2',
      name: 'Evening',
      code: 'EVENING',
      time: '18:00',
      windowStart: '17:00',
      windowEnd: '20:00',
      sortOrder: 4,
    },
  ];

  it('maps due time to round name when round relation missing', () => {
    expect(roundNameFromDueTime('08:00')).toBe('Morning');
    expect(roundNameFromDueTime('8:00')).toBe('Morning');
  });

  it('resolves schedule slot from due time', () => {
    const byTime = indexRoundsByTime(rounds);
    const slot = resolveScheduleSlot({ round: null, dueTime: '18:00', dueVisitName: null }, byTime, rounds);
    expect(slot.timeSlot).toBe('Evening');
    expect(slot.dueTime).toBe('18:00');
    expect(slot.roundWindowStart).toBe('17:00');
  });

  it('maps due time inside administration window to round name', () => {
    const byTime = indexRoundsByTime(rounds);
    const slot = resolveScheduleSlot({ round: null, dueTime: '07:00', dueVisitName: null }, byTime, rounds);
    expect(slot.timeSlot).toBe('Morning');
    expect(slot.dueTime).toBe('07:00');
    expect(slot.roundWindowStart).toBe('07:00');
    expect(slot.roundWindowEnd).toBe('10:00');
  });

  it('formats hm consistently', () => {
    expect(formatHm('8:05')).toBe('08:05');
  });

  it('resolvePackRowDueTime uses timeSlot when dueTime is missing', () => {
    expect(resolvePackRowDueTime({ dueTime: null, timeSlot: 'Morning' })).toBe('08:00');
    expect(resolvePackRowDueTime({ dueTime: null, timeSlot: 'Administration' })).toBeNull();
  });

  it('resolveChartSlotEvent matches pack compartment rows by due time', () => {
    const eventsBySlotDay = new Map<string, { id: string }>();
    const eventsByMedDueDay = new Map<string, { id: string }>();
    const event = { id: 'evt-1' };
    eventsBySlotDay.set('med-1:none:2026-06-02', event);
    eventsByMedDueDay.set('med-1:08:00:2026-06-02', event);

    const found = resolveChartSlotEvent(
      { eventsBySlotDay, eventsByMedDueDay },
      'med-1',
      'pack-compartment-abc',
      '08:00',
      '2026-06-02',
    );
    expect(found?.id).toBe('evt-1');
  });

  it('chartEventDueHm reads due time from scheduledDateTime', () => {
    expect(
      chartEventDueHm({ scheduledDateTime: new Date('2026-06-02T08:00:00.000Z') }),
    ).toBe('08:00');
  });
});
