import { NotFoundException } from '@nestjs/common';
import {
  CqcDashboardService,
  keyQuestionRatings,
  monthsFrom,
} from './cqc-dashboard.service';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ADMIN = {
  id: 'u-1',
  roles: ['Super Admin'],
  permissions: [],
  assignedLocationIds: null,
} as any;
const EVIDENCE_ONLY = {
  id: 'u-2',
  roles: ['Care Coordinator'],
  permissions: ['cqc_evidence.read'],
  assignedLocationIds: ['loc-a'],
} as any;

const RESULT = {
  overall: 'GOOD',
  keyQuestions: [
    { keyQuestionCode: 'SAFE', rating: 'REQUIRES_IMPROVEMENT', percent: 62.5 },
    { keyQuestionCode: 'WELL_LED', rating: 'GOOD', percent: 75 },
  ],
};

function setup() {
  const prisma: any = {
    cqcEvidence: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    cqcMockInspection: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm2',
          title: 'Nov',
          completedAt: day('2026-11-17'),
          locationId: 'loc-a',
          result: RESULT,
        },
        {
          id: 'm1',
          title: 'May',
          completedAt: day('2026-05-10'),
          locationId: 'loc-a',
          result: { overall: 'REQUIRES_IMPROVEMENT', keyQuestions: [] },
        },
      ]),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'COMPLETED', _count: { _all: 2 } },
        { status: 'IN_PROGRESS', _count: { _all: 1 } },
        { status: 'CANCELLED', _count: { _all: 1 } },
      ]),
    },
    cqcMockInspectionAction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'a1',
          title: 'Share lessons',
          status: 'OPEN',
          dueAt: day('2026-11-01'),
          completedAt: null,
          inspectionId: 'm2',
          statement: { title: 'Learning culture' },
        },
        {
          id: 'a2',
          title: 'Train staff',
          status: 'OPEN',
          dueAt: day('2026-11-27'),
          completedAt: null,
          inspectionId: 'm2',
          statement: null,
        },
        {
          id: 'a3',
          title: 'Done one',
          status: 'DONE',
          dueAt: null,
          completedAt: day('2026-11-10'),
          inspectionId: 'm2',
          statement: null,
        },
      ]),
    },
    cqcNotification: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'DRAFT', _count: { _all: 1 } },
        { status: 'SUBMITTED', _count: { _all: 3 } },
      ]),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'n1',
          referenceNumber: 'CQCN-2026-000001',
          type: 'DEATH',
          status: 'DRAFT',
          dueAt: day('2026-11-20'),
        },
      ]),
    },
    location: {
      findMany: jest.fn().mockResolvedValue([{ id: 'loc-a', name: 'Croydon' }]),
    },
  };
  const orgScope: any = {
    fromRequestUser: (u: any) => ({
      locationIds: u.assignedLocationIds ?? null,
    }),
    assertLocationAccess: (scope: any, id: string) => {
      if (scope.locationIds && !scope.locationIds.includes(id))
        throw new NotFoundException('Resource not found');
    },
  };
  const evidence: any = {
    overview: jest.fn().mockResolvedValue({
      data: {
        totals: {
          statements: 34,
          covered: 20,
          gaps: 14,
          currentEvidence: 13,
          reviewOverdue: 1,
          unverifiedTitles: 0,
        },
        keyQuestions: [
          {
            code: 'SAFE',
            title: 'Safe',
            statementCount: 8,
            coveredCount: 5,
            gapCount: 3,
            statements: [],
          },
        ],
      },
    }),
    visibleWhere: jest.fn().mockResolvedValue({}),
    branchWhere: jest.fn().mockReturnValue({}),
  };
  return {
    service: new CqcDashboardService(prisma, orgScope, evidence),
    prisma,
    evidence,
  };
}

describe('CqcDashboardService.dashboard', () => {
  it('brings together evidence, the latest mock ratings, actions and notifications', async () => {
    const { service } = setup();
    const { data } = await service.dashboard(ADMIN, {}, NOW);
    expect(data.evidence?.totals).toMatchObject({
      covered: 20,
      gaps: 14,
      addedLast30Days: 2,
    });
    expect(data.evidence?.keyQuestions[0]).toEqual({
      code: 'SAFE',
      title: 'Safe',
      statementCount: 8,
      coveredCount: 5,
      gapCount: 3,
    });
    expect(data.mock?.latest).toMatchObject({ id: 'm2', overall: 'GOOD' });
    expect(data.mock?.latest?.keyQuestions[0]).toEqual({
      code: 'SAFE',
      rating: 'REQUIRES_IMPROVEMENT',
      percent: 62.5,
    });
    expect(data.mock?.previous).toMatchObject({
      id: 'm1',
      overall: 'REQUIRES_IMPROVEMENT',
    });
    expect(data.mock?.counts).toEqual({
      total: 4,
      completed: 2,
      inProgress: 1,
      cancelled: 1,
    });
    expect(data.mock?.inProgress).toBe(1);
    expect(data.mock?.actions).toMatchObject({
      open: 2,
      overdue: 1,
      dueThisWeek: 1,
      doneLast30Days: 1,
    });
    expect(data.mock?.actions.next[0]).toMatchObject({
      title: 'Share lessons',
      overdue: true,
      statementTitle: 'Learning culture',
    });
    expect(data.notifications).toMatchObject({
      open: 1,
      overdue: 1,
      byStatus: { DRAFT: 1, SUBMITTED: 3 },
    });
  });

  it('lists what needs attention in plain words', async () => {
    const { service } = setup();
    const { data } = await service.dashboard(ADMIN, {}, NOW);
    expect(data.attention.map((a) => a.kind)).toEqual([
      'EVIDENCE_GAPS',
      'EVIDENCE_REVIEW_OVERDUE',
      'ACTIONS_OVERDUE',
      'NOTIFICATIONS_OVERDUE',
    ]);
    expect(data.attention[0].message).toBe(
      '14 quality statements have no current evidence.',
    );
    expect(data.attention[1].message).toBe(
      '1 piece of evidence is past its review date.',
    );
  });

  it('flags when no mock inspection has been completed for six months', async () => {
    const { service, prisma } = setup();
    prisma.cqcMockInspection.findMany.mockResolvedValue([
      {
        id: 'm1',
        title: 'Old',
        completedAt: day('2026-03-01'),
        locationId: null,
        result: RESULT,
      },
    ]);
    const { data } = await service.dashboard(ADMIN, {}, NOW);
    expect(
      data.attention.find((a) => a.kind === 'NO_RECENT_MOCK')?.message,
    ).toMatch(/more than 6 months/);
  });

  it('shows only the parts the person may see, and keeps them to their branches', async () => {
    const { service, prisma } = setup();
    const { data } = await service.dashboard(EVIDENCE_ONLY, {}, NOW);
    expect(data.evidence).not.toBeNull();
    expect(data.mock).toBeNull();
    expect(data.notifications).toBeNull();
    expect(prisma.cqcMockInspection.findMany).not.toHaveBeenCalled();
    await expect(
      service.dashboard(EVIDENCE_ONLY, { locationId: 'loc-b' }, NOW),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CqcDashboardService.reports', () => {
  it('reports by month: ratings of completed mock inspections, evidence added, actions and notifications', async () => {
    const { service, prisma } = setup();
    prisma.cqcEvidence.findMany
      .mockResolvedValueOnce([
        { createdAt: day('2026-10-05'), sourceType: 'AUDIT' },
        { createdAt: day('2026-11-02'), sourceType: 'SURVEY_RESULT' },
      ])
      .mockResolvedValueOnce([
        { sourceType: 'AUDIT', categoryCode: 'PROCESSES' },
        { sourceType: 'AUDIT', categoryCode: 'OUTCOMES' },
        { sourceType: 'COMPLAINT', categoryCode: 'PEOPLES_EXPERIENCE' },
      ]);
    prisma.cqcMockInspection.findMany.mockResolvedValue([
      {
        id: 'm2',
        title: 'Nov',
        completedAt: day('2026-11-17'),
        locationId: 'loc-a',
        result: RESULT,
      },
    ]);
    prisma.cqcMockInspectionAction.findMany.mockResolvedValue([
      {
        createdAt: day('2026-11-17'),
        completedAt: day('2026-11-20'),
        dueAt: day('2026-11-19'),
        status: 'DONE',
      },
      {
        createdAt: day('2026-10-01'),
        completedAt: null,
        dueAt: null,
        status: 'OPEN',
      },
    ]);
    prisma.cqcNotification.findMany.mockResolvedValue([
      {
        type: 'DEATH',
        status: 'SUBMITTED',
        becameAwareAt: day('2026-11-03'),
        dueAt: day('2026-11-04'),
        submittedAt: day('2026-11-04'),
      },
      {
        type: 'DEATH',
        status: 'SUBMITTED',
        becameAwareAt: day('2026-11-05'),
        dueAt: day('2026-11-06'),
        submittedAt: day('2026-11-08'),
      },
    ]);
    const { data } = await service.reports(ADMIN, { months: 3 }, NOW);
    expect(data.months).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(data.evidence?.byMonth).toEqual([
      { month: '2026-09', added: 0 },
      { month: '2026-10', added: 1 },
      { month: '2026-11', added: 1 },
    ]);
    expect(data.evidence?.bySource[0]).toEqual({ key: 'AUDIT', count: 2 });
    expect(data.mock?.inspections[0]).toMatchObject({
      title: 'Nov',
      branch: 'Croydon',
      overall: 'GOOD',
    });
    expect(data.mock?.statusCounts).toEqual({
      completed: 2,
      inProgress: 1,
      cancelled: 1,
    });
    expect(
      data.mock?.actionsByMonth.find((m) => m.month === '2026-11'),
    ).toEqual({ month: '2026-11', raised: 1, done: 1, doneLate: 1 });
    expect(data.notifications).toMatchObject({
      submitted: 2,
      submittedOnTime: 1,
      byType: [{ type: 'DEATH', count: 2 }],
    });
  });
});

describe('helpers', () => {
  it('lists months across a year end, and reads key question ratings', () => {
    expect(monthsFrom('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(keyQuestionRatings(null)).toEqual([]);
  });
});
