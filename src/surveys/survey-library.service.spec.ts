import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { SurveyLibraryService } from './survey-library.service';

const admin: any = { id: 'admin-1', roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
const leedsManager: any = { id: 'mgr-leeds', roles: ['Manager'], permissions: [], assignedLocationIds: ['loc-leeds'] };

const meta = (revisionNote: string | null = null) => ({
  type: 'survey-library',
  version: 1,
  group: { code: 'PEOPLE_WE_SUPPORT', short: 'PWS', name: 'People we support', displayOrder: 10, researchedOn: '2026-11-05' },
  revisionNote,
  respondents: 'People we support',
  summary: 'How well {{organisation}} cares for you.',
  purpose: 'Evidence for Caring.',
  timing: { when: 'Once a year', recurrence: 'YEARLY', trigger: null },
  channels: ['PORTAL', 'TELEPHONE'],
  cqc: { keyQuestions: ['CARING'], qualityStatements: [] },
  estimatedMinutes: 5,
  introduction: '{{organisation}} wants to hear from you.',
  privacyNotice: 'Only managers at {{organisation}} see your answers.',
  managerGuidance: { howToRun: ['Send it.'], actingOnResults: ['Act on it.'], alerts: [] },
  relatedPolicies: ['POL-CD-001'],
  regulatoryBasis: [{ source: 'Regulation 17', url: 'https://www.legislation.gov.uk/' }],
  sections: [
    { title: 'Your visits', questionCount: 1, evidence: ['Safe systems'] },
    { title: 'Your say', questionCount: 1, evidence: [] },
  ],
});

const catalogueQuestions = [
  {
    id: 'cq1', surveyId: 'lib-1', questionText: 'Does {{organisation}} arrive on time?', helpText: null, questionType: 'YES_NO',
    options: null, config: null, isRequired: true, sortOrder: 0, sectionTitle: 'Your visits', deletedAt: null,
    key: 'q-on-time', otherOption: null, exclusiveOptions: null, showIf: null,
    commentConfig: { prompt: 'What could {{organisation}} do better?', showWhen: ['No'] },
  },
  {
    id: 'cq2', surveyId: 'lib-1', questionText: 'Anything else?', helpText: null, questionType: 'TEXTAREA',
    options: null, config: null, isRequired: false, sortOrder: 1, sectionTitle: 'Your say', deletedAt: null,
    key: 'q2', otherOption: null, exclusiveOptions: null, commentConfig: null,
    showIf: { questionKey: 'q-on-time', answers: ['No'] },
  },
];

const catalogue = (revision = 1) => ({
  id: 'lib-1',
  title: 'Annual satisfaction survey',
  description: '{{organisation}} wants to hear from you.\n\nOnly managers at {{organisation}} see your answers.',
  targetKind: 'SERVICE_USER',
  isAnonymous: false,
  isTemplate: true,
  isCatalogue: true,
  locationIds: [],
  libraryReference: 'SUR-PWS-001',
  libraryRevision: revision,
  libraryMeta: meta(revision > 1 ? 'Reworded the timing question' : null),
  deletedAt: null,
  questions: catalogueQuestions,
});

function setup(
  opts: {
    revision?: number;
    adopted?: Array<{ id: string; librarySourceId: string; libraryRevision: number | null; deletedAt?: Date | null }>;
    template?: any;
    templateQuestions?: any[];
    rules?: any[];
  } = {},
) {
  const revision = opts.revision ?? 1;
  const prisma: any = {
    survey: {
      findMany: jest.fn(async (args: any) => {
        if (args.where.isCatalogue === true) return [catalogue(revision)];
        if (args.where.librarySourceId) {
          // Like the database: `deletedAt: null` leaves out soft-deleted templates.
          const rows = opts.adopted ?? [];
          return args.where.deletedAt === null ? rows.filter((r) => !r.deletedAt) : rows;
        }
        return [];
      }),
      findFirst: jest.fn(async (args: any) => {
        if (args.where.isCatalogue === true) return args.where.id === 'lib-1' ? catalogue(revision) : null;
        const t = opts.template;
        if (!t || args.where.id !== t.id) return null;
        return args.where.deletedAt === null && t.deletedAt ? null : t;
      }),
      findUniqueOrThrow: jest.fn(async (args: any) => {
        if (args.where.id === 'lib-1') return catalogue(revision);
        if (opts.template && args.where.id === opts.template.id) return opts.template;
        throw new Error('not found');
      }),
      create: jest.fn(async (args: any) => ({ id: 'tpl-new', ...args.data })),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
    surveyQuestion: {
      updateMany: jest.fn(async () => ({ count: 2 })),
      findMany: jest.fn(async () => opts.templateQuestions ?? []),
    },
    surveyAlertRule: {
      findMany: jest.fn(async () => opts.rules ?? []),
      aggregate: jest.fn(async () => ({ _max: { position: (opts.rules ?? []).length - 1 } })),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      delete: jest.fn(async () => ({})),
      create: jest.fn(async (args: any) => ({ id: 'rule-new', ...args.data })),
    },
    surveyRecipient: { count: jest.fn(async () => 0) },
    surveyResponse: { count: jest.fn(async () => 0) },
    policyDocument: {
      findMany: jest.fn(async () => [{ reference: 'LIB-POL-CD-001', title: 'Care Delivery Policy' }]),
    },
    companyProfile: { findFirst: jest.fn(async () => ({ companyName: 'Allfor Care & Co' })) },
    $transaction: jest.fn(async (ops: unknown) => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops as unknown[]))),
  };
  const audit = { logAudit: jest.fn() };
  const service = new SurveyLibraryService(prisma, new OrgScopeService(prisma), audit as any);
  return { service, prisma, audit };
}

const template = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-1',
  title: 'Annual satisfaction survey',
  isTemplate: true,
  isCatalogue: false,
  locationIds: [],
  librarySourceId: 'lib-1',
  libraryRevision: 1,
  deletedAt: null,
  ...over,
});

describe('SurveyLibraryService', () => {
  it('lists ready-made surveys with the organisation name filled in and adoption status', async () => {
    const { service } = setup({ revision: 2, adopted: [{ id: 'tpl-1', librarySourceId: 'lib-1', libraryRevision: 1 }] });
    const { data } = await service.list();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      reference: 'SUR-PWS-001',
      summary: 'How well Allfor Care & Co cares for you.',
      group: { short: 'PWS', name: 'People we support' },
      audience: 'SERVICE_USER',
      anonymous: false,
      estimatedMinutes: 5,
      questionCount: 2,
      revision: 2,
      adoptedTemplateId: 'tpl-1',
      adoptedRevision: 1,
      updateAvailable: true,
    });
  });

  it('shows one survey with sections, questions, guidance and related policy titles', async () => {
    const { service } = setup();
    const { data } = await service.get('lib-1');
    expect(data.introduction).toBe('Allfor Care & Co wants to hear from you.');
    expect(data.privacyNotice).toBe('Only managers at Allfor Care & Co see your answers.');
    expect(data.sections.map((s) => [s.title, s.questions.length, s.evidence])).toEqual([
      ['Your visits', 1, ['Safe systems']],
      ['Your say', 1, []],
    ]);
    expect(data.sections[0].questions[0].questionText).toBe('Does Allfor Care & Co arrive on time?');
    expect(data.relatedPolicies).toEqual([{ reference: 'POL-CD-001', title: 'Care Delivery Policy' }]);
    expect(data.adoptedTemplateId).toBeNull();
    await expect(service.get('other')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adopts as a company-wide template linked to the library, questions keeping their sections', async () => {
    const { service, prisma, audit } = setup();
    const res = await service.adopt(admin, ['lib-1']);
    expect(res.data.created).toEqual([{ libraryId: 'lib-1', templateId: 'tpl-new', reference: 'SUR-PWS-001', title: 'Annual satisfaction survey' }]);
    const data = prisma.survey.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      isTemplate: true,
      isCatalogue: false,
      status: 'DRAFT',
      locationIds: [],
      targetKind: 'SERVICE_USER',
      librarySourceId: 'lib-1',
      libraryReference: 'SUR-PWS-001',
      libraryRevision: 1,
      createdById: 'admin-1',
      description: 'Allfor Care & Co wants to hear from you.\n\nOnly managers at Allfor Care & Co see your answers.',
    });
    expect(data.libraryMeta.summary).toBe('How well Allfor Care & Co cares for you.');
    expect(data.questions.create).toEqual([
      expect.objectContaining({ questionText: 'Does Allfor Care & Co arrive on time?', sectionTitle: 'Your visits', sortOrder: 0, options: Prisma.JsonNull }),
      expect.objectContaining({ questionText: 'Anything else?', sectionTitle: 'Your say', sortOrder: 1, isRequired: false }),
    ]);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ adoptedFromLibrary: 'SUR-PWS-001' }) }));
  });

  it('skips a survey that is already adopted', async () => {
    const { service, prisma } = setup({ adopted: [{ id: 'tpl-1', librarySourceId: 'lib-1', libraryRevision: 1 }] });
    const res = await service.adopt(admin, ['lib-1', 'lib-1']);
    expect(res.data.created).toEqual([]);
    expect(res.data.skipped).toEqual([
      expect.objectContaining({ libraryId: 'lib-1', reason: 'Already adopted', templateId: 'tpl-1' }),
    ]);
    expect(prisma.survey.create).not.toHaveBeenCalled();
    // Only live templates count as adopted.
    expect(prisma.survey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isTemplate: true, isCatalogue: false, deletedAt: null }) }),
    );
  });

  it('adopted by someone else at the same moment: the unique index refuses a second, theirs is returned', async () => {
    const adopted: Array<{ id: string; librarySourceId: string; libraryRevision: number | null }> = [];
    const { service, prisma, audit } = setup({ adopted });
    prisma.survey.create.mockImplementationOnce(async () => {
      // The other request's template is saved first…
      adopted.push({ id: 'tpl-theirs', librarySourceId: 'lib-1', libraryRevision: 1 });
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'Survey_librarySourceId_live_template_key' },
      });
    });
    const res = await service.adopt(admin, ['lib-1']);
    expect(res.data.created).toEqual([]);
    expect(res.data.skipped).toEqual([
      expect.objectContaining({ libraryId: 'lib-1', reason: 'Already adopted', templateId: 'tpl-theirs' }),
    ]);
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('other database errors on adopt are not hidden', async () => {
    const { service, prisma } = setup();
    prisma.survey.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.adopt(admin, ['lib-1'])).rejects.toThrow('connection lost');
    // A unique violation with no live template behind it is not hidden either.
    prisma.survey.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(service.adopt(admin, ['lib-1'])).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('a deleted template does not count as adopted (list, detail, adopt, template link)', async () => {
    const deleted = { id: 'tpl-old', librarySourceId: 'lib-1', libraryRevision: 1, deletedAt: new Date('2026-11-05T14:30:49Z') };
    const { service, prisma } = setup({ adopted: [deleted], template: template({ id: 'tpl-old', deletedAt: deleted.deletedAt }) });
    expect((await service.list()).data[0]).toMatchObject({ adoptedTemplateId: null, adoptedRevision: null, updateAvailable: false });
    expect((await service.get('lib-1')).data.adoptedTemplateId).toBeNull();
    expect((await service.forTemplate(admin, 'tpl-old')).data).toBeNull();
    const res = await service.adopt(admin, ['lib-1']);
    expect(res.data.skipped).toEqual([]);
    expect(res.data.created).toEqual([expect.objectContaining({ libraryId: 'lib-1', templateId: 'tpl-new' })]);
    expect(prisma.survey.create).toHaveBeenCalledTimes(1);
  });

  it('a live template adopted again after the old one was deleted is the adopted one', async () => {
    const { service } = setup({
      adopted: [
        { id: 'tpl-old', librarySourceId: 'lib-1', libraryRevision: 1, deletedAt: new Date('2026-11-05T14:30:49Z') },
        { id: 'tpl-live', librarySourceId: 'lib-1', libraryRevision: 1, deletedAt: null },
      ],
    });
    expect((await service.list()).data[0].adoptedTemplateId).toBe('tpl-live');
  });

  it('refuses unknown surveys and branch-restricted users (adopted templates are company-wide)', async () => {
    const { service, prisma } = setup();
    await expect(service.adopt(admin, ['lib-1', 'lib-2'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.adopt(leedsManager, ['lib-1'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.adopt(admin, [])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.survey.create).not.toHaveBeenCalled();
  });

  it('reports an update when the library revision is newer than the adopted one', async () => {
    const newer = setup({ revision: 2, template: template() });
    expect((await newer.service.forTemplate(admin, 'tpl-1')).data).toMatchObject({
      reference: 'SUR-PWS-001',
      adoptedRevision: 1,
      currentRevision: 2,
      updateAvailable: true,
      revisionNote: 'Reworded the timing question',
    });
    const same = setup({ revision: 2, template: template({ libraryRevision: 2 }) });
    expect((await same.service.forTemplate(admin, 'tpl-1')).data).toMatchObject({ updateAvailable: false });
    const unlinked = setup({ template: template({ librarySourceId: null }) });
    expect((await unlinked.service.forTemplate(admin, 'tpl-1')).data).toBeNull();
    // Branch users see the link on company templates too (read-only to them).
    expect((await newer.service.forTemplate(leedsManager, 'tpl-1')).data).toMatchObject({ updateAvailable: true });
  });

  it('adopt and apply-update carry whether people may answer without their name', async () => {
    const { service, prisma } = setup();
    prisma.survey.findMany.mockImplementation(async (args: any) =>
      args.where.isCatalogue === true ? [{ ...catalogue(), allowAnonymousResponses: true }] : [],
    );
    await service.adopt(admin, ['lib-1']);
    expect(prisma.survey.create.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);
    const listed = await service.list();
    expect(listed.data[0]).toMatchObject({ allowAnonymousResponses: true });

    const second = setup({ revision: 2, template: template() });
    second.prisma.survey.findFirst.mockImplementation(async (args: any) =>
      args.where.isCatalogue === true ? { ...catalogue(2), allowAnonymousResponses: true } : template(),
    );
    await second.service.applyUpdate(admin, 'tpl-1');
    expect(second.prisma.survey.update.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);

    // Never on for an anonymous ready-made survey.
    const third = setup();
    third.prisma.survey.findMany.mockImplementation(async (args: any) =>
      args.where.isCatalogue === true ? [{ ...catalogue(), isAnonymous: true, allowAnonymousResponses: true }] : [],
    );
    await third.service.adopt(admin, ['lib-1']);
    expect(third.prisma.survey.create.mock.calls[0][0].data.allowAnonymousResponses).toBe(false);
  });

  it('applies an update: replaces the questions and details and records the revision', async () => {
    const { service, prisma, audit } = setup({ revision: 2, template: template({ title: 'Our own title' }) });
    const res = await service.applyUpdate(admin, 'tpl-1');
    expect(res.data).toMatchObject({ surveyId: 'tpl-1', revision: 2, turnedOff: [], refreshed: [] });
    expect(prisma.surveyQuestion.updateMany).toHaveBeenCalledWith({
      where: { surveyId: 'tpl-1', deletedAt: null },
      data: expect.objectContaining({ isActive: false }),
    });
    const data = prisma.survey.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Annual satisfaction survey', libraryRevision: 2, updatedById: 'admin-1' });
    expect(data.questions.create).toHaveLength(2);
    expect(data.questions.create[0]).toMatchObject({ sectionTitle: 'Your visits' });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { libraryUpdate: expect.objectContaining({ reference: 'SUR-PWS-001', from: 1, to: 2, turnedOff: [] }) },
      }),
    );
  });

  it("applies an update without losing the template's alert rules or section introductions", async () => {
    const ownRule = (id: string, questionKey: string, answers: string[]) => ({
      id, key: `own-${id}`, title: `Rule ${id}`, whenText: 'w', actionText: 'a', conditions: [{ questionKey, answers }],
      ownerKey: 'REGISTERED_MANAGER', roleId: null, dueWorkingDays: 1, dueCalendarDays: null, urgent: false,
      recordKind: null, contactRequest: false, isActive: true, libraryAlert: null, minimumAnswers: null,
    });
    const { service, prisma, audit } = setup({
      revision: 2,
      template: template({
        alertRulesSetUpAt: new Date('2026-11-01'),
        sectionIntros: { 'Your visits': 'Our own words.', 'Old section': 'Gone.' },
      }),
      rules: [ownRule('kept', 'q-on-time', ['No']), ownRule('gone', 'q-old', ['Yes'])],
    });
    // Before applying, the update dialog is told exactly what will happen.
    const { data: link } = await service.forTemplate(admin, 'tpl-1');
    expect(link?.plan).toMatchObject({
      kept: ['Rule kept'],
      turnedOff: [{ title: 'Rule gone', reason: '"q-old" is no longer in the survey.' }],
      sectionIntrosKept: ['Your visits'],
      sectionIntrosDropped: ['Old section'],
    });
    const res = await service.applyUpdate(admin, 'tpl-1');
    expect(res.message).toMatch(/1 alert rule was turned off because they can no longer work as set/);
    expect(prisma.surveyAlertRule.update).toHaveBeenCalledTimes(1);
    expect(prisma.surveyAlertRule.update).toHaveBeenCalledWith({ where: { id: 'gone' }, data: { isActive: false, updatedById: 'admin-1' } });
    expect(prisma.survey.update.mock.calls[0][0].data.sectionIntros).toEqual({ 'Your visits': 'Our own words.' });
    expect(audit.logAudit.mock.calls[0][0].metadata.libraryUpdate.turnedOff).toHaveLength(1);
  });

  it('refuses to apply an update when up to date, not linked, used, or for a branch user', async () => {
    await expect(setup({ revision: 1, template: template() }).service.applyUpdate(admin, 'tpl-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ revision: 2, template: template({ librarySourceId: null }) }).service.applyUpdate(admin, 'tpl-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ revision: 2, template: template({ isTemplate: false }) }).service.applyUpdate(admin, 'tpl-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ revision: 2, template: template() }).service.applyUpdate(leedsManager, 'tpl-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const used = setup({ revision: 2, template: template() });
    used.prisma.surveyResponse.count.mockResolvedValue(1);
    await expect(used.service.applyUpdate(admin, 'tpl-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(used.prisma.survey.update).not.toHaveBeenCalled();
  });

  it('keeps keys, comment boxes and show-if rules on adopt, update and in the reader', async () => {
    const { service, prisma } = setup({ revision: 2, template: template() });
    const { data: detail } = await service.get('lib-1');
    expect(detail.sections[0].questions[0]).toMatchObject({
      key: 'q-on-time',
      commentConfig: { prompt: 'What could Allfor Care & Co do better?', showWhen: ['No'] },
    });
    expect(detail.sections[1].questions[0].showIf).toEqual({
      questionKey: 'q-on-time',
      answers: ['No'],
      questionText: 'Does Allfor Care & Co arrive on time?',
    });
    await service.applyUpdate(admin, 'tpl-1');
    const rows = prisma.survey.update.mock.calls[0][0].data.questions.create;
    expect(rows[0]).toMatchObject({
      key: 'q-on-time',
      commentConfig: { prompt: 'What could Allfor Care & Co do better?', showWhen: ['No'] },
      otherOption: Prisma.JsonNull,
    });
    expect(rows[1]).toMatchObject({ key: 'q2', showIf: { questionKey: 'q-on-time', answers: ['No'] } });
  });

  it('never treats a catalogue survey as an organisation template', async () => {
    const { service, prisma } = setup({ revision: 2 });
    // The catalogue survey itself is not "adopted from the library" and cannot be updated.
    expect((await service.forTemplate(admin, 'lib-1')).data).toBeNull();
    await expect(service.applyUpdate(admin, 'lib-1')).rejects.toBeInstanceOf(NotFoundException);
    for (const [args] of prisma.survey.findFirst.mock.calls) {
      if (args.where.id === 'lib-1' && args.where.isCatalogue !== true) expect(args.where.isCatalogue).toBe(false);
    }
  });
});

describe('question bank', () => {
  const q = (id: string, surveyId: string, over: Record<string, unknown> = {}) => ({
    id, surveyId, questionText: 'Do your care workers arrive on time?', helpText: null, questionType: 'LIKERT',
    options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never', "Don't know"], config: { notCountedOptions: ["Don't know"] },
    isRequired: true, sortOrder: 0, sectionTitle: 'Your visits', deletedAt: null, key: `${id}-key`,
    otherOption: null, exclusiveOptions: null, commentConfig: null, showIf: null, ...over,
  });
  const survey = (id: string, reference: string, short: string, questions: unknown[]) => ({
    ...catalogue(),
    id,
    libraryReference: reference,
    title: `Survey ${reference}`,
    libraryMeta: { ...meta(), group: { ...meta().group, short, name: `Group ${short}` } },
    questions,
  });
  const rows = [
    survey('lib-a', 'SUR-PWS-001', 'PWS', [
      q('a1', 'lib-a'),
      q('a2', 'lib-a', {
        questionText: 'Would you like someone to contact you about your answers?', questionType: 'YES_NO',
        options: null, config: null, sectionTitle: 'Anything else', key: 'q-contact',
      }),
      q('a3', 'lib-a', {
        questionText: 'What is the best number to call {{organisation}} back on?', questionType: 'TEXT', options: null, config: null,
        sectionTitle: 'Anything else', helpText: 'We call within a week', showIf: { questionKey: 'q-contact', answers: ['Yes'] },
      }),
    ]),
    survey('lib-b', 'SUR-FAM-001', 'FAM', [q('b1', 'lib-b', { sectionTitle: 'Visits' })]),
    survey('lib-c', 'SUR-APP-001', 'APP', [
      q('c1', 'lib-c', { questionText: 'Which training helped most?', questionType: 'MULTI_SELECT', options: ['Moving', 'Medicines'], config: null, sectionTitle: 'Training' }),
    ]),
  ];
  const bank = (query: Record<string, unknown> = {}) => {
    const prisma: any = {
      survey: { findMany: jest.fn(async () => rows) },
      companyProfile: { findFirst: jest.fn(async () => ({ companyName: 'Allfor Care' })) },
    };
    const service = new SurveyLibraryService(prisma, new OrgScopeService(prisma), { logAudit: jest.fn() } as any);
    return service.questionBank(query as any).then((r) => ({ ...r.data, prisma }));
  };

  it('reads catalogue surveys only (never an organisation’s own)', async () => {
    const { prisma } = await bank();
    expect(prisma.survey.findMany.mock.calls[0][0].where).toEqual({ isCatalogue: true, isTemplate: true, deletedAt: null });
  });

  it('lists an identical question once, with every ready-made survey it is used in', async () => {
    const { items, total, topics } = await bank();
    expect(total).toBe(4);
    const onTime: any = items.find((i: any) => i.questionText === 'Do your care workers arrive on time?');
    expect(onTime.sources.map((s: any) => s.reference)).toEqual(['SUR-PWS-001', 'SUR-FAM-001']);
    expect(onTime.audiences).toEqual(['PWS', 'FAM']);
    expect(onTime).toMatchObject({ notCountedOptions: ["Don't know"], topic: 'Your visits', contactRequest: false });
    expect(topics).toEqual(['Anything else', 'Training', 'Visits', 'Your visits']);
  });

  it('never returns a "Show only if" rule to copy, only that the original had one; fills the organisation name', async () => {
    const { items } = await bank({ search: 'call' });
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('showIf');
    expect(items[0]).not.toHaveProperty('key');
    expect(items[0].askedOnlyIf).toEqual({ questionText: 'Would you like someone to contact you about your answers?', answers: ['Yes'] });
    expect(items[0].questionText).toBe('What is the best number to call Allfor Care back on?');
  });

  it('flags the contact-me question (not for anonymous surveys)', async () => {
    const { items } = await bank({ search: 'contact you' });
    expect(items.map((i: any) => i.contactRequest)).toEqual([true]);
  });

  it('flags its contact-details questions too (their rule is not copied, so they would always be asked)', async () => {
    const { items } = await bank({ search: 'number to call' });
    expect(items.map((i: any) => i.contactRequest)).toEqual([true]);
  });

  it('searches the wording people read (the organisation name filled in)', async () => {
    expect((await bank({ search: 'allfor care' })).items.map((i: any) => i.id)).toEqual(['a3']);
  });

  it('keeps questions apart when their answer settings differ (a score range, not-counted answers)', async () => {
    const extra = [
      survey('lib-d', 'SUR-STF-001', 'STF', [
        q('d1', 'lib-d', { questionText: 'How likely?', questionType: 'RATING', options: null, config: { min: 0, max: 10 } }),
        q('d2', 'lib-d', { config: null }),
      ]),
      survey('lib-e', 'SUR-STF-002', 'STF', [
        q('e1', 'lib-e', { questionText: 'How likely?', questionType: 'RATING', options: null, config: { min: 1, max: 5 } }),
      ]),
    ];
    rows.push(...extra);
    try {
      const { items } = await bank({ search: 'how likely' });
      expect(items.map((i: any) => i.config)).toEqual([{ min: 0, max: 10 }, { min: 1, max: 5 }]);
      const onTime = (await bank({ search: 'arrive on time' })).items;
      expect(onTime.map((i: any) => i.notCountedOptions)).toEqual([["Don't know"], []]);
    } finally {
      rows.splice(rows.length - extra.length, extra.length);
    }
  });

  it('filters by who it is for, topic and answer type, and searches help text and answers', async () => {
    expect((await bank({ audience: 'FAM' })).items.map((i: any) => i.id)).toEqual(['a1']);
    // Job applicants count as Organisation / public.
    expect((await bank({ audience: 'ORG' })).items.map((i: any) => i.id)).toEqual(['c1']);
    expect((await bank({ topic: 'training' })).items.map((i: any) => i.id)).toEqual(['c1']);
    expect((await bank({ topic: 'Visits' })).items.map((i: any) => i.id)).toEqual(['a1']);
    expect((await bank({ type: 'TEXT' })).items.map((i: any) => i.id)).toEqual(['a3']);
    expect((await bank({ search: 'within a week' })).items.map((i: any) => i.id)).toEqual(['a3']);
    expect((await bank({ search: 'medicines' })).items.map((i: any) => i.id)).toEqual(['c1']);
  });

  it('is paged', async () => {
    const first = await bank({ pageSize: 2 });
    const second = await bank({ pageSize: 2, page: 2 });
    expect([first.items.length, second.items.length, first.total]).toEqual([2, 2, 4]);
    expect(new Set([...first.items, ...second.items].map((i: any) => i.id)).size).toBe(4);
  });
});
