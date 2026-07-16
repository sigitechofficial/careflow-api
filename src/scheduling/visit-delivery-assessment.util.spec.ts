import {
  assessVisitDelivery,
  VISIT_PLANNED_SHORT_MINUTES,
} from './visit-delivery-assessment.util';

describe('assessVisitDelivery', () => {
  const base = {
    jobStatus: 'ALLOCATED',
    visitStatus: 'PLANNED',
    allocatedCarers: 1,
    requiredCarers: 1,
    plannedStartIso: '2026-07-16T08:00:00.000Z',
    plannedEndIso: '2026-07-16T09:00:00.000Z',
    hasVisitPlanSlot: true,
  };

  it('classifies assigned scheduled visits', () => {
    const result = assessVisitDelivery(base);
    expect(result.lifecycleStatus).toBe('ASSIGNED');
    expect(result.timingStatus).toBe('NOT_ASSESSED');
  });

  it('classifies on-time check-in', () => {
    const result = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T08:05:00.000Z',
      actualEndIso: '2026-07-16T09:00:00.000Z',
    });
    expect(result.lifecycleStatus).toBe('COMPLETED');
    expect(result.timingStatus).toBe('ON_TIME');
  });

  it('classifies late start and critically late', () => {
    const late = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T08:20:00.000Z',
      actualEndIso: '2026-07-16T09:20:00.000Z',
    });
    expect(late.timingStatus).toBe('LATE_START');
    expect(late.requiresExceptionReason).toBe(true);

    const critical = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T08:50:00.000Z',
      actualEndIso: '2026-07-16T09:50:00.000Z',
    });
    expect(critical.timingStatus).toBe('CRITICALLY_LATE');
  });

  it('flags planned short visits under 30 minutes', () => {
    const result = assessVisitDelivery({
      ...base,
      plannedEndIso: '2026-07-16T08:20:00.000Z',
    });
    expect(result.plannedDurationMinutes).toBeLessThan(VISIT_PLANNED_SHORT_MINUTES);
    expect(result.durationExceptions).toContain('PLANNED_SHORT_VISIT');
  });

  it('flags overrun and actual short visits', () => {
    const overrun = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T08:00:00.000Z',
      actualEndIso: '2026-07-16T09:30:00.000Z',
    });
    expect(overrun.durationExceptions).toContain('OVERRUN');

    const short = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T08:00:00.000Z',
      actualEndIso: '2026-07-16T08:30:00.000Z',
    });
    expect(short.durationExceptions).toContain('ACTUAL_SHORT_VISIT');
  });

  it('detects en route and in progress', () => {
    const enRoute = assessVisitDelivery({
      ...base,
      latestAttendanceEventType: 'EN_ROUTE',
    });
    expect(enRoute.lifecycleStatus).toBe('EN_ROUTE');

    const inProgress = assessVisitDelivery({
      ...base,
      jobStatus: 'IN_PROGRESS',
      visitStatus: 'STARTED',
      actualStartIso: '2026-07-16T08:02:00.000Z',
    });
    expect(inProgress.lifecycleStatus).toBe('IN_PROGRESS');
  });

  it('flags zero and invalid duration', () => {
    const zero = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T08:00:00.000Z',
      actualEndIso: '2026-07-16T08:00:00.000Z',
    });
    expect(zero.durationExceptions).toContain('ZERO_DURATION');

    const invalid = assessVisitDelivery({
      ...base,
      visitStatus: 'COMPLETED',
      jobStatus: 'COMPLETED',
      actualStartIso: '2026-07-16T09:00:00.000Z',
      actualEndIso: '2026-07-16T08:00:00.000Z',
    });
    expect(invalid.durationExceptions).toContain('NEGATIVE_OR_INVALID_DURATION');
  });
});
