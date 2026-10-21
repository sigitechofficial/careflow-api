import { Test } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { addDaysToOperationalIso, operationalTodayIso } from '../common/utils/operational-day.util';

describe('DashboardService.policyReviews', () => {
  let service: DashboardService;
  const prisma: any = {
    policyDocument: { groupBy: jest.fn(), findMany: jest.fn() },
    policyVersion: { findMany: jest.fn() },
  };
  const orgSettings = { getOperationalTimezone: jest.fn().mockResolvedValue('Europe/London') };
  const today = operationalTodayIso(new Date(), 'Europe/London');
  const day = (delta: number) => new Date(`${addDaysToOperationalIso(today, delta)}T00:00:00.000Z`);

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrganisationGeneralSettingsService, useValue: orgSettings },
      ],
    }).compile();
    service = moduleRef.get(DashboardService);
  });

  it('counts due and overdue reviews from the current version, and published policies with no review date', async () => {
    prisma.policyDocument.groupBy.mockResolvedValue([
      { status: 'PUBLISHED', _count: { _all: 4 } },
      { status: 'DRAFT', _count: { _all: 2 } },
    ]);
    prisma.policyDocument.findMany.mockResolvedValue([
      { id: 'p1', reference: 'POL-1', title: 'Overdue', currentVersionId: 'v1' },
      { id: 'p2', reference: 'POL-2', title: 'Due soon', currentVersionId: 'v2' },
      { id: 'p3', reference: 'POL-3', title: 'Far away', currentVersionId: 'v3' },
      { id: 'p4', reference: 'POL-4', title: 'No date', currentVersionId: 'v4' },
    ]);
    prisma.policyVersion.findMany.mockResolvedValue([
      { id: 'v1', reviewDate: day(-5) },
      { id: 'v2', reviewDate: day(10) },
      { id: 'v3', reviewDate: day(90) },
      { id: 'v4', reviewDate: null },
    ]);

    const res = await service.policyReviews(30);

    expect(res.data).toEqual(
      expect.objectContaining({
        days: 30,
        byStatus: { PUBLISHED: 4, DRAFT: 2 },
        publishedNoReviewDate: 1,
        count: 2,
        overdue: 1,
      }),
    );
    expect(res.data.items.map(i => [i.reference, i.overdue])).toEqual([
      ['POL-1', true],
      ['POL-2', false],
    ]);
  });
});
