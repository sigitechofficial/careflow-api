import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { loadCqcFrameworks } from '../../prisma/seed-lib/cqc-framework';
import * as pdfUtil from './cqc-mock-inspection-pdf.util';
import {
  CqcMockInspectionService,
  type InspectionRow,
  type SnapshotItem,
} from './cqc-mock-inspection.service';

jest.mock('../surveys/survey-access', () => ({
  surveysWithoutResultsAccess: jest.fn(async () => new Set<string>()),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const surveyAccess = require('../surveys/survey-access') as {
  surveysWithoutResultsAccess: jest.Mock;
};

const v1 = loadCqcFrameworks()[0];
const SCORING = v1.scoring;
const NOW = new Date('2026-11-17T10:00:00.000Z');

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

const statementsOf = () =>
  v1.keyQuestions.flatMap((k, ki) =>
    k.statements.map((s, si) => ({
      id: `s-${s.code}`,
      code: s.code,
      kq: k.code,
      kqTitle: k.title,
      kqOrder: (ki + 1) * 10,
      order: (ki + 1) * 100 + si,
    })),
  );

function makeRow(
  over: Partial<InspectionRow> = {},
  score: number | null = null,
  snapshot: SnapshotItem[] = [],
): InspectionRow {
  return {
    id: 'insp-1',
    frameworkVersionId: 'fv-1',
    locationId: 'loc-a',
    title: 'Mock inspection',
    status: 'IN_PROGRESS',
    leadReviewerId: 'u-admin',
    notes: null,
    startedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    result: null,
    createdById: 'u-admin',
    updatedById: 'u-admin',
    createdAt: NOW,
    updatedAt: NOW,
    frameworkVersion: {
      id: 'fv-1',
      version: 1,
      code: 'SAF',
      title: 'CQC single assessment framework',
      scoringRules: SCORING as any,
      keyQuestions: v1.keyQuestions.map((k) => ({ code: k.code })),
    },
    template: null,
    statements: statementsOf().map((s) => ({
      id: `row-${s.code}`,
      inspectionId: 'insp-1',
      statementId: s.id,
      score,
      strengths: null,
      concerns: null,
      notes: null,
      evidenceSnapshot: snapshot as any,
      snapshotAt: NOW,
      reviewedById: null,
      reviewedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      statement: {
        id: s.id,
        code: s.code,
        title: s.code,
        summary: 'summary',
        displayOrder: s.order,
        keyQuestion: { code: s.kq, title: s.kqTitle, displayOrder: s.kqOrder },
      },
    })),
    actions: [],
    ...over,
  } as InspectionRow;
}

function setup(row: InspectionRow | null = makeRow()) {
  const prisma: any = {
    cqcMockInspection: {
      findFirst: jest.fn().mockResolvedValue(row),
      create: jest.fn(async (args: any) => ({
        ...makeRow(),
        id: 'new',
        _createArgs: args,
      })),
      update: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    cqcMockInspectionStatement: { update: jest.fn().mockResolvedValue({}) },
    cqcMockInspectionSettings: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'set-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'set-1', ...data })),
    },
    cqcMockInspectionTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    cqcMockInspectionAction: {
      create: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
    },
    cqcFrameworkVersion: {
      findUnique: jest.fn().mockResolvedValue({ scoringRules: SCORING }),
    },
    cqcEvidenceStatement: { findMany: jest.fn().mockResolvedValue([]) },
    location: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    employee: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
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
  const framework: any = {
    active: jest.fn(async () => ({
      id: 'fv-1',
      version: 1,
      title: 'CQC single assessment framework',
      statements: statementsOf().map((s) => ({ id: s.id })),
    })),
  };
  const evidence: any = {
    visibleWhere: jest.fn(async () => ({})),
    branchWhere: jest.fn(() => ({})),
  };
  const service = new CqcMockInspectionService(
    prisma,
    orgScope,
    audit,
    framework,
    evidence,
  );
  return { service, prisma, audit, framework, evidence };
}

describe('CqcMockInspectionService: branch scope', () => {
  it('lets branch users see their branches and whole-organisation inspections', () => {
    const { service } = setup();
    expect(service.visibleWhere({ locationIds: null } as any)).toEqual({});
    expect(service.visibleWhere({ locationIds: ['loc-a'] } as any)).toEqual({
      OR: [{ locationId: { in: ['loc-a'] } }, { locationId: null }],
    });
  });

  it('only lets branch users run inspections of their own branch', async () => {
    const { service } = setup();
    await expect(
      service.assertWritableLocation({ locationIds: ['loc-a'] } as any, null),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.assertWritableLocation(
        { locationIds: ['loc-a'] } as any,
        'loc-b',
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.assertWritableLocation(
        { locationIds: ['loc-a'] } as any,
        'loc-a',
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.assertWritableLocation({ locationIds: null } as any, null),
    ).resolves.toBeUndefined();
  });

  it('refuses a branch user changing a whole-organisation inspection', async () => {
    const { service } = setup(makeRow({ locationId: null }));
    await expect(service.cancel(BRANCH_A, 'insp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('CqcMockInspectionService: create', () => {
  it('starts an inspection with every statement of the active framework and its evidence', async () => {
    const { service, prisma, evidence, audit } = setup();
    prisma.cqcEvidenceStatement.findMany.mockResolvedValue([
      {
        statementId: 's-SAFE_LEARNING_CULTURE',
        evidence: {
          id: 'ev-1',
          title: 'Incident learning log',
          sourceType: 'INCIDENT_LEARNING',
          sourceId: null,
          sourceLabel: null,
          categoryCode: 'PROCESSES',
          periodEnd: null,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          reviewDueAt: new Date('2026-11-01T00:00:00.000Z'),
          _count: { attachments: 2 },
        },
      },
    ]);
    await service.create(
      ADMIN,
      { title: '  November mock  ', locationId: 'loc-a' },
      undefined,
      NOW,
    );

    expect(evidence.branchWhere).toHaveBeenCalledWith(
      { locationIds: null },
      'loc-a',
    );
    const data = prisma.cqcMockInspection.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      title: 'November mock',
      locationId: 'loc-a',
      leadReviewerId: 'u-admin',
      frameworkVersionId: 'fv-1',
      // No settings saved yet: the defaults are copied onto the inspection.
      checkScoring: {
        metPoints: 2,
        partlyMetPoints: 1,
        notMetPoints: 0,
        score4Percent: 100,
        score3Percent: 75,
        score2Percent: 50,
      },
    });
    expect(data.statements.create).toHaveLength(34);
    const safe = data.statements.create.find(
      (s: any) => s.statementId === 's-SAFE_LEARNING_CULTURE',
    );
    expect(safe.evidenceSnapshot).toEqual([
      expect.objectContaining({
        evidenceId: 'ev-1',
        categoryCode: 'PROCESSES',
        reviewOverdue: true,
        attachmentCount: 2,
      }),
    ]);
    expect(
      data.statements.create.find(
        (s: any) => s.statementId !== 's-SAFE_LEARNING_CULTURE',
      ).evidenceSnapshot,
    ).toEqual([]);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cqc_mock_inspection_created' }),
    );
  });

  it('refuses when the active framework has no scoring rules', async () => {
    const { service, prisma } = setup();
    prisma.cqcFrameworkVersion.findUnique.mockResolvedValue({
      scoringRules: null,
    });
    await expect(service.create(ADMIN, { title: 'Mock' })).rejects.toThrow(
      'has no scoring rules',
    );
    expect(prisma.cqcMockInspection.create).not.toHaveBeenCalled();
  });

  it('refuses a lead reviewer who does not exist', async () => {
    const { service, prisma } = setup();
    prisma.user.count.mockResolvedValue(0);
    await expect(
      service.create(ADMIN, { title: 'Mock', leadReviewerId: 'u-gone' }),
    ).rejects.toThrow('The lead reviewer was not found');
  });
});

describe('CqcMockInspectionService: scoring', () => {
  it('saves a score on the scale and records who scored it', async () => {
    const { service, prisma } = setup();
    await service.scoreStatement(
      ADMIN,
      'insp-1',
      's-SAFE_LEARNING_CULTURE',
      { score: 3, concerns: '  late reviews ' },
      undefined,
      NOW,
    );
    expect(prisma.cqcMockInspectionStatement.update).toHaveBeenCalledWith({
      where: { id: 'row-SAFE_LEARNING_CULTURE' },
      data: {
        score: 3,
        reviewedById: 'u-admin',
        reviewedAt: NOW,
        concerns: 'late reviews',
      },
    });
  });

  it('saves the answers to the checks with their notes, trimmed and once each', async () => {
    const { service, prisma } = setup();
    await service.scoreStatement(
      ADMIN,
      'insp-1',
      's-SAFE_LEARNING_CULTURE',
      {
        checks: [
          { part: 'lookAt', text: ' Incident records ', answer: 'MET', note: '  ' },
          {
            part: 'askStaff',
            text: 'Tell me about one',
            answer: 'NOT_MET',
            note: ' Nobody could ',
          },
          { part: 'lookAt', text: 'Incident records', answer: 'NOT_MET' },
        ],
      },
      undefined,
      NOW,
    );
    expect(prisma.cqcMockInspectionStatement.update).toHaveBeenCalledWith({
      where: { id: 'row-SAFE_LEARNING_CULTURE' },
      data: {
        checks: [
          { part: 'lookAt', text: 'Incident records', answer: 'MET', note: null },
          {
            part: 'askStaff',
            text: 'Tell me about one',
            answer: 'NOT_MET',
            note: 'Nobody could',
          },
        ],
      },
    });
  });

  it('works out the score from the answers when the statement has checks, ignoring a score sent with them', async () => {
    const guidance = {
      lookAt: ['Incident records', 'Team minutes'],
      askPeople: [],
      askStaff: ['Tell me about one'],
      inCareFlow: [],
    };
    const save = async (
      answers: Array<'MET' | 'PARTIALLY_MET' | 'NOT_MET'>,
    ) => {
      const { service, prisma } = setup();
      prisma.cqcMockInspectionTemplate.findMany.mockResolvedValue([
        { statements: [{ code: 'SAFE_LEARNING_CULTURE', focus: null, guidance }] },
      ]);
      const texts = [
        ['lookAt', 'Incident records'],
        ['lookAt', 'Team minutes'],
        ['askStaff', 'Tell me about one'],
      ] as const;
      await service.scoreStatement(
        ADMIN,
        'insp-1',
        's-SAFE_LEARNING_CULTURE',
        {
          score: 1,
          checks: answers.map((answer, i) => ({
            part: texts[i][0],
            text: texts[i][1],
            answer,
            note: answer === 'MET' ? undefined : 'Found a gap',
          })),
        },
        undefined,
        NOW,
      );
      return prisma.cqcMockInspectionStatement.update.mock.calls[0][0].data;
    };
    expect(await save(['MET', 'MET', 'MET'])).toMatchObject({
      score: 4,
      reviewedById: 'u-admin',
      reviewedAt: NOW,
    });
    // 2.5 of 3 = 83% → 3
    expect((await save(['MET', 'MET', 'PARTIALLY_MET'])).score).toBe(3);
    // 1 of 3 = 33% → 1
    expect((await save(['MET', 'NOT_MET', 'NOT_MET'])).score).toBe(1);
    // Not every check answered: no score yet.
    expect(await save(['MET', 'MET'])).toMatchObject({
      score: null,
      reviewedById: null,
      reviewedAt: null,
    });
  });

  it('scores with the settings the inspection started with', async () => {
    const guidance = {
      lookAt: ['Incident records', 'Team minutes'],
      askPeople: [],
      askStaff: ['Tell me about one'],
      inCareFlow: [],
    };
    // 3 points for Met, 1 for Partially met; 80% is enough for a 4.
    const { service, prisma } = setup(
      makeRow({
        checkScoring: {
          metPoints: 3,
          partlyMetPoints: 1,
          notMetPoints: 0,
          score4Percent: 80,
          score3Percent: 60,
          score2Percent: 40,
        },
      } as Partial<InspectionRow>),
    );
    prisma.cqcMockInspectionTemplate.findMany.mockResolvedValue([
      { statements: [{ code: 'SAFE_LEARNING_CULTURE', focus: null, guidance }] },
    ]);
    await service.scoreStatement(
      ADMIN,
      'insp-1',
      's-SAFE_LEARNING_CULTURE',
      {
        checks: [
          { part: 'lookAt', text: 'Incident records', answer: 'MET' },
          { part: 'lookAt', text: 'Team minutes', answer: 'MET' },
          { part: 'askStaff', text: 'Tell me about one', answer: 'NOT_MET', note: 'No example given' },
        ],
      },
      undefined,
      NOW,
    );
    // 6 of 9 = 66.7%: a 3 here (60% is enough); with the default settings 66.7% is only a 2.
    expect(prisma.cqcMockInspectionStatement.update.mock.calls[0][0].data.score).toBe(3);
  });

  it('needs a note for a check that is not met or partially met', async () => {
    for (const answer of ['NOT_MET', 'PARTIALLY_MET'] as const) {
      const { service, prisma } = setup();
      await expect(
        service.scoreStatement(ADMIN, 'insp-1', 's-SAFE_LEARNING_CULTURE', {
          checks: [{ part: 'lookAt', text: 'Incident records', answer, note: ' ' }],
        }),
      ).rejects.toThrow('Add a note for "Incident records"');
      expect(prisma.cqcMockInspectionStatement.update).not.toHaveBeenCalled();
    }
  });

  it('gives an inspection of every statement what to check from the ready-made library, with saved answers', async () => {
    const row = makeRow();
    const answered = row.statements.find(
      (s) => s.statementId === 's-SAFE_LEARNING_CULTURE',
    )!;
    (answered as any).checks = [
      { part: 'lookAt', text: 'Incident records', answer: 'PARTIALLY_MET' },
    ];
    const { service, prisma } = setup(row);
    const guidance = {
      lookAt: ['Incident records'],
      askPeople: [],
      askStaff: [],
      inCareFlow: ['Incidents'],
    };
    prisma.cqcMockInspectionTemplate.findMany.mockResolvedValue([
      { statements: [{ code: 'SAFE_LEARNING_CULTURE', focus: 'x', guidance }] },
    ]);
    const { data } = await service.get(ADMIN, 'insp-1');
    const statements = data.keyQuestions.flatMap((k) => k.statements);
    const learning = statements.find((s) => s.code === 'SAFE_LEARNING_CULTURE')!;
    // The library's guidance, but not another template's focus.
    expect(learning).toMatchObject({ focus: null, guidance });
    // An answer saved before notes existed reads with no note.
    expect(learning.checks).toEqual([
      {
        part: 'lookAt',
        text: 'Incident records',
        answer: 'PARTIALLY_MET',
        note: null,
      },
    ]);
    expect(statements.find((s) => s.code === 'SAFE_MEDICINES')).toMatchObject({
      guidance: null,
      checks: [],
    });
  });

  it('refuses a score off the scale, a statement not in the inspection, and a completed inspection', async () => {
    await expect(
      setup().service.scoreStatement(
        ADMIN,
        'insp-1',
        's-SAFE_LEARNING_CULTURE',
        { score: 5 },
      ),
    ).rejects.toThrow('Score must be one of 1, 2, 3, 4');
    await expect(
      setup().service.scoreStatement(ADMIN, 'insp-1', 's-unknown', {
        score: 3,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      setup(makeRow({ status: 'COMPLETED' })).service.scoreStatement(
        ADMIN,
        'insp-1',
        's-SAFE_LEARNING_CULTURE',
        { score: 3 },
      ),
    ).rejects.toThrow('completed');
  });

  it('shows the live ratings while scoring', async () => {
    const { service } = setup(makeRow({}, 3));
    const { data } = await service.get(ADMIN, 'insp-1');
    expect(data.result).toMatchObject({ complete: true, overall: 'GOOD' });
    expect(data.keyQuestions.map((k) => k.code)).toEqual([
      'SAFE',
      'EFFECTIVE',
      'CARING',
      'RESPONSIVE',
      'WELL_LED',
    ]);
    expect(data.scale).toHaveLength(4);
  });
});

describe('CqcMockInspectionService: complete', () => {
  it('refuses while statements are unscored', async () => {
    const row = makeRow({}, 3);
    row.statements[0].score = null;
    row.statements[5].score = null;
    const { service, prisma } = setup(row);
    await expect(service.complete(ADMIN, 'insp-1')).rejects.toThrow(
      'Score every quality statement first (2 still to score).',
    );
    expect(prisma.cqcMockInspection.updateMany).not.toHaveBeenCalled();
  });

  it('freezes the ratings, only from in progress', async () => {
    const { service, prisma, audit } = setup(makeRow({}, 3));
    await service.complete(ADMIN, 'insp-1', undefined, NOW);
    const call = prisma.cqcMockInspection.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'insp-1', status: 'IN_PROGRESS' });
    expect(call.data).toMatchObject({ status: 'COMPLETED', completedAt: NOW });
    expect(call.data.result).toMatchObject({
      overall: 'GOOD',
      complete: true,
      frameworkVersion: 1,
      completedAt: NOW.toISOString(),
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cqc_mock_inspection_completed' }),
    );
  });

  it('says so when someone else completed or cancelled it first', async () => {
    const { service, prisma } = setup(makeRow({}, 3));
    prisma.cqcMockInspection.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.complete(ADMIN, 'insp-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('shows the frozen result of a completed inspection, not a recalculation', async () => {
    const frozen = {
      overall: 'OUTSTANDING',
      complete: true,
      keyQuestions: [],
      unscoredStatementIds: [],
      frameworkVersion: 1,
      completedAt: NOW.toISOString(),
    };
    const { service } = setup(
      makeRow({ status: 'COMPLETED', result: frozen as any }, 3),
    );
    expect((await service.get(ADMIN, 'insp-1')).data.result).toEqual(frozen);
  });
});

describe('CqcMockInspectionService: evidence the viewer may not see', () => {
  it('hides survey results the viewer has no access to and counts them', async () => {
    const items: SnapshotItem[] = [
      {
        evidenceId: 'e1',
        title: 'Staff survey',
        sourceType: 'SURVEY_RESULT',
        sourceId: 'survey-hr',
        sourceLabel: null,
        categoryCode: 'STAFF_FEEDBACK',
        date: NOW.toISOString(),
        reviewDueAt: null,
        reviewOverdue: false,
        attachmentCount: 0,
      },
      {
        evidenceId: 'e2',
        title: 'Audit',
        sourceType: 'AUDIT',
        sourceId: null,
        sourceLabel: null,
        categoryCode: 'PROCESSES',
        date: NOW.toISOString(),
        reviewDueAt: null,
        reviewOverdue: false,
        attachmentCount: 0,
      },
    ];
    surveyAccess.surveysWithoutResultsAccess.mockResolvedValueOnce(
      new Set(['survey-hr']),
    );
    const { service } = setup(makeRow({}, null, items));
    const { data } = await service.get(BRANCH_A, 'insp-1');
    const first = data.keyQuestions[0].statements[0] as any;
    expect(first.evidence.map((e: SnapshotItem) => e.evidenceId)).toEqual([
      'e2',
    ]);
    expect(first.hiddenEvidenceCount).toBe(1);
    expect(first.gap).toBe(false);
  });
});

describe('CqcMockInspectionService: actions', () => {
  it('adds an action for a statement in the inspection, also after it is completed', async () => {
    const { service, prisma } = setup(makeRow({ status: 'COMPLETED' }));
    await service.createAction(ADMIN, 'insp-1', {
      title: 'Review medicines audit',
      statementId: 's-SAFE_LEARNING_CULTURE',
      dueAt: '2026-12-31',
    });
    expect(
      prisma.cqcMockInspectionAction.create.mock.calls[0][0].data,
    ).toMatchObject({
      inspectionId: 'insp-1',
      statementId: 's-SAFE_LEARNING_CULTURE',
      title: 'Review medicines audit',
      dueAt: new Date('2026-12-31'),
    });
  });

  it('adds an action for one check of a statement, and refuses a check without its statement', async () => {
    const { service, prisma } = setup();
    await service.createAction(ADMIN, 'insp-1', {
      title: 'Share lessons at team meeting',
      statementId: 's-SAFE_LEARNING_CULTURE',
      checkText: ' Minutes showing lessons shared ',
    });
    expect(
      prisma.cqcMockInspectionAction.create.mock.calls[0][0].data,
    ).toMatchObject({ checkText: 'Minutes showing lessons shared' });
    await expect(
      setup().service.createAction(ADMIN, 'insp-1', {
        title: 'Do it',
        checkText: 'Minutes',
      }),
    ).rejects.toThrow('needs its quality statement');
  });

  it('assigns an action to a staff member and shows their name', async () => {
    const { service, prisma } = setup();
    await service.createAction(ADMIN, 'insp-1', {
      title: 'Hand hygiene refresher',
      assignedEmployeeId: 'emp-1',
    });
    expect(
      prisma.cqcMockInspectionAction.create.mock.calls[0][0].data,
    ).toMatchObject({ assignedEmployeeId: 'emp-1' });

    const row = makeRow({
      actions: [
        {
          id: 'a1',
          statementId: null,
          checkText: null,
          title: 'Hand hygiene refresher',
          detail: null,
          ownerId: null,
          assignedEmployeeId: 'emp-1',
          dueAt: null,
          status: 'OPEN',
          completedAt: null,
          createdAt: NOW,
        },
      ] as any,
    });
    const shown = setup(row);
    shown.prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-1', personalDetail: { firstName: 'Amina', lastName: 'Khan' } },
    ]);
    const { data } = await shown.service.get(ADMIN, 'insp-1');
    expect(data.actions[0].assignedEmployee).toEqual({
      id: 'emp-1',
      name: 'Amina Khan',
    });

    const missing = setup();
    missing.prisma.employee.count.mockResolvedValue(0);
    await expect(
      missing.service.createAction(ADMIN, 'insp-1', {
        title: 'Do it',
        assignedEmployeeId: 'emp-x',
      }),
    ).rejects.toThrow('That staff member was not found');
  });

  it('refuses a statement outside the inspection and a cancelled inspection', async () => {
    await expect(
      setup().service.createAction(ADMIN, 'insp-1', {
        title: 'Do it',
        statementId: 's-x',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      setup(makeRow({ status: 'CANCELLED' })).service.createAction(
        ADMIN,
        'insp-1',
        { title: 'Do it' },
      ),
    ).rejects.toThrow('cancelled');
  });
});

describe('CqcMockInspectionService: PDF report', () => {
  it('builds the report from what the viewer may see, names the file and logs the export', async () => {
    const items: SnapshotItem[] = [
      {
        evidenceId: 'e1',
        title: 'Staff survey',
        sourceType: 'SURVEY_RESULT',
        sourceId: 'survey-hr',
        sourceLabel: null,
        categoryCode: 'STAFF_FEEDBACK',
        date: NOW.toISOString(),
        reviewDueAt: null,
        reviewOverdue: false,
        attachmentCount: 0,
      },
      {
        evidenceId: 'e2',
        title: 'Medicines audit',
        sourceType: 'AUDIT',
        sourceId: null,
        sourceLabel: null,
        categoryCode: 'PROCESSES',
        date: NOW.toISOString(),
        reviewDueAt: null,
        reviewOverdue: false,
        attachmentCount: 0,
      },
    ];
    surveyAccess.surveysWithoutResultsAccess.mockResolvedValueOnce(
      new Set(['survey-hr']),
    );
    const { service, prisma, audit } = setup(
      makeRow({ title: 'November mock' }, 3, items),
    );
    prisma.companyProfile = {
      findFirst: jest.fn().mockResolvedValue({ companyName: 'All For Care' }),
    };
    const pdf = jest
      .spyOn(pdfUtil, 'buildMockInspectionPdf')
      .mockResolvedValue(Buffer.from('%PDF-test'));

    const file = await service.export(BRANCH_A, 'insp-1', undefined, NOW);

    expect(file.contentType).toBe('application/pdf');
    expect(file.disposition).toContain(
      'mock-cqc-inspection-november-mock-2026-11-17.pdf',
    );
    const report = pdf.mock.calls[0][0];
    expect(report).toMatchObject({
      organisationName: 'All For Care',
      title: 'November mock',
      status: 'IN_PROGRESS',
    });
    expect(report.result?.overall).toBe('GOOD');
    const first = report.keyQuestions[0].statements[0];
    expect(first.evidence.map((e) => e.title)).toEqual(['Medicines audit']);
    expect(first.hiddenEvidenceCount).toBe(1);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cqc_mock_inspection_exported',
        recordId: 'insp-1',
      }),
    );
    pdf.mockRestore();
  });
});

describe('CqcMockInspectionService: comparison with the previous inspection', () => {
  it('finds the last completed inspection of the same service before this one and compares them', async () => {
    const completedAt = new Date('2026-11-17T12:00:00.000Z');
    const current = makeRow({ status: 'COMPLETED', completedAt }, 3);
    const previous = makeRow(
      {
        id: 'insp-0',
        title: 'August mock',
        status: 'COMPLETED',
        completedAt: new Date('2026-08-01T12:00:00.000Z'),
      },
      2,
    );
    const { service, prisma } = setup(current);
    prisma.cqcMockInspection.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(previous);

    const { data } = await service.comparison(BRANCH_A, 'insp-1');

    const where = prisma.cqcMockInspection.findFirst.mock.calls[1][0].where;
    expect(where.AND[1]).toEqual({
      id: { not: 'insp-1' },
      locationId: 'loc-a',
      status: 'COMPLETED',
      completedAt: { lt: completedAt },
    });
    expect(where.AND[0]).toEqual({
      OR: [{ locationId: { in: ['loc-a'] } }, { locationId: null }],
    });
    expect(data.previous).toMatchObject({
      id: 'insp-0',
      title: 'August mock',
      overall: 'REQUIRES_IMPROVEMENT',
    });
    expect(data.comparison?.overall).toEqual({
      from: 'REQUIRES_IMPROVEMENT',
      to: 'GOOD',
    });
    expect(data.comparison?.improved).toHaveLength(34);
    expect(data.comparison?.keyQuestions[0]).toMatchObject({
      code: 'SAFE',
      fromPercent: 50,
      toPercent: 75,
      change: 25,
    });
  });

  it('has nothing to compare with when there is no earlier completed inspection', async () => {
    const current = makeRow({}, 3);
    const { service, prisma } = setup(current);
    prisma.cqcMockInspection.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null);
    const { data } = await service.comparison(ADMIN, 'insp-1');
    // In progress: any completed inspection before now counts.
    expect(
      prisma.cqcMockInspection.findFirst.mock.calls[1][0].where.AND[1],
    ).not.toHaveProperty('completedAt');
    expect(data).toEqual({ previous: null, comparison: null });
  });
});

describe('CqcMockInspectionService: ready-made inspections', () => {
  const guidance = {
    lookAt: ['MAR charts'],
    askPeople: [],
    askStaff: ['What if a dose is missed?'],
    inCareFlow: ['eMAR'],
  };
  const templateRow = {
    id: 'tpl-6',
    code: 'MI-006',
    groupCode: 'TOPIC',
    groupName: 'Topic deep dives',
    title: 'Medicines management',
    summary: 'Medicines support.',
    whenToUse: 'Every quarter.',
    estimatedMinutes: 120,
    displayOrder: 60,
    statements: [
      { code: 'SAFE_MEDICINES', focus: null, guidance },
      { code: 'WELL_LED_GOVERNANCE', focus: 'Medicines audits.', guidance },
    ],
    sources: [{ id: 'x', source: 'X', url: 'https://example.org' }],
    researchedOn: new Date('2026-11-19T00:00:00.000Z'),
    retiredAt: null,
  };
  const activeFramework = () => ({
    id: 'fv-1',
    version: 1,
    title: 'CQC single assessment framework',
    keyQuestions: v1.keyQuestions.map((k) => ({ code: k.code })),
    statements: statementsOf().map((s) => ({
      id: s.id,
      code: s.code,
      title: s.code,
      keyQuestionCode: s.kq,
      keyQuestionTitle: s.kqTitle,
    })),
  });

  it('starts an inspection with only the template statements and remembers the template', async () => {
    const { service, prisma, framework } = setup();
    framework.active.mockResolvedValue(activeFramework());
    prisma.cqcMockInspectionTemplate = {
      findFirst: jest.fn().mockResolvedValue(templateRow),
      findMany: jest.fn().mockResolvedValue([]),
    };
    await service.create(
      ADMIN,
      { title: 'Medicines check', templateCode: 'MI-006' },
      undefined,
      NOW,
    );
    expect(prisma.cqcMockInspectionTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'MI-006', retiredAt: null } }),
    );
    const data = prisma.cqcMockInspection.create.mock.calls[0][0].data;
    expect(data.templateId).toBe('tpl-6');
    expect(
      data.statements.create.map((s: any) => s.statementId).sort(),
    ).toEqual(['s-SAFE_MEDICINES', 's-WELL_LED_GOVERNANCE']);
  });

  it('refuses a template that is unknown or no longer matches the framework', async () => {
    const unknown = setup();
    unknown.framework.active.mockResolvedValue(activeFramework());
    unknown.prisma.cqcMockInspectionTemplate = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    await expect(
      unknown.service.create(ADMIN, { title: 'X', templateCode: 'MI-099' }),
    ).rejects.toThrow('was not found');

    const stale = setup();
    stale.framework.active.mockResolvedValue(activeFramework());
    stale.prisma.cqcMockInspectionTemplate = {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          ...templateRow,
          statements: [
            ...templateRow.statements,
            { code: 'GONE', focus: null, guidance },
          ],
        }),
    };
    await expect(
      stale.service.create(ADMIN, { title: 'X', templateCode: 'MI-006' }),
    ).rejects.toThrow('does not match the current CQC framework');
  });

  it('shows the focus and guidance, and no overall rating for a focused inspection', async () => {
    const row = makeRow(
      {
        template: {
          id: 'tpl-6',
          code: 'MI-006',
          title: 'Medicines management',
          statements: templateRow.statements,
        } as any,
      },
      3,
    );
    row.statements = row.statements.filter((s) =>
      ['s-SAFE_MEDICINES', 's-WELL_LED_GOVERNANCE'].includes(s.statementId),
    );
    const { service } = setup(row);
    const { data } = await service.get(ADMIN, 'insp-1');
    expect(data.template).toEqual({
      code: 'MI-006',
      title: 'Medicines management',
    });
    const governance = data.keyQuestions.find((k) => k.code === 'WELL_LED')!
      .statements[0];
    expect(governance).toMatchObject({ focus: 'Medicines audits.', guidance });
    expect(data.result).toMatchObject({
      complete: true,
      overallApplies: false,
      overall: null,
    });
    expect(data.result?.keyQuestions.map((k) => k.keyQuestionCode)).toEqual([
      'SAFE',
      'WELL_LED',
    ]);
  });

  it('lists templates with statement titles, key questions and whether they give an overall rating', async () => {
    const { service, prisma, framework } = setup();
    framework.active.mockResolvedValue({
      ...activeFramework(),
      keyQuestions: v1.keyQuestions.map((k) => ({
        code: k.code,
        title: k.title,
      })),
    });
    prisma.cqcMockInspectionTemplate = {
      findMany: jest.fn().mockResolvedValue([templateRow]),
    };
    const { data } = await service.templates();
    expect(data[0]).toMatchObject({
      code: 'MI-006',
      statementCount: 2,
      keyQuestionCodes: ['SAFE', 'WELL_LED'],
      givesOverallRating: false,
      matchesFramework: true,
      researchedOn: '2026-11-19',
    });
    expect(data[0].statements[1]).toMatchObject({
      code: 'WELL_LED_GOVERNANCE',
      keyQuestionCode: 'WELL_LED',
      focus: 'Medicines audits.',
    });
  });
});

describe('CqcMockInspectionService: settings', () => {
  const good = {
    metPoints: 3,
    partlyMetPoints: 1,
    notMetPoints: 0,
    score4Percent: 90,
    score3Percent: 70,
    score2Percent: 40,
  };

  it('gives the defaults until settings are saved', async () => {
    const { service } = setup();
    const { data } = await service.settings();
    expect(data).toMatchObject({ metPoints: 2, score4Percent: 100, score3Percent: 75, score2Percent: 50 });
  });

  it('saves settings, logs the change, and new inspections copy them', async () => {
    const { service, prisma, audit } = setup();
    await service.updateSettings(ADMIN, good);
    expect(prisma.cqcMockInspectionSettings.create).toHaveBeenCalledWith({
      data: { ...good, updatedById: 'u-admin' },
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cqc_mock_inspection_settings_updated', newValues: good }),
    );
    prisma.cqcMockInspectionSettings.findFirst.mockResolvedValue({ id: 'set-1', ...good });
    await service.create(ADMIN, { title: 'December mock', locationId: 'loc-a' }, undefined, NOW);
    expect(prisma.cqcMockInspection.create.mock.calls[0][0].data.checkScoring).toEqual(good);
  });

  it('refuses settings that do not go up in order', async () => {
    const { service, prisma } = setup();
    await expect(service.updateSettings(ADMIN, { ...good, partlyMetPoints: 3 })).rejects.toThrow(
      'Met must score more than Partially met',
    );
    await expect(service.updateSettings(ADMIN, { ...good, score3Percent: 95 })).rejects.toThrow(
      'Each level must need a higher %',
    );
    expect(prisma.cqcMockInspectionSettings.create).not.toHaveBeenCalled();
  });
});
