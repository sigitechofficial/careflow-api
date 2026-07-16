import {
  classifyArrival,
  classifyDeparture,
  classifyDuration,
  classifyMissed,
  deriveArrivalWindow,
  ECM_PLATFORM_DEFAULTS,
  evaluateEcmTiming,
} from './ecm-timing.util';

describe('ecm-timing.util', () => {
  const plannedStart = new Date('2026-07-16T08:00:00.000Z');
  const plannedEnd = new Date('2026-07-16T09:00:00.000Z');
  const thresholds = { ...ECM_PLATFORM_DEFAULTS };

  it('computes four independent variances', () => {
    const result = evaluateEcmTiming({
      plannedStart,
      plannedEnd,
      actualStart: new Date('2026-07-16T08:12:00.000Z'),
      actualEnd: new Date('2026-07-16T08:50:00.000Z'),
      thresholds,
    });
    expect(result.startVarianceMinutes).toBe(12);
    expect(result.endVarianceMinutes).toBe(-10);
    expect(result.actualDurationMinutes).toBe(38);
    expect(result.durationVarianceMinutes).toBe(-22);
    expect(result.plannedDurationMinutes).toBe(60);
  });

  it('classifies late but full duration separately from short', () => {
    const lateFull = evaluateEcmTiming({
      plannedStart,
      plannedEnd,
      actualStart: new Date('2026-07-16T08:20:00.000Z'),
      actualEnd: new Date('2026-07-16T09:20:00.000Z'),
      thresholds,
    });
    expect(lateFull.arrivalClassification).toBe('LATE_ARRIVAL');
    expect(lateFull.durationClassification).toBe('ON_TIME');
    expect(lateFull.timingSummary.toLowerCase()).toContain('late');
  });

  it('classifies early arrival via tolerance', () => {
    expect(
      classifyArrival({
        startVarianceMinutes: -15,
        actualStart: new Date('2026-07-16T07:45:00.000Z'),
        plannedStart,
        lateArrivalToleranceMinutes: 15,
        veryLateThresholdMinutes: 30,
        earlyArrivalToleranceMinutes: 10,
      }),
    ).toBe('EARLY_ARRIVAL');
  });

  it('classifies very late after higher threshold', () => {
    expect(
      classifyArrival({
        startVarianceMinutes: 35,
        actualStart: new Date('2026-07-16T08:35:00.000Z'),
        plannedStart,
        lateArrivalToleranceMinutes: 15,
        veryLateThresholdMinutes: 30,
        earlyArrivalToleranceMinutes: 10,
      }),
    ).toBe('VERY_LATE_ARRIVAL');
  });

  it('uses arrival window when provided', () => {
    const window = deriveArrivalWindow(plannedStart, 10, 15);
    expect(
      classifyArrival({
        startVarianceMinutes: 0,
        actualStart: new Date('2026-07-16T07:45:00.000Z'),
        plannedStart,
        earliestPermittedStart: window.earliest,
        latestPermittedStart: window.latest,
        lateArrivalToleranceMinutes: 15,
        veryLateThresholdMinutes: 30,
        earlyArrivalToleranceMinutes: 10,
      }),
    ).toBe('EARLY_ARRIVAL');

    expect(
      classifyArrival({
        startVarianceMinutes: 7,
        actualStart: new Date('2026-07-16T08:07:00.000Z'),
        plannedStart,
        earliestPermittedStart: window.earliest,
        latestPermittedStart: window.latest,
        lateArrivalToleranceMinutes: 15,
        veryLateThresholdMinutes: 30,
        earlyArrivalToleranceMinutes: 10,
      }),
    ).toBe('ON_TIME');
  });

  it('classifies early departure and short/long/excessive duration', () => {
    expect(
      classifyDeparture({
        endVarianceMinutes: -20,
        lateArrivalToleranceMinutes: 15,
      }),
    ).toBe('EARLY_DEPARTURE');

    expect(
      classifyDuration({
        plannedDurationMinutes: 60,
        actualDurationMinutes: 40,
        durationVarianceMinutes: -20,
        shortVisitToleranceMinutes: 5,
        shortVisitTolerancePercent: 10,
        longVisitToleranceMinutes: 15,
        excessiveOverrunMinutes: 45,
      }),
    ).toBe('SHORT_VISIT');

    expect(
      classifyDuration({
        plannedDurationMinutes: 60,
        actualDurationMinutes: 80,
        durationVarianceMinutes: 20,
        shortVisitToleranceMinutes: 5,
        shortVisitTolerancePercent: 10,
        longVisitToleranceMinutes: 15,
        excessiveOverrunMinutes: 45,
      }),
    ).toBe('LONG_VISIT');

    expect(
      classifyDuration({
        plannedDurationMinutes: 60,
        actualDurationMinutes: 120,
        durationVarianceMinutes: 60,
        shortVisitToleranceMinutes: 5,
        shortVisitTolerancePercent: 10,
        longVisitToleranceMinutes: 15,
        excessiveOverrunMinutes: 45,
      }),
    ).toBe('EXCESSIVE_OVERRUN');
  });

  it('separates potential missed from confirmed / false alert / disputed', () => {
    const now = new Date('2026-07-16T09:30:00.000Z');
    expect(
      classifyMissed({
        actualStart: null,
        plannedStart,
        missedVisitThresholdMinutes: 60,
        now,
      }),
    ).toBe('POTENTIAL_MISSED');

    expect(
      classifyMissed({
        actualStart: null,
        plannedStart,
        missedVisitThresholdMinutes: 60,
        now,
        confirmedMissed: true,
      }),
    ).toBe('CONFIRMED_MISSED');

    expect(
      classifyMissed({
        actualStart: null,
        plannedStart,
        missedVisitThresholdMinutes: 60,
        now,
        falseEcmAlert: true,
      }),
    ).toBe('FALSE_ECM_ALERT');

    expect(
      classifyMissed({
        actualStart: null,
        plannedStart,
        missedVisitThresholdMinutes: 60,
        now,
        disputed: true,
      }),
    ).toBe('DISPUTED');
  });

  it('supports overnight planned duration across midnight', () => {
    const result = evaluateEcmTiming({
      plannedStart: new Date('2026-07-16T20:00:00.000Z'),
      plannedEnd: new Date('2026-07-17T08:00:00.000Z'),
      actualStart: new Date('2026-07-16T20:05:00.000Z'),
      actualEnd: new Date('2026-07-17T08:00:00.000Z'),
      thresholds,
    });
    expect(result.plannedDurationMinutes).toBe(12 * 60);
    expect(result.arrivalClassification).toBe('ON_TIME');
    expect(result.durationClassification).toBe('ON_TIME');
  });
});
