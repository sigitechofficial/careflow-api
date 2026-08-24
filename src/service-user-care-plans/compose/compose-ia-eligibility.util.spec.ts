import { InitialAssessmentStatus } from '@prisma/client';
import { splitLatestAndPreviousAssessments } from './compose-ia-eligibility.util';

describe('splitLatestAndPreviousAssessments', () => {
  it('selects the latest SUBMITTED or REVIEWED assessment by submittedAt', () => {
    const { latest, previous } = splitLatestAndPreviousAssessments([
      {
        id: 'draft',
        status: InitialAssessmentStatus.DRAFT,
        submittedAt: new Date('2026-08-20T12:00:00.000Z'),
        updatedAt: new Date('2026-08-20T12:00:00.000Z'),
      },
      {
        id: 'old-reviewed',
        status: InitialAssessmentStatus.REVIEWED,
        submittedAt: new Date('2026-05-11T09:00:00.000Z'),
        updatedAt: new Date('2026-05-11T09:00:00.000Z'),
      },
      {
        id: 'latest-submitted',
        status: InitialAssessmentStatus.SUBMITTED,
        submittedAt: new Date('2026-08-19T07:36:44.000Z'),
        updatedAt: new Date('2026-08-19T07:36:44.000Z'),
      },
      {
        id: 'cancelled',
        status: InitialAssessmentStatus.CANCELLED,
        submittedAt: new Date('2026-08-21T00:00:00.000Z'),
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      },
    ]);

    expect(latest?.id).toBe('latest-submitted');
    expect(previous.map((row) => row.id)).toEqual(['old-reviewed']);
  });

  it('prefers REVIEWED when it is the newest eligible assessment', () => {
    const { latest } = splitLatestAndPreviousAssessments([
      {
        id: 'submitted',
        status: InitialAssessmentStatus.SUBMITTED,
        submittedAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: 'reviewed',
        status: InitialAssessmentStatus.REVIEWED,
        submittedAt: new Date('2026-08-18T00:00:00.000Z'),
        updatedAt: new Date('2026-08-18T00:00:00.000Z'),
      },
    ]);
    expect(latest?.id).toBe('reviewed');
  });

  it('ignores DRAFT and IN_PROGRESS assessments as current source', () => {
    const { latest, previous } = splitLatestAndPreviousAssessments([
      {
        id: 'draft',
        status: InitialAssessmentStatus.DRAFT,
        submittedAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
      {
        id: 'in-progress',
        status: InitialAssessmentStatus.IN_PROGRESS,
        submittedAt: null,
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      },
    ]);
    expect(latest).toBeNull();
    expect(previous).toEqual([]);
  });

  it('ignores ARCHIVED assessments as current source and previous history', () => {
    const { latest, previous } = splitLatestAndPreviousAssessments([
      {
        id: 'archived-newest',
        status: InitialAssessmentStatus.ARCHIVED,
        submittedAt: new Date('2026-08-21T12:00:00.000Z'),
        updatedAt: new Date('2026-08-21T12:00:00.000Z'),
      },
      {
        id: 'latest-submitted',
        status: InitialAssessmentStatus.SUBMITTED,
        submittedAt: new Date('2026-08-19T07:36:44.000Z'),
        updatedAt: new Date('2026-08-19T07:36:44.000Z'),
      },
      {
        id: 'old-reviewed',
        status: InitialAssessmentStatus.REVIEWED,
        submittedAt: new Date('2026-05-11T09:00:00.000Z'),
        updatedAt: new Date('2026-05-11T09:00:00.000Z'),
      },
    ]);

    expect(latest?.id).toBe('latest-submitted');
    expect(previous.map((row) => row.id)).toEqual(['old-reviewed']);
    expect(previous.map((row) => row.id)).not.toContain('archived-newest');
  });

  it('does not use an ARCHIVED-only list as current or previous suggestion source', () => {
    const { latest, previous } = splitLatestAndPreviousAssessments([
      {
        id: 'archived-only',
        status: InitialAssessmentStatus.ARCHIVED,
        submittedAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ]);
    expect(latest).toBeNull();
    expect(previous).toEqual([]);
  });
});
