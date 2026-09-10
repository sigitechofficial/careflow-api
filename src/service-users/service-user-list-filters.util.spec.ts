import { describe, expect, it } from 'vitest';
import {
  carePlanListStatusWhere,
  dateOfBirthRangeFromAges,
  initialAssessmentStatusWhere,
  mergeDateOfBirthFilter,
  openLoneWorkerRiskWhere,
} from './service-user-list-filters.util';
import type { Prisma } from '@prisma/client';

describe('dateOfBirthRangeFromAges', () => {
  const today = new Date('2026-09-10T15:30:00.000Z');

  it('maps ageMin to DOB upper bound', () => {
    const { to, from } = dateOfBirthRangeFromAges(65, undefined, today);
    expect(from).toBeUndefined();
    expect(to?.toISOString().startsWith('1961-09-10')).toBe(true);
  });

  it('maps ageMax to DOB lower bound', () => {
    const { from, to } = dateOfBirthRangeFromAges(undefined, 80, today);
    expect(to).toBeUndefined();
    expect(from?.toISOString().startsWith('1945-09-11')).toBe(true);
  });

  it('intersects age and explicit DOB in mergeDateOfBirthFilter', () => {
    const where: Prisma.ServiceUserWhereInput = {};
    mergeDateOfBirthFilter(where, {
      ageMin: 65,
      ageMax: 80,
      dateOfBirthFrom: '1940-01-01',
      dateOfBirthTo: '2000-01-01',
      today,
    });
    const dob = where.dateOfBirth as Prisma.DateTimeNullableFilter;
    expect((dob.gte as Date).toISOString().startsWith('1945-09-11')).toBe(true);
    expect((dob.lte as Date).toISOString().startsWith('1961-09-10')).toBe(true);
  });
});

describe('carePlanListStatusWhere', () => {
  it('filters none as no published plans', () => {
    expect(carePlanListStatusWhere('none')).toEqual({
      carePlanInstances: { none: { status: 'PUBLISHED' } },
    });
  });

  it('filters overdue with nextReviewDueAt before today', () => {
    const where = carePlanListStatusWhere('overdue', new Date('2026-09-10T12:00:00.000Z'));
    expect(where.carePlanInstances).toBeTruthy();
  });
});

describe('initialAssessmentStatusWhere', () => {
  it('maps awaiting_review to SUBMITTED submissions', () => {
    expect(initialAssessmentStatusWhere('awaiting_review')).toEqual({
      initialAssessmentSubmissions: {
        some: {
          deletedAt: null,
          isActive: true,
          status: 'SUBMITTED',
        },
      },
    });
  });
});

describe('openLoneWorkerRiskWhere', () => {
  it('filters open LONE_WORKER risks', () => {
    expect(openLoneWorkerRiskWhere()).toEqual({
      initialAssessmentRiskRecords: {
        some: {
          riskType: 'LONE_WORKER',
          status: 'OPEN',
        },
      },
    });
  });
});
