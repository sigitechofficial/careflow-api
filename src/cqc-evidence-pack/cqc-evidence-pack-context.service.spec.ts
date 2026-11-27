import {
  CqcEvidencePackContextService,
  joinAddress,
  percentOf,
} from './cqc-evidence-pack-context.service';

const NOW = new Date('2026-11-27T10:00:00.000Z');

function setup() {
  const prisma: any = {
    companyProfile: {
      findFirst: jest.fn().mockResolvedValue({
        companyName: 'Acme',
        legalName: 'Acme Care Ltd',
        cqcProviderId: '1-100',
        registeredAddressLine1: '1 High St',
        registeredAddressLine2: null,
        registeredTown: 'Croydon',
        registeredCounty: '',
        registeredPostcode: 'CR0 1AA',
      }),
    },
    scheduleArea: {
      findMany: jest.fn().mockResolvedValue([
        {
          name: 'Croydon',
          officialCqcName: 'Acme Care - Croydon',
          cqcLocationId: '1-200',
          address: 'old one-line address',
          addressLine1: '2 Park Rd',
          addressLine2: null,
          town: 'Croydon',
          county: null,
          postcode: 'CR0 2BB',
          phone: '020 1234',
          email: null,
          registeredManagers: ['Sam Lee'],
          nominatedIndividual: 'Alex Kay',
          regulatedActivities: ['Personal care'],
          serviceTypes: ['Homecare agencies'],
          cqcRegistrationDate: new Date('2020-01-01'),
          cqcRating: null,
          cqcRatingStatus: 'NOT_YET_RATED',
        },
      ]),
    },
    serviceUser: { count: jest.fn().mockResolvedValue(40) },
    employee: { count: jest.fn().mockResolvedValue(25) },
    incident: {
      count: jest
        .fn()
        .mockResolvedValueOnce(12) // all
        .mockResolvedValueOnce(2) // high or critical
        .mockResolvedValueOnce(5) // falls
        .mockResolvedValueOnce(3), // medication
    },
    safeguardingCase: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1),
    },
    feedbackRecord: {
      count: jest
        .fn()
        .mockResolvedValueOnce(6) // complaints
        .mockResolvedValueOnce(2) // upheld
        .mockResolvedValueOnce(1) // open
        .mockResolvedValueOnce(9), // compliments
    },
    cqcNotification: {
      findMany: jest.fn().mockResolvedValue([
        { submittedAt: new Date('2026-05-01'), dueAt: new Date('2026-05-02') },
        { submittedAt: new Date('2026-06-05'), dueAt: new Date('2026-06-02') },
      ]),
      count: jest.fn().mockResolvedValue(1),
    },
    employeeCompliance: {
      count: jest
        .fn()
        .mockResolvedValueOnce(40) // training records
        .mockResolvedValueOnce(30) // in date
        .mockResolvedValueOnce(25) // DBS records
        .mockResolvedValueOnce(25), // in date
    },
    supervisionSession: { count: jest.fn().mockResolvedValue(18) },
  };
  const orgScope: any = {
    employeeEmploymentScopeWhere: jest.fn((s: any) =>
      s.locationIds === null ? undefined : { employment: { is: {} } },
    ),
    serviceUserScopeWhere: jest.fn((s: any) =>
      s.locationIds === null
        ? undefined
        : { locationId: { in: s.locationIds } },
    ),
    incidentScopeWhere: jest.fn(async (s: any) =>
      s.locationIds === null
        ? undefined
        : { locationId: { in: s.locationIds } },
    ),
  };
  return {
    service: new CqcEvidencePackContextService(prisma, orgScope),
    prisma,
    orgScope,
  };
}

const ADMIN = { id: 'u1', roles: ['Super Admin'], permissions: [] } as any;
const ALL_BRANCHES = { locationIds: null } as any;

describe('CqcEvidencePackContextService', () => {
  it('gives the provider and each registered branch, with the address parts filled in', async () => {
    const { service, prisma } = setup();
    const out = await service.serviceDetails(ALL_BRANCHES);
    expect(out.provider).toEqual({
      name: 'Acme',
      legalName: 'Acme Care Ltd',
      cqcProviderId: '1-100',
      address: '1 High St, Croydon, CR0 1AA',
    });
    expect(out.locations[0]).toMatchObject({
      name: 'Acme Care - Croydon',
      cqcLocationId: '1-200',
      address: '2 Park Rd, Croydon, CR0 2BB',
      contact: '020 1234',
      registeredManagers: ['Sam Lee'],
      rating: 'Not yet rated',
    });
    // Only registered branches; no branch filter for every branch.
    expect(prisma.scheduleArea.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      cqcLocationId: { not: null },
    });
  });

  it('keeps to the chosen branch', async () => {
    const { service, prisma } = setup();
    await service.serviceDetails(ALL_BRANCHES, 'loc-a');
    expect(
      prisma.scheduleArea.findMany.mock.calls[0][0].where.locationId,
    ).toEqual({
      in: ['loc-a'],
    });
  });

  it('counts the last 12 months for every area the user may see', async () => {
    const { service, prisma } = setup();
    const out = await service.keyData(ADMIN, ALL_BRANCHES, undefined, NOW);
    expect(out.from.toISOString()).toBe('2025-11-27T10:00:00.000Z');
    expect(out.hidden).toEqual([]);
    const figures = Object.fromEntries(
      out.groups.flatMap((g) =>
        g.figures.map((f) => [f.label, [f.value, f.note]]),
      ),
    );
    expect(figures).toEqual({
      'People supported now': ['40', undefined],
      'Staff employed now': ['25', undefined],
      'Incidents reported': ['12', undefined],
      'High or critical': ['2', undefined],
      Falls: ['5', undefined],
      'Medication incidents': ['3', undefined],
      'Concerns raised': ['4', '1 still open'],
      Complaints: ['6', '2 upheld or partly upheld, 1 still open'],
      Compliments: ['9', undefined],
      'Sent to CQC': ['2', '1 on time'],
      'Late and not sent yet': ['1', undefined],
      'Required training in date': ['75% (30 of 40)', undefined],
      'DBS checks in date': ['100% (25 of 25)', undefined],
      'Supervisions held': ['18', undefined],
    });
    expect(
      prisma.incident.count.mock.calls[0][0].where.AND[0].AND[0].occurredAt,
    ).toEqual({
      gte: out.from,
      lte: NOW,
    });
  });

  it('leaves out what the user may not see, and says so', async () => {
    const { service, prisma } = setup();
    const user = {
      id: 'u2',
      roles: ['Care Coordinator'],
      permissions: ['complaints.read', 'cqc_notifications.read'],
    } as any;
    const out = await service.keyData(user, ALL_BRANCHES, undefined, NOW);
    expect(out.groups.map((g) => g.title)).toEqual([
      'Complaints and compliments',
      'CQC notifications',
    ]);
    expect(out.hidden).toEqual([
      'People and staff',
      'Incidents',
      'Safeguarding',
      'Staff training and checks',
    ]);
    expect(prisma.incident.count).not.toHaveBeenCalled();
  });

  it('counts only the chosen branch, or the user’s own branches', async () => {
    const { service, prisma, orgScope } = setup();
    await service.keyData(
      ADMIN,
      { locationIds: ['loc-a', 'loc-b'] } as any,
      'loc-a',
      NOW,
    );
    expect(
      prisma.safeguardingCase.count.mock.calls[0][0].where.locationId,
    ).toEqual({
      in: ['loc-a'],
    });
    expect(orgScope.incidentScopeWhere.mock.calls[0][0].locationIds).toEqual([
      'loc-a',
    ]);

    const again = setup();
    await again.service.keyData(
      ADMIN,
      { locationIds: ['loc-a', 'loc-b'] } as any,
      undefined,
      NOW,
    );
    expect(
      again.prisma.feedbackRecord.count.mock.calls[0][0].where.locationId,
    ).toEqual({
      in: ['loc-a', 'loc-b'],
    });
  });
});

describe('helpers', () => {
  it('joins the address parts that are filled in', () => {
    expect(joinAddress([' 1 High St ', null, '', 'CR0 1AA'])).toBe(
      '1 High St, CR0 1AA',
    );
    expect(joinAddress([null, ''])).toBeNull();
  });
  it('gives a percentage with the counts', () => {
    expect(percentOf(1, 3)).toBe('33% (1 of 3)');
    expect(percentOf(0, 0)).toBe('No records');
  });
});
