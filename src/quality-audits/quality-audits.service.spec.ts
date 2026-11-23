import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  QualityAuditsService,
  defaultAuditTitle,
  levelWhere,
  shiftMonth,
  tabWhere,
  type AuditRow,
} from './quality-audits.service';
import {
  QualityAuditTemplatesService,
  areaCodeOf,
  normaliseSections,
} from './quality-audit-templates.service';
import { QualityAuditSchedulesService } from './quality-audit-schedules.service';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ADMIN = {
  id: 'u-admin',
  roles: ['Admin'],
  permissions: [],
  assignedLocationIds: null,
} as any;
const BRANCH_A = {
  id: 'u-a',
  roles: ['Manager'],
  permissions: [],
  assignedLocationIds: ['loc-a'],
} as any;

const SECTIONS = [
  {
    title: 'Policy',
    standards: [
      { id: 'policy-current', text: 'Policy is current' },
      { id: 'policy-read', text: 'Staff have read it' },
    ],
  },
  {
    title: 'Practice',
    standards: [
      {
        id: 'hands-observed',
        text: 'Hand washing seen',
        hint: 'Watch 3 carers',
      },
    ],
  },
];
const NEW_SECTIONS = [
  {
    title: 'Policy',
    standards: [{ id: 'policy-current', text: 'Policy is current (v2)' }],
  },
];

const TEMPLATE = {
  id: 'tpl-1',
  code: 'AUD-001',
  title: 'Infection prevention and control',
  summary: 'IPC',
  introduction: 'Use spot checks',
  sections: SECTIONS,
  isCustom: false,
  keyQuestionCode: 'SAFE',
  frequency: 'QUARTERLY',
  earlyDays: 2,
  lateDays: 2,
  auditedItemLabel: null,
  estimatedMinutes: 90,
  locationIds: [],
  cqcStatementCodes: ['SAFE_IPC'],
  sources: [],
  researchedOn: day('2026-11-23'),
  retiredAt: null,
  area: { code: 'INFECTION_PREVENTION', name: 'Infection prevention' },
  _count: { schedules: 0 },
};

function makeRow(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'aud-1',
    templateId: 'tpl-1',
    sections: SECTIONS,
    locationId: 'loc-a',
    scheduleId: null,
    title: 'Infection prevention and control, November 2026',
    dueDate: null,
    earlyDays: null,
    lateDays: null,
    auditDate: day('2026-11-23'),
    auditorId: 'u-admin',
    accountableUserId: 'u-admin',
    auditedItemLabel: null,
    auditedItemValue: null,
    status: 'IN_PROGRESS',
    summary: null,
    startedAt: NOW,
    missedAt: null,
    completedAt: null,
    cancelledAt: null,
    result: null,
    createdById: 'u-admin',
    updatedById: 'u-admin',
    createdAt: NOW,
    updatedAt: NOW,
    template: {
      code: 'AUD-001',
      title: 'Infection prevention and control',
      keyQuestionCode: 'SAFE',
      frequency: 'QUARTERLY',
      introduction: 'Use spot checks',
      sections: NEW_SECTIONS,
      area: { code: 'INFECTION_PREVENTION', name: 'Infection prevention' },
    },
    answers: [],
    actions: [],
    ...over,
  };
}

const answer = (
  standardId: string,
  value: 'MET' | 'NOT_MET',
  note: string | null = null,
) =>
  ({
    id: `ans-${standardId}`,
    auditId: 'aud-1',
    standardId,
    answer: value,
    celebrate: false,
    note,
    answeredById: 'u-admin',
    answeredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }) as AuditRow['answers'][number];

const SCHEDULE = {
  id: 'sch-1',
  templateId: 'tpl-1',
  locationId: 'loc-a',
  frequency: 'MONTHLY',
  earlyDays: 2,
  lateDays: 2,
  firstDueDate: day('2026-12-01'),
  accountableUserId: 'u-admin',
  stoppedAt: null,
  template: {
    code: 'AUD-001',
    title: 'Infection prevention and control',
    sections: SECTIONS,
    auditedItemLabel: null,
    retiredAt: null,
    area: { code: 'INFECTION_PREVENTION', name: 'Infection prevention' },
  },
};

function setup(row: AuditRow | null = makeRow()) {
  const prisma: any = {
    qualityAudit: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue(row ? [row] : []),
      count: jest.fn().mockResolvedValue(row ? 1 : 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'aud-1', ...data })),
      update: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    qualityAuditTemplate: {
      findFirst: jest.fn().mockResolvedValue(TEMPLATE),
      findMany: jest.fn().mockResolvedValue([TEMPLATE]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => ({ id: 'tpl-new', ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...TEMPLATE, ...data })),
    },
    qualityAuditSchedule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(SCHEDULE),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => ({ id: 'sch-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...SCHEDULE, ...data })),
    },
    qualityAuditArea: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'area-ipc', code: 'INFECTION_PREVENTION' }),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { displayOrder: 80 } }),
      create: jest.fn(async ({ data }: any) => ({ id: 'area-new', ...data })),
    },
    qualityAuditAnswer: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    qualityAuditAction: {
      create: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
    },
    location: {
      count: jest.fn(async ({ where }: any) =>
        where.id?.in ? where.id.in.length : 1,
      ),
      findMany: jest.fn().mockResolvedValue([{ id: 'loc-a', name: 'Croydon' }]),
    },
    user: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'u-admin', firstName: 'Sam', lastName: 'Ali', email: null },
        ]),
    },
    employee: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
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
  const audit: any = { logAudit: jest.fn() };
  const templates = new QualityAuditTemplatesService(prisma, orgScope, audit);
  const schedules = new QualityAuditSchedulesService(
    prisma,
    orgScope,
    audit,
    templates,
  );
  const service = new QualityAuditsService(
    prisma,
    orgScope,
    audit,
    templates,
    schedules,
  );
  return { service, templates, schedules, prisma, audit };
}

// ─── Templates and areas ──────────────────────────────────────────────────────

describe('QualityAuditTemplatesService', () => {
  it('lists templates with their area and counts', async () => {
    const { templates } = setup();
    const { data } = await templates.templates(ADMIN);
    expect(data[0]).toMatchObject({
      code: 'AUD-001',
      area: { code: 'INFECTION_PREVENTION' },
      isCustom: false,
      sectionCount: 2,
      standardCount: 3,
    });
  });

  it('makes your own template with the next OWN code, keeping given standard ids and making new ones', async () => {
    const { templates, prisma } = setup();
    prisma.qualityAuditTemplate.count.mockResolvedValue(4);
    prisma.qualityAuditTemplate.findFirst.mockResolvedValue({
      ...TEMPLATE,
      code: 'OWN-0005',
      isCustom: true,
    });
    await templates.createTemplate(ADMIN, {
      areaCode: 'INFECTION_PREVENTION',
      title: '  Hand hygiene spot check ',
      frequency: 'MONTHLY',
      auditedItemLabel: 'Carer',
      sections: [
        {
          title: 'Observed',
          standards: [
            { id: 'washed-hands', text: 'Washed hands before care' },
            { text: 'Used gel between tasks', hint: '  Watch closely ' },
          ],
        },
      ],
    });
    const data = prisma.qualityAuditTemplate.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      code: 'OWN-0005',
      isCustom: true,
      title: 'Hand hygiene spot check',
      frequency: 'MONTHLY',
      earlyDays: 2,
      lateDays: 2,
      auditedItemLabel: 'Carer',
      areaId: 'area-ipc',
    });
    expect(data.sections[0].standards[0].id).toBe('washed-hands');
    expect(data.sections[0].standards[1]).toMatchObject({
      id: expect.stringMatching(/^s-[0-9a-f]{8}$/),
      text: 'Used gel between tasks',
      hint: 'Watch closely',
    });
  });

  it('needs a known area, and branch users must choose their own branches', async () => {
    const noArea = setup();
    noArea.prisma.qualityAuditArea.findFirst.mockResolvedValue(null);
    const dto: any = {
      areaCode: 'NOPE',
      title: 'Mine',
      frequency: 'MONTHLY',
      sections: [{ title: 'S', standards: [{ text: 'One' }] }],
    };
    await expect(noArea.templates.createTemplate(ADMIN, dto)).rejects.toThrow(
      'Choose an audit area',
    );
    const { templates } = setup();
    await expect(
      templates.createTemplate(BRANCH_A, {
        ...dto,
        areaCode: 'INFECTION_PREVENTION',
      }),
    ).rejects.toThrow('Choose your branches');
    await expect(
      templates.createTemplate(BRANCH_A, {
        ...dto,
        areaCode: 'INFECTION_PREVENTION',
        locationIds: ['loc-b'],
      }),
    ).rejects.toThrow('own branches');
  });

  it('will not change or remove library templates, nor remove one still scheduled', async () => {
    const { templates, prisma } = setup();
    const dto: any = {
      areaCode: 'X',
      title: 'T',
      frequency: 'MONTHLY',
      sections: [],
    };
    await expect(
      templates.updateTemplate(ADMIN, 'AUD-001', dto),
    ).rejects.toThrow('cannot be changed');
    await expect(templates.retireTemplate(ADMIN, 'AUD-001')).rejects.toThrow(
      'cannot be removed',
    );
    prisma.qualityAuditTemplate.findFirst.mockResolvedValue({
      ...TEMPLATE,
      isCustom: true,
      _count: { schedules: 2 },
    });
    await expect(templates.retireTemplate(ADMIN, 'OWN-0001')).rejects.toThrow(
      'Stop its 2 schedules first',
    );
  });

  it('refuses a standard id listed twice', () => {
    expect(() =>
      normaliseSections([
        { title: 'A', standards: [{ id: 'same', text: 'One' }] },
        { title: 'B', standards: [{ id: 'same', text: 'Two' }] },
      ]),
    ).toThrow('listed twice');
  });

  it('adds an area with a code from its name, after the others, and refuses a repeated name', async () => {
    const { templates, prisma } = setup();
    prisma.qualityAuditArea.findFirst.mockResolvedValue(null);
    await templates.createArea(ADMIN, { name: 'Medication & MAR' });
    expect(prisma.qualityAuditArea.create.mock.calls[0][0].data).toMatchObject({
      code: 'MEDICATION_MAR',
      name: 'Medication & MAR',
      displayOrder: 90,
    });
    prisma.qualityAuditArea.findFirst.mockResolvedValue({
      name: 'Medication & MAR',
    });
    await expect(
      templates.createArea(ADMIN, { name: 'medication & mar' }),
    ).rejects.toThrow('already an area');
    expect(areaCodeOf('  care at night! ')).toBe('CARE_AT_NIGHT');
  });
});

// ─── Schedules ────────────────────────────────────────────────────────────────

describe('QualityAuditSchedulesService.sync', () => {
  it('marks open audits missed once their late days have passed', async () => {
    const { schedules, prisma } = setup();
    prisma.qualityAudit.findMany.mockResolvedValueOnce([
      { id: 'late', dueDate: day('2026-11-18'), lateDays: 2 },
      { id: 'still-in-time', dueDate: day('2026-11-21'), lateDays: 2 },
    ]);
    prisma.qualityAudit.updateMany.mockResolvedValue({ count: 1 });
    const r = await schedules.sync(NOW);
    expect(prisma.qualityAudit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['late'] }, status: { in: ['DUE', 'IN_PROGRESS'] } },
      data: { status: 'MISSED', missedAt: NOW },
    });
    expect(r.missed).toBe(1);
  });

  it('makes the first due audit of a new schedule', async () => {
    const { schedules, prisma } = setup();
    prisma.qualityAudit.findMany.mockResolvedValueOnce([]);
    prisma.qualityAuditSchedule.findMany.mockResolvedValue([SCHEDULE]);
    prisma.qualityAudit.findFirst.mockResolvedValue(null);
    await schedules.sync(NOW);
    expect(prisma.qualityAudit.create).toHaveBeenCalledTimes(1);
    expect(prisma.qualityAudit.create.mock.calls[0][0].data).toMatchObject({
      scheduleId: 'sch-1',
      dueDate: day('2026-12-01'),
      status: 'DUE',
      title: 'Infection prevention and control, December 2026',
      earlyDays: 2,
      lateDays: 2,
      accountableUserId: 'u-admin',
      startedAt: null,
      auditDate: null,
    });
  });

  it('records the months nobody did as missed, then makes the next due one', async () => {
    const { schedules, prisma } = setup();
    prisma.qualityAudit.findMany.mockResolvedValueOnce([]);
    prisma.qualityAuditSchedule.findMany.mockResolvedValue([
      { ...SCHEDULE, firstDueDate: day('2026-09-01') },
    ]);
    prisma.qualityAudit.findFirst.mockResolvedValue(null);
    await schedules.sync(NOW);
    const made = prisma.qualityAudit.create.mock.calls.map((c: any) => [
      c[0].data.dueDate.toISOString().slice(0, 10),
      c[0].data.status,
    ]);
    expect(made).toEqual([
      ['2026-09-01', 'MISSED'],
      ['2026-10-01', 'MISSED'],
      ['2026-11-01', 'MISSED'],
      ['2026-12-01', 'DUE'],
    ]);
  });

  it('leaves a schedule alone while its audit is open, and makes the next after it is completed', async () => {
    const open = setup();
    open.prisma.qualityAudit.findMany.mockResolvedValueOnce([]);
    open.prisma.qualityAuditSchedule.findMany.mockResolvedValue([SCHEDULE]);
    open.prisma.qualityAudit.findFirst.mockResolvedValue({
      dueDate: day('2026-12-01'),
      status: 'DUE',
    });
    await open.schedules.sync(NOW);
    expect(open.prisma.qualityAudit.create).not.toHaveBeenCalled();

    const done = setup();
    done.prisma.qualityAudit.findMany.mockResolvedValueOnce([]);
    done.prisma.qualityAuditSchedule.findMany.mockResolvedValue([SCHEDULE]);
    done.prisma.qualityAudit.findFirst.mockResolvedValue({
      dueDate: day('2026-12-01'),
      status: 'COMPLETED',
    });
    await done.schedules.sync(NOW);
    expect(
      done.prisma.qualityAudit.create.mock.calls[0][0].data.dueDate,
    ).toEqual(day('2027-01-01'));
  });
});

describe('QualityAuditSchedulesService', () => {
  it('schedules an audit with the template defaults and you as accountable', async () => {
    const { schedules, prisma } = setup();
    prisma.qualityAudit.findMany.mockResolvedValue([]);
    prisma.qualityAuditSchedule.findMany.mockResolvedValue([
      { ...SCHEDULE, audits: [] },
    ]);
    await schedules.create(
      ADMIN,
      {
        templateCode: 'AUD-001',
        locationId: 'loc-a',
        firstDueDate: '2026-12-01',
      },
      undefined,
      NOW,
    );
    expect(
      prisma.qualityAuditSchedule.create.mock.calls[0][0].data,
    ).toMatchObject({
      templateId: 'tpl-1',
      locationId: 'loc-a',
      frequency: 'QUARTERLY',
      earlyDays: 2,
      lateDays: 2,
      firstDueDate: day('2026-12-01'),
      accountableUserId: 'u-admin',
    });
  });

  it('refuses a second schedule of the same audit for the branch, and a template not used there', async () => {
    const dup = setup();
    dup.prisma.qualityAuditSchedule.count.mockResolvedValue(1);
    await expect(
      dup.schedules.create(ADMIN, {
        templateCode: 'AUD-001',
        locationId: 'loc-a',
        firstDueDate: '2026-12-01',
      }),
    ).rejects.toThrow('already scheduled');
    const own = setup();
    own.prisma.qualityAuditTemplate.findFirst.mockResolvedValue({
      ...TEMPLATE,
      isCustom: true,
      locationIds: ['loc-b'],
    });
    await expect(
      own.schedules.create(ADMIN, {
        templateCode: 'OWN-0001',
        locationId: 'loc-a',
        firstDueDate: '2026-12-01',
      }),
    ).rejects.toThrow('not used at this branch');
  });

  it('stops a schedule and cancels the audit waiting to be done', async () => {
    const { schedules, prisma } = setup();
    prisma.qualityAudit.findMany.mockResolvedValue([]);
    prisma.qualityAuditSchedule.findMany.mockResolvedValue([
      { ...SCHEDULE, audits: [] },
    ]);
    await schedules.stop(ADMIN, 'sch-1', undefined, NOW);
    expect(prisma.qualityAudit.updateMany).toHaveBeenCalledWith({
      where: { scheduleId: 'sch-1', status: 'DUE' },
      data: { status: 'CANCELLED', cancelledAt: NOW },
    });
  });
});

// ─── Audits ───────────────────────────────────────────────────────────────────

describe('QualityAuditsService: start and begin', () => {
  it('starts an audit by hand from the template, with you as auditor and accountable', async () => {
    const { service, prisma } = setup();
    await service.start(
      ADMIN,
      { templateCode: 'AUD-001', locationId: 'loc-a' },
      undefined,
      NOW,
    );
    expect(prisma.qualityAudit.create.mock.calls[0][0].data).toMatchObject({
      templateId: 'tpl-1',
      sections: SECTIONS,
      title: 'Infection prevention and control, November 2026',
      auditDate: day('2026-11-23'),
      auditorId: 'u-admin',
      accountableUserId: 'u-admin',
      status: 'IN_PROGRESS',
    });
  });

  it('keeps branch users to their own branches', async () => {
    await expect(
      setup().service.start(BRANCH_A, { templateCode: 'AUD-001' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('begins a due audit with the template’s current standards and the audited item', async () => {
    const row = makeRow({
      status: 'DUE',
      auditedItemLabel: 'Carer',
      startedAt: null,
      auditDate: null,
    });
    const { service, prisma } = setup(row);
    await service.begin(
      ADMIN,
      'aud-1',
      { auditedItemValue: ' Amelia Foster ' },
      undefined,
      NOW,
    );
    expect(prisma.qualityAudit.update.mock.calls[0][0].data).toMatchObject({
      status: 'IN_PROGRESS',
      startedAt: NOW,
      auditDate: day('2026-11-23'),
      auditorId: 'u-admin',
      sections: NEW_SECTIONS,
      auditedItemValue: 'Amelia Foster',
    });
  });

  it('begins a due audit on its first answer', async () => {
    const due = makeRow({ status: 'DUE', sections: NEW_SECTIONS });
    const { service, prisma } = setup(due);
    prisma.qualityAudit.findFirst
      .mockResolvedValueOnce(due)
      .mockResolvedValue(makeRow({ sections: NEW_SECTIONS }));
    await service.answer(
      ADMIN,
      'aud-1',
      'policy-current',
      { answer: 'MET' },
      undefined,
      NOW,
    );
    expect(prisma.qualityAudit.update.mock.calls[0][0].data.status).toBe(
      'IN_PROGRESS',
    );
    expect(prisma.qualityAuditAnswer.upsert).toHaveBeenCalled();
  });

  it('names the audit after the template and month', () => {
    expect(defaultAuditTitle('Medication', '2027-01-05')).toBe(
      'Medication, January 2027',
    );
    expect(shiftMonth('2026-11', -6)).toBe('2026-05');
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
  });
});

describe('QualityAuditsService: complete', () => {
  const allAnswered = [
    answer('policy-current', 'MET'),
    answer('policy-read', 'NOT_MET', 'Two unsigned'),
    answer('hands-observed', 'MET'),
  ];

  it('needs every standard answered and a note for each not met', async () => {
    await expect(
      setup(
        makeRow({ answers: [answer('policy-current', 'MET')] }),
      ).service.complete(ADMIN, 'aud-1'),
    ).rejects.toThrow('2 of 3 still to answer');
    await expect(
      setup(
        makeRow({
          answers: [
            answer('policy-current', 'MET'),
            answer('policy-read', 'NOT_MET'),
            answer('hands-observed', 'MET'),
          ],
        }),
      ).service.complete(ADMIN, 'aud-1'),
    ).rejects.toThrow('1 still needs one');
  });

  it('cannot be completed before its early window opens', async () => {
    const row = makeRow({
      answers: allAnswered,
      dueDate: day('2026-12-10'),
      earlyDays: 2,
      lateDays: 2,
      scheduleId: 'sch-1',
    });
    await expect(
      setup(row).service.complete(ADMIN, 'aud-1', undefined, NOW),
    ).rejects.toThrow('can be completed from 08/12/2026');
  });

  it('needs the audited item when the template records one', async () => {
    const row = makeRow({
      answers: allAnswered,
      auditedItemLabel: 'Carer',
      auditedItemValue: null,
    });
    await expect(setup(row).service.complete(ADMIN, 'aud-1')).rejects.toThrow(
      'Fill in "Carer" first',
    );
  });

  it('freezes the result and makes the next scheduled audit', async () => {
    const row = makeRow({
      answers: allAnswered,
      dueDate: day('2026-11-24'),
      earlyDays: 2,
      lateDays: 2,
      scheduleId: 'sch-1',
    });
    const { service, prisma } = setup(row);
    await service.complete(ADMIN, 'aud-1', undefined, NOW);
    const data = prisma.qualityAudit.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'COMPLETED', completedAt: NOW });
    expect(data.result).toMatchObject({
      met: 2,
      notMet: 1,
      percent: 66.7,
      complete: true,
    });
    expect(prisma.qualityAuditSchedule.findMany).toHaveBeenCalled();
  });
});

describe('QualityAuditsService: actions', () => {
  it('adds an urgent action for a standard, also on a missed audit', async () => {
    const { service, prisma } = setup(makeRow({ status: 'MISSED' }));
    await service.createAction(ADMIN, 'aud-1', {
      title: 'Re-train two carers',
      standardId: 'hands-observed',
      assignedEmployeeId: 'emp-1',
      dueAt: '2026-12-31',
      urgent: true,
    });
    expect(
      prisma.qualityAuditAction.create.mock.calls[0][0].data,
    ).toMatchObject({
      standardId: 'hands-observed',
      assignedEmployeeId: 'emp-1',
      dueAt: day('2026-12-31'),
      urgent: true,
    });
  });

  it('refuses actions on a cancelled or due audit', async () => {
    await expect(
      setup(makeRow({ status: 'CANCELLED' })).service.createAction(
        ADMIN,
        'aud-1',
        { title: 'Do it' },
      ),
    ).rejects.toThrow('cancelled');
    await expect(
      setup(makeRow({ status: 'DUE' })).service.createAction(ADMIN, 'aud-1', {
        title: 'Do it',
      }),
    ).rejects.toThrow('cannot be changed now');
  });
});

describe('QualityAuditsService: tabs, list, dashboard and reports', () => {
  it('sorts open audits into overdue, due and in progress by the due date', () => {
    expect(tabWhere('OVERDUE', '2026-11-23')).toEqual({
      status: { in: ['DUE', 'IN_PROGRESS'] },
      dueDate: { lt: day('2026-11-23') },
    });
    expect(tabWhere('DUE', '2026-11-23')).toEqual({
      status: 'DUE',
      dueDate: { gte: day('2026-11-23') },
    });
    expect(tabWhere('IN_PROGRESS', '2026-11-23')).toEqual({
      status: 'IN_PROGRESS',
      OR: [{ dueDate: null }, { dueDate: { gte: day('2026-11-23') } }],
    });
    expect(levelWhere('COMPLIANT')).toEqual({
      status: 'COMPLETED',
      result: { path: ['percent'], gte: 90 },
    });
  });

  it('lists audits with their due state, area, compliance level and previous result', async () => {
    const due = makeRow({
      status: 'DUE',
      dueDate: day('2026-11-25'),
      earlyDays: 2,
      lateDays: 2,
      scheduleId: 'sch-1',
      startedAt: null,
    });
    const { service, prisma } = setup(due);
    prisma.qualityAudit.findMany
      .mockResolvedValueOnce([]) // sync: nothing late
      .mockResolvedValueOnce([due]) // the page
      .mockResolvedValueOnce([
        {
          id: 'old',
          templateId: 'tpl-1',
          locationId: 'loc-a',
          completedAt: day('2026-08-20'),
          result: { percent: 92 },
        },
      ]);
    const { data } = await service.list(
      ADMIN,
      { page: 1, limit: 20, tab: 'DUE' },
      NOW,
    );
    expect(data[0]).toMatchObject({
      state: 'DUE',
      dueDate: '2026-11-25',
      daysToDue: 2,
      daysToClose: 4,
      scheduled: true,
      template: { area: { code: 'INFECTION_PREVENTION' } },
      accountable: { id: 'u-admin', name: 'Sam Ali' },
      previousPercent: 92,
      level: null,
    });
  });

  it('counts the tabs and fills the timeline with done, missed, due and future scheduled audits', async () => {
    const { service, prisma } = setup();
    prisma.qualityAudit.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    prisma.qualityAudit.findMany
      .mockResolvedValueOnce([]) // sync
      .mockResolvedValueOnce([
        {
          status: 'COMPLETED',
          dueDate: day('2026-10-05'),
          completedAt: day('2026-10-04'),
        },
        { status: 'MISSED', dueDate: day('2026-10-20'), completedAt: null },
        { status: 'DUE', dueDate: day('2026-12-01'), completedAt: null },
        { status: 'COMPLETED', dueDate: null, completedAt: day('2026-11-02') },
      ]);
    prisma.qualityAuditSchedule.findMany
      .mockResolvedValueOnce([]) // sync
      .mockResolvedValueOnce([
        {
          id: 'sch-1',
          firstDueDate: day('2026-12-01'),
          frequency: 'MONTHLY',
          audits: [{ dueDate: day('2026-12-01') }],
        },
      ]);
    const { data } = await service.dashboard(ADMIN, {}, NOW);
    expect(data.counts).toEqual({
      overdue: 4,
      due: 3,
      inProgress: 3,
      completed: 3,
      missed: 2,
    });
    expect(data.timeline).toHaveLength(18);
    expect(data.timeline[0].month).toBe('2026-05');
    expect(data.timeline[17].month).toBe('2027-10');
    const month = (m: string) => data.timeline.find((t) => t.month === m)!;
    expect(month('2026-10')).toMatchObject({ completed: 1, missed: 1, due: 0 });
    expect(month('2026-11')).toMatchObject({ completed: 1 });
    expect(month('2026-12')).toMatchObject({ due: 1 });
    // Future months come from the schedule.
    expect(month('2027-01')).toMatchObject({ due: 1 });
    expect(month('2027-10')).toMatchObject({ due: 1 });
  });

  it('reports compliance levels, the average and compliance by month', async () => {
    const { service, prisma } = setup();
    prisma.qualityAudit.findMany
      .mockResolvedValueOnce([]) // sync
      .mockResolvedValueOnce([
        { completedAt: day('2026-10-28'), result: { percent: 100 } },
        { completedAt: day('2026-11-05'), result: { percent: 80 } },
        { completedAt: day('2026-11-20'), result: { percent: 50 } },
      ]);
    prisma.qualityAudit.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    const { data } = await service.reports(ADMIN, { days: 30 }, NOW);
    expect(data.levels).toEqual({
      COMPLIANT: 1,
      PARTIALLY_COMPLIANT: 1,
      NOT_COMPLIANT: 1,
    });
    expect(data.overallPercent).toBe(76.7);
    expect(data.due).toEqual({ overdue: 1, dueThisWeek: 2, dueIn30Days: 5 });
    expect(data.byMonth).toEqual([
      { month: '2026-10', audits: 1, percent: 100 },
      { month: '2026-11', audits: 2, percent: 65 },
    ]);
  });
});
