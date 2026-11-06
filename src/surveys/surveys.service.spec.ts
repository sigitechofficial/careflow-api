import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma, SurveyRecurrence } from '@prisma/client';
import {
  SurveysService,
  WITHHELD_TEXT_DISPLAY,
  anonymityLocked,
  branchWithin,
  isStaleUnansweredSurvey,
  keepWithheldWrittenAnswers,
  keepLookupAnswersLinkedToNoOne,
  resolveExclusiveChoices,
  surveyRetryDelayMs,
  writtenAnswerVisibility,
} from './surveys.service';
import { SurveyLinkGuard } from './survey-link-guard';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { SendSurveyDto } from './dto/send-survey.dto';
import { SubmitSurveyResponseDto } from './dto/submit-survey-response.dto';
import { DuplicateSurveyDto } from './dto/duplicate-survey.dto';
import { ReopenSurveyDto } from './dto/reopen-survey.dto';
import { flushPendingResponses, submitClaimExpiry } from './survey-pending-responses';

jest.mock('./survey-eligibility.util', () => {
  const actual = jest.requireActual('./survey-eligibility.util');
  // Who can still be sent a survey is tested in survey-eligibility.util.spec; here everyone can unless a test says.
  return { ...actual, ineligibleRecipientIds: jest.fn(async () => new Set<string>()) };
});


/* ─── Fixtures ─────────────────────────────────────────────────────────────── */

const admin: any = { id: 'admin-1', roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
const leedsManager: any = {
  id: 'mgr-leeds',
  roles: ['Manager'],
  permissions: [],
  assignedLocationIds: ['loc-leeds'],
};

function surveyRow(overrides: Record<string, unknown> = {}): any {
  const at = new Date('2026-11-01T09:00:00.000Z');
  return {
    id: 's1',
    title: 'Staff survey',
    description: null,
    targetKind: 'EMPLOYEE',
    status: 'DRAFT',
    isAnonymous: false,
    opensAt: null,
    closesAt: null,
    publishedAt: null,
    locationIds: [],
    roleIds: [],
    isTemplate: false,
    distributeAt: null,
    distributedAt: null,
    recurrence: null,
    clonedFromId: null,
    periodKey: null,
    periodOpenDays: null,
    recurrenceAnchorAt: null,
    audienceEmployeeIds: [],
    audienceServiceUserIds: [],
    scheduledById: null,
    distributionFailedAt: null,
    distributionError: null,
    shareToken: 'share-token-1',
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    createdById: 'creator-1',
    updatedById: 'creator-1',
    deletedById: null,
    ...overrides,
  };
}

const question = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1',
  surveyId: 's1',
  questionText: 'How supported do you feel?',
  helpText: null,
  questionType: 'YES_NO',
  options: null,
  config: null,
  isRequired: true,
  sortOrder: 0,
  isActive: true,
  sourceQuestionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const METHODS = [
  'findFirst',
  'findMany',
  'findUnique',
  'count',
  'create',
  'createMany',
  'update',
  'updateMany',
  'groupBy',
  'deleteMany',
] as const;
const MODELS = [
  'survey',
  'surveyQuestion',
  'surveyShareLink',
  'surveyRecipient',
  'surveyResponse',
  'surveyAnswer',
  'surveyPendingResponse',
  'cqcSurveyCapture',
  'employee',
  'employeeEmployment',
  'employeePersonalDetail',
  'serviceUser',
  'serviceUserPortalAccount',
  'user',
  'location',
  'jobTitle',
  'permission',
  'role',
  'rolePermission',
  'userRole',
  'auditLog',
] as const;

function createPrismaMock() {
  const prisma: any = {};
  for (const model of MODELS) {
    prisma[model] = {};
    for (const method of METHODS) prisma[model][method] = jest.fn();
  }
  prisma.$transaction = jest.fn();
  return prisma;
}

function resetDefaults(prisma: any) {
  for (const model of MODELS) {
    prisma[model].findMany.mockResolvedValue([]);
    prisma[model].groupBy.mockResolvedValue([]);
    prisma[model].count.mockResolvedValue(0);
    prisma[model].findFirst.mockResolvedValue(null);
    prisma[model].findUnique.mockResolvedValue(null);
    prisma[model].createMany.mockResolvedValue({ count: 0 });
    prisma[model].updateMany.mockResolvedValue({ count: 1 });
    prisma[model].deleteMany.mockResolvedValue({ count: 0 });
    prisma[model].create.mockImplementation(async (args: any) => ({ id: `${model}-new`, ...args.data }));
    prisma[model].update.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }));
  }
  // Every recipient row a send asks for is inserted (no row created by someone else in between).
  prisma.surveyRecipient.createMany.mockImplementation(async (args: any) => ({
    count: Array.isArray(args.data) ? args.data.length : 1,
  }));
  prisma.survey.create.mockImplementation(async (args: any) => {
    const { questions: _q, ...data } = args.data;
    return surveyRow({ id: 'survey-new', ...data });
  });
  prisma.survey.update.mockImplementation(async (args: any) =>
    surveyRow({ id: args.where.id, ...args.data }),
  );
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);
  // No finished day waiting to be audited unless a test says so.
  prisma.$queryRaw = jest.fn().mockResolvedValue([]);
}

/**
 * Answers linked to no one counted for the day (survey-unlinked-answer-days.ts): one entry per
 * answer, the survey, the day, and whether staff (1, 0) or a reviewer (1, 1) recorded it.
 */
function unlinkedDayCounts(prisma: any): Array<{ surveyId: string; day: string; recorded: number; reviewer: number }> {
  return (prisma.$executeRaw?.mock?.calls ?? [])
    .filter((c: any[]) => [...c[0]].join('?').includes('SurveyUnlinkedAnswerDay'))
    .map((c: any[]) => ({ surveyId: c[1], day: c[2], recorded: c[3], reviewer: c[4] }));
}

/** No answer linked to no one ever gets an audit row of its own (time + survey would date it). */
function expectNoPerAnswerAudit(audit: { logAudit: jest.Mock }) {
  const perAnswer = audit.logAudit.mock.calls.filter((c: any[]) =>
    ['survey_response_submitted', 'survey_response_recorded'].includes(c[0].action),
  );
  expect(perAnswer).toEqual([]);
}

describe('SurveysService', () => {
  const prisma = createPrismaMock();
  const audit = { logAudit: jest.fn() };
  const notifications = { notifyUsers: jest.fn() };
  const push = { sendToEmployees: jest.fn() };
  const mail = { send: jest.fn() };
  const config = { get: jest.fn(() => '') };
  const orgSettings = { getOperationalTimezone: jest.fn(async () => 'Europe/London') };
  let service: SurveysService;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaults(prisma);
    notifications.notifyUsers.mockResolvedValue({});
    service = new SurveysService(
      prisma,
      audit as any,
      config as any,
      mail as any,
      push as any,
      notifications as any,
      new OrgScopeService(prisma),
      orgSettings as any,
    );
  });

  /** findFirst for the survey under test (requireSurvey); other findFirst calls fall through. */
  const givenSurvey = (row: any) => {
    prisma.survey.findFirst.mockImplementation(async (args: any) =>
      args?.where?.id === row.id || args?.where?.shareToken === row.shareToken ? row : null,
    );
  };
  const givenQuestions = (n: number) => prisma.surveyQuestion.count.mockResolvedValue(n);
  /** What the submit put in the pending store (not a response yet). */
  const held = (i = 0) => prisma.surveyPendingResponse.create.mock.calls[i][0].data;
  /** Run the real flush over everything held so far; returns the responses it wrote. */
  const flushHeld = async () => {
    const rows = prisma.surveyPendingResponse.create.mock.calls.map((c: any[], i: number) => ({ id: `held-${i}`, ...c[0].data }));
    const bySurvey = new Map<string, number>();
    for (const r of rows) bySurvey.set(r.surveyId, (bySurvey.get(r.surveyId) ?? 0) + 1);
    prisma.surveyPendingResponse.groupBy.mockResolvedValue([...bySurvey].map(([surveyId, n]) => ({ surveyId, _count: { _all: n } })));
    prisma.surveyPendingResponse.findMany.mockImplementation(async (args: any) =>
      rows.filter((r: any) => r.surveyId === args.where.surveyId),
    );
    prisma.surveyPendingResponse.deleteMany.mockImplementation(async (args: any) => ({ count: args.where.id.in.length }));
    const before = prisma.surveyResponse.createMany.mock.calls.length;
    const answersBefore = prisma.surveyAnswer.createMany.mock.calls.length;
    await flushPendingResponses(prisma, { force: true });
    // As one create with its answers would have had them.
    const answers = prisma.surveyAnswer.createMany.mock.calls.slice(answersBefore).flatMap((c: any[]) => c[0].data);
    return prisma.surveyResponse.createMany.mock.calls
      .slice(before)
      .flatMap((c: any[]) => c[0].data)
      .map((r: any) => ({ ...r, answers: { create: answers.filter((a: any) => a.responseId === r.id) } }));
  };

  /* ─── 1. Templates are inert ──────────────────────────────────────────────── */

  describe('templates', () => {
    const template = surveyRow({ isTemplate: true });

    it('cannot be sent, scheduled, published, opened, closed or answered', async () => {
      givenSurvey(template);
      givenQuestions(3);
      await expect(service.send(admin, 's1', {})).rejects.toThrow(/template/);
      await expect(
        service.send(admin, 's1', { distributeAt: '2030-01-01T09:00:00.000Z' }),
      ).rejects.toThrow(/template/);
      await expect(service.publish(admin, 's1')).rejects.toThrow(/template/);
      await expect(service.openForResponses(admin, 's1')).rejects.toThrow(/template/);
      await expect(service.close(admin, 's1')).rejects.toThrow(/template/);
      await expect(
        service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          isAnonymous: true,
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any),
      ).rejects.toThrow(/template/);
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('does not resolve a template share link or a recipient link on a template', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ isTemplate: true, targetKind: 'PUBLIC' }));
      await expect(service.getPublicByToken('share-token-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.survey.findFirst.mockResolvedValue(null);
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'SENT',
        targetKind: 'EMPLOYEE',
        employeeId: 'e1',
        serviceUserId: null,
        response: null,
        survey: surveyRow({ isTemplate: true, status: 'ACTIVE' }),
      });
      await expect(service.getPublicByToken('tok')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('"Save as template" on a sent survey makes a template copy and leaves the live survey alone', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyRecipient.count.mockResolvedValue(12);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      const res = await service.saveAsTemplate(admin, 's1');
      expect(res.data.mode).toBe('copied');
      expect(prisma.survey.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isTemplate: true, status: 'DRAFT' }) }),
      );
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('"Save as template" on an unused draft turns it into the template', async () => {
      givenSurvey(surveyRow());
      const res = await service.saveAsTemplate(admin, 's1');
      expect(res.data.mode).toBe('moved');
      expect(prisma.survey.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isTemplate: true }) }),
      );
      expect(prisma.survey.create).not.toHaveBeenCalled();
    });

    it('rejects isTemplate:true through update once the survey has recipients', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyRecipient.count.mockResolvedValue(1);
      await expect(service.update(admin, 's1', { isTemplate: true })).rejects.toThrow(/Save as template/);
    });

    it('never keeps a schedule on a template', async () => {
      givenSurvey(surveyRow({ distributeAt: new Date('2030-01-01'), recurrence: 'MONTHLY' }));
      await service.update(admin, 's1', { isTemplate: true });
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        isTemplate: true,
        distributeAt: null,
        recurrence: null,
      });
    });

    it('the scheduler never picks up templates', async () => {
      await service.runDueDistributions(new Date());
      expect(prisma.survey.findMany.mock.calls[0][0].where).toMatchObject({ isTemplate: false });
    });
  });

  /* ─── 1b. Ready-made (catalogue) surveys are invisible ───────────────────── */

  describe('ready-made (catalogue) surveys', () => {
    const catalogue = surveyRow({
      id: 'lib-1',
      isTemplate: true,
      isCatalogue: true,
      targetKind: 'PUBLIC',
      status: 'ACTIVE',
      libraryReference: 'SUR-PWS-001',
      libraryRevision: 1,
    });
    /** The database only returns the catalogue survey when the query does not exclude it. */
    const givenCatalogue = () => {
      prisma.survey.findFirst.mockImplementation(async (args: any) =>
        args?.where?.isCatalogue === false ? null : catalogue,
      );
      givenQuestions(3);
    };

    it.each([
      ['getById', (s: SurveysService) => s.getById(admin, 'lib-1')],
      ['results', (s: SurveysService) => s.results(admin, 'lib-1')],
      ['responses', (s: SurveysService) => s.listResponses(admin, 'lib-1')],
      ['recipients', (s: SurveysService) => s.listRecipients(admin, 'lib-1')],
      ['record candidates', (s: SurveysService) => s.listRecordCandidates(admin, 'lib-1')],
      ['send', (s: SurveysService) => s.send(admin, 'lib-1', {})],
      ['schedule', (s: SurveysService) => s.send(admin, 'lib-1', { distributeAt: '2030-01-01T09:00:00.000Z' })],
      ['publish', (s: SurveysService) => s.publish(admin, 'lib-1')],
      ['open', (s: SurveysService) => s.openForResponses(admin, 'lib-1')],
      ['close', (s: SurveysService) => s.close(admin, 'lib-1')],
      ['cancel schedule', (s: SurveysService) => s.cancelSchedule(admin, 'lib-1')],
      [
        'record',
        (s: SurveysService) =>
          s.recordResponse(admin, 'lib-1', {
            channel: 'PAPER',
            isAnonymous: true,
            answers: [{ questionId: 'q1', booleanValue: true }],
          } as any),
      ],
      ['use / duplicate', (s: SurveysService) => s.duplicate(admin, 'lib-1')],
      ['save as template', (s: SurveysService) => s.saveAsTemplate(admin, 'lib-1')],
      ['update', (s: SurveysService) => s.update(admin, 'lib-1', { title: 'Mine now' })],
      ['delete', (s: SurveysService) => s.remove(admin, 'lib-1')],
      ['add question', (s: SurveysService) => s.addQuestion(admin, 'lib-1', { questionText: 'Q?', questionType: 'YES_NO' } as any)],
    ])('%s cannot reach a catalogue survey', async (_name, call) => {
      givenCatalogue();
      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.survey.create).not.toHaveBeenCalled();
      expect(prisma.survey.update).not.toHaveBeenCalled();
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('are left out of the survey and template lists', async () => {
      await service.list(admin, {});
      await service.list(admin, { isTemplate: 'true' } as any);
      await service.list(leedsManager, {});
      for (const [args] of prisma.survey.findMany.mock.calls) {
        expect(args.where).toMatchObject({ isCatalogue: false });
      }
    });

    it('are never picked up by the scheduler', async () => {
      await service.runDueDistributions(new Date());
      expect(prisma.survey.findMany.mock.calls[0][0].where).toMatchObject({ isTemplate: false, isCatalogue: false });
    });

    it('never appear in the portal or the carer app', async () => {
      await service.listForServiceUserPortal('su-1');
      await service.listForEmployeeApp('emp-1');
      for (const [args] of prisma.surveyRecipient.findMany.mock.calls) {
        expect(args.where.survey).toMatchObject({ isTemplate: false, isCatalogue: false });
      }
      await expect(service.getPortalSurveyAnswers('su-1', 'tok')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.surveyRecipient.findFirst.mock.calls[0][0].where.survey).toMatchObject({ isCatalogue: false });
    });

    it('have no working share link or recipient link', async () => {
      prisma.survey.findFirst.mockResolvedValue(catalogue);
      await expect(service.getPublicByToken('share-token-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.survey.findFirst.mockResolvedValue(null);
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'SENT',
        targetKind: 'EMPLOYEE',
        employeeId: 'e1',
        serviceUserId: null,
        response: null,
        // Even if a catalogue row were somehow marked live, its links stay dead.
        survey: { ...catalogue, isTemplate: false, targetKind: 'EMPLOYEE' },
      });
      await expect(service.getPublicByToken('tok')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getEmployeeAppForm('e1', 'tok')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('section headings travel with questions: builder, copies and the form', async () => {
      const adopted = surveyRow({ id: 's1', isTemplate: true, libraryReference: 'SUR-PWS-001', libraryRevision: 1, librarySourceId: 'lib-1' });
      givenSurvey(adopted);
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ sectionTitle: 'Your visits' })]);
      const detail = await service.getById(admin, 's1');
      expect(detail.data).toMatchObject({ libraryReference: 'SUR-PWS-001', libraryRevision: 1, librarySourceId: 'lib-1' });
      expect(detail.data.questions[0].sectionTitle).toBe('Your visits');

      await service.duplicate(admin, 's1');
      const copy = prisma.survey.create.mock.calls[0][0].data;
      expect(copy.questions.create[0].sectionTitle).toBe('Your visits');
      // A survey started from an adopted template is the organisation's own, not linked to the library.
      expect(copy.librarySourceId).toBeUndefined();
      expect(copy.isCatalogue).toBeUndefined();

      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
      const form = await service.getPublicByToken('share-token-1');
      expect(form.data.questions[0].sectionTitle).toBe('Your visits');
    });

    it('starting from a template sets the new survey’s own start and end (never the source’s)', async () => {
      givenSurvey(
        surveyRow({
          id: 's1',
          isTemplate: true,
          opensAt: new Date('2026-01-01T09:00:00.000Z'),
          closesAt: new Date('2026-01-31T17:00:00.000Z'),
        }),
      );
      await service.duplicate(admin, 's1');
      let data = prisma.survey.create.mock.calls[0][0].data;
      expect(data.opensAt).toBeUndefined();
      expect(data.closesAt).toBeUndefined();

      prisma.survey.create.mockClear();
      await service.duplicate(admin, 's1', {
        opensAt: '2027-02-01T09:00:00.000Z',
        closesAt: '2027-03-01T17:00:00.000Z',
      });
      data = prisma.survey.create.mock.calls[0][0].data;
      expect(data.opensAt).toEqual(new Date('2027-02-01T09:00:00.000Z'));
      expect(data.closesAt).toEqual(new Date('2027-03-01T17:00:00.000Z'));
      expect(data.status).toBe('DRAFT');

      prisma.survey.create.mockClear();
      await expect(
        service.duplicate(admin, 's1', { opensAt: '2027-03-01T09:00:00.000Z', closesAt: '2027-02-01T09:00:00.000Z' }),
      ).rejects.toThrow(/end must be after the start/);
      expect(prisma.survey.create).not.toHaveBeenCalled();
    });

    it('"Use" keeps who a template is for, and a ready-made template’s anonymity (API, not just the dialog)', async () => {
      givenSurvey(surveyRow({ id: 's1', isTemplate: true, targetKind: 'SERVICE_USER' }));
      await expect(service.duplicate(admin, 's1', { targetKind: 'EMPLOYEE' })).rejects.toThrow(/same people as the template/);
      // Anonymity of the organisation's own template can be chosen.
      await service.duplicate(admin, 's1', { targetKind: 'SERVICE_USER', isAnonymous: true });
      expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({ targetKind: 'SERVICE_USER', isAnonymous: true });

      prisma.survey.create.mockClear();
      givenSurvey(surveyRow({ id: 's1', isTemplate: true, isAnonymous: true, librarySourceId: 'lib-1' }));
      await expect(service.duplicate(admin, 's1', { isAnonymous: false })).rejects.toThrow(/ready-made survey that is anonymous/);
      expect(prisma.survey.create).not.toHaveBeenCalled();
      await service.duplicate(admin, 's1', { isAnonymous: true });
      expect(prisma.survey.create).toHaveBeenCalledTimes(1);

      // Duplicating a survey (not a template) can still change who it is for.
      prisma.survey.create.mockClear();
      givenSurvey(surveyRow({ id: 's1' }));
      await service.duplicate(admin, 's1', { targetKind: 'SERVICE_USER' });
      expect(prisma.survey.create.mock.calls[0][0].data.targetKind).toBe('SERVICE_USER');
    });
  });

  /* ─── 2. Anonymity ─────────────────────────────────────────────────────────── */

  describe('anonymous surveys', () => {
    it('cannot switch anonymity once sent or answered', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      prisma.surveyResponse.count.mockResolvedValue(2);
      await expect(service.update(admin, 's1', { isAnonymous: false })).rejects.toThrow(/Anonymity/);
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('returns status counts only — no names or completion times', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      prisma.surveyRecipient.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: { _all: 3 } },
        { status: 'SENT', _count: { _all: 5 } },
      ]);
      const res = await service.listRecipients(admin, 's1');
      expect(res.data.recipients).toEqual([]);
      expect(res.data.counts).toEqual({ total: 8, notStarted: 5, opened: 0, completed: 3, lapsed: null });
      expect(prisma.surveyRecipient.findMany).not.toHaveBeenCalled();
    });

    it('lists anonymous answers without people, ids or times', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      prisma.surveyResponse.findMany.mockResolvedValue([
        {
          id: 'resp-1',
          surveyId: 's1',
          recipientId: null,
          recipient: null,
          submittedAt: new Date('2026-11-04T00:00:00.000Z'),
          respondentRelation: null,
          respondentName: 'should not show',
          channel: 'ONLINE',
          isAnonymous: false,
          recordedById: null,
          contactedAt: new Date('2026-11-04T10:12:00.000Z'),
          contactNumber: '07000',
          contactNotes: null,
          consentGiven: null,
          answers: [],
        },
      ]);
      const res = await service.listResponses(admin, 's1');
      const [row] = res.data.responses;
      expect(row).toMatchObject({
        respondentLabel: 'Anonymous respondent #1',
        employeeId: null,
        serviceUserId: null,
        respondentName: null,
        contactNumber: null,
        contactedAt: null,
        submittedDateOnly: true,
      });
      expect(prisma.employeePersonalDetail.findMany).not.toHaveBeenCalled();
    });

    it('shows an equality group on an anonymous response only when at least 10 chose it', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED' }));
      const q = { id: 'q-eth', questionText: 'What is your ethnic group?', questionType: 'SINGLE_SELECT', options: null, sortOrder: 0, sectionTitle: null, otherOption: null, optionsFrom: 'ETHNICITY', sourceQuestionId: null };
      const row = (i: number, name: string) => ({
        id: `resp-${i}`, surveyId: 's1', recipientId: null, recipient: null, submittedAt: new Date('2026-11-04T00:00:00.000Z'),
        respondentRelation: null, respondentName: null, channel: 'ONLINE', isAnonymous: false, recordedById: null,
        contactedAt: null, contactNumber: null, contactNotes: null, consentGiven: null,
        answers: [{ questionId: 'q-eth', booleanValue: null, textValue: null, numberValue: null, selectedOptions: [name], lookupCodes: null, otherText: null, comment: null, question: q }],
      });
      prisma.surveyResponse.findMany.mockResolvedValue([...Array.from({ length: 10 }, (_, i) => row(i, 'Asian - Gujarati')), row(10, 'Arab')]);
      const res = await service.listResponses(admin, 's1');
      const shown = res.data.responses.map((r: any) => r.answers[0].selectedOptions[0]);
      expect(shown.filter((x: string) => x === 'Asian')).toHaveLength(10);
      expect(shown).not.toContain('Arab');
      expect(shown).not.toContain('Asian - Gujarati');
      expect(shown).toContain('Not shown (fewer than 10 chose this group)');
      // What the page shows (displayValue) follows the same rule: never the small group's name.
      const display = res.data.responses.map((r: any) => r.answers[0].displayValue);
      expect(display).not.toContain('Arab');
      expect(display).toContain('Not shown (fewer than 10 chose this group)');
      expect(display.filter((x: string) => x === 'Asian')).toHaveLength(10);
    });

    it('named survey: a without-name answer\'s group is counted among without-name answers only', async () => {
      givenSurvey(surveyRow({ isAnonymous: false, status: 'CLOSED' }));
      const q = { id: 'q-eth', questionText: 'What is your ethnic group?', questionType: 'SINGLE_SELECT', options: null, sortOrder: 0, sectionTitle: null, otherOption: null, optionsFrom: 'ETHNICITY', sourceQuestionId: null };
      const row = (i: number, name: string, unlinked: boolean) => ({
        id: `resp-${i}`, surveyId: 's1', recipientId: unlinked ? null : `rec-${i}`, recipient: unlinked ? null : { id: `rec-${i}`, employeeId: `emp-${i}`, serviceUserId: null },
        submittedAt: new Date('2026-11-04T00:00:00.000Z'), respondentRelation: null, respondentName: null, channel: 'ONLINE', isAnonymous: unlinked, recordedById: null,
        contactedAt: null, contactNumber: null, contactNotes: null, consentGiven: null,
        answers: [{ questionId: 'q-eth', booleanValue: null, textValue: null, numberValue: null, selectedOptions: [name], lookupCodes: null, otherText: null, comment: null, question: q }],
      });
      // 9 named Arab answers and 1 without a name: the named ones must not lift it to 10.
      prisma.surveyResponse.findMany.mockResolvedValue([
        ...Array.from({ length: 9 }, (_, i) => row(i, 'Arab', false)),
        row(9, 'Arab', true),
        // Enough answers without a name that they are listed once closed.
        ...Array.from({ length: 9 }, (_, i) => row(10 + i, 'White - English, Welsh, Scottish, Northern Irish or British', true)),
      ]);
      const res = await service.listResponses(admin, 's1');
      const unlinked = res.data.responses.find((r: any) => r.id === 'resp-9');
      expect(unlinked?.answers[0].displayValue).toBe('Not shown (fewer than 10 chose this group)');
    });

    it('someone who can no longer be sent it: their link says it is closed for them, and an answer is refused', async () => {
      const elig = jest.requireMock('./survey-eligibility.util').ineligibleRecipientIds as jest.Mock;
      elig.mockResolvedValueOnce(new Set(['r1']));
      const survey = surveyRow({ isAnonymous: false, status: 'ACTIVE' });
      const row = { id: 'r1', token: 'tok', status: 'SENT', targetKind: 'EMPLOYEE', employeeId: 'emp-1', serviceUserId: null, response: null, survey };
      prisma.surveyRecipient.findUnique.mockResolvedValue(row);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      const form = await service.getPublicByToken('tok');
      expect(form.data).toMatchObject({ canSubmit: false, unavailableKind: 'CLOSED_FOR_YOU', unavailableReason: 'This survey is closed for you. Thank you.' });
      expect(prisma.surveyRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: { in: ['PENDING', 'SENT', 'STARTED'] } },
        data: { status: 'LAPSED', invitationTextPending: false },
      });
      prisma.surveyRecipient.findUnique.mockResolvedValue({ ...row, status: 'LAPSED' });
      await expect(service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: false }] })).rejects.toThrow(/closed for you/);
      // Already answered: never lapsed, answers kept (the check is not even made).
      prisma.surveyRecipient.updateMany.mockClear();
      prisma.surveyRecipient.findUnique.mockResolvedValue({ ...row, status: 'COMPLETED', response: { id: 'resp', submittedAt: new Date() } });
      const done = await service.getPublicByToken('tok');
      expect(done.data.unavailableKind).not.toBe('CLOSED_FOR_YOU');
      expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
    });

    it('a lapsed invitation is sent again only by staff, on a named survey, once the person can be sent it again', async () => {
      const elig = jest.requireMock('./survey-eligibility.util').ineligibleRecipientIds as jest.Mock;
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      await expect(service.resendLapsed(admin, 's1', 'r1')).rejects.toThrow(/never single out one person/);
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyRecipient.findFirst.mockResolvedValue({ id: 'r1', token: 'tok', status: 'LAPSED', employeeId: 'emp-1', serviceUserId: null, externalContactId: null });
      elig.mockResolvedValueOnce(new Set(['r1']));
      await expect(service.resendLapsed(admin, 's1', 'r1')).rejects.toThrow(/still cannot be sent/);
      await service.resendLapsed(admin, 's1', 'r1');
      expect(prisma.surveyRecipient.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'SENT', sentAt: expect.any(Date) } });
    });

    it('an outside person is sent it again through the outside-people path (checks first, then their own link); a refusal changes nothing', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'PUBLIC' }));
      prisma.surveyRecipient.findFirst.mockResolvedValue({ id: 'r9', token: 'tok-9', status: 'LAPSED', employeeId: null, serviceUserId: null, externalContactId: 'x1' });
      prisma.surveyRecipient.update.mockClear();
      const row = { id: 'x1', name: 'Dr Sam Patel', email: 'sam@hill.example' };
      const outside = {
        checkResend: jest.fn(async () => ({ row, reasonUsed: 'End-of-life care review' })),
        deliverOne: jest.fn(async () => undefined),
      };
      (service as any).outside = outside;
      await service.resendLapsed(admin, 's1', 'r9', undefined, undefined, 'End-of-life care review');
      expect(outside.checkResend).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'x1', 'End-of-life care review');
      expect(prisma.surveyRecipient.update).toHaveBeenCalledWith({ where: { id: 'r9' }, data: { status: 'SENT', sentAt: expect.any(Date) } });
      expect(outside.deliverOne).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'tok-9', row, undefined);
      const entry = audit.logAudit.mock.calls.at(-1)[0];
      expect(entry.newValues).toMatchObject({ afterDeathReason: 'End-of-life care review' });
      expect(JSON.stringify(entry)).not.toMatch(/Patel|hill\.example/);
      // Refused (e.g. needs a reason): never marked sent.
      prisma.surveyRecipient.update.mockClear();
      outside.checkResend.mockRejectedValueOnce(new Error('The person this survey is about has died. Say why'));
      await expect(service.resendLapsed(admin, 's1', 'r9')).rejects.toThrow(/Say why/);
      expect(prisma.surveyRecipient.update).not.toHaveBeenCalled();
      (service as any).outside = undefined;
    });

    it('stores an anonymous answer without the recipient link and with the date only', async () => {
      const survey = surveyRow({ isAnonymous: true, status: 'ACTIVE' });
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'STARTED',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey,
      });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.employeeEmployment.findFirst.mockResolvedValue({ locationId: 'loc-leeds', jobTitleId: 'jt-carer' });
      prisma.permission.findMany.mockResolvedValue([{ id: 'p1' }]);
      prisma.rolePermission.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'office-1' }]);
      prisma.survey.findUnique.mockResolvedValue({ title: 'Staff survey', isAnonymous: true });

      await service.submitPublicResponse(
        'tok',
        { answers: [{ questionId: 'q1', booleanValue: false }] },
        { ipAddress: '10.0.0.7', userAgent: 'CarerApp' } as any,
      );

      // Held first (no response yet), then written by the survey job.
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      const [data] = await flushHeld();
      expect(data.recipientId).toBeNull();
      expect(data.surveyId).toBe('s1');
      expect(data.locationId).toBe('loc-leeds');
      // Branch only: a job title could single the respondent out.
      expect(data.jobTitleId).toBeNull();
      const day = new Date(data.submittedAt);
      expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(day)).toBe('00:00');
      expect(prisma.surveyRecipient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
      // No audit row of its own (no recipient, response, device or exact time): one more in the
      // survey's count for the day, written to the audit log once the day is over.
      expectNoPerAnswerAudit(audit);
      expect(unlinkedDayCounts(prisma)).toEqual([{ surveyId: 's1', day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), recorded: 0, reviewer: 0 }]);

      // The office is not told at the moment it came in (its time would date it): one summary a day.
      await new Promise((r) => setImmediate(r));
      expect(prisma.employeePersonalDetail.findFirst).not.toHaveBeenCalled();
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
    });

    it('answers linked to no one: the office gets one summary a day per staff survey, only people with results access, never the rated manager', async () => {
      // A finished day's count, as the survey job finds it.
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ surveyId: 's1', day: '2026-11-04', answers: 3, recorded: 0, reviewerRecorded: 0 }]);
      prisma.$executeRaw = jest.fn().mockResolvedValue(1);
      prisma.survey.findUnique.mockResolvedValue({
        ...surveyRow({ status: 'ACTIVE', isAnonymous: true, targetKind: 'EMPLOYEE', locationIds: ['loc-leeds'] }),
        // A "Feedback on your manager" copy: the manager it rates never sees its answers.
        accessPolicy: {
          responses: { restricted: false, ownerKeys: [], roleIds: [], userIds: [] },
          results: { restricted: false, ownerKeys: [], roleIds: [], userIds: [] },
          excludeUserIds: ['rated-1'],
        },
      });
      prisma.permission.findMany.mockResolvedValue([{ id: 'p1' }]);
      prisma.rolePermission.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'office-1' }, { userId: 'rated-1' }, { userId: 'other-branch' }]);
      prisma.user.findMany.mockResolvedValue([
        // Branches as at sign-in: given to the account, or (none given) those of their own employment.
        { id: 'office-1', email: 'o@x', userRoles: [{ role: { name: 'Care Coordinator' } }], userLocations: [{ locationId: 'loc-leeds' }] },
        { id: 'rated-1', email: 'r@x', userRoles: [{ role: { name: 'Manager' } }], userLocations: [{ locationId: 'loc-leeds' }] },
        { id: 'other-branch', email: 'b@x', userRoles: [{ role: { name: 'Manager' } }], userLocations: [{ locationId: 'loc-york' }] },
      ]);
      prisma.surveyRecipient.count.mockResolvedValueOnce(12).mockResolvedValueOnce(30);
      await service.flushPendingResponses({ now: new Date('2026-11-05T09:00:00Z') });
      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      const note = notifications.notifyUsers.mock.calls[0][0];
      expect(note.recipientUserIds).toEqual(['office-1']);
      expect(note.message).toBe('3 answers to "Staff survey" not linked to anyone came in on 4 Nov 2026. 12 of 30 have now answered.');
      expect(note.metadata).toMatchObject({ surveyId: 's1', day: '2026-11-04' });
      // Close the survey's audit for the day in the same run.
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_unlinked_answers_counted', recordId: 's1' }));
    });

    it('names the carer in the office notification only for named surveys', async () => {
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'SENT',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey: surveyRow({ status: 'ACTIVE' }),
      });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.role.findMany.mockResolvedValue([{ id: 'sa' }]);
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'office-1' }]);
      prisma.survey.findUnique.mockResolvedValue({ ...surveyRow({ status: 'ACTIVE' }), title: 'Staff survey', isAnonymous: false });
      prisma.user.findMany.mockResolvedValue([{ id: 'office-1', email: 'o@x', userRoles: [{ role: { name: 'Super Admin' } }], userLocations: [] }]);
      prisma.employeePersonalDetail.findFirst.mockResolvedValue({ firstName: 'Jo', lastName: 'Bloggs' });

      await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
      await new Promise((r) => setImmediate(r));
      expect(prisma.surveyResponse.create.mock.calls[0][0].data.recipientId).toBe('r1');
      expect(notifications.notifyUsers.mock.calls[0][0].message).toMatch(/^Jo Bloggs completed/);
    });

    it('records a named phone answer on an anonymous survey without linking it', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
      prisma.serviceUser.findFirst.mockResolvedValue({ locationId: 'loc-leeds', assignments: [] });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      await service.recordResponse(admin, 's1', {
        channel: 'TELEPHONE',
        consentGiven: true,
        personId: 'su-1',
        contactNumber: '0113 000',
        respondentRelation: 'FAMILY_MEMBER',
        respondentName: 'Ann',
        answers: [{ questionId: 'q1', booleanValue: true }],
      } as any);
      expect(JSON.stringify(held())).not.toMatch(/0113|Ann|su-1|admin-1/);
      const [data] = await flushHeld();
      expect(data).toMatchObject({ recipientId: null, respondentName: null, respondentRelation: 'FAMILY_MEMBER', consentGiven: true });
      expect(data).not.toHaveProperty('contactNumber');
      expect(data).not.toHaveProperty('recordedById');
    });

    it('withholds the branch breakdown under 5 anonymous responses (and has no job title one)', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED' }));
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) => {
        if (args.by[0] === 'locationId') return [{ locationId: 'loc-leeds', _count: { _all: 3 } }];
        if (args.by[0] === 'jobTitleId') return [{ jobTitleId: 'jt-1', _count: { _all: 3 } }];
        return [{ surveyId: 's1', _count: { _all: 3 } }];
      });
      // Updated with the reporting threshold (survey-access.ts): under 5 responses an anonymous
      // survey shows no figures or breakdowns at all, only how many more answers are needed.
      const res = await service.results(admin, 's1');
      expect(res.data.reporting).toMatchObject({ threshold: 5, counted: 3, belowThreshold: true });
      expect(res.data.reporting.note).toMatch(/^2 more answers are needed before results show/);
      expect(res.data.breakdowns).toEqual([]);
      expect(res.data.questionSummaries).toEqual([]);
      expect(res.data.headline).toBeNull();
      expect(prisma.surveyResponse.groupBy.mock.calls.map((c: any[]) => c[0].by[0])).not.toContain('jobTitleId');
    });
  });

  /* ─── 3 & 4. Sending, scheduling and audience ─────────────────────────────── */

  describe('send / schedule', () => {
    const future = '2030-03-04T09:00:00.000Z';

    beforeEach(() => {
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', employment: { locationId: 'loc-leeds' } },
      ]);
    });

    it('never sends a survey that still says {{manager}} (it is the starting point for copies per manager)', async () => {
      givenSurvey(surveyRow());
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ questionText: 'Does {{manager}} listen to you?' })]);
      await expect(service.send(admin, 's1', { employeeIds: ['emp-1'] })).rejects.toThrow(/Make a copy for each manager/);
      givenSurvey(surveyRow({ title: 'Feedback on {{manager}}' }));
      await expect(service.send(admin, 's1', { employeeIds: ['emp-1'] })).rejects.toThrow(/still says \{\{manager\}\}/);
      // Also in an answer, a section title or a section introduction.
      givenSurvey(surveyRow());
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ questionType: 'SINGLE_SELECT', options: ['{{manager}}', 'Someone else'] })]);
      await expect(service.send(admin, 's1', { employeeIds: ['emp-1'] })).rejects.toThrow(/still says/);
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ sectionTitle: 'About {{manager}}' })]);
      await expect(service.send(admin, 's1', { employeeIds: ['emp-1'] })).rejects.toThrow(/still says/);
      givenSurvey(surveyRow({ sectionIntros: { Visits: 'About {{manager}}.' } }));
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      await expect(service.send(admin, 's1', { employeeIds: ['emp-1'] })).rejects.toThrow(/still says/);
      expect(prisma.surveyRecipient.create ?? prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('a copy made for each manager is not sent or scheduled once its team has shrunk below its minimum', async () => {
      const copy = surveyRow({ isAnonymous: true, audienceEmployeeIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] });
      givenSurvey(copy);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.survey.findUnique.mockImplementation(async (args: any) =>
        args?.select?.managerCopy ? { managerCopy: { managerUserIds: ['u-sam'], pooled: false, minTeam: 6 }, audienceEmployeeIds: copy.audienceEmployeeIds } : copy,
      );
      // One of the six has since left (or now has another manager).
      prisma.employeeEmployment.findMany.mockResolvedValue([1, 2, 3, 4, 5].map(() => ({ supervisorUserId: 'u-sam' })));
      await expect(service.send(admin, 's1', { employeeIds: copy.audienceEmployeeIds })).rejects.toThrow(
        /Fewer than 6 of this manager’s staff are still named under them/,
      );
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
      // A scheduled send is reported to whoever scheduled it, not sent.
      prisma.survey.findMany.mockResolvedValue([{ ...copy, distributeAt: new Date('2026-11-01T09:00:00Z'), distributedAt: null, scheduledById: 'admin-1' }]);
      const [run] = await service.runDueDistributions(new Date('2026-11-01T09:00:30Z'));
      expect(run).toMatchObject({ surveyId: 's1', ok: false });
      expect(run!.detail).toMatch(/Fewer than 6/);
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('keeps the chosen branches, job titles and people on a scheduled send', async () => {
      givenSurvey(surveyRow());
      await service.send(admin, 's1', {
        distributeAt: future,
        locationIds: ['loc-leeds'],
        roleIds: ['jt-carer'],
        employeeIds: ['emp-1'],
      });
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        distributeAt: new Date(future),
        locationIds: ['loc-leeds'],
        roleIds: ['jt-carer'],
        audienceEmployeeIds: ['emp-1'],
        scheduledById: 'admin-1',
      });
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('clearing job titles means all job titles', async () => {
      givenSurvey(surveyRow({ roleIds: ['jt-old'] }));
      await service.send(admin, 's1', { distributeAt: future, roleIds: [] });
      expect(prisma.survey.update.mock.calls[0][0].data.roleIds).toEqual([]);
      const where = prisma.employee.findMany.mock.calls[0][0].where;
      expect(where.employment).toBeUndefined();
    });

    it('the scheduled run uses the saved audience and the scheduler as the acting user', async () => {
      const due = surveyRow({
        distributeAt: new Date('2026-11-05T09:00:00.000Z'),
        locationIds: ['loc-leeds'],
        roleIds: ['jt-carer'],
        scheduledById: 'mgr-leeds',
      });
      prisma.survey.findMany.mockResolvedValue([due]);
      prisma.surveyRecipient.findMany.mockResolvedValue([]);
      const out = await service.runDueDistributions(new Date('2026-11-05T09:00:30.000Z'));
      expect(out[0].ok).toBe(true);
      expect(prisma.employee.findMany.mock.calls[0][0].where.employment).toEqual({
        locationId: { in: ['loc-leeds'] },
        jobTitleId: { in: ['jt-carer'] },
      });
      const recipients = prisma.surveyRecipient.createMany.mock.calls[0][0].data;
      expect(recipients[0].createdById).toBe('mgr-leeds');
      expect(recipients[0].createdById).not.toBe(due.id);
      expect(audit.logAudit.mock.calls[0][0].userId).toBe('mgr-leeds');
    });

    it('cannot schedule a survey without questions', async () => {
      givenSurvey(surveyRow());
      givenQuestions(0);
      await expect(service.send(admin, 's1', { distributeAt: future })).rejects.toThrow(/at least one question/);
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('a due run with no questions is marked failed and the scheduler told — not retried', async () => {
      const due = surveyRow({ distributeAt: new Date('2026-11-05T09:00:00.000Z'), scheduledById: 'admin-1' });
      prisma.survey.findMany.mockResolvedValue([due]);
      givenQuestions(0);
      const out = await service.runDueDistributions(new Date('2026-11-05T09:01:00.000Z'));
      expect(out[0]).toMatchObject({ ok: false });
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        distributionFailedAt: expect.any(Date),
        distributionError: expect.stringMatching(/no questions/),
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserIds: ['admin-1'], severity: 'WARNING' }),
      );
      expect(prisma.survey.findMany.mock.calls[0][0].where).toMatchObject({ distributionFailedAt: null });
    });

    it('send now with a repeat starts the series immediately (repeat is honoured)', async () => {
      givenSurvey(surveyRow());
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      const res = await service.send(admin, 's1', { recurrence: SurveyRecurrence.MONTHLY });
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({ recurrence: 'MONTHLY' });
      const clone = prisma.survey.create.mock.calls[0][0].data;
      expect(clone).toMatchObject({ clonedFromId: 's1', status: 'ACTIVE' });
      expect(res.data.sent).toBe(1);
    });

    it('never sends or schedules a one-off survey that would already have ended', async () => {
      givenSurvey(surveyRow({ closesAt: new Date('2020-01-01T09:00:00.000Z') }));
      await expect(service.send(admin, 's1', {})).rejects.toThrow(/end date \(.*\) has passed, so people could not answer it/);
      givenSurvey(surveyRow({ closesAt: new Date('2030-03-01T09:00:00.000Z') }));
      await expect(service.send(admin, 's1', { distributeAt: future })).rejects.toThrow(/ends on .*, before it would be sent/);
      expect(prisma.survey.update).not.toHaveBeenCalled();
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
      // An end date after the send time is fine.
      givenSurvey(surveyRow({ closesAt: new Date('2030-04-01T09:00:00.000Z') }));
      await service.send(admin, 's1', { distributeAt: future });
      expect(prisma.survey.update).toHaveBeenCalled();
    });

    it('a scheduled one-off whose end date passed first is not sent: marked failed and the scheduler told', async () => {
      const due = surveyRow({
        distributeAt: new Date('2026-11-05T09:00:00.000Z'),
        closesAt: new Date('2026-11-05T08:00:00.000Z'),
        scheduledById: 'admin-1',
      });
      prisma.survey.findMany.mockResolvedValue([due]);
      const out = await service.runDueDistributions(new Date('2026-11-05T09:00:30.000Z'));
      expect(out[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/end date passed/) });
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({ distributionFailedAt: expect.any(Date) });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: ['admin-1'] }));
    });

    it('rejects sending to nobody before saving anything', async () => {
      givenSurvey(surveyRow());
      prisma.employee.findMany.mockResolvedValue([]);
      await expect(service.send(admin, 's1', { distributeAt: future })).rejects.toThrow(/No active employees/);
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('anonymous survey invitations carry no personal link or token (email or app)', async () => {
      givenSurvey(surveyRow({ isAnonymous: true }));
      const ids = ['e1', 'e2', 'e3', 'e4', 'e5'];
      prisma.employee.findMany.mockResolvedValue(ids.map((id) => ({ id, employment: { locationId: 'loc-leeds' } })));
      prisma.employeePersonalDetail.findMany.mockResolvedValue(ids.map((id) => ({ employeeId: id, firstName: 'Sam', email: `${id}@example.test` })));
      config.get.mockImplementation(((key: string) => (key === 'app.adminAppUrl' ? 'https://care.example' : '')) as any);
      push.sendToEmployees.mockResolvedValue({ sent: 1 });
      await service.send(admin, 's1', {});
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      const tokens = prisma.surveyRecipient.createMany.mock.calls[0][0].data.map((r: any) => r.token);
      const sent = JSON.stringify([push.sendToEmployees.mock.calls, mail.send.mock.calls]);
      expect(mail.send).toHaveBeenCalled();
      expect(sent).not.toContain('/survey/');
      for (const t of tokens) expect(sent).not.toContain(t);
      expect(mail.send.mock.calls[0][0].text).toMatch(/Open Surveys in the carer app/);
      config.get.mockImplementation((() => '') as any);
    });

    describe('the 4-week contact rule', () => {
      const withRule = (apply: jest.Mock) => {
        const contactRule = { apply, recordHeld: jest.fn(), ruleFor: jest.fn(async () => ({ owner: surveyRow(), rule: { holdBack: true } })) };
        const svc = new SurveysService(
          prisma, audit as any, config as any, mail as any, push as any, notifications as any,
          new OrgScopeService(prisma), orgSettings as any, undefined, undefined, undefined, undefined, contactRule as any,
        );
        return { svc, contactRule };
      };
      const twoStaff = () =>
        prisma.employee.findMany.mockResolvedValue([
          { id: 'emp-1', employment: { locationId: 'loc-leeds' } },
          { id: 'emp-2', employment: { locationId: 'loc-leeds' } },
        ]);

      it('staff who left in the last 3 months can be chosen by name: no reason on leavers’ surveys, a reason on any other', async () => {
        givenSurvey(surveyRow({ libraryReference: 'SUR-STF-015', audienceEmployeeIds: ['emp-left'] }));
        givenQuestions(1);
        prisma.employee.count.mockResolvedValue(1);
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-left', employment: { locationId: 'loc-leeds' } }]);
        const { svc } = withRule(jest.fn(async () => ({ sendIds: ['emp-left'], held: [], sampledOut: 0, skipped: [], holdBack: false })));
        await svc.send(admin, 's1', { employeeIds: ['emp-left'] });
        const where = prisma.employee.findMany.mock.calls.find((c: any) => c[0]?.where?.id?.in?.includes('emp-left'))[0].where;
        expect(where.isActive).toBeUndefined();
        expect(where.OR[0]).toEqual({ isActive: true });
        expect(where.OR[1]).toMatchObject({ isActive: false, deletedAt: null });
        // Any other survey (decision, November 2026): they can be chosen by name too, but only with a reason.
        givenSurvey(surveyRow({ libraryReference: 'SUR-STF-001', audienceEmployeeIds: ['emp-left'] }));
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-left', isActive: false, employment: { locationId: 'loc-leeds' } }]);
        await expect(svc.send(admin, 's1', { employeeIds: ['emp-left'] })).rejects.toThrow(/Say why someone who has left/);
        audit.logAudit.mockClear();
        await svc.send(admin, 's1', { employeeIds: ['emp-left'], formerReason: 'Exit views on the new rota' });
        const sent = audit.logAudit.mock.calls.map((c: any) => c[0]).find((e: any) => e.action === 'survey_sent');
        expect(sent.newValues).toMatchObject({ formerPeople: 1, formerReason: 'Exit views on the new rota' });
        // Never on a schedule or a repeat.
        await expect(svc.send(admin, 's1', { employeeIds: ['emp-left'], distributeAt: '2030-01-06T09:00:00Z', formerReason: 'Exit views' })).rejects.toThrow(/only be sent a survey now/);
      });

      it('someone whose care ended: their own email (never the portal), their own link and an unsubscribe link', async () => {
        prisma.serviceUser.findMany
          .mockResolvedValueOnce([{ id: 'su-ended', status: { code: 'DISCHARGED' } }])
          .mockResolvedValueOnce([{ id: 'su-ended', firstName: 'Ada', preferredName: null, email: 'ada@example.com' }]);
        const portal = prisma.serviceUserPortalAccount;
        prisma.serviceUserPortalAccount = { findMany: jest.fn(async () => [{ email: 'portal@example.com', serviceUserId: 'su-ended', serviceUser: { firstName: 'Ada', preferredName: null } }]) };
        const unsubscribe = { link: jest.fn(() => 'https://care.example/survey-unsubscribe/abc.def') };
        (service as any).unsubscribe = unsubscribe;
        mail.send.mockClear();
        await (service as any).deliverToRecipients(
          { id: 's1', title: 'Your care', targetKind: 'SERVICE_USER', isAnonymous: false },
          [{ employeeId: null, serviceUserId: 'su-ended', token: 'tok-ended' }],
          'https://care.example',
        );
        expect(mail.send.mock.calls.map((c: any) => c[0].to)).toEqual(['ada@example.com']);
        expect(mail.send.mock.calls[0][0].text).toContain('/survey/tok-ended');
        expect(mail.send.mock.calls[0][0].text).toContain('https://care.example/survey-unsubscribe/abc.def');
        (service as any).unsubscribe = undefined;
        prisma.serviceUserPortalAccount = portal;
      });

      it('former staff: never the carer app, and only a personal email (never a work address)', async () => {
        prisma.employeePersonalDetail.findMany.mockResolvedValue([
          { employeeId: 'emp-left', firstName: 'Zara', email: 'zara@sunrise.example' },
          { employeeId: 'emp-left2', firstName: 'Ola', email: 'ola@example.com' },
        ]);
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-left', isActive: false }, { id: 'emp-left2', isActive: false }]);
        prisma.companyProfile = { findFirst: jest.fn().mockResolvedValue({ email: 'office@sunrise.example', companyWebsite: null }) };
        push.sendToEmployees.mockClear();
        mail.send.mockClear();
        await (service as any).deliverToRecipients(
          { id: 's1', title: 'Leaving us', targetKind: 'EMPLOYEE', isAnonymous: false },
          [{ employeeId: 'emp-left', serviceUserId: null, token: 't1' }, { employeeId: 'emp-left2', serviceUserId: null, token: 't2' }],
          'https://care.example',
        );
        expect(push.sendToEmployees).not.toHaveBeenCalled();
        expect(mail.send.mock.calls.map((c: any) => c[0].to)).toEqual(['ola@example.com']);
        expect(mail.send.mock.calls[0][0].text).toContain('/survey/t2');
      });

      it('an event-sent survey is never sent by hand: its month copies are', async () => {
        givenSurvey(surveyRow({ eventTrigger: { event: 'NOTICE_GIVEN', delayDays: 1, windowDays: 3, exclusions: [], options: {}, since: '2026-11-01' } }));
        givenQuestions(1);
        const { svc } = withRule(jest.fn());
        await expect(svc.send(admin, 's1', {})).rejects.toThrow(/sent when something happens in the care records/);
      });

      it('event sends go into the month copy (made once), through the 4-week rule, audited as counts', async () => {
        const source = surveyRow({ eventTrigger: { event: 'NOTICE_GIVEN', delayDays: 1, windowDays: 3, exclusions: [], options: {}, since: '2026-11-01' } });
        prisma.survey.findFirst.mockResolvedValue(null);
        prisma.surveyQuestion.findMany.mockResolvedValue([
          { id: 'q1', key: 'k1', questionText: 'How was it?', helpText: null, questionType: 'TEXT', options: null, optionsFrom: null, config: null, isRequired: false, sortOrder: 0, sectionTitle: null, isActive: true, showIf: null, commentConfig: null, otherOption: null, exclusiveOptions: null },
        ]);
        const period = { ...surveyRow({ id: 'p-nov', clonedFromId: 's1', periodKey: '2026-11', status: 'ACTIVE' }) };
        prisma.survey.create.mockResolvedValue(period);
        twoStaff();
        const held = [{ personId: 'emp-2', lastContactDay: '2026-11-01', freeFrom: '2026-11-29' }];
        const { svc, contactRule } = withRule(jest.fn(async () => ({ sendIds: ['emp-1'], held, sampledOut: 0, skipped: [], holdBack: true })));
        audit.logAudit.mockClear();
        const res = await svc.sendForEvents(source as any, ['emp-1', 'emp-2'], new Date());
        expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({ periodKey: expect.stringMatching(/^\d{4}-\d{2}$/), status: 'ACTIVE', clonedFromId: 's1' });
        expect(res).toMatchObject({ periodId: 'p-nov', sent: ['emp-1'], held: ['emp-2'], deferred: false });
        expect(contactRule.recordHeld).toHaveBeenCalledWith('p-nov', 'EMPLOYEE', held);
        // The copy keeps the source's audience, never these people as its chosen audience.
        const created = prisma.surveyRecipient.createMany.mock.calls.at(-1)[0].data.map((r: any) => r.employeeId);
        expect(created).toEqual(['emp-1']);
        const sentAudit = audit.logAudit.mock.calls.map((c: any) => c[0]).find((e: any) => e.action === 'survey_sent');
        expect(sentAudit.newValues).toEqual({ sent: 1, heldBack: 1, notSentHeld: 0, notReachable: 0 });
        expect(JSON.stringify(sentAudit)).not.toMatch(/emp-1|emp-2/);
      });

      it('a weekly repeat needs a reason (the 4-week rule never stops a series asking the same people), audited', async () => {
        givenSurvey(surveyRow());
        twoStaff();
        givenQuestions(1);
        const { svc } = withRule(jest.fn(async () => ({ sendIds: ['emp-1', 'emp-2'], held: [], sampledOut: 0, skipped: [], holdBack: true })));
        await expect(svc.send(admin, 's1', { recurrence: 'WEEKLY' as any, distributeAt: '2030-01-06T09:00:00Z' })).rejects.toThrow(/asked every week/);
        audit.logAudit.mockClear();
        await svc.send(admin, 's1', { recurrence: 'WEEKLY' as any, distributeAt: '2030-01-06T09:00:00Z', repeatReason: 'Short check-in during the winter pressures' });
        const saved = prisma.survey.update.mock.calls.at(-1)[0].data;
        expect(saved.contactRule).toMatchObject({ repeatReason: 'Short check-in during the winter pressures' });
        expect(audit.logAudit.mock.calls.map((c: any) => c[0])).toEqual(
          expect.arrayContaining([expect.objectContaining({ action: 'survey_contact_rule_changed', newValues: { recurrence: 'WEEKLY', repeatReason: 'Short check-in during the winter pressures' } })]),
        );
      });

      it('a survey that skips held people records them as not sent and says so', async () => {
        givenSurvey(surveyRow());
        twoStaff();
        const skipped = [{ personId: 'emp-2', lastContactDay: '2026-11-01', freeFrom: '2026-11-29' }];
        const { svc, contactRule } = withRule(jest.fn(async () => ({ sendIds: ['emp-1'], held: [], sampledOut: 0, skipped, holdBack: true })));
        const res = await svc.send(admin, 's1', {});
        expect(contactRule.recordHeld).toHaveBeenCalledWith('s1', 'EMPLOYEE', skipped, 'SKIPPED');
        expect(res.message).toMatch(/will not be sent this one/);
        expect(res.data).toMatchObject({ sent: 1, heldBack: 0, notSentHeld: 1 });
      });

      it('holds back people surveyed in the last 4 weeks: not sent now, kept to send on their free day', async () => {
        givenSurvey(surveyRow());
        twoStaff();
        const held = [{ personId: 'emp-2', lastContactDay: '2026-11-01', freeFrom: '2026-11-29' }];
        const { svc, contactRule } = withRule(jest.fn(async () => ({ sendIds: ['emp-1'], held, sampledOut: 0, skipped: [], holdBack: true })));
        const res = await svc.send(admin, 's1', {});
        const created = prisma.surveyRecipient.createMany.mock.calls[0][0].data.map((r: any) => r.employeeId);
        expect(created).toEqual(['emp-1']);
        expect(contactRule.recordHeld).toHaveBeenCalledWith('s1', 'EMPLOYEE', held);
        expect(res.message).toMatch(/1 had another survey in the last 4 weeks/);
        expect(res.data).toMatchObject({ sent: 1, heldBack: 1 });
        expect(contactRule.apply.mock.calls[0][3]).toMatchObject({ override: false, chosenPeople: false });
      });

      it('sending anyway needs a reason, and the audit row holds the count and reason only', async () => {
        givenSurvey(surveyRow());
        twoStaff();
        const { svc, contactRule } = withRule(jest.fn(async () => ({ sendIds: ['emp-1', 'emp-2'], held: [], sampledOut: 0, skipped: [], holdBack: true })));
        await expect(svc.send(admin, 's1', { contactRuleOverride: { reason: ' ' } } as any)).rejects.toThrow(/Say why/);
        await svc.send(admin, 's1', { contactRuleOverride: { reason: 'Annual survey must reach everyone' } } as any);
        expect(contactRule.apply.mock.calls.at(-1)[3]).toMatchObject({ override: true });
        const row = audit.logAudit.mock.calls.map((c: any[]) => c[0]).find((r: any) => r.action === 'survey_contact_rule_overridden');
        expect(row.newValues).toEqual({ sent: 2, reason: 'Annual survey must reach everyone' });
        expect(JSON.stringify(row)).not.toMatch(/emp-/);
      });

      it('an anonymous survey is not sent when the rule leaves too few to send to now', async () => {
        givenSurvey(surveyRow({ isAnonymous: true }));
        prisma.employee.findMany.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, employment: { locationId: 'loc-leeds' } })));
        const held = ['c', 'd', 'e', 'f'].map((personId) => ({ personId, lastContactDay: '2026-11-01', freeFrom: '2026-11-29' }));
        const { svc } = withRule(jest.fn(async () => ({ sendIds: ['a', 'b'], held, sampledOut: 0, skipped: [], holdBack: true })));
        await expect(svc.send(admin, 's1', {})).rejects.toThrow(/had another survey in the last 4 weeks/);
        expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
      });

      it('held people are checked again when sent later: someone who has left is lapsed, and the branch is kept', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', locationIds: ['loc-leeds'], audienceEmployeeIds: ['emp-1', 'emp-2'] }));
        prisma.surveyHeldBack = {
          findMany: jest.fn(async () => [
            { id: 'h1', employeeId: 'emp-1', serviceUserId: null },
            { id: 'h2', employeeId: 'emp-2', serviceUserId: null },
          ]),
          updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
        };
        // emp-2 has left since they were held back: only emp-1 is still an active employee.
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
        const { svc } = withRule(jest.fn());
        const res = await svc.sendHeldAnyway(admin, 's1', { reason: 'Needed before the inspection' });
        expect(res.data.sent).toBe(1);
        expect(prisma.employee.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null, isActive: true, id: { in: ['emp-1', 'emp-2'] } });
        expect(prisma.surveyRecipient.createMany.mock.calls[0][0].data.map((r: any) => r.employeeId)).toEqual(['emp-1']);
        expect(prisma.surveyHeldBack.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['h2'] } }, data: { status: 'LAPSED', resolvedAt: expect.any(Date) } });
        // Chosen people: the survey keeps its branch.
        expect(prisma.survey.update.mock.calls.at(-1)[0].data.locationIds).toEqual(['loc-leeds']);
      });
    });
  });

  /* ─── 5. Tokens ────────────────────────────────────────────────────────────── */

  it('never returns recipient link tokens to admin clients', async () => {
    givenSurvey(surveyRow({ status: 'ACTIVE' }));
    prisma.surveyRecipient.groupBy.mockResolvedValue([{ status: 'SENT', _count: { _all: 1 } }]);
    prisma.surveyRecipient.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: 'SENT',
        employeeId: 'emp-1',
        serviceUserId: null,
        sentAt: new Date(),
        createdAt: new Date(),
        response: null,
      },
    ]);
    const res = await service.listRecipients(admin, 's1');
    expect(res.data.recipients).toHaveLength(1);
    expect(res.data.recipients[0]).not.toHaveProperty('token');
    expect(JSON.stringify(res)).not.toMatch(/token/i);
    expect(prisma.surveyRecipient.findMany.mock.calls[0][0].select).not.toHaveProperty('token');
  });

  /* ─── 6. Branch scoping ────────────────────────────────────────────────────── */

  describe('branch scoping', () => {
    it('lists only surveys wholly within the user’s branches (plus company templates)', async () => {
      prisma.survey.findMany.mockResolvedValue([
        { ...surveyRow({ id: 'a', locationIds: ['loc-leeds'] }), _count: { questions: 0, recipients: 0, responses: 0, clones: 0 } },
        { ...surveyRow({ id: 'b', locationIds: ['loc-leeds', 'loc-york'] }), _count: { questions: 0, recipients: 0, responses: 0, clones: 0 } },
        { ...surveyRow({ id: 'c', locationIds: [] }), _count: { questions: 0, recipients: 0, responses: 0, clones: 0 } },
        { ...surveyRow({ id: 'd', locationIds: [], isTemplate: true }), _count: { questions: 0, recipients: 0, responses: 0, clones: 0 } },
      ]);
      const res = await service.list(leedsManager, {});
      expect(res.data.map((s) => s.id)).toEqual(['a', 'd']);
      expect(prisma.survey.findMany.mock.calls[0][0].where.AND).toBeDefined();
    });

    it.each([
      ['getById', (s: SurveysService) => s.getById(leedsManager, 's1')],
      ['results', (s: SurveysService) => s.results(leedsManager, 's1')],
      ['responses', (s: SurveysService) => s.listResponses(leedsManager, 's1')],
      ['recipients', (s: SurveysService) => s.listRecipients(leedsManager, 's1')],
      ['record candidates', (s: SurveysService) => s.listRecordCandidates(leedsManager, 's1')],
      ['send', (s: SurveysService) => s.send(leedsManager, 's1', {})],
    ])('%s of another branch’s survey is not found', async (_name, call) => {
      givenSurvey(surveyRow({ locationIds: ['loc-york'] }));
      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('record candidates are limited to the user’s branches', async () => {
      givenSurvey(surveyRow({ locationIds: ['loc-leeds'], status: 'ACTIVE' }));
      await service.listRecordCandidates(leedsManager, 's1', 'jo');
      const where = prisma.employee.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where.AND)).toContain('loc-leeds');
    });

    it('record candidates match a full name word by word (the call list opens Record response with it)', async () => {
      givenSurvey(surveyRow({ locationIds: ['loc-leeds'], status: 'ACTIVE' }));
      await service.listRecordCandidates(leedsManager, 's1', 'Jane  Carertest');
      const where = prisma.employee.findMany.mock.calls[0][0].where;
      const words = JSON.stringify(where.AND);
      expect(words).toContain('"contains":"Jane"');
      expect(words).toContain('"contains":"Carertest"');
      expect(words).not.toContain('"contains":"Jane  Carertest"');
      expect(JSON.stringify(where.AND)).toContain('loc-leeds');
    });

    it('recording for someone outside the user’s branches is refused', async () => {
      givenSurvey(surveyRow({ locationIds: ['loc-leeds'], status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
      prisma.serviceUser.findFirst.mockResolvedValue({ locationId: 'loc-york', assignments: [] });
      await expect(
        service.recordResponse(leedsManager, 's1', {
          channel: 'IN_PERSON',
          personId: 'su-york',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    });

    it('a branch user’s new survey is for their branches; other branches are refused', async () => {
      await service.create(leedsManager, { title: 'Leeds check-in' });
      expect(prisma.survey.create.mock.calls[0][0].data.locationIds).toEqual(['loc-leeds']);
      await expect(
        service.create(leedsManager, { title: 'York', locationIds: ['loc-york'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a branch user cannot send to people outside their branches', async () => {
      givenSurvey(surveyRow({ locationIds: ['loc-leeds'] }));
      givenQuestions(1);
      prisma.employee.count.mockResolvedValue(0);
      await expect(
        service.send(leedsManager, 's1', { employeeIds: ['emp-york'] }),
      ).rejects.toThrow(/not in your branches/);
    });
  });

  /* ─── 7. Share links ───────────────────────────────────────────────────────── */

  describe('share links', () => {
    it.each(['EMPLOYEE', 'SERVICE_USER'])('do not resolve for %s surveys', async (targetKind) => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind, status: 'ACTIVE' }));
      await expect(service.getPublicByToken('share-token-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a named public form never keeps the IP address or device an answer came from', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE', isAnonymous: false }));
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.surveyResponse.create.mockResolvedValue({ id: 'resp-1' });
      await service.submitPublicResponse(
        'share-token-1',
        { answers: [{ questionId: 'q1', booleanValue: true }] },
        { ipAddress: '10.0.0.7', userAgent: 'Browser' } as any,
      );
      const row = audit.logAudit.mock.calls.find((c: any[]) => c[0].action === 'survey_response_submitted')?.[0];
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('ipAddress');
      expect(row).not.toHaveProperty('userAgent');
    });

    it('resolve for live public surveys', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
      const res = await service.getPublicByToken('share-token-1');
      expect(res.data.linkKind).toBe('share');
    });

    describe('shared link on staff and service-user surveys', () => {
      const contactMe = question({
        id: 'q-contact',
        key: 'contact-me',
        questionText: 'Would you like someone to contact you?',
        questionType: 'YES_NO',
        sortOrder: 1,
        isRequired: false,
        config: { contactRequest: true },
      });

      it.each([
        ['EMPLOYEE', false],
        ['EMPLOYEE', true],
        ['SERVICE_USER', false],
        ['SERVICE_USER', true],
      ])('%s (anonymous: %s): the form is linked to no one and never offers "without my name"', async (targetKind, isAnonymous) => {
        givenSurvey(surveyRow({ targetKind, isAnonymous, status: 'ACTIVE', sharedLinkEnabled: true, allowAnonymousResponses: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const res: any = await service.getPublicByToken('share-token-1');
        expect(res.data).toMatchObject({ linkKind: 'share', unlinked: true, allowAnonymousResponses: false, canSubmit: true });
        expect(res.data.sharedLinkNote).toMatch(/not linked to your name/);
        // Who is answering only where it is kept (anonymous service-user surveys).
        expect(res.data.askRespondent).toBe(targetKind === 'SERVICE_USER' && isAnonymous);
      });

      it('an answer is held (never written at once), linked to no one, with the day only and no IP', async () => {
        givenSurvey(surveyRow({ targetKind: 'EMPLOYEE', isAnonymous: false, status: 'ACTIVE', sharedLinkEnabled: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const res = await service.submitPublicResponse(
          'share-token-1',
          { answers: [{ questionId: 'q1', booleanValue: true }] },
          { ipAddress: '10.0.0.7', userAgent: 'Browser' } as any,
        );
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
        const row = held();
        // Named survey: a response without a name (no branch, no who answered).
        expect(row).toMatchObject({ surveyId: 's1', isAnonymous: true, channel: 'ONLINE' });
        expect(row.payload).toMatchObject({ locationId: null, respondentRelation: null, viaSharedLink: true, shareLinkId: null });
        expect(row.createdAt.toISOString()).toMatch(/T(00|23):00:00\.000Z$/);
        expect(res.data.id).toBe('surveyPendingResponse-new');
        // No audit row of its own (no time, IP or device): counted for the day only.
        expectNoPerAnswerAudit(audit);
        expect(unlinkedDayCounts(prisma)).toMatchObject([{ surveyId: 's1', recorded: 0, reviewer: 0 }]);
        // Written out later: marked as through the shared link, never with a person.
        const [written] = await flushHeld();
        expect(written).toMatchObject({ recipientId: null, viaSharedLink: true, shareLinkId: null, locationId: null, isAnonymous: true });
      });

      it('contact-me questions are not asked, and an answer to one is discarded', async () => {
        givenSurvey(surveyRow({ targetKind: 'EMPLOYEE', status: 'ACTIVE', sharedLinkEnabled: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactMe]);
        const form: any = await service.getPublicByToken('share-token-1');
        expect(form.data.questions.map((q: any) => q.id)).toEqual(['q1']);
        await service.submitPublicResponse('share-token-1', {
          answers: [{ questionId: 'q1', booleanValue: true }, { questionId: 'q-contact', booleanValue: true }],
        });
        expect(held().payload.answers.map((a: any) => a.questionId)).toEqual(['q1']);
      });

      it('anonymous service-user survey: who is answering is required and kept, a branch link keeps its branch', async () => {
        const row = surveyRow({ targetKind: 'SERVICE_USER', isAnonymous: true, status: 'ACTIVE', sharedLinkEnabled: true, shareToken: 'main' });
        prisma.survey.findFirst.mockResolvedValue(null);
        prisma.surveyShareLink.findFirst.mockResolvedValue({ id: 'link-leeds', locationId: 'loc-leeds', survey: row });
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await expect(
          service.submitPublicResponse('branch-token', { answers: [{ questionId: 'q1', booleanValue: true }] }),
        ).rejects.toThrow(/who is answering/);
        await service.submitPublicResponse('branch-token', {
          respondentRelation: 'FAMILY_MEMBER',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any);
        expect(held()).toMatchObject({ isAnonymous: false });
        expect(held().payload).toMatchObject({ locationId: 'loc-leeds', respondentRelation: 'FAMILY_MEMBER', viaSharedLink: true, shareLinkId: 'link-leeds' });
      });

      it('a link that is turned off answers like one that never existed', async () => {
        givenSurvey(surveyRow({ targetKind: 'EMPLOYEE', status: 'ACTIVE', sharedLinkEnabled: false }));
        await expect(service.getPublicByToken('share-token-1')).rejects.toThrow('Survey link not found');
      });

      it("a repeating survey's link opens the period that is open, or says when the next opens", async () => {
        const source = surveyRow({ targetKind: 'EMPLOYEE', status: 'ACTIVE', sharedLinkEnabled: true, recurrence: 'MONTHLY', distributeAt: new Date('2026-12-01T09:00:00Z') });
        const period = surveyRow({ id: 's1-p', targetKind: 'EMPLOYEE', status: 'ACTIVE', clonedFromId: 's1', shareToken: 'period-token', title: 'Staff survey (November)' });
        prisma.survey.findFirst.mockImplementation(async (args: any) =>
          args?.where?.shareToken === 'share-token-1' ? source : args?.where?.clonedFromId === 's1' ? period : null,
        );
        prisma.surveyQuestion.findMany.mockResolvedValue([question({ surveyId: 's1-p' })]);
        const open: any = await service.getPublicByToken('share-token-1');
        expect(open.data).toMatchObject({ title: 'Staff survey (November)', canSubmit: true });
        await service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] });
        expect(held().surveyId).toBe('s1-p');

        prisma.survey.findFirst.mockImplementation(async (args: any) => (args?.where?.shareToken === 'share-token-1' ? source : null));
        const none: any = await service.getPublicByToken('share-token-1');
        expect(none.data).toMatchObject({ canSubmit: false, unavailableKind: 'NO_OPEN_PERIOD' });
        expect(none.data.unavailableReason).toMatch(/next one opens on 1 Dec 2026/);
        await expect(
          service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] }),
        ).rejects.toThrow(/no survey open on this link/);
      });

      it("results count answers through the shared link (written and waiting), never per response", async () => {
        givenSurvey(surveyRow({ targetKind: 'EMPLOYEE', status: 'CLOSED', sharedLinkEnabled: true }));
        prisma.surveyResponse.count.mockImplementation(async (args: any) => (args?.where?.viaSharedLink ? 3 : 0));
        prisma.surveyPendingResponse.count.mockImplementation(async (args: any) =>
          args?.where?.payload?.path?.[0] === 'viaSharedLink' ? 2 : 0,
        );
        const res: any = await service.results(admin, 's1');
        expect(res.data.participation.answeredThroughSharedLink).toBe(5);
      });
    });

    describe('spam protection', () => {
      const withGuard = () => {
        // The guard's two tables, kept in memory here (survey-link-guard.spec covers them in full).
        const used = new Set<string>();
        const guardDb: any = {
          surveyLinkFormToken: {
            create: jest.fn(async ({ data }: any) => {
              if (used.has(data.nonce)) throw new Prisma.PrismaClientKnownRequestError('taken', { code: 'P2002', clientVersion: 'test' });
              used.add(data.nonce);
            }),
            deleteMany: jest.fn(async ({ where }: any) => {
              if (where.nonce) used.delete(where.nonce);
            }),
          },
          surveyLinkRate: { aggregate: jest.fn(async () => ({ _sum: { answers: 0 } })), upsert: jest.fn(), deleteMany: jest.fn(async () => ({})) },
          $executeRaw: jest.fn(),
        };
        guardDb.$transaction = jest.fn(async (fn: any) => fn(guardDb));
        const guard = new SurveyLinkGuard(guardDb, { get: () => 'test-secret' } as any);
        const guarded = new SurveysService(
          prisma, audit as any, config as any, mail as any, push as any, notifications as any,
          new OrgScopeService(prisma), orgSettings as any, undefined, undefined, guard,
        );
        return { guard, guarded };
      };

      it('the form carries a token; a form filling the hidden field is thanked and nothing is kept', async () => {
        const { guarded } = withGuard();
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const form: any = await guarded.getPublicByToken('share-token-1');
        expect(form.data.formToken).toMatch(/^v1\./);
        const res = await guarded.submitPublicResponse('share-token-1', {
          answers: [{ questionId: 'q1', booleanValue: true }],
          website: 'buy now',
          formToken: form.data.formToken,
        } as any);
        expect(res.data.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
        expect(audit.logAudit).not.toHaveBeenCalled();
      });

      it('answers sent the moment the form opened are refused; a refused answer frees the form to be sent again', async () => {
        const { guard, guarded } = withGuard();
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const fresh = guard.issue('share-token-1');
        await expect(
          guarded.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }], formToken: fresh } as any),
        ).rejects.toThrow(/take a moment/);
        const older = guard.issue('share-token-1', Date.now() - 10_000);
        await expect(
          guarded.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q-missing', booleanValue: true }], formToken: older } as any),
        ).rejects.toThrow();
        await guarded.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }], formToken: older } as any);
        expect(prisma.surveyResponse.create).toHaveBeenCalledTimes(1);
      });

      it('answers kept before a later step failed: the form stays used, so a retry cannot add them twice', async () => {
        const { guard, guarded } = withGuard();
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const formToken = guard.issue('share-token-1', Date.now() - 10_000);
        audit.logAudit.mockRejectedValueOnce(new Error('audit store down'));
        await expect(
          guarded.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }], formToken } as any),
        ).rejects.toThrow('audit store down');
        expect(prisma.surveyResponse.create).toHaveBeenCalledTimes(1);
        await expect(
          guarded.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }], formToken } as any),
        ).rejects.toThrow(/already been sent/);
        expect(prisma.surveyResponse.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('one answer per device and the burst count', () => {
      it('a link asking for one answer per device names a marker for the page (per survey) and says so', async () => {
        givenSurvey(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE', sharedLinkOncePerDevice: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const res: any = await service.getPublicByToken('share-token-1');
        expect(res.data.deviceMarker).toMatch(/^careflow-survey-answered-[0-9a-f]{20}$/);
        expect(res.data.oncePerDeviceNote).toMatch(/never sent with your answers/);
        givenSurvey(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        const off: any = await service.getPublicByToken('share-token-1');
        expect(off.data.deviceMarker).toBeNull();
      });

      it('each shared-link answer adds one to the day’s count (and nothing else); a failed count never fails the answer', async () => {
        givenSurvey(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        prisma.$executeRaw = jest.fn().mockResolvedValue(1);
        await service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        const [sql, surveyId, day] = prisma.$executeRaw.mock.calls[0];
        expect(sql.join('?')).toMatch(/SurveySharedLinkDay[\s\S]*"answers" \+ 1/);
        expect(surveyId).toBe('s1');
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        prisma.$executeRaw = jest.fn().mockRejectedValue(new Error('down'));
        await expect(
          service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] }),
        ).resolves.toMatchObject({ message: 'Survey response submitted' });
        delete prisma.$executeRaw;
      });

      it('Results warn about a burst of shared-link answers, from the day counts only', async () => {
        givenSurvey(surveyRow({ targetKind: 'PUBLIC', status: 'CLOSED' }));
        prisma.surveySharedLinkDay = {
          findMany: jest.fn().mockResolvedValue([
            { surveyId: 's1', day: new Date('2026-11-02T00:00:00Z'), answers: 2 },
            { surveyId: 's1', day: new Date('2026-11-03T00:00:00Z'), answers: 3 },
            { surveyId: 's1', day: new Date('2026-11-04T00:00:00Z'), answers: 45 },
          ]),
        };
        const res: any = await service.results(admin, 's1');
        expect(res.data.sharedLinkCaution.days).toEqual([{ day: '2026-11-04', answers: 45 }]);
        expect(res.data.sharedLinkCaution.note).toMatch(/45 on 4 Nov 2026/);
        delete prisma.surveySharedLinkDay;
      });
    });

    it('forms carry the section introductions of the sections asked (ready-made ones included)', async () => {
      givenSurvey(
        surveyRow({
          targetKind: 'PUBLIC',
          status: 'ACTIVE',
          libraryMeta: { sections: [{ title: 'Your visits', introduction: 'About your care workers’ visits.' }] },
          sectionIntros: { 'Not on the form': 'Never sent.' },
        }),
      );
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ sectionTitle: 'Your visits' })]);
      const res: any = await service.getPublicByToken('share-token-1');
      expect(res.data.sectionIntros).toEqual({ 'Your visits': 'About your care workers’ visits.' });
    });

    it('the closing-screen message is never in the form people answer, only in what submitting returns', async () => {
      givenSurvey(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE', closingMessage: '  Thank you. Speak to your manager if worried.  ' }));
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      const res: any = await service.getPublicByToken('share-token-1');
      // It can hold the answers to knowledge questions (CQC-002), so not even hidden in the form.
      expect(res.data.closingMessage).toBeNull();
      expect(JSON.stringify(res.data)).not.toContain('Speak to your manager');
      prisma.survey.findUnique.mockResolvedValue({ closingMessage: '  Thank you. Speak to your manager if worried.  ' });
      const done: any = await (service as any).withClosingMessage('s1', { message: 'Survey response submitted', data: { id: 'r1' } });
      expect(done.data).toEqual({ id: 'r1', closingMessage: 'Thank you. Speak to your manager if worried.' });
      prisma.survey.findUnique.mockResolvedValue({ closingMessage: null });
      expect(((await (service as any).withClosingMessage('s1', { message: 'x', data: {} })) as any).data.closingMessage).toBeNull();
    });

    it('an ended survey says so plainly, with the organisation to contact instead', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'CLOSED' }));
      prisma.companyProfile = { findFirst: jest.fn().mockResolvedValue({ displayName: 'Sunrise Care', companyName: 'Sunrise Ltd', phoneNumber: '0113 000 0000', email: 'office@sunrise.example' }) };
      const res: any = await service.getPublicByToken('share-token-1');
      expect(res.data).toMatchObject({ canSubmit: false, unavailableKind: 'ENDED' });
      expect(res.data.contact).toEqual({ name: 'Sunrise Care', phone: '0113 000 0000', email: 'office@sunrise.example' });
      delete prisma.companyProfile;
    });

    it('only public surveys can be published, and only they expose a share token', async () => {
      givenSurvey(surveyRow({ targetKind: 'EMPLOYEE' }));
      givenQuestions(1);
      await expect(service.publish(admin, 's1')).rejects.toThrow(/Only public surveys/);
      prisma.surveyAnswer.groupBy.mockResolvedValue([]);
      const detail = await service.getById(admin, 's1');
      expect(detail.data.shareToken).toBeNull();
    });
  });

  /* ─── 8. Open for responses ───────────────────────────────────────────────── */

  describe('open for responses', () => {
    it('opens a service-user survey without portal sending', async () => {
      givenSurvey(surveyRow({ targetKind: 'SERVICE_USER' }));
      givenQuestions(4);
      const res = await service.openForResponses(admin, 's1');
      expect(res.data.status).toBe('ACTIVE');
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('needs questions, and is not for public surveys or repeating surveys', async () => {
      givenSurvey(surveyRow({ targetKind: 'SERVICE_USER' }));
      givenQuestions(0);
      await expect(service.openForResponses(admin, 's1')).rejects.toThrow(/question/);
      givenSurvey(surveyRow({ targetKind: 'PUBLIC' }));
      await expect(service.openForResponses(admin, 's1')).rejects.toThrow(/publishing/);
      givenSurvey(surveyRow({ targetKind: 'SERVICE_USER', recurrence: 'MONTHLY' }));
      givenQuestions(2);
      await expect(service.openForResponses(admin, 's1')).rejects.toThrow(/repeats/);
    });

    it('after opening, staff can record phone feedback', async () => {
      givenSurvey(surveyRow({ targetKind: 'SERVICE_USER', status: 'ACTIVE' }));
      prisma.serviceUser.findFirst.mockResolvedValue({ locationId: 'loc-leeds', assignments: [] });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      const res = await service.recordResponse(admin, 's1', {
        channel: 'TELEPHONE',
        consentGiven: true,
        personId: 'su-1',
        respondentRelation: 'SELF',
        answers: [{ questionId: 'q1', booleanValue: true }],
      } as any);
      expect(res.message).toBe('Survey response recorded');
      expect(prisma.surveyResponse.create.mock.calls[0][0].data).toMatchObject({
        surveyId: 's1',
        recipientId: 'surveyRecipient-new',
        channel: 'TELEPHONE',
      });
    });

    it('recording on a draft explains how to open it', async () => {
      givenSurvey(surveyRow({ targetKind: 'SERVICE_USER' }));
      await expect(
        service.recordResponse(admin, 's1', { channel: 'PAPER', isAnonymous: true, answers: [] } as any),
      ).rejects.toThrow(/Open for responses/);
    });
  });

  /* ─── 9 & 10. Recurring periods ───────────────────────────────────────────── */

  describe('recurring periods', () => {
    const source = () =>
      surveyRow({
        recurrence: 'MONTHLY',
        distributeAt: new Date('2026-11-01T09:00:00.000Z'),
        recurrenceAnchorAt: new Date('2026-10-01T08:00:00.000Z'),
        periodOpenDays: 14,
        locationIds: ['loc-leeds'],
        scheduledById: 'admin-1',
      });
    const now = new Date('2026-11-01T09:00:20.000Z');

    beforeEach(() => {
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ id: 'src-q1' })]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', employment: { locationId: 'loc-leeds' } },
      ]);
    });

    it('creates the period copy, recipients and next run in one transaction', async () => {
      const run = await service.runRecurringPeriod(source(), now);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const clone = prisma.survey.create.mock.calls[0][0].data;
      expect(clone).toMatchObject({
        title: 'Staff survey — Nov 2026',
        periodKey: '2026-11',
        clonedFromId: 's1',
        status: 'ACTIVE',
        createdById: 'admin-1',
      });
      expect(clone.questions.create[0].sourceQuestionId).toBe('src-q1');
      // Open 14 days at the same local time (GMT here).
      expect(clone.closesAt.toISOString()).toBe('2026-11-15T09:00:00.000Z');
      // Anchored on 1 Oct 09:00 BST → next is 1 Dec 09:00 GMT.
      expect(run.nextAt.toISOString()).toBe('2026-12-01T09:00:00.000Z');
      expect(prisma.survey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ distributeAt: run.nextAt }) }),
      );
    });

    it('closes the previous period when the next one is created', async () => {
      await service.runRecurringPeriod(source(), now);
      const closes = prisma.survey.updateMany.mock.calls.map((c: any[]) => c[0]);
      expect(closes[0]).toMatchObject({
        where: { clonedFromId: 's1', status: 'ACTIVE' },
        data: { status: 'CLOSED', closesAt: now },
      });
      expect(closes[1]).toMatchObject({ data: { status: 'CLOSED' } });
    });

    it('never sends the same period twice', async () => {
      prisma.survey.findFirst.mockResolvedValue({ id: 'existing-period' });
      const run = await service.runRecurringPeriod(source(), now);
      expect(run.alreadySent).toBe(true);
      expect(prisma.survey.create).not.toHaveBeenCalled();
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
      expect(prisma.survey.update.mock.calls[0][0].data.distributeAt.toISOString()).toBe(
        '2026-12-01T09:00:00.000Z',
      );
    });

    it('treats a unique (survey, period) clash from a parallel run as already sent', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'x' }),
      );
      const run = await service.runRecurringPeriod(source(), now);
      expect(run.alreadySent).toBe(true);
    });

    it('checks there is someone to send to before copying (no orphan drafts)', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      await expect(service.runRecurringPeriod(source(), now)).rejects.toThrow(/No active employees/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.survey.create).not.toHaveBeenCalled();
    });

    it('a period with nobody to send to is skipped and the scheduler told', async () => {
      prisma.survey.findMany.mockResolvedValue([source()]);
      prisma.employee.findMany.mockResolvedValue([]);
      const out = await service.runDueDistributions(now);
      expect(out[0].ok).toBe(false);
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        distributeAt: new Date('2026-12-01T09:00:00.000Z'),
      });
      expect(prisma.survey.update.mock.calls[0][0].data.distributionFailedAt).toBeUndefined();
      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
    });

    describe('closing at the end date', () => {
      const due = (over: Record<string, unknown> = {}) =>
        surveyRow({
          id: 'one-off',
          title: 'Winter survey',
          status: 'ACTIVE',
          closesAt: new Date('2026-10-31T17:00:00.000Z'),
          createdById: 'creator-1',
          scheduledById: 'scheduler-1',
          distributeAt: new Date('2026-12-01T09:00:00.000Z'),
          ...over,
        });

      it('finds open one-off surveys and periods past their end date — never drafts, templates or a repeating survey itself', async () => {
        await service.closeSurveysPastEndDate(now);
        expect(prisma.survey.findMany.mock.calls[0][0].where).toEqual({
          status: 'ACTIVE',
          deletedAt: null,
          isTemplate: false,
          isCatalogue: false,
          closesAt: { lte: now },
          recurrence: null,
          clones: { none: {} },
        });
      });

      it('closes each one (only while still open), clears a pending send, records a system close and tells its creator and scheduler', async () => {
        prisma.survey.findMany.mockResolvedValue([due()]);
        await expect(service.closeSurveysPastEndDate(now)).resolves.toBe(1);
        expect(prisma.survey.updateMany).toHaveBeenCalledWith({
          where: { id: 'one-off', status: 'ACTIVE', closesAt: { lte: now } },
          data: expect.objectContaining({ status: 'CLOSED', distributeAt: null, scheduledById: null, updatedAt: now }),
        });
        expect(audit.logAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: undefined,
            action: 'survey_updated',
            recordId: 'one-off',
            description: 'Reached its end date',
            metadata: { closed: true, closedAtEndDate: true, reason: 'Reached its end date' },
          }),
        );
        expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
        const n = notifications.notifyUsers.mock.calls[0][0];
        expect(n.recipientUserIds).toEqual(['creator-1', 'scheduler-1']);
        expect(n.message).toBe('Winter survey closed at its end date — results are ready');
        expect(n.metadata.href).toBe('/surveys/one-off/responses');
      });

      it('a period copy still closes as before (and its creator is told once when they also scheduled it)', async () => {
        prisma.survey.findMany.mockResolvedValue([
          due({ id: 'p1', title: 'Staff survey — Nov 2026', clonedFromId: 's1', scheduledById: 'creator-1', distributeAt: null }),
        ]);
        await expect(service.closeSurveysPastEndDate(now)).resolves.toBe(1);
        expect(prisma.survey.updateMany.mock.calls[0][0].where.id).toBe('p1');
        expect(notifications.notifyUsers.mock.calls[0][0].recipientUserIds).toEqual(['creator-1']);
      });

      it('two runs at once close it once and tell people once', async () => {
        prisma.survey.findMany.mockResolvedValue([due()]);
        let open = true;
        prisma.survey.updateMany.mockImplementation(async () => {
          const count = open ? 1 : 0;
          open = false;
          return { count };
        });
        const [a, b] = await Promise.all([service.closeSurveysPastEndDate(now), service.closeSurveysPastEndDate(now)]);
        expect(a + b).toBe(1);
        expect(audit.logAudit).toHaveBeenCalledTimes(1);
        expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
        // A later run finds nothing open.
        prisma.survey.findMany.mockResolvedValue([]);
        await expect(service.closeSurveysPastEndDate(now)).resolves.toBe(0);
        expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      });

      it('a failed notification never stops the close', async () => {
        prisma.survey.findMany.mockResolvedValue([due(), due({ id: 'two' })]);
        notifications.notifyUsers.mockRejectedValueOnce(new Error('down'));
        await expect(service.closeSurveysPastEndDate(now)).resolves.toBe(2);
      });

      describe('reopening after the end date', () => {
        const closed = (over: Record<string, unknown> = {}) =>
          surveyRow({ status: 'CLOSED', closesAt: new Date('2020-01-01T09:00:00.000Z'), ...over });
        beforeEach(() => givenQuestions(1));

        it('is refused while the end date is in the past, saying why', async () => {
          givenSurvey(closed());
          await expect(service.openForResponses(admin, 's1')).rejects.toThrow(
            /end date \(1 Jan 2020, 09:00\) has passed, so it would close again straight away\. Choose a new end date, or remove it/,
          );
          givenSurvey(closed({ targetKind: 'PUBLIC' }));
          await expect(service.publish(admin, 's1')).rejects.toThrow(/Choose a new end date, or remove it/);
          expect(prisma.survey.update).not.toHaveBeenCalled();
        });

        it('reopens with a new end date in the future, or with the end date removed', async () => {
          givenSurvey(closed());
          const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
          await service.openForResponses(admin, 's1', undefined, { closesAt: later });
          expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', closesAt: new Date(later) });
          await service.openForResponses(admin, 's1', undefined, { closesAt: null });
          expect(prisma.survey.update.mock.calls[1][0].data).toMatchObject({ status: 'ACTIVE', closesAt: null });
          givenSurvey(closed({ targetKind: 'PUBLIC' }));
          await service.publish(admin, 's1', undefined, { closesAt: null });
          expect(prisma.survey.update.mock.calls[2][0].data).toMatchObject({ status: 'ACTIVE', closesAt: null });
        });

        it('a new end date must be in the future', async () => {
          givenSurvey(closed());
          await expect(
            service.openForResponses(admin, 's1', undefined, { closesAt: '2021-01-01T09:00:00.000Z' }),
          ).rejects.toThrow('The new end date must be in the future.');
        });

        it('a survey with a future end date reopens as before (its end date kept)', async () => {
          const future = new Date(Date.now() + 86_400_000);
          givenSurvey(closed({ closesAt: future }));
          await service.openForResponses(admin, 's1');
          expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE' });
          expect(prisma.survey.update.mock.calls[0][0].data).not.toHaveProperty('closesAt');
        });

        it('the open request accepts the new end date (and rejects anything else)', async () => {
          const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
          const ok = await pipe.transform({ closesAt: null }, { type: 'body', metatype: ReopenSurveyDto });
          expect(ok.closesAt).toBeNull();
          await expect(
            pipe.transform({ closesAt: 'next week' }, { type: 'body', metatype: ReopenSurveyDto }),
          ).rejects.toBeDefined();
        });
      });

      describe('"Closed at its end date" on the survey and in the list', () => {
        it('is true when the latest close was the automatic one', async () => {
          givenSurvey(surveyRow({ status: 'CLOSED' }));
          prisma.auditLog.findMany.mockResolvedValue([
            { recordId: 's1', metadata: { closed: true, closedAtEndDate: true } },
            { recordId: 's1', metadata: { closed: true } },
          ]);
          const res: any = await service.getById(admin, 's1');
          expect(res.data.closedAtEndDate).toBe(true);
          expect(prisma.auditLog.findMany.mock.calls[0][0].where).toMatchObject({
            recordType: 'Survey',
            recordId: { in: ['s1'] },
            metadata: { path: ['closed'], equals: true },
          });
        });

        it('is false when someone closed it last, and never asked for open surveys', async () => {
          prisma.survey.findMany.mockResolvedValue([
            { ...surveyRow({ id: 'a', status: 'CLOSED' }), _count: { questions: 1, recipients: 0, responses: 0, clones: 0 } },
            { ...surveyRow({ id: 'b', status: 'ACTIVE' }), _count: { questions: 1, recipients: 0, responses: 0, clones: 0 } },
          ]);
          prisma.auditLog.findMany.mockResolvedValue([
            { recordId: 'a', metadata: { closed: true } },
            { recordId: 'a', metadata: { closed: true, closedAtEndDate: true } },
          ]);
          const res: any = await service.list(admin, {} as any);
          expect(res.data.map((s: any) => [s.id, s.closedAtEndDate])).toEqual([
            ['a', false],
            ['b', false],
          ]);
          expect(prisma.auditLog.findMany.mock.calls[0][0].where.recordId).toEqual({ in: ['a'] });
        });
      });
    });
  });

  /* ─── 11. Results across periods ───────────────────────────────────────────── */

  it('matches period answers to the repeating survey’s questions by source link', async () => {
    givenSurvey(surveyRow({ recurrence: 'MONTHLY' }));
    prisma.survey.findMany.mockResolvedValue([
      { id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10', opensAt: new Date(), closesAt: null, status: 'CLOSED' },
    ]);
    prisma.surveyQuestion.findMany.mockResolvedValue([question({ id: 'src-q1' })]);
    const periodQ = { id: 'p1-q1', surveyId: 'p1', sourceQuestionId: 'src-q1', questionType: 'YES_NO', questionText: 'How supported do you feel?', options: null, sortOrder: 0 };
    prisma.surveyAnswer.findMany.mockResolvedValue([
      { booleanValue: true, textValue: null, numberValue: null, selectedOptions: null, question: periodQ },
      { booleanValue: false, textValue: null, numberValue: null, selectedOptions: null, question: periodQ },
    ]);
    prisma.surveyRecipient.groupBy.mockResolvedValue([
      { surveyId: 'p1', status: 'COMPLETED', _count: { _all: 2 } },
      { surveyId: 'p1', status: 'SENT', _count: { _all: 2 } },
    ]);
    prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
      args.by[0] === 'surveyId' ? [{ surveyId: 'p1', _count: { _all: 2 } }] : [],
    );
    const res = await service.results(admin, 's1');
    expect(res.data.includesPeriodRuns).toBe(true);
    expect(res.data.periods[0]).toMatchObject({ id: 'p1', recipients: 4, completed: 2, responses: 2 });
    expect(res.data).toMatchObject({ recipients: 4, completed: 2, responses: 2 });
    expect(res.data.questionSummaries).toHaveLength(1);
    expect(res.data.questionSummaries[0]).toMatchObject({ questionId: 'src-q1', answerCount: 2, status: 'current' });
  });

  it('the responses list covers every period, like the progress figures', async () => {
    givenSurvey(surveyRow({ recurrence: 'MONTHLY' }));
    prisma.survey.findMany.mockResolvedValue([
      { id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10', opensAt: new Date(), closesAt: null, status: 'CLOSED' },
    ]);
    await service.listResponses(admin, 's1');
    expect(prisma.surveyResponse.findMany.mock.calls[0][0].where).toEqual({ surveyId: { in: ['s1', 'p1'] } });
  });

  /* ─── 12 & 14. Questions ───────────────────────────────────────────────────── */

  describe('questions', () => {
    it('rejects choice questions without valid options', async () => {
      givenSurvey(surveyRow());
      await expect(
        service.addQuestion(admin, 's1', { questionText: 'Pick', questionType: 'SINGLE_SELECT', options: ['A', 'a'] }),
      ).rejects.toThrow(/more than once/);
      await expect(
        service.addQuestion(admin, 's1', { questionText: 'Rate', questionType: 'RATING', config: { min: 1.5, max: 5 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.surveyQuestion.create).not.toHaveBeenCalled();
    });

    it('once answered, only the help text can change', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      const q = question({ questionType: 'SINGLE_SELECT', options: ['Yes', 'No'] });
      prisma.surveyQuestion.findFirst.mockResolvedValue(q);
      prisma.surveyResponse.count.mockResolvedValue(3);
      await expect(
        service.updateQuestion(admin, 's1', 'q1', { options: ['Yes', 'Not really'] }),
      ).rejects.toThrow(/help text/);
      await expect(service.updateQuestion(admin, 's1', 'q1', { questionText: 'Reworded' })).rejects.toThrow(
        /help text/,
      );
      await expect(service.updateQuestion(admin, 's1', 'q1', { questionType: 'TEXT' })).rejects.toThrow(
        /help text/,
      );
      await service.updateQuestion(admin, 's1', 'q1', { helpText: 'Think about the last month' });
      expect(prisma.surveyQuestion.update.mock.calls[0][0].data.helpText).toBe('Think about the last month');
    });

    describe('answers not counted in percentages', () => {
      it('are saved with a new question, and dropped when their answer is taken off', async () => {
        givenSurvey(surveyRow());
        await service.addQuestion(admin, 's1', {
          questionText: 'Overall?',
          questionType: 'SINGLE_SELECT',
          options: ['Good', 'Poor', "Don't know"],
          config: { notCountedOptions: ["Don't know"] },
        });
        expect(prisma.surveyQuestion.create.mock.calls[0][0].data.config).toEqual({ notCountedOptions: ["Don't know"] });

        const q = question({ questionType: 'SINGLE_SELECT', options: ['Good', 'Poor', "Don't know"], config: { notCountedOptions: ["Don't know"] } });
        prisma.surveyQuestion.findFirst.mockResolvedValue(q);
        await service.updateQuestion(admin, 's1', 'q1', { helpText: 'Think about the last month' });
        expect(prisma.surveyQuestion.update.mock.calls[0][0].data.config).toEqual({ notCountedOptions: ["Don't know"] });
        await service.updateQuestion(admin, 's1', 'q1', { options: ['Good', 'Poor'] });
        expect(prisma.surveyQuestion.update.mock.calls[1][0].data.config).toEqual(Prisma.JsonNull);
      });

      it('can change once people have answered (it changes only the percentages): periods follow, evidence is recaptured, the change is audited', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyQuestion.findFirst.mockResolvedValue(
          question({ questionType: 'SINGLE_SELECT', options: ['Good', 'Poor', "Don't know"] }),
        );
        prisma.surveyResponse.count.mockResolvedValue(2);
        prisma.surveyQuestion.findMany.mockImplementation(async (args: any) =>
          args?.where?.sourceQuestionId
            ? [
                { id: 'p1-q1', surveyId: 'p1', questionType: 'SINGLE_SELECT', options: ['Good', 'Poor', "Don't know"] },
                { id: 'p2-q1', surveyId: 'p2', questionType: 'SINGLE_SELECT', options: ['Good', 'Poor'] },
              ]
            : [],
        );
        prisma.cqcSurveyCapture.findMany.mockResolvedValue([{ surveyId: 'p1' }]);
        await service.updateQuestion(admin, 's1', 'q1', { config: { notCountedOptions: ["Don't know"] } });
        expect(prisma.surveyQuestion.update.mock.calls[0][0].data.config).toEqual({ notCountedOptions: ["Don't know"] });
        const periodUpdates = prisma.surveyQuestion.update.mock.calls.slice(1).map((c: any[]) => [c[0].where.id, c[0].data.config]);
        expect(periodUpdates).toEqual([
          ['p1-q1', { notCountedOptions: ["Don't know"] }],
          ['p2-q1', Prisma.JsonNull],
        ]);
        expect(prisma.cqcSurveyCapture.updateMany).toHaveBeenCalledWith({
          where: { surveyId: { in: ['p1'] } },
          data: { surveyUpdatedAt: new Date(0) },
        });
        expect(audit.logAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              notCountedInPercentages: { from: [], to: ["Don't know"] },
              answered: true,
              cqcRecapture: ['p1'],
            }),
          }),
        );
        // The answers themselves still cannot change.
        await expect(service.updateQuestion(admin, 's1', 'q1', { options: ['Good', 'Poor'] })).rejects.toThrow(/help text/);
      });
    });

    it('"Add question here" puts the new question straight after the section’s last question', async () => {
      givenSurvey(surveyRow());
      prisma.surveyQuestion.findMany.mockResolvedValue([
        question({ id: 'qa', key: 'a', sortOrder: 0, sectionTitle: 'About you' }),
        question({ id: 'qb', key: 'b', sortOrder: 1, sectionTitle: 'Your care' }),
        question({ id: 'qc', key: 'c', sortOrder: 2, sectionTitle: 'Your care' }),
      ]);
      await service.addQuestion(admin, 's1', {
        questionText: 'Anything else about you?',
        questionType: 'TEXT',
        sectionTitle: 'About you',
        afterQuestionId: 'qa',
      } as any);
      expect(prisma.surveyQuestion.create.mock.calls[0][0].data).toMatchObject({ sortOrder: 1, sectionTitle: 'About you' });
      const moved = Object.fromEntries(prisma.surveyQuestion.update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data.sortOrder]));
      expect(moved).toEqual({ qb: 2, qc: 3 });
    });

    describe('the contact-me question on anonymous surveys', () => {
      const contactMe = 'Would you like someone to contact you about your answers?';

      it('cannot be added, copied or reworded into on an anonymous survey', async () => {
        givenSurvey(surveyRow({ isAnonymous: true }));
        await expect(
          service.addQuestion(admin, 's1', { questionText: contactMe, questionType: 'YES_NO' } as any),
        ).rejects.toThrow(/This survey is anonymous, so nobody could be contacted/);
        expect(prisma.surveyQuestion.create).not.toHaveBeenCalled();

        prisma.surveyQuestion.findFirst.mockResolvedValue({ ...question({ id: 'b', questionType: 'YES_NO', options: null }), questionText: contactMe, key: 'q-b' });
        await expect(service.copyQuestion(admin, 's1', 'b')).rejects.toThrow(/This survey is anonymous/);

        prisma.surveyQuestion.findFirst.mockResolvedValue({ ...question({ id: 'c', questionType: 'YES_NO', options: null }), questionText: 'Do you feel safe?', key: 'q-c' });
        await expect(service.updateQuestion(admin, 's1', 'c', { questionText: contactMe } as any)).rejects.toThrow(
          /This survey is anonymous/,
        );
        expect(prisma.surveyQuestion.update).not.toHaveBeenCalled();
      });

      it('a named survey can ask it', async () => {
        givenSurvey(surveyRow({ isAnonymous: false }));
        prisma.surveyQuestion.findMany.mockResolvedValue([]);
        prisma.surveyQuestion.create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }));
        await service.addQuestion(admin, 's1', { questionText: contactMe, questionType: 'YES_NO' } as any);
        expect(prisma.surveyQuestion.create).toHaveBeenCalled();
      });

      it('a survey (or a copy of one) cannot be made anonymous while it asks it', async () => {
        givenSurvey(surveyRow({ isAnonymous: false }));
        prisma.surveyQuestion.findMany.mockResolvedValue([{ questionType: 'YES_NO', questionText: contactMe }]);
        await expect(service.update(admin, 's1', { isAnonymous: true } as any)).rejects.toThrow(
          /An anonymous survey cannot ask "Would you like someone to contact you about your answers\?"/,
        );
        await expect(service.duplicate(admin, 's1', { isAnonymous: true } as any)).rejects.toThrow(/Remove that question first/);
        expect(prisma.survey.update).not.toHaveBeenCalled();
        expect(prisma.survey.create).not.toHaveBeenCalled();
      });
    });

    describe('moving and copying', () => {
      const lq = (id: string, sortOrder: number, over: Record<string, unknown> = {}) => ({
        id,
        key: `q-${id}`,
        questionText: `Question ${id}`,
        questionType: 'YES_NO',
        options: null,
        config: null,
        otherOption: null,
        showIf: null,
        sortOrder,
        createdAt: new Date('2026-11-01T09:00:00.000Z'),
        ...over,
      });
      const sortOrders = () =>
        Object.fromEntries(prisma.surveyQuestion.update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data.sortOrder]));

      beforeEach(() => givenSurvey(surveyRow()));

      it('moves a question one place, renumbering positions 0, 1, 2 …', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([lq('a', 0), lq('b', 0), lq('c', 5)]);
        await expect(service.moveQuestion(admin, 's1', 'c', 'up')).resolves.toMatchObject({ data: { position: 2 } });
        expect(sortOrders()).toEqual({ b: 2, c: 1 });
        expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { surveyId: 's1', moved: 'up' } }));
      });

      it('a question cannot move above the question it depends on, nor that question below it', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([
          lq('a', 0),
          lq('b', 1, { showIf: { questionKey: 'q-a', answers: ['Yes'] } }),
        ]);
        await expect(service.moveQuestion(admin, 's1', 'b', 'up')).rejects.toThrow(
          'This question is asked only after an answer to "Question a", so it cannot move above it.',
        );
        await expect(service.moveQuestion(admin, 's1', 'a', 'down')).rejects.toThrow(
          '"Question b" is asked only after an answer to this question, so this question cannot move below it.',
        );
        expect(prisma.surveyQuestion.update).not.toHaveBeenCalled();
      });

      it('the first cannot move up, nor the last down', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([lq('a', 0), lq('b', 1)]);
        await expect(service.moveQuestion(admin, 's1', 'a', 'up')).rejects.toThrow('This is already the first question.');
        await expect(service.moveQuestion(admin, 's1', 'b', 'down')).rejects.toThrow('This is already the last question.');
      });

      it('positions can still change once people have answered (answers stay with their question)', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyResponse.count.mockResolvedValue(4);
        prisma.surveyQuestion.findMany.mockResolvedValue([lq('a', 0), lq('b', 1)]);
        await service.moveQuestion(admin, 's1', 'b', 'up');
        expect(sortOrders()).toEqual({ a: 1, b: 0 });
      });

      it('copies a question straight after it with a new key, keeping its settings and its own rule', async () => {
        const source = {
          ...question({ id: 'b', questionType: 'SINGLE_SELECT', options: ['Good', 'Poor', "Don't know"] }),
          key: 'q-b',
          sortOrder: 1,
          config: { notCountedOptions: ["Don't know"] },
          showIf: { questionKey: 'q-a', answers: ['Yes'] },
          sectionTitle: 'Your visits',
          helpText: 'Think about the last month',
        };
        prisma.surveyQuestion.findFirst.mockResolvedValue(source);
        prisma.surveyQuestion.findMany.mockResolvedValue([lq('a', 0), lq('b', 1, { showIf: source.showIf }), lq('c', 2)]);
        prisma.surveyQuestion.create.mockImplementation(async (args: any) => ({ id: 'copy', createdAt: new Date(), ...args.data }));
        await service.copyQuestion(admin, 's1', 'b');
        const data = prisma.surveyQuestion.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
          questionText: source.questionText,
          questionType: 'SINGLE_SELECT',
          options: ['Good', 'Poor', "Don't know"],
          config: { notCountedOptions: ["Don't know"] },
          showIf: { questionKey: 'q-a', answers: ['Yes'] },
          sectionTitle: 'Your visits',
          helpText: 'Think about the last month',
        });
        expect(data.key).toMatch(/^q-[a-z0-9]{8}$/);
        expect(data.key).not.toBe('q-b');
        // Straight after it: c moves down one.
        expect(sortOrders()).toEqual({ copy: 2, c: 3 });
      });

      it('no copy once people have answered (the copy could never be reworded), counting waiting answers', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyQuestion.findFirst.mockResolvedValue({ ...question({ id: 'b' }), key: 'q-b' });
        prisma.surveyQuestion.findMany.mockResolvedValue([lq('a', 0), lq('b', 1)]);
        prisma.surveyResponse.count.mockResolvedValue(0);
        prisma.surveyPendingResponse.count.mockResolvedValue(1);
        await expect(service.copyQuestion(admin, 's1', 'b')).rejects.toThrow(/already answered this survey, so a copy could not be reworded/);
        expect(prisma.surveyQuestion.create).not.toHaveBeenCalled();
        prisma.surveyPendingResponse.count.mockResolvedValue(0);
      });
    });

    it('no question can be removed once the survey has responses (without saying whether it has answers)', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyQuestion.findFirst.mockResolvedValue(question());
      prisma.surveyResponse.count.mockResolvedValue(1);
      await expect(service.removeQuestion(admin, 's1', 'q1')).rejects.toThrow(
        "This question can't be removed once the survey has responses.",
      );
      // Answers still waiting to be written count too — and the message is the same.
      prisma.surveyResponse.count.mockResolvedValue(0);
      prisma.surveyPendingResponse.count.mockResolvedValue(1);
      await expect(service.removeQuestion(admin, 's1', 'q1')).rejects.toThrow(
        "This question can't be removed once the survey has responses.",
      );
      expect(prisma.surveyAnswer.count).not.toHaveBeenCalled();
      expect(prisma.surveyQuestion.update).not.toHaveBeenCalled();
      prisma.surveyPendingResponse.count.mockResolvedValue(0);
      await service.removeQuestion(admin, 's1', 'q1');
      expect(prisma.surveyQuestion.update).toHaveBeenCalled();
    });

    describe('built-in agree ↔ disagree scale', () => {
      const likert = (options: unknown = null) => question({ questionType: 'LIKERT', options });

      it('offers "Neither agree nor disagree" in the middle', async () => {
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([likert()]);
        const res: any = await service.getPublicByToken('share-token-1');
        expect(res.data.questions[0].options).toEqual([
          'Strongly agree',
          'Agree',
          'Neither agree nor disagree',
          'Disagree',
          'Strongly disagree',
        ]);
      });

      it('counts old "Neutral" answers under the new middle label in the summary', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([likert()]);
        const q = { id: 'q1', surveyId: 's1', sourceQuestionId: null, questionType: 'LIKERT', questionText: 'I feel supported', options: null, sortOrder: 0 };
        const answer = (label: string) => ({ booleanValue: null, textValue: null, numberValue: null, selectedOptions: [label], question: q });
        prisma.surveyAnswer.findMany.mockResolvedValue([
          answer('Neutral'),
          answer('Neither agree nor disagree'),
          answer('Agree'),
        ]);
        const res = await service.results(admin, 's1');
        const options = (res.data.questionSummaries[0] as any).options;
        expect(options.map((o: any) => o.label)).toEqual([
          'Strongly agree',
          'Agree',
          'Neither agree nor disagree',
          'Disagree',
          'Strongly disagree',
        ]);
        expect(options.find((o: any) => o.label === 'Neither agree nor disagree')).toMatchObject({ count: 2, percent: 67 });
      });

      it('shows an old "Neutral" answer with the new label in the responses list', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        const answerRow = (options: unknown) => ({
          booleanValue: null,
          textValue: null,
          numberValue: null,
          selectedOptions: ['Neutral'],
          question: { id: 'q1', questionText: 'I feel supported', questionType: 'LIKERT', options, sortOrder: 0, sectionTitle: null },
        });
        prisma.surveyResponse.findMany.mockResolvedValue([
          {
            id: 'resp-1', surveyId: 's1', recipientId: null, recipient: null,
            submittedAt: new Date('2026-11-04T10:00:00.000Z'), respondentRelation: null, respondentName: null,
            channel: 'ONLINE', isAnonymous: false, recordedById: null, contactedAt: null, contactNumber: null,
            contactNotes: null, consentGiven: null,
            answers: [answerRow(null)],
          },
          {
            id: 'resp-2', surveyId: 's1', recipientId: null, recipient: null,
            submittedAt: new Date('2026-11-04T11:00:00.000Z'), respondentRelation: null, respondentName: null,
            channel: 'ONLINE', isAnonymous: false, recordedById: null, contactedAt: null, contactNumber: null,
            contactNotes: null, consentGiven: null,
            // A question with its own labels keeps "Neutral" as it is.
            answers: [answerRow(['Positive', 'Neutral', 'Negative'])],
          },
        ]);
        const res = await service.listResponses(admin, 's1');
        expect(res.data.responses[0].answers[0]).toMatchObject({
          selectedOptions: ['Neither agree nor disagree'],
          displayValue: 'Neither agree nor disagree',
        });
        expect(res.data.responses[1].answers[0]).toMatchObject({ selectedOptions: ['Neutral'], displayValue: 'Neutral' });
      });

      it('still accepts "Neutral" from a form opened before the change, and saves the new label', async () => {
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([likert()]);
        await service.submitPublicResponse('share-token-1', {
          answers: [{ questionId: 'q1', selectedOptions: ['Neutral'] }],
        });
        const created = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;
        expect(created[0].selectedOptions).toEqual(['Neither agree nor disagree']);
      });

      it('custom labels are not remapped, and "Neutral" is not an answer to them', async () => {
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([likert(['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'])]);
        await expect(
          service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', selectedOptions: ['Neutral'] }] }),
        ).rejects.toThrow(/Invalid choice/);
      });

      it('saving an unchanged question keeps its custom labels', async () => {
        givenSurvey(surveyRow());
        const labels = ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'];
        prisma.surveyQuestion.findFirst.mockResolvedValue(likert(labels));
        await service.updateQuestion(admin, 's1', 'q1', { questionText: 'How supported do you feel?', questionType: 'LIKERT' } as any);
        expect(prisma.surveyQuestion.update.mock.calls[0][0].data.options).toEqual(labels);
      });
    });

    it('rejects a rating answer outside the question’s range', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
      prisma.surveyQuestion.findMany.mockResolvedValue([
        question({ questionType: 'RATING', config: { min: 1, max: 5 } }),
      ]);
      await expect(
        service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', numberValue: 7 }] }),
      ).rejects.toThrow(/from 1 to 5/);
    });
  });

  /* ─── 15. Status and actors ───────────────────────────────────────────────── */

  describe('status changes', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    it('update cannot set status, schedule or repeat', async () => {
      for (const body of [{ status: 'ACTIVE' }, { distributeAt: '2030-01-01T00:00:00Z' }, { recurrence: 'WEEKLY' }]) {
        await expect(
          pipe.transform(body, { type: 'body', metatype: UpdateSurveyDto }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('send accepts an empty job-title list (clears it)', async () => {
      await expect(
        pipe.transform({ roleIds: [], locationIds: [] }, { type: 'body', metatype: SendSurveyDto }),
      ).resolves.toMatchObject({ roleIds: [], locationIds: [] });
    });

    it('close goes through its own action and cancels the schedule', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE', distributeAt: new Date('2030-01-01'), recurrence: 'WEEKLY' }));
      const res = await service.close(admin, 's1');
      expect(res.data.status).toBe('CLOSED');
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        distributeAt: null,
        recurrence: null,
        updatedById: 'admin-1',
      });
    });

    it('a closed survey can be reopened with Open for responses', async () => {
      givenSurvey(surveyRow({ status: 'CLOSED', targetKind: 'EMPLOYEE' }));
      givenQuestions(1);
      const res = await service.openForResponses(admin, 's1');
      expect(res.data.status).toBe('ACTIVE');
    });
  });

  /* ─── Independent review follow-ups ───────────────────────────────────────── */

  describe('review follow-ups', () => {
    const londonHm = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(d);

    it('record candidates never show who has answered an anonymous survey', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', personalDetail: { firstName: 'Jo', lastName: 'Bloggs' } },
      ]);
      prisma.surveyRecipient.findMany.mockResolvedValue([
        { employeeId: 'emp-1', serviceUserId: null, status: 'COMPLETED' },
      ]);
      const res = await service.listRecordCandidates(admin, 's1');
      expect(res.data).toEqual([
        { id: 'emp-1', name: 'Jo Bloggs', recipientStatus: null, hasResponse: false, statusHidden: true },
      ]);
      expect(prisma.surveyRecipient.findMany).not.toHaveBeenCalled();
    });

    it('record candidates still show completion on named surveys', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', personalDetail: { firstName: 'Jo', lastName: 'Bloggs' } },
      ]);
      prisma.surveyRecipient.findMany.mockResolvedValue([
        { employeeId: 'emp-1', serviceUserId: null, status: 'COMPLETED' },
      ]);
      const res = await service.listRecordCandidates(admin, 's1');
      expect(res.data[0]).toMatchObject({ hasResponse: true, recipientStatus: 'COMPLETED', statusHidden: false });
    });

    it('anonymous answer rows keep only the day too (not just the response row)', async () => {
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'SENT',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey: surveyRow({ isAnonymous: true, status: 'ACTIVE' }),
      });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      expect(londonHm(held().createdAt)).toBe('00:00');
      const [data] = await flushHeld();
      const answer = data.answers.create[0];
      expect(answer.createdAt).toEqual(data.submittedAt);
      expect(answer.updatedAt).toEqual(data.submittedAt);
      expect(londonHm(answer.createdAt)).toBe('00:00');
    });

    it('named answers keep their real timestamps', async () => {
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'SENT',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey: surveyRow({ status: 'ACTIVE' }),
      });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
      const answer = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create[0];
      expect(answer).not.toHaveProperty('createdAt');
    });

    it('stopping a repeating survey ends a period that was open "until the next period"', async () => {
      const nextRun = new Date('2099-12-01T09:00:00.000Z');
      givenSurvey(surveyRow({ recurrence: 'MONTHLY', distributeAt: nextRun }));
      await service.close(admin, 's1');
      expect(prisma.survey.updateMany).toHaveBeenCalledWith({
        where: { clonedFromId: 's1', deletedAt: null, status: 'ACTIVE', closesAt: null },
        data: { closesAt: nextRun },
      });
    });

    it('cancelling a repeat whose next run has passed ends the open period now', async () => {
      givenSurvey(surveyRow({ recurrence: 'MONTHLY', distributeAt: new Date('2020-01-01T09:00:00.000Z') }));
      const before = Date.now();
      await service.cancelSchedule(admin, 's1');
      const call = prisma.survey.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ clonedFromId: 's1', closesAt: null });
      expect(call.data.closesAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('a stopped repeating survey can be restarted with a repeat (not a dead end)', async () => {
      givenSurvey(surveyRow({ status: 'CLOSED' }));
      givenQuestions(2);
      prisma.survey.count.mockResolvedValue(3); // it has periods
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
      const res = await service.send(admin, 's1', {
        recurrence: SurveyRecurrence.MONTHLY,
        distributeAt: '2099-01-01T09:00:00.000Z',
      });
      expect(res.message).toMatch(/scheduled/i);
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        status: 'DRAFT',
        recurrence: 'MONTHLY',
      });
      // Without a repeat a closed survey still cannot be sent.
      await expect(service.send(admin, 's1', { recurrence: null })).rejects.toThrow(/closed/);
    });

    it('after downtime only the current period is sent, not a stale one', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ id: 'src-q1' })]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
      const source = surveyRow({
        recurrence: 'MONTHLY',
        distributeAt: new Date('2026-08-01T08:00:00.000Z'), // 1 Aug 09:00 BST, missed
        recurrenceAnchorAt: new Date('2026-08-01T08:00:00.000Z'),
        periodOpenDays: 7,
        audienceEmployeeIds: ['emp-1'],
      });
      const now = new Date('2026-11-05T12:00:00.000Z');
      const run = await service.runRecurringPeriod(source, now);
      const clone = prisma.survey.create.mock.calls[0][0].data;
      expect(clone.periodKey).toBe('2026-11');
      expect(clone.title).toBe('Staff survey — Nov 2026');
      expect(clone.opensAt.toISOString()).toBe('2026-11-01T09:00:00.000Z'); // 09:00 GMT
      expect(clone.closesAt.toISOString()).toBe('2026-11-08T09:00:00.000Z');
      // The period copy keeps the chosen people, so "Send to more" starts from them.
      expect(clone.audienceEmployeeIds).toEqual(['emp-1']);
      expect(run.nextAt.toISOString()).toBe('2026-12-01T09:00:00.000Z');
    });

    it('an unexpected error leaves the schedule for the next tick instead of failing it', async () => {
      const due = surveyRow({ distributeAt: new Date('2026-11-05T09:00:00.000Z'), scheduledById: 'admin-1' });
      prisma.survey.findMany.mockResolvedValue([due]);
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
      prisma.$transaction.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
      const out = await service.runDueDistributions(new Date('2026-11-05T09:01:00.000Z'));
      expect(out[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/will retry/) });
      expect(prisma.survey.update).not.toHaveBeenCalled();
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
    });
  });
  /* ─── Approved decisions & review fixes (final round) ─────────────────────── */

  describe('anonymous surveys: small groups', () => {
    const fiveEmployees = Array.from({ length: 5 }, (_, i) => ({
      id: `emp-${i}`,
      employment: { locationId: 'loc-leeds' },
    }));

    it('cannot be sent, scheduled or repeated to fewer than 5 people', async () => {
      givenSurvey(surveyRow({ isAnonymous: true }));
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue(fiveEmployees.slice(0, 4));
      for (const dto of [
        {},
        { distributeAt: '2099-01-01T09:00:00.000Z' },
        { recurrence: SurveyRecurrence.MONTHLY },
      ]) {
        await expect(service.send(admin, 's1', dto)).rejects.toThrow(/at least 5 people.*has 4/);
      }
      expect(prisma.survey.update).not.toHaveBeenCalled();
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('can be sent to 5 or more, and named surveys have no minimum', async () => {
      givenSurvey(surveyRow({ isAnonymous: true }));
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue(fiveEmployees);
      await expect(service.send(admin, 's1', {})).resolves.toMatchObject({ data: { sent: 5 } });

      jest.clearAllMocks();
      resetDefaults(prisma);
      givenSurvey(surveyRow());
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue(fiveEmployees.slice(0, 1));
      await expect(service.send(admin, 's1', {})).resolves.toMatchObject({ data: { sent: 1 } });
    });

    it('a recipient created by staff between the send’s read and its insert is skipped and never emailed or pushed', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      givenQuestions(2);
      config.get.mockReturnValue('https://admin.example.test');
      prisma.employee.findMany.mockResolvedValue(fiveEmployees.slice(0, 2));
      prisma.employeePersonalDetail.findMany.mockResolvedValue([
        { employeeId: 'emp-0', firstName: 'Ann', email: 'ann@example.test' },
        { employeeId: 'emp-1', firstName: 'Bea', email: 'bea@example.test' },
      ]);
      // emp-1's answer was recorded (their row created) after the send read who already had one:
      // the insert skips their duplicate, so the token generated for them here was never saved.
      let saved: string[] = [];
      prisma.surveyRecipient.createMany.mockImplementation(async (args: any) => {
        saved = args.data.filter((r: any) => r.employeeId === 'emp-0').map((r: any) => r.token);
        return { count: saved.length };
      });
      prisma.surveyRecipient.findMany.mockImplementation(async (args: any) =>
        args.where.token ? saved.map((token) => ({ token })) : [],
      );
      try {
        const res = await service.send(admin, 's1', {});
        expect(res.data).toMatchObject({ sent: 1, skippedExisting: 1 });
        await new Promise((r) => setImmediate(r));
        expect(push.sendToEmployees).toHaveBeenCalledTimes(1);
        expect(push.sendToEmployees.mock.calls[0][0]).toEqual(['emp-0']);
        expect(mail.send).toHaveBeenCalledTimes(1);
        expect(mail.send.mock.calls[0][0]).toMatchObject({ to: 'ann@example.test' });
        expect(mail.send.mock.calls[0][0].text).toContain(`/survey/${saved[0]}`);
        expect(audit.logAudit.mock.calls.at(-1)[0].newValues).toMatchObject({ sent: 1, skippedExisting: 1 });
      } finally {
        config.get.mockReturnValue('');
      }
    });

    it('"Send to more" counts the people it already went to', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', clonedFromId: 'src' }));
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue(fiveEmployees.slice(0, 2));
      prisma.surveyRecipient.count.mockImplementation(async (args: any) =>
        args.where.employeeId ? 0 : 8,
      );
      await expect(service.send(admin, 's1', { employeeIds: ['emp-0', 'emp-1'] })).resolves.toMatchObject({
        data: { sent: 2 },
      });

      // Only 3 earlier recipients, 1 of them chosen again: 3 + 2 - 1 = 4 people.
      prisma.surveyRecipient.count.mockImplementation(async (args: any) =>
        args.where.employeeId ? 1 : 3,
      );
      await expect(service.send(admin, 's1', { employeeIds: ['emp-0', 'emp-1'] })).rejects.toThrow(/has 4/);
    });

    it('cannot be opened for responses with fewer than 5 people in its audience', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, targetKind: 'SERVICE_USER', locationIds: ['loc-leeds'] }));
      givenQuestions(2);
      // 1 with a portal + 2 without: answers could be recorded for 3 people.
      prisma.serviceUser.findMany.mockResolvedValue([{ id: 'su-1', locationId: 'loc-leeds' }]);
      prisma.serviceUser.count.mockResolvedValue(3);
      await expect(service.openForResponses(admin, 's1')).rejects.toThrow(/at least 5 people.*has 3/);

      prisma.serviceUser.count.mockResolvedValue(6);
      await expect(service.openForResponses(admin, 's1')).resolves.toMatchObject({
        data: { status: 'ACTIVE' },
      });
    });

    it('templates and drafts can still be created anonymous', async () => {
      await expect(service.create(admin, { title: 'Anon template', isAnonymous: true, isTemplate: true })).resolves.toBeDefined();
      await expect(service.create(admin, { title: 'Anon draft', isAnonymous: true })).resolves.toBeDefined();
    });

    it('a repeating anonymous survey with too few people skips the period and tells the scheduler', async () => {
      const source = surveyRow({
        isAnonymous: true,
        recurrence: 'MONTHLY',
        distributeAt: new Date('2026-11-01T09:00:00.000Z'),
        recurrenceAnchorAt: new Date('2026-11-01T09:00:00.000Z'),
        scheduledById: 'admin-1',
      });
      prisma.survey.findMany.mockResolvedValue([source]);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.employee.findMany.mockResolvedValue(fiveEmployees.slice(0, 2));
      const out = await service.runDueDistributions(new Date('2026-11-01T09:00:30.000Z'));
      expect(out[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/at least 5 people/) });
      expect(prisma.survey.create).not.toHaveBeenCalled();
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        distributeAt: new Date('2026-12-01T09:00:00.000Z'),
      });
      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
    });

    it('a named staff answer keeps its job title', async () => {
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'SENT',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey: surveyRow({ status: 'ACTIVE' }),
      });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.employeeEmployment.findFirst.mockResolvedValue({ locationId: 'loc-leeds', jobTitleId: 'jt-carer' });
      await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
      expect(prisma.surveyResponse.create.mock.calls[0][0].data).toMatchObject({
        locationId: 'loc-leeds',
        jobTitleId: 'jt-carer',
      });
    });

    it('a recorded answer on an anonymous survey keeps the branch but not the job title', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.employeeEmployment.findFirst.mockResolvedValue({ locationId: 'loc-leeds', jobTitleId: 'jt-carer' });
      await service.recordResponse(admin, 's1', {
        channel: 'PAPER',
        personId: 'emp-1',
        answers: [{ questionId: 'q1', booleanValue: true }],
      } as any);
      expect(held().payload).toMatchObject({ locationId: 'loc-leeds' });
      expect(JSON.stringify(held())).not.toMatch(/jt-carer|emp-1/);
      const [data] = await flushHeld();
      expect(data).toMatchObject({
        recipientId: null,
        locationId: 'loc-leeds',
        jobTitleId: null,
      });
    });

    it('anonymous breakdowns wait until the survey is closed', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      // 9 responses in the figures (over the reporting threshold), all from Leeds.
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'locationId'
          ? [{ locationId: 'loc-leeds', _count: { _all: 9 } }]
          : args.by[0] === 'surveyId'
            ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 9 } }]
            : [],
      );
      const open = await service.results(admin, 's1');
      expect(open.data.breakdowns).toEqual([
        expect.objectContaining({ dimension: 'branch', suppressed: true, note: expect.stringMatching(/once the survey is closed/) }),
      ]);
      expect(prisma.surveyResponse.groupBy.mock.calls.some((c: any[]) => c[0].by[0] === 'locationId')).toBe(false);

      givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED' }));
      prisma.location.findMany.mockResolvedValue([{ id: 'loc-leeds', name: 'Leeds' }]);
      const closed = await service.results(admin, 's1');
      expect(closed.data.breakdowns[0]).toMatchObject({
        suppressed: false,
        groups: [{ key: 'loc-leeds', label: 'Leeds', responses: 9 }],
      });
    });

    it('a repeating anonymous survey breaks down closed periods only', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, recurrence: 'MONTHLY', status: 'ACTIVE' }));
      prisma.survey.findMany.mockResolvedValue([
        { id: 'p2', title: 'Nov', periodKey: '2026-11', opensAt: new Date('2026-11-01'), closesAt: null, status: 'ACTIVE' },
        { id: 'p1', title: 'Oct', periodKey: '2026-10', opensAt: new Date('2026-10-01'), closesAt: null, status: 'CLOSED' },
      ]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'locationId'
          ? [{ locationId: 'loc-leeds', _count: { _all: 6 } }]
          : args.by[0] === 'surveyId'
            ? [{ surveyId: 'p1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 6 } }]
            : [],
      );
      const res = await service.results(admin, 's1');
      const call = prisma.surveyResponse.groupBy.mock.calls.find((c: any[]) => c[0].by[0] === 'locationId');
      expect(call[0].where).toEqual({ surveyId: { in: ['p1'] } });
      expect(res.data.breakdowns[0].note).toMatch(/Closed periods only/);
    });

    it('"All periods" leaves out a period with fewer answers than the threshold (no working it out by subtraction)', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, recurrence: 'MONTHLY', status: 'ACTIVE' }));
      prisma.survey.findMany.mockResolvedValue([
        { id: 'p2', title: 'Nov', periodKey: '2026-11', opensAt: new Date('2026-11-01'), closesAt: null, status: 'CLOSED' },
        { id: 'p1', title: 'Oct', periodKey: '2026-10', opensAt: new Date('2026-10-01'), closesAt: null, status: 'CLOSED' },
      ]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'locationId'
          ? [{ locationId: 'loc-leeds', _count: { _all: 6 } }]
          : args.by[0] === 'surveyId'
            ? [
                { surveyId: 'p1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 6 } },
                { surveyId: 'p2', isAnonymous: false, channel: 'ONLINE', _count: { _all: 2 } },
              ]
            : [],
      );
      const res = await service.results(admin, 's1');
      expect(res.data.periodsLeftOut).toBe(1);
      expect(res.data.periodsLeftOutNote).toBe('1 period has too few answers to show and is not included in these figures.');
      expect(res.data.participation.responsesInFigures).toBe(6);
      const call = prisma.surveyResponse.groupBy.mock.calls.find((c: any[]) => c[0].by[0] === 'locationId');
      expect(call[0].where).toEqual({ surveyId: { in: ['p1'] } });
    });

    it('still suppresses a small branch above the threshold (9 answers: Leeds 6, York 3)', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED' }));
      prisma.location.findMany.mockResolvedValue([
        { id: 'loc-leeds', name: 'Leeds' },
        { id: 'loc-york', name: 'York' },
      ]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'locationId'
          ? [
              { locationId: 'loc-leeds', _count: { _all: 6 } },
              { locationId: 'loc-york', _count: { _all: 3 } },
            ]
          : args.by[0] === 'surveyId'
            ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 9 } }]
            : [],
      );
      const res = await service.results(admin, 's1');
      expect(res.data.reporting.belowThreshold).toBe(false);
      const branch: any = res.data.breakdowns.find((b: any) => b.dimension === 'branch');
      expect(JSON.stringify(branch)).not.toMatch(/York[^}]*"responses":3/);
      expect(branch!.groups.find((g: any) => g.label === 'York')?.responses).not.toBe(3);
    });

    it('a named staff survey still breaks down by job title while open', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) => {
        if (args.by[0] === 'locationId') return [{ locationId: 'loc-leeds', _count: { _all: 2 } }];
        if (args.by[0] === 'jobTitleId') return [{ jobTitleId: 'jt-1', _count: { _all: 2 } }];
        return [];
      });
      const res = await service.results(admin, 's1');
      expect(res.data.breakdowns.map((b: any) => b.dimension)).toEqual(['branch', 'jobTitle']);
      expect(res.data.breakdowns.every((b: any) => !b.suppressed)).toBe(true);
    });

    it('recording for someone on an anonymous survey never reveals whether they already answered', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      // emp-1 has already answered through their own link.
      prisma.surveyRecipient.findFirst.mockResolvedValue({ id: 'r1', status: 'COMPLETED' });
      prisma.surveyRecipient.updateMany.mockResolvedValue({ count: 0 });
      const res = await service.recordResponse(admin, 's1', {
        channel: 'TELEPHONE',
        consentGiven: true,
        personId: 'emp-1',
        answers: [{ questionId: 'q1', booleanValue: true }],
      } as any, { ipAddress: '10.0.0.9', userAgent: 'Office' } as any);
      expect(res.message).toBe('Survey response recorded');
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      expect((await flushHeld())[0].recipientId).toBeNull();
      // No audit row of its own (its time would date the call): counted for the day as recorded by staff.
      expectNoPerAnswerAudit(audit);
      expect(unlinkedDayCounts(prisma)).toMatchObject([{ surveyId: 's1', recorded: 1, reviewer: 0 }]);
    });

    it('recording for someone who already answered a named survey is still refused', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      prisma.surveyRecipient.findFirst.mockResolvedValue({ id: 'r1', status: 'COMPLETED' });
      await expect(
        service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          personId: 'emp-1',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any),
      ).rejects.toThrow(/already answered/);
    });

    describe('named survey: a duplicate key while recording', () => {
      const body = { channel: 'PAPER', personId: 'emp-1', answers: [{ questionId: 'q1', booleanValue: true }] } as any;
      const clash = () => new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' });
      beforeEach(() => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      });

      it('the distribution job created their recipient meanwhile: tried again and recorded against that row', async () => {
        let jobRow: { id: string; status: string } | null = null;
        prisma.surveyRecipient.findFirst.mockImplementation(async () => jobRow);
        prisma.surveyRecipient.create.mockImplementationOnce(async () => {
          jobRow = { id: 'r-job', status: 'SENT' };
          throw clash();
        });
        await expect(service.recordResponse(admin, 's1', body)).resolves.toMatchObject({
          message: 'Survey response recorded',
        });
        expect(prisma.surveyRecipient.updateMany.mock.calls.at(-1)[0]).toMatchObject({
          where: { id: 'r-job' },
          data: { status: 'COMPLETED' },
        });
        expect(prisma.surveyResponse.create).toHaveBeenCalledTimes(1);
        expect(prisma.surveyResponse.create.mock.calls[0][0].data.recipientId).toBe('r-job');
      });

      it('they answered meanwhile: "already answered", nothing written', async () => {
        let row: { id: string; status: string } | null = null;
        prisma.surveyRecipient.findFirst.mockImplementation(async () => row);
        prisma.surveyRecipient.create.mockImplementationOnce(async () => {
          row = { id: 'r1', status: 'COMPLETED' };
          throw clash();
        });
        await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(/already answered/);
        expect(prisma.surveyRecipient.create).toHaveBeenCalledTimes(1);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      });

      it('a clash that does not go away is "try again", never "already answered"', async () => {
        prisma.surveyRecipient.findFirst.mockResolvedValue(null);
        prisma.surveyRecipient.create.mockRejectedValue(clash());
        const err = await service.recordResponse(admin, 's1', body).catch((e: unknown) => e);
        expect(String(err)).toMatch(/could not be recorded just now/);
        expect(String(err)).not.toMatch(/already answered/);
        expect(prisma.surveyRecipient.create).toHaveBeenCalledTimes(2);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      });
    });

    it('correcting a recorded answer on an anonymous survey is audited against the survey', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      const existing = {
        id: 'resp-1',
        channel: 'PAPER',
        isAnonymous: false,
        submittedAt: new Date('2026-11-04T00:00:00.000Z'),
        updatedAt: new Date('2026-11-04T00:00:00.000Z'),
        contactedAt: null,
        answers: [],
      };
      prisma.surveyResponse.findFirst.mockResolvedValue(existing);
      prisma.surveyResponse.update.mockResolvedValue({ ...existing, answers: [] });
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      await service.updateRecordedResponse(
        admin,
        's1',
        'resp-1',
        { reason: 'Typo', answers: [{ questionId: 'q1', booleanValue: false }] } as any,
        { ipAddress: '10.0.0.9' } as any,
      );
      const row = audit.logAudit.mock.calls[0][0];
      expect(row).toMatchObject({ recordType: 'Survey', recordId: 's1' });
      expect(row).not.toHaveProperty('ipAddress');
    });

    it('never writes an unlinked equality answer into the audit trail when it is corrected', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
      const eth = { questionText: 'What is your ethnic group?', questionType: 'SINGLE_SELECT', options: null, sortOrder: 1, otherOption: null, optionsFrom: 'ETHNICITY' };
      const existing = {
        id: 'resp-1', channel: 'PAPER', isAnonymous: false, recordedById: 'u1',
        submittedAt: new Date('2026-11-04T00:00:00.000Z'), updatedAt: new Date('2026-11-04T00:00:00.000Z'), contactedAt: null,
        answers: [{ questionId: 'q-eth', booleanValue: null, textValue: null, numberValue: null, selectedOptions: ['Arab'], otherText: null, comment: null, question: eth }],
      };
      prisma.surveyResponse.findFirst.mockResolvedValue(existing);
      prisma.surveyResponse.update.mockResolvedValue(existing);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      await service.updateRecordedResponse(admin, 's1', 'resp-1', { reason: 'Typo', answers: [{ questionId: 'q1', booleanValue: false }] } as any);
      expect(JSON.stringify(audit.logAudit.mock.calls[0][0])).not.toContain('Arab');
    });
  });

  describe('branch managers', () => {
    const companyTemplate = surveyRow({ isTemplate: true, locationIds: [] });

    it.each([
      ['update', (s: SurveysService) => s.update(leedsManager, 's1', { title: 'Mine now' })],
      ['move to surveys', (s: SurveysService) => s.update(leedsManager, 's1', { isTemplate: false })],
      ['delete', (s: SurveysService) => s.remove(leedsManager, 's1')],
      ['add question', (s: SurveysService) => s.addQuestion(leedsManager, 's1', { questionText: 'Q', questionType: 'YES_NO' } as any)],
      ['edit question', (s: SurveysService) => s.updateQuestion(leedsManager, 's1', 'q1', { helpText: 'x' })],
      ['remove question', (s: SurveysService) => s.removeQuestion(leedsManager, 's1', 'q1')],
    ])('cannot %s a shared company template', async (_name, call) => {
      givenSurvey(companyTemplate);
      prisma.surveyQuestion.findFirst.mockResolvedValue(question());
      await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.survey.update).not.toHaveBeenCalled();
      expect(prisma.surveyQuestion.update).not.toHaveBeenCalled();
      expect(prisma.surveyQuestion.create).not.toHaveBeenCalled();
    });

    it('can view and use a shared company template (marked read-only)', async () => {
      givenSurvey(companyTemplate);
      const detail = await service.getById(leedsManager, 's1');
      expect(detail.data.readOnly).toBe(true);
      const res = await service.duplicate(leedsManager, 's1');
      expect(res.message).toMatch(/from template/);
      expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({ isTemplate: false, locationIds: ['loc-leeds'] });
    });

    it('company-wide users can still edit company templates; branch templates stay editable for their branch', async () => {
      givenSurvey(companyTemplate);
      expect((await service.getById(admin, 's1')).data.readOnly).toBe(false);
      await expect(service.update(admin, 's1', { title: 'Renamed' })).resolves.toBeDefined();

      givenSurvey(surveyRow({ isTemplate: true, locationIds: ['loc-leeds'] }));
      await expect(service.update(leedsManager, 's1', { title: 'Leeds template' })).resolves.toBeDefined();
    });

    it('the survey list marks shared templates read-only for branch users', async () => {
      prisma.survey.findMany.mockResolvedValue([
        { ...surveyRow({ id: 'd', isTemplate: true, locationIds: [] }), _count: { questions: 0, recipients: 0, responses: 0, clones: 0 } },
        { ...surveyRow({ id: 'e', isTemplate: true, locationIds: ['loc-leeds'] }), _count: { questions: 0, recipients: 0, responses: 0, clones: 0 } },
      ]);
      const res = await service.list(leedsManager, { isTemplate: 'true' } as any);
      expect(res.data.map((s: any) => [s.id, s.readOnly])).toEqual([
        ['d', true],
        ['e', false],
      ]);
    });

    it('people chosen through a floor / base branch keep the survey in the sender’s branches', async () => {
      givenSurvey(surveyRow({ locationIds: ['loc-leeds'] }));
      givenQuestions(1);
      prisma.employee.count.mockResolvedValue(1); // in scope through the floor branch
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-floor',
          employment: {
            locationId: 'loc-york',
            baseLocationId: null,
            floorLocations: [{ locationId: 'loc-leeds' }],
          },
        },
      ]);
      await service.send(leedsManager, 's1', { employeeIds: ['emp-floor'] });
      const data = prisma.survey.update.mock.calls[0][0].data;
      expect(data.locationIds).toEqual(['loc-leeds']);
      expect(data.audienceEmployeeIds).toEqual(['emp-floor']);
    });

    it('a scheduled run keeps chosen people under the survey’s own branches', async () => {
      const due = surveyRow({
        distributeAt: new Date('2026-11-05T09:00:00.000Z'),
        locationIds: ['loc-leeds'],
        audienceEmployeeIds: ['emp-floor'],
        scheduledById: 'mgr-leeds',
      });
      prisma.survey.findMany.mockResolvedValue([due]);
      givenQuestions(1);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-floor', employment: { locationId: 'loc-york', baseLocationId: 'loc-leeds', floorLocations: [] } },
      ]);
      const out = await service.runDueDistributions(new Date('2026-11-05T09:00:30.000Z'));
      expect(out[0].ok).toBe(true);
      expect(prisma.survey.update.mock.calls[0][0].data.locationIds).toEqual(['loc-leeds']);
    });

    it('branchWithin prefers the main branch, then base, then floor branches in scope', () => {
      const e = { locationId: 'york', baseLocationId: 'hull', floorLocations: [{ locationId: 'leeds' }] };
      expect(branchWithin(e, null)).toBe('york');
      expect(branchWithin(e, ['york', 'leeds'])).toBe('york');
      expect(branchWithin(e, ['leeds', 'hull'])).toBe('hull');
      expect(branchWithin(e, ['leeds'])).toBe('leeds');
      expect(branchWithin(e, ['bradford'])).toBe('york');
      expect(branchWithin(null, ['leeds'])).toBeNull();
    });
  });

  describe('repeating surveys: retired questions in "All periods"', () => {
    const periods = [
      { id: 'p2', title: 'Staff survey — Nov 2026', periodKey: '2026-11', opensAt: new Date('2026-11-01T09:00:00Z'), closesAt: null, status: 'ACTIVE' },
      { id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10', opensAt: new Date('2026-10-01T08:00:00Z'), closesAt: null, status: 'CLOSED' },
    ];
    const pq = (id: string, surveyId: string, overrides: Record<string, unknown> = {}) => ({
      id,
      surveyId,
      sourceQuestionId: 'src-q1',
      questionType: 'YES_NO',
      questionText: 'Do you feel supported by your manager?',
      options: null,
      sortOrder: 0,
      ...overrides,
    });
    const yes = (q: unknown) => ({ booleanValue: true, textValue: null, numberValue: null, selectedOptions: null, question: q });
    const no = (q: unknown) => ({ booleanValue: false, textValue: null, numberValue: null, selectedOptions: null, question: q });

    beforeEach(() => {
      givenSurvey(surveyRow({ recurrence: 'MONTHLY' }));
      prisma.survey.findMany.mockResolvedValue(periods);
    });

    it('keeps answers to an old wording as a "reworded" question with its periods', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([
        question({ id: 'src-q1', questionText: 'Do you feel supported by your manager?' }),
      ]);
      const oct = pq('p1-q1', 'p1', { questionText: 'How supported do you feel?' });
      const nov = pq('p2-q1', 'p2');
      prisma.surveyAnswer.findMany.mockResolvedValue([yes(nov), yes(oct), no(oct)]);
      const res = await service.results(admin, 's1');
      expect(prisma.surveyQuestion.findMany.mock.calls[0][0].where).toEqual({ surveyId: 's1' });
      const [current, reworded] = res.data.questionSummaries as any[];
      expect(res.data.questionSummaries).toHaveLength(2);
      expect(current).toMatchObject({ questionId: 'src-q1', status: 'current', answerCount: 1 });
      expect(reworded).toMatchObject({
        status: 'reworded',
        questionText: 'How supported do you feel?',
        currentQuestionText: 'Do you feel supported by your manager?',
        answerCount: 2,
        askedIn: [{ id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10' }],
      });
      expect(reworded.options).toEqual([
        { label: 'Yes', count: 1, percent: 50, notCounted: false },
        { label: 'No', count: 1, percent: 50, notCounted: false },
      ]);
    });

    it('keeps a removed question’s answers, labelled "removed"', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([
        question({ id: 'src-q1', questionText: 'Do you feel supported by your manager?' }),
        question({ id: 'src-q2', questionText: 'Would you recommend us?', sortOrder: 1, deletedAt: new Date('2026-10-20') }),
      ]);
      const removedQ = pq('p1-q2', 'p1', { sourceQuestionId: 'src-q2', questionText: 'Would you recommend us?', sortOrder: 1 });
      prisma.surveyAnswer.findMany.mockResolvedValue([yes(removedQ)]);
      const res = await service.results(admin, 's1');
      expect(res.data.questionSummaries.map((q: any) => [q.questionText, q.status, q.answerCount])).toEqual([
        ['Do you feel supported by your manager?', 'current', 0],
        ['Would you recommend us?', 'removed', 1],
      ]);
      expect((res.data.questionSummaries[1] as any).askedIn.map((p: any) => p.id)).toEqual(['p1']);
    });

    it('a type change is kept apart too (never mixed into the current question)', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([question({ id: 'src-q1', questionType: 'RATING', questionText: 'Do you feel supported by your manager?' })]);
      prisma.surveyAnswer.findMany.mockResolvedValue([yes(pq('p1-q1', 'p1'))]);
      const res = await service.results(admin, 's1');
      expect(res.data.questionSummaries.map((q: any) => [q.questionType, q.status, q.answerCount])).toEqual([
        ['RATING', 'current', 0],
        ['YES_NO', 'reworded', 1],
      ]);
    });

    it('answers given on the repeating survey itself (before it repeated) count as current', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([
        question({ id: 'src-q1', questionText: 'Do you feel supported by your manager?' }),
      ]);
      prisma.surveyAnswer.findMany.mockResolvedValue([
        yes(pq('src-q1', 's1', { sourceQuestionId: null })),
        no(pq('p1-q1', 'p1')),
      ]);
      const res = await service.results(admin, 's1');
      expect(res.data.questionSummaries).toEqual([
        expect.objectContaining({ questionId: 'src-q1', status: 'current', answerCount: 2 }),
      ]);
    });

    it('a single survey only reads its own live questions', async () => {
      givenSurvey(surveyRow());
      prisma.survey.findMany.mockResolvedValue([]);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.surveyAnswer.findMany.mockResolvedValue([yes({ ...pq('q1', 's1'), sourceQuestionId: null })]);
      const res = await service.results(admin, 's1');
      expect(prisma.surveyQuestion.findMany.mock.calls[0][0].where).toEqual({ surveyId: 's1', deletedAt: null });
      expect(res.data.questionSummaries[0]).toMatchObject({ questionId: 'q1', status: 'current', answerCount: 1 });
    });
  });

  describe('carer app / portal list', () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const row = (token: string, survey: Record<string, unknown>, status = 'SENT', response: unknown = null) => ({
      token,
      status,
      sentAt: daysAgo(60),
      survey: {
        id: `s-${token}`,
        title: token,
        description: null,
        isAnonymous: false,
        status: 'CLOSED',
        opensAt: null,
        closesAt: null,
        updatedAt: daysAgo(60),
        ...survey,
      },
      response,
    });

    beforeEach(() => {
      prisma.surveyRecipient.findMany.mockResolvedValue([
        row('old-unanswered', { closesAt: daysAgo(40) }),
        row('old-closed-early', { closesAt: null, updatedAt: daysAgo(31) }),
        row('old-answered', { closesAt: daysAgo(40) }, 'COMPLETED', { submittedAt: daysAgo(45) }),
        row('recent-unanswered', { closesAt: daysAgo(10) }),
        row('open', { status: 'ACTIVE', closesAt: null, updatedAt: daysAgo(90) }),
      ]);
    });

    it('stops listing closed surveys nobody answered after 30 days (carer app)', async () => {
      const res = await service.listForEmployeeApp('emp-1', now);
      expect(res.data.map((d) => d.token).sort()).toEqual(['old-answered', 'open', 'recent-unanswered']);
    });

    it('stops listing closed surveys nobody answered after 30 days (portal)', async () => {
      const res = await service.listForServiceUserPortal('su-1', now);
      expect(res.data.map((d) => d.token).sort()).toEqual(['old-answered', 'open', 'recent-unanswered']);
    });

    it('isStaleUnansweredSurvey', () => {
      const base = { status: 'ACTIVE' as any, closesAt: null, updatedAt: daysAgo(100) };
      expect(isStaleUnansweredSurvey(base, false, now)).toBe(false);
      expect(isStaleUnansweredSurvey({ ...base, closesAt: daysAgo(31) }, false, now)).toBe(true);
      expect(isStaleUnansweredSurvey({ ...base, closesAt: daysAgo(29) }, false, now)).toBe(false);
      expect(isStaleUnansweredSurvey({ ...base, closesAt: daysAgo(31) }, true, now)).toBe(false);
      expect(isStaleUnansweredSurvey({ ...base, status: 'CLOSED', closesAt: new Date('2099-01-01') }, false, now)).toBe(true);
    });
  });

  describe('unexpected run errors back off', () => {
    const due = surveyRow({ distributeAt: new Date('2026-11-05T09:00:00.000Z'), scheduledById: 'admin-1' });
    const t0 = new Date('2026-11-05T09:00:00.000Z').getTime();
    const at = (min: number) => new Date(t0 + min * 60_000);

    beforeEach(() => {
      prisma.survey.findMany.mockImplementation(async (args: any) =>
        args?.where?.id?.notIn?.includes('s1') ? [] : [due],
      );
      givenQuestions(2);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
      prisma.$transaction.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    });

    it('retries every minute 3 times, then waits longer, and tells the scheduler once', async () => {
      for (const min of [1, 2, 3]) {
        const out = await service.runDueDistributions(at(min));
        expect(out[0].detail).toMatch(/will retry next minute/);
      }
      const fourth = await service.runDueDistributions(at(4));
      expect(fourth[0].detail).toMatch(/will retry at .*attempt 4/);
      // Backing off: the survey is left out of the next ticks.
      expect(await service.runDueDistributions(at(5))).toEqual([]);
      expect(prisma.survey.findMany.mock.calls.at(-1)[0].where.id).toEqual({ notIn: ['s1'] });
      expect(notifications.notifyUsers).not.toHaveBeenCalled();

      await service.runDueDistributions(at(9)); // 5th failure → scheduler told
      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      expect(notifications.notifyUsers.mock.calls[0][0]).toMatchObject({
        recipientUserIds: ['admin-1'],
        title: expect.stringMatching(/keeps failing/),
      });
      await service.runDueDistributions(at(19)); // 6th failure → not told again
      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      // Never marked failed: it still goes out once the problem clears.
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('a successful run clears the back-off', async () => {
      for (const min of [1, 2, 3, 4]) await service.runDueDistributions(at(min));
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
      const out = await service.runDueDistributions(at(40));
      expect(out[0].ok).toBe(true);
      prisma.$transaction.mockRejectedValue(new Error('blip'));
      const again = await service.runDueDistributions(at(41));
      expect(again[0].detail).toMatch(/next minute \(attempt 1\)/);
    });

    it('surveyRetryDelayMs grows to an hour at most', () => {
      expect([1, 2, 3].map(surveyRetryDelayMs)).toEqual([0, 0, 0]);
      expect([4, 5, 6, 7, 8, 20].map((n) => surveyRetryDelayMs(n) / 60_000)).toEqual([5, 10, 20, 40, 60, 60]);
    });
  });

  /* ─── Respondent text ("Other", comments), clearing answers and "Show only if" ─── */

  describe('respondent text and conditional questions', () => {
    const visits = () =>
      question({
        id: 'q1',
        key: 'q-visits',
        questionText: 'Do your care workers arrive on time?',
        questionType: 'SINGLE_SELECT',
        options: ['Always', 'Usually', 'Rarely', 'Never'],
        commentConfig: { prompt: 'Please tell us why', showWhen: ['Rarely', 'Never'] },
        isRequired: true,
        sortOrder: 0,
      });
    const lateWhy = () =>
      question({
        id: 'q2',
        key: 'q-late',
        questionText: 'Did the office tell you they would be late?',
        questionType: 'YES_NO',
        showIf: { questionKey: 'q-visits', answers: ['Rarely', 'Never'] },
        isRequired: true,
        sortOrder: 1,
      });
    const help = () =>
      question({
        id: 'q3',
        key: 'q-help',
        questionText: 'Which help do you get?',
        questionType: 'MULTI_SELECT',
        options: ['Washing', 'Meals', 'None of these'],
        otherOption: { label: 'Other (please tell us)', textPrompt: 'What else?', textRequired: true },
        exclusiveOptions: ['None of these'],
        isRequired: false,
        sortOrder: 2,
      });
    const meals = () =>
      question({
        id: 'q4',
        key: 'q-meals',
        questionText: 'Are your meals warm?',
        questionType: 'YES_NO',
        showIf: { questionKey: 'q-help', answers: ['Meals'] },
        isRequired: true,
        sortOrder: 3,
      });
    const all = () => [visits(), lateWhy(), help(), meals()];
    const submit = (answers: any[]) => service.submitPublicResponse('share-token-1', { answers });
    const created = () => prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;

    beforeEach(() => {
      prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'PUBLIC', status: 'ACTIVE' }));
      prisma.surveyQuestion.findMany.mockResolvedValue(all());
    });

    describe('answering (enforced by the server)', () => {
      it('a hidden question is not required and anything sent for it is discarded', async () => {
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'], comment: 'Not shown for Always' },
          { questionId: 'q2', booleanValue: false },
        ]);
        const rows = created();
        expect(rows.map((r: any) => r.questionId)).toEqual(['q1']);
        expect(rows[0].comment).toBeNull();
      });

      it('a question shown by the answer is required', async () => {
        await expect(submit([{ questionId: 'q1', selectedOptions: ['Never'] }])).rejects.toThrow(
          /Answer required for: Did the office tell you/,
        );
        await submit([
          { questionId: 'q1', selectedOptions: ['Never'], comment: '  Two hours late  ' },
          { questionId: 'q2', booleanValue: true },
        ]);
        expect(created()[0]).toMatchObject({ questionId: 'q1', comment: 'Two hours late' });
        expect(created()[1]).toMatchObject({ questionId: 'q2', booleanValue: true });
      });

      it('MULTI_SELECT: any selected answer can show a question', async () => {
        await expect(
          submit([
            { questionId: 'q1', selectedOptions: ['Always'] },
            { questionId: 'q3', selectedOptions: ['Washing', 'Meals'] },
          ]),
        ).rejects.toThrow(/Are your meals warm/);
      });

      it('keeps the Other text (trimmed) when Other is chosen, and requires it', async () => {
        await expect(
          submit([
            { questionId: 'q1', selectedOptions: ['Always'] },
            { questionId: 'q3', selectedOptions: ['Other (please tell us)'], otherText: '   ' },
          ]),
        ).rejects.toThrow(/Please say what "Other \(please tell us\)" is/);
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'] },
          { questionId: 'q3', selectedOptions: ['Washing', 'Other (please tell us)'], otherText: ' Shopping ' },
        ]);
        expect(created()[1]).toMatchObject({
          selectedOptions: ['Washing', 'Other (please tell us)'],
          otherText: 'Shopping',
        });
      });

      it('drops Other text when Other is not chosen', async () => {
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'] },
          { questionId: 'q3', selectedOptions: ['Washing'], otherText: 'left over' },
        ]);
        expect(created()[1].otherText).toBeNull();
      });

      it('Other text can be optional', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([
          visits(),
          help(),
        ].map((q) => (q.id === 'q3' ? { ...q, otherOption: { label: 'Other', textPrompt: 'Say', textRequired: false } } : q)));
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'] },
          { questionId: 'q3', selectedOptions: ['Other'] },
        ]);
        expect(created()[1]).toMatchObject({ selectedOptions: ['Other'], otherText: null });
      });

      it('a clearing answer sent with other choices (older carer apps) is dropped, the specific choices kept', async () => {
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'] },
          { questionId: 'q3', selectedOptions: ['Washing', 'None of these'] },
        ]);
        expect(created()[1].selectedOptions).toEqual(['Washing']);
        // …and the response audit says so.
        expect(audit.logAudit.mock.calls[0][0].metadata).toEqual({
          surveyId: 's1',
          exclusiveOptionsDropped: [{ questionId: 'q3', dropped: ['None of these'], kept: ['Washing'] }],
        });

        prisma.surveyResponse.create.mockClear();
        audit.logAudit.mockClear();
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'] },
          { questionId: 'q3', selectedOptions: ['None of these'] },
        ]);
        expect(created()[1].selectedOptions).toEqual(['None of these']);
        expect(audit.logAudit.mock.calls[0][0].metadata).toEqual({ surveyId: 's1' });
      });

      it('"Show only if" follows the kept choices, and Other counts as a specific choice', async () => {
        await expect(
          submit([
            { questionId: 'q1', selectedOptions: ['Always'] },
            { questionId: 'q3', selectedOptions: ['None of these', 'Meals'] },
          ]),
        ).rejects.toThrow(/Answer required for: Are your meals warm/);
        await submit([
          { questionId: 'q1', selectedOptions: ['Always'] },
          { questionId: 'q3', selectedOptions: ['None of these', 'Other (please tell us)'], otherText: 'Shopping' },
        ]);
        expect(created()[1]).toMatchObject({ selectedOptions: ['Other (please tell us)'], otherText: 'Shopping' });
      });

      it('staff-recorded answers get the same treatment (every channel)', async () => {
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'SERVICE_USER', status: 'ACTIVE' }));
        await service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          isAnonymous: true,
          answers: [
            { questionId: 'q1', selectedOptions: ['Always'] },
            { questionId: 'q3', selectedOptions: ['None of these', 'Washing', 'Meals'] },
            { questionId: 'q4', booleanValue: true },
          ],
        } as any);
        const rows = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;
        expect(rows[1].selectedOptions).toEqual(['Washing', 'Meals']);
        // Recorded without a name: no audit entry of its own (no time, choices or response id), counted for the day.
        expectNoPerAnswerAudit(audit);
        expect(unlinkedDayCounts(prisma)).toMatchObject([{ surveyId: 's1', recorded: 1, reviewer: 0 }]);
        expect(JSON.stringify(audit.logAudit.mock.calls)).not.toMatch(/Washing|Meals/);
      });

      it('resolveExclusiveChoices', () => {
        const none = ['None of these', 'Prefer not to say'];
        expect(resolveExclusiveChoices(['Washing'], none)).toEqual({ selected: ['Washing'], dropped: [] });
        expect(resolveExclusiveChoices(['None of these'], none)).toEqual({ selected: ['None of these'], dropped: [] });
        expect(resolveExclusiveChoices(['Washing', 'None of these'], [])).toEqual({
          selected: ['Washing', 'None of these'],
          dropped: [],
        });
        expect(resolveExclusiveChoices(['None of these', 'Washing', 'Prefer not to say'], none)).toEqual({
          selected: ['Washing'],
          dropped: ['None of these', 'Prefer not to say'],
        });
        // Only clearing answers: the first one given is kept.
        expect(resolveExclusiveChoices(['Prefer not to say', 'None of these'], none)).toEqual({
          selected: ['Prefer not to say'],
          dropped: ['None of these'],
        });
      });

      it('the same choice ticked twice is refused (it would be counted twice)', async () => {
        await expect(
          submit([
            { questionId: 'q1', selectedOptions: ['Always'] },
            { questionId: 'q3', selectedOptions: ['Washing', 'Washing'] },
          ]),
        ).rejects.toThrow(/Invalid choices for: Which help/);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      });

      it('a response recorded as anonymous on a named survey keeps only the day (no call time)', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-05T14:32:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
        try {
          prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'SERVICE_USER', status: 'ACTIVE' }));
          await service.recordResponse(admin, 's1', {
            channel: 'TELEPHONE',
            consentGiven: true,
            isAnonymous: true,
            contactedAt: '2026-11-05T14:10:00.000Z',
            answers: [{ questionId: 'q1', selectedOptions: ['Always'] }],
          } as any);
          const data = prisma.surveyResponse.create.mock.calls[0][0].data;
          const midnight = new Date('2026-11-05T00:00:00.000Z'); // Europe/London, GMT in November
          expect(data).toMatchObject({ recipientId: null, submittedAt: midnight, contactedAt: midnight, createdAt: midnight });
          expect(data.answers.create[0]).toMatchObject({ createdAt: midnight, updatedAt: midnight });
        } finally {
          jest.useRealTimers();
        }

        // …and the responses list shows its date only, with no call time.
        givenSurvey(surveyRow());
        prisma.surveyResponse.findMany.mockResolvedValue([
          {
            id: 'r1',
            surveyId: 's1',
            submittedAt: new Date('2026-11-05T14:32:00.000Z'),
            contactedAt: new Date('2026-11-05T14:10:00.000Z'),
            recipient: null,
            channel: 'TELEPHONE',
            isAnonymous: true,
            recordedById: null,
            answers: [],
          },
        ]);
        const res = await service.listResponses(admin, 's1');
        expect(res.data.responses[0]).toMatchObject({ isAnonymous: true, submittedDateOnly: true, contactedAt: null });
      });

      it('rejects Other text over 2,000 characters (DTO)', async () => {
        const pipe = new ValidationPipe({ whitelist: true, transform: true });
        await expect(
          pipe.transform(
            { answers: [{ questionId: '00000000-0000-4000-8000-000000000001', otherText: 'x'.repeat(2001) }] },
            { type: 'body', metatype: SubmitSurveyResponseDto },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('staff recording keeps the Other text and comments they type', async () => {
        prisma.survey.findFirst.mockResolvedValue(surveyRow({ targetKind: 'SERVICE_USER', status: 'ACTIVE' }));
        await service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          isAnonymous: true,
          answers: [
            { questionId: 'q1', selectedOptions: ['Rarely'], comment: 'Weekends are worst' },
            { questionId: 'q2', booleanValue: false },
            { questionId: 'q3', selectedOptions: ['Other (please tell us)'], otherText: 'Gardening' },
          ],
        } as any);
        const rows = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;
        expect(rows[0].comment).toBe('Weekends are worst');
        expect(rows[2].otherText).toBe('Gardening');
      });
    });

    it('forms carry the settings, with the id of the question a rule depends on', async () => {
      const res = await service.getPublicByToken('share-token-1');
      const [q1, q2, q3] = res.data.questions;
      expect(q1).toMatchObject({ key: 'q-visits', commentConfig: { prompt: 'Please tell us why', showWhen: ['Rarely', 'Never'] }, showIf: null });
      expect(q2.showIf).toEqual({ questionKey: 'q-visits', answers: ['Rarely', 'Never'], questionId: 'q1' });
      expect(q3).toMatchObject({
        otherOption: { label: 'Other (please tell us)', textPrompt: 'What else?', textRequired: true },
        exclusiveOptions: ['None of these'],
      });
    });

    describe('building', () => {
      beforeEach(() => givenSurvey(surveyRow()));

      it('saves the settings (trimmed, defaults filled in) with a new key', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([visits()]);
        await service.addQuestion(admin, 's1', {
          questionText: 'Which help do you get?',
          questionType: 'MULTI_SELECT',
          options: ['Washing', 'None of these'],
          otherOption: { label: ' Something else ' },
          exclusiveOptions: ['None of these'],
          commentConfig: { prompt: 'Anything to add?' },
          showIf: { questionKey: 'q-visits', answers: ['Never'] },
          sortOrder: 1,
        } as any);
        const data = prisma.surveyQuestion.create.mock.calls[0][0].data;
        expect(data.key).toMatch(/^q-[a-z0-9]{8}$/);
        expect(data.otherOption).toEqual({ label: 'Something else', textPrompt: 'Please tell us', textRequired: true });
        expect(data.exclusiveOptions).toEqual(['None of these']);
        expect(data.commentConfig).toEqual({ prompt: 'Anything to add?', showWhen: null });
        expect(data.showIf).toEqual({ questionKey: 'q-visits', answers: ['Never'] });
      });

      it.each([
        [{ showIf: { questionKey: 'q-nowhere', answers: ['Yes'] } }, /not in this survey/],
        [{ showIf: { questionKey: 'q-visits', answers: ['Sometimes'] } }, /"Sometimes" is not one of the answers/],
        [{ commentConfig: { prompt: 'Why?', showWhen: ['Maybe'] } }, /not one of this question's answers/],
        [{ exclusiveOptions: ['Nothing'] }, /not one of the options/],
        [{ otherOption: { label: 'washing' } }, /already one of the options/],
      ])('rejects %j', async (extra, message) => {
        prisma.surveyQuestion.findMany.mockResolvedValue([visits()]);
        await expect(
          service.addQuestion(admin, 's1', {
            questionText: 'Which help?',
            questionType: 'MULTI_SELECT',
            options: ['Washing', 'None of these'],
            sortOrder: 1,
            ...extra,
          } as any),
        ).rejects.toThrow(message);
        expect(prisma.surveyQuestion.create).not.toHaveBeenCalled();
      });

      it('a rule must point at an earlier question that is always asked', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy()]);
        await expect(
          service.addQuestion(admin, 's1', {
            questionText: 'Why?',
            questionType: 'TEXT',
            showIf: { questionKey: 'q-late', answers: ['No'] },
            sortOrder: 2,
          } as any),
        ).rejects.toThrow(/always asked/);
        // Moving the question it depends on below it is refused too.
        prisma.surveyQuestion.findFirst.mockResolvedValue(visits());
        await expect(service.updateQuestion(admin, 's1', 'q1', { sortOrder: 5 })).rejects.toThrow(/earlier question/);
      });

      it('a question another depends on cannot be removed', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy()]);
        prisma.surveyQuestion.findFirst.mockResolvedValue(visits());
        await expect(service.removeQuestion(admin, 's1', 'q1')).rejects.toThrow(/Show only if/);
      });

      it('once answered, the Other choice and rule are fixed but the comment box can change', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyResponse.count.mockResolvedValue(2);
        prisma.surveyQuestion.findMany.mockResolvedValue(all());
        prisma.surveyQuestion.findFirst.mockResolvedValue(help());
        await expect(service.updateQuestion(admin, 's1', 'q3', { otherOption: null })).rejects.toThrow(/help text/);
        prisma.surveyQuestion.findFirst.mockResolvedValue(visits());
        await service.updateQuestion(admin, 's1', 'q1', { commentConfig: { prompt: 'What went wrong?', showWhen: ['Never'] } });
        expect(prisma.surveyQuestion.update.mock.calls[0][0].data.commentConfig).toEqual({
          prompt: 'What went wrong?',
          showWhen: ['Never'],
        });
      });
    });

    describe('copies keep keys, so rules keep pointing at the same questions', () => {
      it('duplicate / save as template', async () => {
        givenSurvey(surveyRow());
        await service.duplicate(admin, 's1');
        const rows = prisma.survey.create.mock.calls[0][0].data.questions.create;
        expect(rows.map((r: any) => r.key)).toEqual(['q-visits', 'q-late', 'q-help', 'q-meals']);
        expect(rows[1].showIf).toEqual({ questionKey: 'q-visits', answers: ['Rarely', 'Never'] });
        expect(rows[2].otherOption).toMatchObject({ label: 'Other (please tell us)' });
        expect(rows[2].exclusiveOptions).toEqual(['None of these']);
        expect(rows[0].commentConfig).toEqual({ prompt: 'Please tell us why', showWhen: ['Rarely', 'Never'] });
      });

      it('a question without a key gets a new one', async () => {
        givenSurvey(surveyRow());
        prisma.surveyQuestion.findMany.mockResolvedValue([{ ...visits(), key: null }]);
        await service.duplicate(admin, 's1');
        expect(prisma.survey.create.mock.calls[0][0].data.questions.create[0].key).toMatch(/^q-[a-z0-9]{8}$/);
      });

      it('period copies', async () => {
        prisma.survey.findFirst.mockResolvedValue(null);
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
        await service.runRecurringPeriod(
          surveyRow({
            recurrence: 'MONTHLY',
            distributeAt: new Date('2026-11-01T09:00:00.000Z'),
            recurrenceAnchorAt: new Date('2026-10-01T08:00:00.000Z'),
            locationIds: ['loc-leeds'],
            scheduledById: 'admin-1',
          }),
          new Date('2026-11-01T09:00:20.000Z'),
        );
        const rows = prisma.survey.create.mock.calls[0][0].data.questions.create;
        expect(rows[3]).toMatchObject({ key: 'q-meals', sourceQuestionId: 'q4', showIf: { questionKey: 'q-help', answers: ['Meals'] } });
      });
    });

    describe('results: Other counted, written answers', () => {
      const answer = (over: Record<string, unknown>) => ({
        booleanValue: null,
        textValue: null,
        numberValue: null,
        selectedOptions: null,
        otherText: null,
        comment: null,
        response: { id: 'r1', isAnonymous: false, recipient: { employeeId: 'emp-1', serviceUserId: null } },
        question: { ...help(), surveyId: 's1' },
        ...over,
      });
      const givenResults = (survey: any, responses: number) => {
        givenSurvey(survey);
        prisma.surveyQuestion.findMany.mockResolvedValue([visits(), help()]);
        prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
          args.by[0] === 'surveyId' ? [{ surveyId: 's1', _count: { _all: responses } }] : [],
        );
        prisma.surveyAnswer.findMany.mockResolvedValue([
          answer({ selectedOptions: ['Other (please tell us)'], otherText: 'Shopping' }),
          answer({
            selectedOptions: ['Never'],
            comment: 'Always late at weekends',
            question: { ...visits(), surveyId: 's1' },
            response: { id: 'r2', isAnonymous: false, recipient: { employeeId: 'emp-2', serviceUserId: null } },
          }),
          answer({ selectedOptions: ['Washing'] }),
        ]);
        prisma.employeePersonalDetail.findMany.mockResolvedValue([
          { employeeId: 'emp-1', firstName: 'Ada', lastName: 'Lovelace' },
          { employeeId: 'emp-2', firstName: 'Grace', lastName: 'Hopper' },
        ]);
      };
      const summary = (res: any, id: string) => res.data.questionSummaries.find((s: any) => s.questionId === id);

      describe('per-survey access (survey-access.ts)', () => {
        const coordinator: any = { id: 'cc-1', roles: ['Care Coordinator'], permissions: ['surveys.read'], assignedLocationIds: null };
        const hr = { restricted: true, ownerKeys: ['HR_MANAGER'], roleIds: [], userIds: [] };
        beforeEach(() => {
          prisma.role.findMany.mockImplementation(async (args: any) => {
            const all = [{ id: 'role-hr', name: 'HR' }, { id: 'role-cc', name: 'Care Coordinator' }];
            return args?.where?.name?.in ? all.filter((r) => args.where.name.in.includes(r.name)) : all;
          });
          prisma.surveyAlertOwnerRole = { findMany: jest.fn().mockResolvedValue([]) };
        });

        it('refuses the results to someone outside a restricted survey, in results and individual responses', async () => {
          givenResults(surveyRow({ accessPolicy: { responses: hr, results: hr } }), 6);
          await expect(service.results(coordinator, 's1')).rejects.toThrow(/limited to particular people/);
          await expect(service.listResponses(coordinator, 's1')).rejects.toThrow(/limited to particular people/);
        });

        it('shows the figures but no written answers or names when only individual responses are limited', async () => {
          givenResults(surveyRow({ accessPolicy: { responses: hr, results: { restricted: false } } }), 6);
          const res = await service.results(coordinator, 's1');
          const helpSummary = summary(res, 'q3');
          expect(helpSummary.options.find((o: any) => o.label === 'Other (please tell us)')).toMatchObject({ count: 1 });
          expect(helpSummary).toMatchObject({ writtenAnswers: [], writtenAnswersRestricted: true });
          expect(JSON.stringify(res.data.questionSummaries)).not.toMatch(/Lovelace|Hopper|Shopping|weekends/);
          expect(res.data.access).toEqual({ responses: false, results: true, configure: false });
        });

        it('shows response and completion counts only to people who may see the results', async () => {
          const row = { ...surveyRow({ accessPolicy: { responses: hr, results: hr } }), _count: { questions: 2, recipients: 8, responses: 6, clones: 0 } };
          prisma.survey.findMany.mockResolvedValue([row]);
          prisma.surveyRecipient.groupBy.mockResolvedValue([{ surveyId: 's1', _count: { _all: 6 } }]);
          const hidden = (await service.list(coordinator, {} as any)).data[0];
          expect(hidden).toMatchObject({ countsRestricted: true, responseCount: null, completedCount: null, responseRate: null, recipientCount: 8 });
          const shown = (await service.list(admin, {} as any)).data[0];
          expect(shown).toMatchObject({ countsRestricted: false, responseCount: 6, completedCount: 6 });
          givenSurvey(surveyRow({ accessPolicy: { responses: hr, results: hr } }));
          await expect(service.listRecipients(coordinator, 's1')).resolves.toMatchObject({ data: { counts: null, recipientsRestricted: true } });
        });

        it('never says which questions have answers to someone who may not see the results (a follow-up shows the answer before it)', async () => {
          // The manager a copy rates: excluded, so not even "question 2 has answers".
          givenSurvey(surveyRow({ accessPolicy: { excludeUserIds: ['cc-1'] }, createdById: 'cc-1' }));
          prisma.surveyQuestion.findMany.mockResolvedValue([question({ id: 'q1' }), question({ id: 'q2', sortOrder: 1 })]);
          prisma.surveyResponse.count.mockResolvedValue(6);
          prisma.surveyAnswer.groupBy.mockResolvedValue([{ questionId: 'q1', _count: { _all: 6 } }]);
          const hidden = await service.getById(coordinator, 's1');
          expect(hidden.data.questions.map((q: any) => q.hasAnswers)).toEqual([true, true]);
          expect(hidden.data.questions[0]).not.toHaveProperty('answerCount');
          expect(hidden.data.responseCount).toBeNull();
          const shown = await service.getById(admin, 's1');
          expect(shown.data.questions.map((q: any) => q.hasAnswers)).toEqual([true, false]);
        });

        it('keeps admins and the survey’s maker in', async () => {
          givenResults(surveyRow({ accessPolicy: { responses: hr, results: hr }, createdById: 'cc-1' }), 6);
          await expect(service.results(coordinator, 's1')).resolves.toBeDefined();
          await expect(service.results(admin, 's1')).resolves.toBeDefined();
        });

        it('shows nothing below a threshold set on a named survey, with how many more are needed', async () => {
          givenResults(surveyRow({ reportingThreshold: 10 }), 6);
          const res = await service.results(admin, 's1');
          expect(res.data.questionSummaries).toEqual([]);
          expect(res.data.reporting.note).toMatch(/^4 more answers are needed/);
        });
      });

      it('counts Other as a choice and lists written answers with who wrote them (named survey)', async () => {
        givenResults(surveyRow(), 3);
        const res = await service.results(admin, 's1');
        const helpSummary = summary(res, 'q3');
        expect(helpSummary.options.find((o: any) => o.label === 'Other (please tell us)')).toMatchObject({ count: 1 });
        expect(helpSummary.writtenAnswers).toEqual([
          { answer: 'Other (please tell us)', otherText: 'Shopping', comment: null, respondentName: 'Ada Lovelace' },
        ]);
        expect(summary(res, 'q1').writtenAnswers).toEqual([
          { answer: 'Never', otherText: null, comment: 'Always late at weekends', respondentName: 'Grace Hopper' },
        ]);
      });

      it('anonymous survey: never says who wrote them', async () => {
        givenResults(surveyRow({ isAnonymous: true, status: 'CLOSED' }), 6);
        const res = await service.results(admin, 's1');
        expect(summary(res, 'q3').writtenAnswers[0]).toMatchObject({ otherText: 'Shopping', respondentName: null });
        expect(prisma.employeePersonalDetail.findMany).not.toHaveBeenCalled();
        // Same-day anonymous answers are not listed in the order they were saved (random id order).
        expect(prisma.surveyAnswer.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      });

      it('anonymous survey with fewer than 5 responses: no written answers at all, even once closed', async () => {
        givenResults(surveyRow({ isAnonymous: true, status: 'CLOSED' }), 4);
        const res = await service.results(admin, 's1');
        // Since the reporting threshold: under 5 nothing is shown at all (not even counts), and the
        // existing written-answer rule still explains why.
        expect(res.data.questionSummaries).toEqual([]);
        expect(res.data.reporting).toMatchObject({ belowThreshold: true, counted: 4 });
        expect(res.data.reporting.note).toMatch(/^1 more answer is needed before results show/);
        expect(res.data.writtenAnswersNote).toMatch(/once the survey has closed and at least 5 people have answered/);
      });

      it('anonymous survey still open: no written answers, however many have answered', async () => {
        givenResults(surveyRow({ isAnonymous: true, status: 'ACTIVE' }), 40);
        const res = await service.results(admin, 's1');
        expect(summary(res, 'q3')).toMatchObject({ writtenAnswers: [], writtenAnswersWithheld: true });
        expect(summary(res, 'q1')).toMatchObject({ writtenAnswers: [], writtenAnswersWithheld: true });
        expect(res.data.writtenAnswersNote).toMatch(/once the survey has closed/);
      });

      it('anonymous survey: short / long text answers follow the same rule', async () => {
        const said = question({ id: 'q5', key: 'q-said', questionText: 'Anything else?', questionType: 'TEXTAREA', isRequired: false, sortOrder: 4 });
        const run = async (status: string, responses: number) => {
          givenSurvey(surveyRow({ isAnonymous: true, status }));
          prisma.surveyQuestion.findMany.mockResolvedValue([said]);
          prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
            args.by[0] === 'surveyId' ? [{ surveyId: 's1', _count: { _all: responses } }] : [],
          );
          prisma.surveyAnswer.findMany.mockResolvedValue([
            answer({ textValue: 'My carer Jo is brilliant', question: { ...said, surveyId: 's1' } }),
          ]);
          return summary(await service.results(admin, 's1'), 'q5');
        };
        expect(await run('ACTIVE', 9)).toMatchObject({ textSamples: [], writtenAnswersWithheld: true, answerCount: 1 });
        // Under the reporting threshold the question is not shown at all.
        expect(await run('CLOSED', 3)).toBeUndefined();
        expect(await run('CLOSED', 5)).toMatchObject({ textSamples: ['My carer Jo is brilliant'], writtenAnswersWithheld: false });
      });

      it('named surveys show written answers while open', async () => {
        givenResults(surveyRow({ status: 'ACTIVE' }), 1);
        const res = await service.results(admin, 's1');
        expect(summary(res, 'q3')).toMatchObject({ writtenAnswersWithheld: false });
        expect(summary(res, 'q3').writtenAnswers).toHaveLength(1);
        expect(res.data.writtenAnswersNote).toBeNull();
      });

      it('repeating anonymous survey: written answers from closed periods only', async () => {
        const source = surveyRow({ isAnonymous: true, recurrence: 'MONTHLY' });
        givenSurvey(source);
        prisma.survey.findMany.mockResolvedValue([
          { id: 'p-oct', title: 'Staff survey — October 2026', periodKey: '2026-10', opensAt: new Date('2026-10-01'), closesAt: null, status: 'CLOSED' },
          { id: 'p-nov', title: 'Staff survey — November 2026', periodKey: '2026-11', opensAt: new Date('2026-11-01'), closesAt: null, status: 'ACTIVE' },
        ]);
        prisma.surveyQuestion.findMany.mockResolvedValue([visits(), help()]);
        prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
          args.by[0] === 'surveyId'
            ? [
                { surveyId: 'p-oct', _count: { _all: 6 } },
                // At the reporting threshold (5): a period below it is left out of "All periods" altogether.
                { surveyId: 'p-nov', _count: { _all: 5 } },
              ]
            : [],
        );
        const inPeriod = (surveyId: string, text: string) =>
          answer({
            selectedOptions: ['Other (please tell us)'],
            otherText: text,
            question: { ...help(), id: `${surveyId}-q3`, sourceQuestionId: 'q3', surveyId },
          });
        prisma.surveyAnswer.findMany.mockResolvedValue([inPeriod('p-nov', 'November words'), inPeriod('p-oct', 'October words')]);
        const res = await service.results(admin, 's1');
        const helpSummary = summary(res, 'q3');
        expect(helpSummary.answerCount).toBe(2);
        expect(helpSummary.writtenAnswers.map((w: any) => w.otherText)).toEqual(['October words']);
        expect(helpSummary.writtenAnswersWithheld).toBe(true);
        expect(res.data.writtenAnswersNote).toMatch(/^Closed periods only\./);
      });

      it('writtenAnswerVisibility', () => {
        const counts = (entries: Array<[string, number]>) => new Map(entries);
        const named = writtenAnswerVisibility({ id: 's1', isAnonymous: false, status: 'ACTIVE' as any }, [], counts([]));
        expect(named).toMatchObject({ all: true, note: null });
        const open = writtenAnswerVisibility({ id: 's1', isAnonymous: true, status: 'ACTIVE' as any }, [], counts([['s1', 50]]));
        expect(open).toMatchObject({ all: false, surveyIds: new Set() });
        const closedFew = writtenAnswerVisibility({ id: 's1', isAnonymous: true, status: 'CLOSED' as any }, [], counts([['s1', 4]]));
        expect(closedFew.all).toBe(false);
        const closed = writtenAnswerVisibility({ id: 's1', isAnonymous: true, status: 'CLOSED' as any }, [], counts([['s1', 5]]));
        expect(closed).toMatchObject({ all: true, note: null });
        // Periods: closed periods count together towards the minimum.
        const periods = [
          { id: 'p1', status: 'CLOSED' as any },
          { id: 'p2', status: 'CLOSED' as any },
          { id: 'p3', status: 'ACTIVE' as any },
        ];
        const series = writtenAnswerVisibility({ id: 's1', isAnonymous: true, status: 'DRAFT' as any }, periods, counts([['p1', 3], ['p2', 2], ['p3', 9]]));
        expect(series).toMatchObject({ all: false, surveyIds: new Set(['p1', 'p2']) });
        expect(series.note).toMatch(/Closed periods only/);
      });

      it('responses list and own answers show the person’s words', async () => {
        givenSurvey(surveyRow());
        prisma.surveyResponse.findMany.mockResolvedValue([
          {
            id: 'r1',
            surveyId: 's1',
            submittedAt: new Date(),
            recipient: null,
            channel: 'ONLINE',
            isAnonymous: false,
            recordedById: null,
            answers: [
              {
                ...answer({ selectedOptions: ['Washing', 'Other (please tell us)'], otherText: 'Shopping', comment: 'Thanks' }),
                question: { ...help() },
              },
            ],
          },
        ]);
        const res = await service.listResponses(admin, 's1');
        expect(res.data.responses[0].answers[0]).toMatchObject({
          otherText: 'Shopping',
          comment: 'Thanks',
          displayValue: 'Washing, Other (please tell us): Shopping',
        });
      });
    });

    describe('anonymous written answers in Responses → View response', () => {
      const said = () =>
        question({ id: 'q5', key: 'q-said', questionText: 'Anything else?', questionType: 'TEXTAREA', isRequired: false, sortOrder: 4 });
      const savedAnswers = () => [
        {
          questionId: 'q1',
          booleanValue: null,
          textValue: null,
          numberValue: null,
          selectedOptions: ['Never'],
          otherText: null,
          comment: 'Late at weekends',
          question: visits(),
        },
        {
          questionId: 'q3',
          booleanValue: null,
          textValue: null,
          numberValue: null,
          selectedOptions: ['Other (please tell us)'],
          otherText: 'Shopping',
          comment: null,
          question: help(),
        },
        {
          questionId: 'q5',
          booleanValue: null,
          textValue: 'My carer Jo is brilliant',
          numberValue: null,
          selectedOptions: null,
          otherText: null,
          comment: null,
          question: said(),
        },
      ];
      const responseRow = (id: string, over: Record<string, unknown> = {}) => ({
        id,
        surveyId: 's1',
        submittedAt: new Date('2026-11-05T00:00:00.000Z'),
        updatedAt: new Date('2026-11-05T00:00:00.000Z'),
        contactedAt: null,
        recipient: null,
        channel: 'PAPER',
        isAnonymous: true,
        recordedById: null,
        answers: savedAnswers(),
        ...over,
      });
      const listFor = async (status: string, responses: number) => {
        givenSurvey(surveyRow({ isAnonymous: true, status }));
        prisma.surveyResponse.findMany.mockResolvedValue(
          Array.from({ length: responses }, (_, i) => responseRow(`r${i + 1}`)),
        );
        return (await service.listResponses(admin, 's1')).data;
      };

      it('held back while the survey is open, whatever the number of answers', async () => {
        const data = await listFor('ACTIVE', 7);
        expect(data.writtenAnswersNote).toMatch(/once the survey has closed and at least 5 people/);
        const [r] = data.responses;
        expect(r.writtenAnswersWithheld).toBe(true);
        const [visitsAnswer, helpAnswer, saidAnswer] = r.answers;
        expect(visitsAnswer).toMatchObject({ comment: null, withheldFields: ['comment'], displayValue: 'Never' });
        expect(helpAnswer).toMatchObject({
          otherText: null,
          withheldFields: ['otherText'],
          displayValue: 'Other (please tell us)',
        });
        expect(saidAnswer).toMatchObject({ textValue: null, withheldFields: ['textValue'], displayValue: WITHHELD_TEXT_DISPLAY });
        expect(JSON.stringify(data)).not.toMatch(/Late at weekends|Shopping|Jo is brilliant/);
      });

      it('held back once closed with fewer than 5 responses', async () => {
        const data = await listFor('CLOSED', 4);
        expect(data.responses[0].writtenAnswersWithheld).toBe(true);
        expect(JSON.stringify(data)).not.toMatch(/Late at weekends|Shopping|Jo is brilliant/);
      });

      it('shown once closed with 5 or more responses', async () => {
        const data = await listFor('CLOSED', 5);
        expect(data.writtenAnswersNote).toBeNull();
        const [visitsAnswer, helpAnswer, saidAnswer] = data.responses[0].answers;
        expect(data.responses[0].writtenAnswersWithheld).toBe(false);
        expect(visitsAnswer).toMatchObject({ comment: 'Late at weekends', withheldFields: [] });
        expect(helpAnswer.displayValue).toBe('Other (please tell us): Shopping');
        expect(saidAnswer).toMatchObject({ textValue: 'My carer Jo is brilliant', displayValue: 'My carer Jo is brilliant' });
      });

      it('named surveys always show them', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyResponse.findMany.mockResolvedValue([responseRow('r1', { isAnonymous: false })]);
        const data = (await service.listResponses(admin, 's1')).data;
        expect(data.writtenAnswersNote).toBeNull();
        expect(data.responses[0].answers[0].comment).toBe('Late at weekends');
      });

      describe('editing a staff-recorded response keeps held-back text', () => {
        const edited = () => prisma.surveyResponse.update.mock.calls[0][0].data.answers.create;
        const given = (status: string, responses: number) => {
          givenSurvey(surveyRow({ isAnonymous: true, status, targetKind: 'SERVICE_USER' }));
          prisma.surveyResponse.findFirst.mockResolvedValue(responseRow('r1'));
          prisma.surveyResponse.count.mockResolvedValue(responses);
          prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy(), help(), said()]);
          prisma.surveyResponse.update.mockImplementation(async (args: any) => ({
            id: args.where.id,
            answers: args.data.answers.create.map((a: any) => ({
              ...a,
              comment: a.comment ?? null,
              question: [visits(), lateWhy(), help(), said()].find((q) => q.id === a.questionId),
            })),
          }));
        };

        it('what staff could not see and left empty is kept (never silently wiped)', async () => {
          given('ACTIVE', 3);
          await service.updateRecordedResponse(admin, 's1', 'r1', {
            reason: 'Wrong box ticked',
            answers: [
              { questionId: 'q1', selectedOptions: ['Never'] },
              { questionId: 'q2', booleanValue: true },
              { questionId: 'q3', selectedOptions: ['Washing', 'Other (please tell us)'] },
              // The long text answer is not sent at all.
            ],
          } as any);
          const rows = edited();
          expect(rows.find((r: any) => r.questionId === 'q1')).toMatchObject({ comment: 'Late at weekends' });
          expect(rows.find((r: any) => r.questionId === 'q3')).toMatchObject({
            selectedOptions: ['Washing', 'Other (please tell us)'],
            otherText: 'Shopping',
          });
          expect(rows.find((r: any) => r.questionId === 'q5')).toMatchObject({ textValue: 'My carer Jo is brilliant' });
          // The audit log does not reveal them either.
          const entry = audit.logAudit.mock.calls[0][0];
          expect(JSON.stringify(entry)).not.toMatch(/Late at weekends|Shopping|Jo is brilliant/);
          expect(entry.metadata.writtenAnswersKept).toBe(true);
        });

        it('text staff type replaces it; a choice they clear goes with its written parts', async () => {
          given('ACTIVE', 3);
          await service.updateRecordedResponse(admin, 's1', 'r1', {
            reason: 'Typed up again',
            answers: [
              { questionId: 'q1', selectedOptions: ['Always'] },
              { questionId: 'q3', selectedOptions: ['Washing'] },
              { questionId: 'q5', textValue: 'New words' },
            ],
          } as any);
          const rows = edited();
          // "Always" has no comment box, and Other is no longer chosen.
          expect(rows.find((r: any) => r.questionId === 'q1').comment).toBeNull();
          expect(rows.find((r: any) => r.questionId === 'q3').otherText).toBeNull();
          expect(rows.find((r: any) => r.questionId === 'q5').textValue).toBe('New words');
        });

        it('once written answers are shown, the correction is taken as given', async () => {
          given('CLOSED', 6);
          await service.updateRecordedResponse(admin, 's1', 'r1', {
            reason: 'Comment was not theirs',
            answers: [
              { questionId: 'q1', selectedOptions: ['Never'] },
              { questionId: 'q2', booleanValue: true },
            ],
          } as any);
          const rows = edited();
          expect(rows.find((r: any) => r.questionId === 'q1').comment).toBeNull();
          expect(rows.find((r: any) => r.questionId === 'q5')).toBeUndefined();
          expect(audit.logAudit.mock.calls[0][0].metadata.writtenAnswersKept).toBeUndefined();
        });
      });

      describe('staff notes on an anonymous recording follow the written-answer rule', () => {
        const notes = 'Spoke to Mrs Patel at 14:05, her daughter Priya helped';
        const listWithNotes = async (status: string, responses: number, survey: Record<string, unknown> = {}) => {
          givenSurvey(surveyRow({ isAnonymous: true, status, ...survey }));
          prisma.surveyResponse.findMany.mockResolvedValue(
            Array.from({ length: responses }, (_, i) => responseRow(`r${i + 1}`, { contactNotes: notes })),
          );
          return (await service.listResponses(admin, 's1')).data;
        };

        it('held back while the survey is open, and while closed with fewer than 5', async () => {
          for (const [status, n] of [['ACTIVE', 9], ['CLOSED', 4]] as const) {
            const data = await listWithNotes(status, n);
            expect(data.responses[0]).toMatchObject({
              contactNotes: null,
              contactNotesWithheld: true,
              writtenAnswersWithheld: true,
            });
            expect(data.writtenAnswersNote).toMatch(/once the survey has closed and at least 5 people/);
            expect(JSON.stringify(data)).not.toMatch(/Patel|Priya/);
          }
        });

        it('shown once closed with 5 or more', async () => {
          const data = await listWithNotes('CLOSED', 5);
          expect(data.responses[0]).toMatchObject({ contactNotes: notes, contactNotesWithheld: false });
        });

        it('only notes that hold text count as held back (no note when there are none)', async () => {
          givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
          prisma.surveyResponse.findMany.mockResolvedValue([
            responseRow('r1', { contactNotes: '  ', answers: [] }),
          ]);
          const data = (await service.listResponses(admin, 's1')).data;
          expect(data.responses[0]).toMatchObject({ contactNotesWithheld: false, writtenAnswersWithheld: false });
          expect(data.writtenAnswersNote).toBeNull();
        });

        it('named survey: unchanged (shown), for named and anonymous recordings alike', async () => {
          givenSurvey(surveyRow({ status: 'ACTIVE' }));
          prisma.surveyResponse.findMany.mockResolvedValue([
            responseRow('r1', { isAnonymous: false, contactNotes: 'Named call' }),
            responseRow('r2', { contactNotes: 'Paper form, number crossed out' }),
          ]);
          const data = (await service.listResponses(admin, 's1')).data;
          expect(data.responses.map((r: any) => r.contactNotes).sort()).toEqual([
            'Named call',
            'Paper form, number crossed out',
          ]);
          expect(data.responses.every((r: any) => r.contactNotesWithheld === false)).toBe(true);
        });

        it('editing while held back: notes left empty are kept; typed notes replace them', async () => {
          givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
          prisma.surveyResponse.findFirst.mockResolvedValue(responseRow('r1', { contactNotes: notes }));
          prisma.surveyResponse.count.mockResolvedValue(3);
          prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy(), help(), said()]);
          prisma.surveyResponse.update.mockImplementation(async (args: any) => ({ id: args.where.id, answers: [] }));
          const body = {
            reason: 'Wrong box',
            answers: [
              { questionId: 'q1', selectedOptions: ['Never'] },
              { questionId: 'q2', booleanValue: true },
            ],
          } as any;
          await service.updateRecordedResponse(admin, 's1', 'r1', body);
          expect(prisma.surveyResponse.update.mock.calls[0][0].data.contactNotes).toBe(notes);
          await service.updateRecordedResponse(admin, 's1', 'r1', { ...body, contactNotes: 'Paper form' });
          expect(prisma.surveyResponse.update.mock.calls[1][0].data.contactNotes).toBe('Paper form');
          // The audit log never carries the notes.
          expect(JSON.stringify(audit.logAudit.mock.calls)).not.toMatch(/Patel|Priya/);
        });

        it('editing once shown: the notes are taken as given (cleared when left empty), as before', async () => {
          givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED', targetKind: 'SERVICE_USER' }));
          prisma.surveyResponse.findFirst.mockResolvedValue(responseRow('r1', { contactNotes: notes }));
          prisma.surveyResponse.count.mockResolvedValue(6);
          prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy(), help(), said()]);
          prisma.surveyResponse.update.mockImplementation(async (args: any) => ({ id: args.where.id, answers: [] }));
          await service.updateRecordedResponse(admin, 's1', 'r1', {
            reason: 'Notes were wrong',
            answers: [
              { questionId: 'q1', selectedOptions: ['Never'] },
              { questionId: 'q2', booleanValue: true },
            ],
          } as any);
          expect(prisma.surveyResponse.update.mock.calls[0][0].data.contactNotes).toBeNull();
        });

        it('editing counts answers still waiting, as the list does (notes shown there can be cleared)', async () => {
          // Closed with 4 written and 1 still waiting: the list shows the notes (5 answers)…
          givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED', targetKind: 'SERVICE_USER' }));
          prisma.surveyPendingResponse.groupBy.mockResolvedValue([
            { surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 1 } },
          ]);
          prisma.surveyResponse.findMany.mockResolvedValue(
            Array.from({ length: 4 }, (_, i) => responseRow(`r${i + 1}`, { contactNotes: notes })),
          );
          const listed = (await service.listResponses(admin, 's1')).data;
          expect(listed.responses[0]).toMatchObject({ contactNotes: notes, contactNotesWithheld: false });
          // …so the edit takes them as given.
          prisma.surveyResponse.findFirst.mockResolvedValue(responseRow('r1', { contactNotes: notes }));
          prisma.surveyResponse.count.mockResolvedValue(4);
          prisma.surveyPendingResponse.count.mockResolvedValue(1);
          prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy(), help(), said()]);
          prisma.surveyResponse.update.mockImplementation(async (args: any) => ({ id: args.where.id, answers: [] }));
          await service.updateRecordedResponse(admin, 's1', 'r1', {
            reason: 'Notes were wrong',
            answers: [
              { questionId: 'q1', selectedOptions: ['Never'] },
              { questionId: 'q2', booleanValue: true },
            ],
          } as any);
          expect(prisma.surveyResponse.update.mock.calls[0][0].data.contactNotes).toBeNull();
          expect(audit.logAudit.mock.calls[0][0].metadata.writtenAnswersKept).toBeUndefined();
        });

        it('a named person’s held recording keeps its written-out day when a call date is typed in', async () => {
          const writtenOn = new Date('2026-11-09T00:00:00.000Z');
          givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
          prisma.surveyResponse.count.mockResolvedValue(3);
          prisma.surveyQuestion.findMany.mockResolvedValue([visits(), lateWhy(), help(), said()]);
          prisma.surveyResponse.update.mockImplementation(async (args: any) => ({ id: args.where.id, answers: [] }));
          const body = {
            reason: 'Typed up',
            contactedAt: '2026-11-04T14:05:00.000Z',
            answers: [
              { questionId: 'q1', selectedOptions: ['Never'] },
              { questionId: 'q2', booleanValue: true },
            ],
          } as any;
          // Written out of the pending store: no recorder kept.
          prisma.surveyResponse.findFirst.mockResolvedValue(responseRow('r1', { contactedAt: writtenOn, recordedById: null }));
          await service.updateRecordedResponse(admin, 's1', 'r1', body);
          expect(prisma.surveyResponse.update.mock.calls[0][0].data.contactedAt).toEqual(writtenOn);
          // Recorded as anonymous (nobody marked Completed, recorder kept): the typed day is taken, as before.
          prisma.surveyResponse.findFirst.mockResolvedValue(responseRow('r2', { contactedAt: writtenOn, recordedById: 'admin-1' }));
          await service.updateRecordedResponse(admin, 's1', 'r2', body);
          expect(prisma.surveyResponse.update.mock.calls[1][0].data.contactedAt).toEqual(new Date('2026-11-04T00:00:00.000Z'));
        });
      });

      it('keepWithheldWrittenAnswers', () => {
        const saved = [
          { questionId: 'a', textValue: 'kept text', otherText: null, comment: null },
          { questionId: 'b', textValue: null, otherText: 'kept other', comment: 'kept comment' },
          { questionId: 'c', textValue: null, otherText: null, comment: 'gone with its answer' },
        ];
        const out = keepWithheldWrittenAnswers(
          {
            reason: 'x',
            answers: [
              { questionId: 'b', selectedOptions: ['Other'], comment: 'typed' },
              { questionId: 'd', booleanValue: true },
            ],
          },
          saved,
        );
        expect(out.reason).toBe('x');
        expect(out.answers).toEqual([
          { questionId: 'b', selectedOptions: ['Other'], otherText: 'kept other', comment: 'typed' },
          { questionId: 'd', booleanValue: true },
          { questionId: 'a', textValue: 'kept text' },
        ]);
      });

      it('keepLookupAnswersLinkedToNoOne: an equality answer shown as its group only is kept unless a new one is chosen', () => {
        const lookup = { optionsFrom: 'ETHNICITY' };
        const saved = [
          { questionId: 'bare', selectedOptions: ['Asian - Gujarati'], question: lookup },
          { questionId: 'group', selectedOptions: ['Asian - Gujarati'], question: lookup },
          { questionId: 'hidden', selectedOptions: ['White - Irish'], question: lookup },
          { questionId: 'changed', selectedOptions: ['Asian - Gujarati'], question: lookup },
          { questionId: 'cleared', selectedOptions: ['Arab'], question: lookup },
          { questionId: 'plain', selectedOptions: ['Usually'], question: { optionsFrom: null } },
        ];
        const shownAs = (stored: string[]) => stored.map((v) => v.split(' - ')[0]!);
        const out = keepLookupAnswersLinkedToNoOne(
          {
            answers: [
              { questionId: 'bare' },
              { questionId: 'group', selectedOptions: ['Asian'] },
              { questionId: 'hidden', selectedOptions: ['Not shown (fewer than 10 chose this group)'] },
              { questionId: 'changed', selectedOptions: ['Arab'] },
              { questionId: 'plain', selectedOptions: ['Rarely'] },
            ],
          },
          saved,
          shownAs,
        );
        expect(out.answers).toEqual([
          { questionId: 'bare', selectedOptions: ['Asian - Gujarati'] },
          { questionId: 'group', selectedOptions: ['Asian - Gujarati'] },
          // The "Not shown" words are never saved as an answer.
          { questionId: 'hidden', selectedOptions: ['White - Irish'] },
          { questionId: 'changed', selectedOptions: ['Arab'] },
          { questionId: 'plain', selectedOptions: ['Rarely'] },
        ]);
        // No answer at all: cleared (not restored).
        expect(out.answers.some((a) => a.questionId === 'cleared')).toBe(false);
      });
    });
  });

  /* ─── Where a survey came from (templates, ready-made surveys) ─────────────── */

  describe('survey origin', () => {
    const readyMadeTemplate = () =>
      surveyRow({
        id: 't1',
        isTemplate: true,
        isAnonymous: true,
        targetKind: 'SERVICE_USER',
        libraryReference: 'SUR-PWS-003',
        libraryRevision: 2,
        librarySourceId: 'lib-1',
      });

    it('a survey started from a template keeps the template and the ready-made reference', async () => {
      givenSurvey(readyMadeTemplate());
      const res = await service.duplicate(admin, 't1');
      const data = prisma.survey.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        createdFromTemplateId: 't1',
        libraryReference: 'SUR-PWS-003',
        libraryRevision: 2,
        isTemplate: false,
      });
      // librarySourceId marks the adopted template only.
      expect(data.librarySourceId).toBeUndefined();
      expect(res.data).toMatchObject({ createdFromTemplateId: 't1', anonymityLocked: true });
    });

    it('a duplicate keeps its source’s template, and the anonymity lock', async () => {
      givenSurvey(
        surveyRow({ id: 's9', isAnonymous: true, createdFromTemplateId: 't1', libraryReference: 'SUR-PWS-003', libraryRevision: 2 }),
      );
      await expect(service.duplicate(admin, 's9', { isAnonymous: false })).rejects.toThrow(/ready-made survey that is anonymous/);
      await service.duplicate(admin, 's9');
      expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({
        createdFromTemplateId: 't1',
        libraryReference: 'SUR-PWS-003',
        isAnonymous: true,
      });
    });

    it('the organisation’s own template: origin kept, anonymity can be chosen', async () => {
      givenSurvey(surveyRow({ id: 't2', isTemplate: true }));
      await service.duplicate(admin, 't2', { isAnonymous: true });
      const data = prisma.survey.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ createdFromTemplateId: 't2', libraryReference: null, isAnonymous: true });
      expect(anonymityLocked(data)).toBe(false);
    });

    describe('named and anonymous versions of a ready-made survey', () => {
      const variantMeta = {
        type: 'survey-library',
        version: 1,
        anonymousVariant: {
          introduction: 'Sunrise wants to hear from you. This survey is anonymous.',
          privacyNotice: 'We never know who answered.',
          leaveOut: ['q-contact', 'q-phone', 'q-worker'],
          leaveOutAlerts: [1],
          closingMessage: 'Thank you. Nobody can tell which answers are yours.',
        },
      };
      const namedTemplate = (over: Record<string, unknown> = {}) =>
        surveyRow({
          id: 't3',
          isTemplate: true,
          isAnonymous: false,
          targetKind: 'SERVICE_USER',
          description: 'Named introduction.\n\nNamed privacy notice.',
          libraryReference: 'SUR-PWS-001',
          libraryRevision: 1,
          librarySourceId: 'lib-1',
          libraryMeta: variantMeta,
          closingMessage: 'Thank you. We will call you if you asked us to.',
          ...over,
        });
      const templateQuestions = () => [
        question({ id: 'a', key: 'q1', questionText: 'Overall, how was your experience of our service?' }),
        question({ id: 'b', key: 'q-worker', questionText: 'Which care worker visits you most?', questionType: 'TEXT', sortOrder: 1 }),
        question({ id: 'c', key: 'q-contact', questionText: 'Would you like someone to contact you about your answers?', isRequired: false, sortOrder: 2 }),
        question({ id: 'd', key: 'q-phone', questionText: 'What number should we call?', questionType: 'TEXT', sortOrder: 3 }),
      ];

      it('New survey can choose the anonymous version: its own introduction, without the questions needing a name', async () => {
        givenSurvey(namedTemplate());
        prisma.surveyQuestion.findMany.mockResolvedValue(templateQuestions());
        await service.duplicate(admin, 't3', { isAnonymous: true });
        const data = prisma.survey.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
          isAnonymous: true,
          allowAnonymousResponses: false,
          description: 'Sunrise wants to hear from you. This survey is anonymous.\n\nWe never know who answered.',
          libraryReference: 'SUR-PWS-001',
        });
        expect(data.questions.create.map((q: any) => q.questionText)).toEqual(['Overall, how was your experience of our service?']);
        // The anonymous version's own closing screen.
        expect(data.closingMessage).toBe('Thank you. Nobody can tell which answers are yours.');
        // Fixed from then on, like any ready-made survey.
        expect(anonymityLocked(data)).toBe(true);
      });

      it('the named version is unchanged, and a template without an anonymous version still refuses the switch', async () => {
        givenSurvey(namedTemplate());
        prisma.surveyQuestion.findMany.mockResolvedValue(templateQuestions());
        await service.duplicate(admin, 't3');
        const named = prisma.survey.create.mock.calls[0][0].data;
        expect(named).toMatchObject({
          isAnonymous: false,
          description: 'Named introduction.\n\nNamed privacy notice.',
          closingMessage: 'Thank you. We will call you if you asked us to.',
        });
        expect(named.questions.create).toHaveLength(4);

        givenSurvey(namedTemplate({ libraryMeta: { type: 'survey-library', version: 1 } }));
        prisma.survey.findFirst.mockImplementation(async (args: any) => (args?.where?.id === 't3' ? namedTemplate({ libraryMeta: null }) : null));
        await expect(service.duplicate(admin, 't3', { isAnonymous: true })).rejects.toThrow(/ready-made/);
      });

      it('an anonymous version without its own closing message never takes the named one (it may promise a reply)', async () => {
        const { closingMessage: _c, ...variantWithout } = variantMeta.anonymousVariant as Record<string, unknown>;
        givenSurvey(namedTemplate({ libraryMeta: { ...variantMeta, anonymousVariant: variantWithout } }));
        prisma.surveyQuestion.findMany.mockResolvedValue(templateQuestions());
        await service.duplicate(admin, 't3', { isAnonymous: true });
        expect(prisma.survey.create.mock.calls[0][0].data.closingMessage).toBeNull();
      });

      it('never creates an anonymous version that still asks to contact someone', async () => {
        givenSurvey(namedTemplate({ libraryMeta: { ...variantMeta, anonymousVariant: { ...variantMeta.anonymousVariant, leaveOut: ['q-worker'] } } }));
        prisma.surveyQuestion.findMany.mockResolvedValue(templateQuestions());
        await expect(service.duplicate(admin, 't3', { isAnonymous: true })).rejects.toThrow(/cannot ask/);
        expect(prisma.survey.create).not.toHaveBeenCalled();
      });

      it('a survey started as the anonymous version cannot be switched back', async () => {
        givenSurvey(surveyRow({ id: 's10', isAnonymous: true, createdFromTemplateId: 't3', libraryReference: 'SUR-PWS-001' }));
        await expect(service.duplicate(admin, 's10', { isAnonymous: false })).rejects.toThrow(/ready-made/);
        await expect(service.update(admin, 's10', { isAnonymous: false })).rejects.toThrow(/ready-made/);
      });
    });

    it('Edit details refuses an anonymity change on a ready-made survey (even unsent)', async () => {
      givenSurvey(surveyRow({ id: 's9', isAnonymous: true, createdFromTemplateId: 't1', libraryReference: 'SUR-PWS-003' }));
      await expect(service.update(admin, 's9', { isAnonymous: false })).rejects.toThrow(/ready-made survey that is anonymous/);
      expect(prisma.survey.update).not.toHaveBeenCalled();
      // Everything else can still change, and sending the same value is fine.
      await service.update(admin, 's9', { title: 'Our annual survey', isAnonymous: true });
      expect(prisma.survey.update).toHaveBeenCalledTimes(1);
      // The adopted template itself too.
      givenSurvey(readyMadeTemplate());
      await expect(service.update(admin, 't1', { isAnonymous: false })).rejects.toThrow(/ready-made/);
    });

    it('a survey of the organisation’s own can still switch anonymity before it is sent', async () => {
      givenSurvey(surveyRow({ id: 's8', createdFromTemplateId: 't2' }));
      await service.update(admin, 's8', { isAnonymous: true });
      expect(prisma.survey.update.mock.calls[0][0].data.isAnonymous).toBe(true);
    });

    it('the survey says whether its anonymity is locked', async () => {
      givenSurvey(surveyRow({ id: 's9', createdFromTemplateId: 't1', libraryReference: 'SUR-PWS-003' }));
      const detail = await service.getById(admin, 's9');
      expect(detail.data).toMatchObject({ anonymityLocked: true, createdFromTemplateId: 't1', libraryReference: 'SUR-PWS-003' });
      prisma.survey.findMany.mockResolvedValue([
        { ...surveyRow({ id: 's8' }), _count: { questions: 1, recipients: 0, responses: 0, clones: 0 } },
      ]);
      const list = await service.list(admin, {} as any);
      expect(list.data[0]).toMatchObject({ anonymityLocked: false, createdFromTemplateId: null });
    });

    it('an adopted template moved back to surveys is no longer the adopted copy (keeps its reference)', async () => {
      givenSurvey(readyMadeTemplate());
      await service.update(admin, 't1', { isTemplate: false });
      const data = prisma.survey.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ isTemplate: false, librarySourceId: null });
      expect(data.libraryReference).toBeUndefined();
    });

    it('period copies keep the repeating survey’s origin', async () => {
      prisma.survey.findFirst.mockResolvedValue(null);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
      await service.runRecurringPeriod(
        surveyRow({
          recurrence: 'MONTHLY',
          distributeAt: new Date('2026-11-01T09:00:00.000Z'),
          recurrenceAnchorAt: new Date('2026-10-01T08:00:00.000Z'),
          locationIds: ['loc-leeds'],
          scheduledById: 'admin-1',
          createdFromTemplateId: 't1',
          libraryReference: 'SUR-PWS-003',
          libraryRevision: 2,
        }),
        new Date('2026-11-01T09:00:20.000Z'),
      );
      expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({
        createdFromTemplateId: 't1',
        libraryReference: 'SUR-PWS-003',
        libraryRevision: 2,
      });
    });
  });

  /* ─── Respondent-chosen anonymity (answer without my name) ─────────────────── */

  describe('answer without my name (named surveys)', () => {
    const named = (over: Record<string, unknown> = {}) =>
      surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true, ...over });
    const contactQ = (over: Record<string, unknown> = {}) =>
      question({
        id: 'q-contact',
        key: 'q-contact',
        questionText: 'Would you like someone to contact you about your answers?',
        questionType: 'YES_NO',
        isRequired: true,
        sortOrder: 1,
        ...over,
      });
    const howQ = () =>
      question({
        id: 'q-how',
        key: 'q-how',
        questionText: 'How should we contact you?',
        questionType: 'TEXT',
        isRequired: true,
        sortOrder: 2,
        showIf: { questionKey: 'q-contact', answers: ['Yes'] },
      });
    const givenRecipient = (survey: any, over: Record<string, unknown> = {}) =>
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'STARTED',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey,
        ...over,
      });
    const londonTime = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

    describe('the setting', () => {
      it('is stored on named surveys only', async () => {
        await service.create(admin, { title: 'A', allowAnonymousResponses: true } as any);
        expect(prisma.survey.create.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);
        await service.create(admin, { title: 'B', isAnonymous: true, allowAnonymousResponses: true } as any);
        expect(prisma.survey.create.mock.calls[1][0].data.allowAnonymousResponses).toBe(false);
        expect(
          (await service.create(admin, { title: 'C', allowAnonymousResponses: true } as any)).data.allowAnonymousResponses,
        ).toBe(true);
      });

      it('can be turned on at any time, but not off once people were offered it', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyRecipient.count.mockResolvedValue(4);
        await service.update(admin, 's1', { allowAnonymousResponses: true });
        expect(prisma.survey.update.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);

        givenSurvey(named());
        await expect(service.update(admin, 's1', { allowAnonymousResponses: false })).rejects.toThrow(
          /already been offered the choice/,
        );
        prisma.surveyRecipient.count.mockResolvedValue(0);
        await service.update(admin, 's1', { allowAnonymousResponses: false });
        expect(prisma.survey.update.mock.calls[1][0].data.allowAnonymousResponses).toBe(false);
      });

      it('cannot be turned off when the ready-made survey promises it', async () => {
        const row = named({ status: 'DRAFT', libraryReference: 'SUR-PWS-003', libraryRevision: 2 });
        prisma.survey.findFirst.mockImplementation(async (args: any) =>
          args?.where?.isCatalogue === true
            ? { isAnonymous: false, allowAnonymousResponses: true }
            : args?.where?.id === 's1'
              ? row
              : null,
        );
        await expect(service.update(admin, 's1', { allowAnonymousResponses: false })).rejects.toThrow(
          /ready-made survey SUR-PWS-003/,
        );
        const detail = await service.getById(admin, 's1');
        expect(detail.data).toMatchObject({ allowAnonymousResponses: true, anonymousChoiceFixed: 'library' });
      });

      it('is dropped when a survey becomes anonymous', async () => {
        givenSurvey(named({ status: 'DRAFT' }));
        await service.update(admin, 's1', { isAnonymous: true });
        expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
          isAnonymous: true,
          allowAnonymousResponses: false,
        });
      });

      it('is carried by copies, templates and period copies', async () => {
        givenSurvey(named());
        await service.duplicate(admin, 's1');
        expect(prisma.survey.create.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);
        await service.duplicate(admin, 's1', { isAnonymous: true } as any);
        expect(prisma.survey.create.mock.calls[1][0].data.allowAnonymousResponses).toBe(false);

        prisma.surveyRecipient.count.mockResolvedValue(3);
        await service.saveAsTemplate(admin, 's1');
        expect(prisma.survey.create.mock.calls[2][0].data).toMatchObject({ isTemplate: true, allowAnonymousResponses: true });

        prisma.survey.findFirst.mockResolvedValue(null);
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', employment: { locationId: 'loc-leeds' } }]);
        await service.runRecurringPeriod(
          named({
            status: 'DRAFT',
            recurrence: 'MONTHLY',
            distributeAt: new Date('2026-11-01T09:00:00.000Z'),
            recurrenceAnchorAt: new Date('2026-10-01T08:00:00.000Z'),
            locationIds: ['loc-leeds'],
            scheduledById: 'admin-1',
          }),
          new Date('2026-11-01T09:00:20.000Z'),
        );
        expect(prisma.survey.create.mock.calls[3][0].data.allowAnonymousResponses).toBe(true);
      });

      it('getById says it is fixed once sent', async () => {
        givenSurvey(named());
        prisma.surveyRecipient.count.mockResolvedValue(2);
        const res = await service.getById(admin, 's1');
        expect(res.data.anonymousChoiceFixed).toBe('sent');
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        expect((await service.getById(admin, 's1')).data.anonymousChoiceFixed).toBeNull();
      });
    });

    describe('the answer form', () => {
      it('offers the choice and marks the contact-me question (link, carer app)', async () => {
        const survey = named({ targetKind: 'PUBLIC' });
        givenSurvey(survey);
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ()]);
        const form: any = await service.getPublicByToken('share-token-1');
        expect(form.data.allowAnonymousResponses).toBe(true);
        expect(form.data.questions.map((q: any) => q.contactRequest)).toEqual([false, true]);

        prisma.surveyRecipient.findMany.mockResolvedValue([
          { token: 'tok', status: 'SENT', sentAt: null, survey: { ...named(), id: 's1' }, response: null },
          {
            token: 'tok2',
            status: 'COMPLETED',
            sentAt: null,
            survey: { ...named(), id: 's2' },
            response: null,
          },
        ]);
        const app: any = await service.listForEmployeeApp('emp-1', new Date('2026-11-05T10:00:00.000Z'));
        const open = app.data.find((i: any) => i.token === 'tok');
        expect(open).toMatchObject({ allowAnonymousResponses: true, answeredWithoutName: false });
        expect(open.questions.find((q: any) => q.id === 'q-contact').contactRequest).toBe(true);
        expect(app.data.find((i: any) => i.token === 'tok2')).toMatchObject({ state: 'COMPLETED', answeredWithoutName: true });
      });

      it('is never offered on anonymous surveys or surveys without the setting', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'PUBLIC', isAnonymous: true, allowAnonymousResponses: true }));
        expect(((await service.getPublicByToken('share-token-1')) as any).data.allowAnonymousResponses).toBe(false);
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'PUBLIC' }));
        expect(((await service.getPublicByToken('share-token-1')) as any).data.allowAnonymousResponses).toBe(false);
      });
    });

    describe('an older anonymous survey that still asks contact-me', () => {
      const anonymous = () => surveyRow({ status: 'ACTIVE', isAnonymous: true });

      it('never shows it or its follow-up on the link, portal or carer app forms', async () => {
        givenSurvey({ ...anonymous(), targetKind: 'PUBLIC' });
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ(), howQ()]);
        const form: any = await service.getPublicByToken('share-token-1');
        expect(form.data.questions.map((q: any) => q.id)).toEqual(['q1']);

        prisma.surveyRecipient.findMany.mockResolvedValue([
          { token: 'tok', status: 'SENT', sentAt: null, survey: { ...anonymous(), id: 's1' }, response: null },
        ]);
        prisma.surveyQuestion.findMany.mockResolvedValue([
          { ...question(), surveyId: 's1' },
          { ...contactQ(), surveyId: 's1' },
          { ...howQ(), surveyId: 's1' },
        ]);
        const app: any = await service.listForEmployeeApp('emp-1', new Date('2026-11-05T10:00:00.000Z'));
        expect(app.data[0].questions.map((q: any) => q.id)).toEqual(['q1']);
      });

      it('discards anything sent for them (not required either), as when answering without a name', async () => {
        givenRecipient(anonymous());
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ(), howQ()]);
        prisma.survey.findUnique.mockResolvedValue({ title: 'Staff survey', isAnonymous: true });
        await service.submitPublicResponse('tok', {
          answers: [
            { questionId: 'q1', booleanValue: true },
            { questionId: 'q-contact', booleanValue: true },
            { questionId: 'q-how', textValue: 'Ring me' },
          ],
        });
        const [data] = await flushHeld();
        expect(data.answers.create.map((a: any) => a.questionId)).toEqual(['q1']);
        // Required contact-me left unanswered is no problem either.
        await expect(
          service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] }),
        ).resolves.toBeDefined();
      });
    });

    describe('submitting without a name', () => {
      it('stores the answer like an anonymous one and discards the contact-me answer', async () => {
        givenRecipient(named());
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ(), howQ()]);
        prisma.employeeEmployment.findFirst.mockResolvedValue({ locationId: 'loc-leeds', jobTitleId: 'jt-carer' });
        prisma.role.findMany.mockResolvedValue([{ id: 'sa' }]);
        prisma.userRole.findMany.mockResolvedValue([{ userId: 'office-1' }]);
        prisma.survey.findUnique.mockResolvedValue({ title: 'Staff survey', isAnonymous: false });

        const res = await service.submitPublicResponse(
          'tok',
          {
            answerWithoutName: true,
            answers: [
              { questionId: 'q1', booleanValue: true },
              { questionId: 'q-contact', booleanValue: true },
              { questionId: 'q-how', textValue: 'Ring me on 07000 000000' },
            ],
          },
          { ipAddress: '10.0.0.7', userAgent: 'CarerApp' } as any,
        );

        // Held, not written with the Completed mark; the pending row names nobody.
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(JSON.stringify(held())).not.toMatch(/r1|emp-1|tok|10\.0\.0\.7|CarerApp/);
        const [data] = await flushHeld();
        // Not linked to the person, their branch or job title.
        expect(data).toMatchObject({
          recipientId: null,
          isAnonymous: true,
          locationId: null,
          jobTitleId: null,
          submittedById: null,
          respondentName: null,
          channel: 'ONLINE',
        });
        expect(prisma.employeeEmployment.findFirst).not.toHaveBeenCalled();
        // The day only, everywhere: response, answers and the recipient's own row.
        expect(londonTime(data.submittedAt)).toBe('00:00');
        expect(data.createdAt).toEqual(data.submittedAt);
        expect(data.updatedAt).toEqual(data.submittedAt);
        expect(res.data.submittedAt).toBe(data.submittedAt.toISOString());
        const answers = data.answers.create;
        expect(answers.map((a: any) => a.questionId)).toEqual(['q1']);
        expect(answers[0].createdAt).toEqual(data.submittedAt);
        // The recipient is claimed, then completed (reminders stop) — with the day only, and the
        // claim (a token without a time) is cleared with the Completed mark.
        const [claimCall, completeCall] = prisma.surveyRecipient.updateMany.mock.calls.map((c: any[]) => c[0]);
        expect(claimCall.data.updatedAt).toEqual(data.submittedAt);
        expect(completeCall).toEqual({
          where: { id: 'r1', submitClaim: claimCall.data.submitClaim, status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED', submitClaim: null, submitClaimExpiresAt: null, updatedAt: data.submittedAt },
        });
        // The audit trail names neither the person, the response nor the device, and does not date
        // the answer: no row of its own, only one more in the survey's count for the day.
        expectNoPerAnswerAudit(audit);
        expect(unlinkedDayCounts(prisma)).toMatchObject([{ surveyId: 's1', recorded: 0, reviewer: 0 }]);
        expect(JSON.stringify(audit.logAudit.mock.calls)).not.toMatch(/emp-1|surveyResponse-new|surveyPendingResponse-new/);

        // The office is not told at the moment it came in: once a day, without a name.
        await new Promise((r) => setImmediate(r));
        expect(prisma.employeePersonalDetail.findFirst).not.toHaveBeenCalled();
        expect(notifications.notifyUsers).not.toHaveBeenCalled();
      });

      it('does not require a required contact-me question', async () => {
        givenRecipient(named());
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ()]);
        await service.submitPublicResponse('tok', {
          answerWithoutName: true,
          answers: [{ questionId: 'q1', booleanValue: false }],
        });
        expect(prisma.surveyPendingResponse.create).toHaveBeenCalled();
        // With a name it is still required.
        jest.clearAllMocks();
        resetDefaults(prisma);
        givenRecipient(named());
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ()]);
        await expect(
          service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: false }] }),
        ).rejects.toThrow(/Answer required for: Would you like someone to contact you/);
      });

      it('keeps neither who answered nor a family member’s name on a service-user survey (portal)', async () => {
        givenRecipient(named({ targetKind: 'SERVICE_USER' }), {
          targetKind: 'SERVICE_USER',
          employeeId: null,
          serviceUserId: 'su-1',
        });
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitPublicResponse('tok', {
          answerWithoutName: true,
          respondentRelation: 'FAMILY_MEMBER',
          respondentName: 'Ann Smith',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any);
        expect(held().payload.respondentRelation).toBeNull();
        expect(JSON.stringify(held())).not.toMatch(/Ann Smith|FAMILY_MEMBER/);
        const [data] = await flushHeld();
        expect(data).toMatchObject({
          recipientId: null,
          isAnonymous: true,
          locationId: null,
          respondentRelation: null,
          respondentName: null,
          channel: 'PORTAL',
        });
        expect(prisma.serviceUser.findFirst).not.toHaveBeenCalled();

        // Who is answering is not required either.
        givenRecipient(named({ targetKind: 'SERVICE_USER' }), {
          targetKind: 'SERVICE_USER',
          employeeId: null,
          serviceUserId: 'su-1',
        });
        await expect(
          service.submitPublicResponse('tok', { answerWithoutName: true, answers: [{ questionId: 'q1', booleanValue: true }] }),
        ).resolves.toMatchObject({ message: 'Survey response submitted' });
      });

      it('carer app: same storage, and a second answer is refused', async () => {
        givenRecipient(named());
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitEmployeeAppResponse('emp-1', 'tok', {
          answerWithoutName: true,
          answers: [{ questionId: 'q1', booleanValue: true }],
        });
        expect(held()).toMatchObject({ isAnonymous: true, channel: 'ONLINE' });
        expect((await flushHeld())[0]).toMatchObject({ recipientId: null, isAnonymous: true });
        givenRecipient(named(), { status: 'COMPLETED' });
        await expect(
          service.submitEmployeeAppResponse('emp-1', 'tok', {
            answerWithoutName: true,
            answers: [{ questionId: 'q1', booleanValue: true }],
          }),
        ).rejects.toThrow(/already completed/);
      });

      it('is refused on a named survey that does not offer it', async () => {
        givenRecipient(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await expect(
          service.submitPublicResponse('tok', { answerWithoutName: true, answers: [{ questionId: 'q1', booleanValue: true }] }),
        ).rejects.toThrow(/does not offer answering without your name/);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
      });

      it('changes nothing on an anonymous survey (already unlinked)', async () => {
        givenRecipient(surveyRow({ status: 'ACTIVE', isAnonymous: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitPublicResponse('tok', { answerWithoutName: true, answers: [{ questionId: 'q1', booleanValue: true }] });
        expect(held()).toMatchObject({ isAnonymous: false });
        expect((await flushHeld())[0]).toMatchObject({ recipientId: null, isAnonymous: false });
      });

      it('a shared link answer without a name is held (never written at once), keeps the day only and no IP in the audit', async () => {
        givenSurvey(named({ targetKind: 'PUBLIC' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ({ isRequired: false })]);
        const res: any = await service.submitPublicResponse(
          'share-token-1',
          {
            answerWithoutName: true,
            answers: [
              { questionId: 'q1', booleanValue: true },
              { questionId: 'q-contact', booleanValue: true },
            ],
          },
          { ipAddress: '10.0.0.7', userAgent: 'Browser' } as any,
        );
        // Never written at once: anyone watching Results would see it arrive at a known time.
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(held()).toMatchObject({ surveyId: 's1', isAnonymous: true, channel: 'ONLINE' });
        expect(londonTime(held().createdAt)).toBe('00:00');
        expect(held().payload).toMatchObject({ respondentRelation: null, viaSharedLink: true });
        expect(JSON.stringify(held())).not.toMatch(/10\.0\.0\.7|Browser/);
        // A receipt only, never the response it becomes.
        expect(res.data.id).toBe('surveyPendingResponse-new');
        const [data] = await flushHeld();
        expect(data).toMatchObject({ recipientId: null, isAnonymous: true, viaSharedLink: true });
        expect(londonTime(data.submittedAt)).toBe('00:00');
        expect(data.answers.create.map((a: any) => a.questionId)).toEqual(['q1']);
        // No audit row of its own (no time or IP): counted for the day.
        expectNoPerAnswerAudit(audit);
        expect(unlinkedDayCounts(prisma)).toMatchObject([{ surveyId: 's1', recorded: 0 }]);
      });

      it('an anonymous public survey: every shared-link answer is held and written in a batch; a used form stays used once held', async () => {
        givenSurvey(named({ targetKind: 'PUBLIC', isAnonymous: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] });
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(held()).toMatchObject({ isAnonymous: false, payload: expect.objectContaining({ viaSharedLink: true }) });
        // Held, then a later step fails: the form's token is not released (a retry would add it twice).
        const release = jest.fn(async () => undefined);
        (service as any).linkGuard = { check: jest.fn(async () => 'ok'), release };
        jest.spyOn(service as any, 'countSharedLinkAnswer').mockRejectedValueOnce(new Error('down'));
        await expect(service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }], formToken: 'ft' } as any)).rejects.toThrow('down');
        expect(release).not.toHaveBeenCalled();
        // Not held (a missing answer): released, so the same form can be sent again.
        await expect(service.submitPublicResponse('share-token-1', { answers: [], formToken: 'ft2' } as any)).rejects.toThrow();
        expect(release).toHaveBeenCalledWith('ft2');
      });

      it('a named shared-link answer is unchanged', async () => {
        givenSurvey(named({ targetKind: 'PUBLIC' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitPublicResponse('share-token-1', { answers: [{ questionId: 'q1', booleanValue: true }] }, {
          ipAddress: '10.0.0.7',
        } as any);
        expect(prisma.surveyResponse.create.mock.calls[0][0].data.isAnonymous).toBe(false);
        expect(audit.logAudit.mock.calls[0][0]).toMatchObject({ recordType: 'SurveyResponse' });
        // People answering a shared link are not identified: their IP address is never kept.
        expect(audit.logAudit.mock.calls[0][0]).not.toHaveProperty('ipAddress');
      });
    });

    describe('the person’s own view', () => {
      it('says why there are no answers to show', async () => {
        prisma.surveyRecipient.findFirst.mockResolvedValue({
          status: 'COMPLETED',
          survey: { title: 'Annual survey', isAnonymous: false },
          response: null,
        });
        await expect(service.getPortalSurveyAnswers('su-1', 'tok')).rejects.toThrow(/answered this survey without your name/);
      });

      it('the portal list marks it and offers no answers to view', async () => {
        prisma.surveyRecipient.findMany.mockResolvedValue([
          { token: 'a', status: 'COMPLETED', sentAt: null, survey: named({ targetKind: 'SERVICE_USER' }), response: null },
          {
            token: 'b',
            status: 'COMPLETED',
            sentAt: null,
            survey: named({ targetKind: 'SERVICE_USER' }),
            response: { submittedAt: new Date('2026-11-02T10:00:00.000Z'), respondentRelation: 'SELF' },
          },
        ]);
        const res: any = await service.listForServiceUserPortal('su-1', new Date('2026-11-05T10:00:00.000Z'));
        expect(res.data.find((i: any) => i.token === 'a')).toMatchObject({ answeredWithoutName: true, answersAvailable: false });
        expect(res.data.find((i: any) => i.token === 'b')).toMatchObject({ answeredWithoutName: false, answersAvailable: true });
      });
    });

    describe('results and responses', () => {
      const q = () => question({ id: 'q1', questionType: 'TEXTAREA', questionText: 'What could we do better?', isRequired: false });
      const answer = (responseId: string, isAnonymous: boolean, text: string, channel = 'ONLINE') => ({
        booleanValue: null,
        textValue: text,
        numberValue: null,
        selectedOptions: null,
        otherText: null,
        comment: null,
        response: {
          id: responseId,
          isAnonymous,
          channel,
          recipient: isAnonymous ? null : { employeeId: 'emp-1', serviceUserId: null },
        },
        question: { ...q(), surveyId: 's1' },
      });
      const givenResults = (survey: any, named: number, withoutName: number, recorded = 0) => {
        givenSurvey(survey);
        prisma.surveyQuestion.findMany.mockResolvedValue([q()]);
        prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
          args.by[0] === 'surveyId'
            ? [
                { surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: named } },
                { surveyId: 's1', isAnonymous: true, channel: 'ONLINE', _count: { _all: withoutName } },
                ...(recorded ? [{ surveyId: 's1', isAnonymous: true, channel: 'PAPER', _count: { _all: recorded } }] : []),
              ]
            : [],
        );
        prisma.surveyAnswer.findMany.mockResolvedValue([
          answer('r-named', false, 'Named idea'),
          answer('r-anon', true, 'Idea given without a name'),
          answer('r-paper', true, 'Paper idea', 'PAPER'),
        ]);
      };

      it('counts them in every total and reports their share; their answers wait for the close', async () => {
        givenResults(named(), 6, 5, 1);
        const open: any = await service.results(admin, 's1');
        expect(open.data).toMatchObject({
          responses: 12,
          answeredWithoutName: 6,
          answeredWithoutNamePercent: 50,
          // Open: a new unnamed answer could be matched to whoever just turned Completed.
          withoutNameAnswersHeldBack: 5,
        });
        expect(open.data.withoutNameAnswersNote).toMatch(/once the survey \(or period\) has closed and at least 5/);
        expect(open.data.questionSummaries[0].answerCount).toBe(2);

        givenResults(named({ status: 'CLOSED' }), 6, 5, 1);
        const closed: any = await service.results(admin, 's1');
        expect(closed.data).toMatchObject({ responses: 12, withoutNameAnswersHeldBack: 0, withoutNameAnswersNote: null });
        expect(closed.data.questionSummaries[0].answerCount).toBe(3);
      });

      it('leaves every part of them out while fewer than 5 answered that way (who chose it can be seen)', async () => {
        givenResults(named({ status: 'CLOSED' }), 6, 4, 1);
        const res: any = await service.results(admin, 's1');
        // Still counted as responses (their number is no secret)…
        expect(res.data).toMatchObject({ responses: 11, answeredWithoutName: 5, withoutNameAnswersHeldBack: 4 });
        expect(res.data.withoutNameAnswersNote).toMatch(/4 responses were given without a name .* at least 5 people/);
        // …but not in any question's figures, samples or "held back" flags.
        const summary = res.data.questionSummaries[0];
        expect(summary.answerCount).toBe(2);
        expect(summary.textSamples).toEqual(['Named idea', 'Paper idea']);
        expect(summary.writtenAnswersWithheld).toBe(false);
        expect(res.data.writtenAnswersNote).toBeNull();
      });

      it('holds their written answers back on a named survey until closed with at least 5', async () => {
        givenResults(named(), 6, 5);
        const open: any = await service.results(admin, 's1');
        const samples = open.data.questionSummaries[0].textSamples;
        expect(samples).toEqual(expect.arrayContaining(['Named idea', 'Paper idea']));
        expect(samples).not.toContain('Idea given without a name');
        // While open the whole answer is held back (not only the written part), and no flag hints at it.
        expect(open.data.questionSummaries[0].writtenAnswersWithheld).toBe(false);
        expect(open.data.withoutNameAnswersHeldBack).toBe(5);

        givenResults(named({ status: 'CLOSED' }), 6, 4);
        const fewClosed: any = await service.results(admin, 's1');
        expect(fewClosed.data.questionSummaries[0].textSamples).not.toContain('Idea given without a name');

        givenResults(named({ status: 'CLOSED' }), 6, 5);
        const closed: any = await service.results(admin, 's1');
        expect(closed.data.questionSummaries[0].textSamples).toContain('Idea given without a name');
        expect(closed.data.writtenAnswersNote).toBeNull();
      });

      it('never names who wrote them', async () => {
        givenResults(named({ status: 'CLOSED' }), 6, 5);
        prisma.surveyQuestion.findMany.mockResolvedValue([
          question({ id: 'q1', questionType: 'YES_NO', commentConfig: { prompt: 'Why?', showWhen: null } }),
        ]);
        prisma.surveyAnswer.findMany.mockResolvedValue([
          { ...answer('r-anon', true, ''), textValue: null, booleanValue: true, comment: 'Late again', question: { ...question(), surveyId: 's1' } },
        ]);
        const res: any = await service.results(admin, 's1');
        expect(res.data.questionSummaries[0].writtenAnswers[0]).toMatchObject({ comment: 'Late again', respondentName: null });
        expect(prisma.employeePersonalDetail.findMany).not.toHaveBeenCalled();
      });

      it('leaves them out of branch and job title groups, saying so', async () => {
        givenSurvey(named());
        prisma.surveyResponse.groupBy.mockImplementation(async (args: any) => {
          if (args.by[0] === 'locationId') return [{ locationId: 'loc-leeds', _count: { _all: 6 } }];
          if (args.by[0] === 'jobTitleId') return [{ jobTitleId: 'jt-1', _count: { _all: 6 } }];
          return [
            { surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 6 } },
            { surveyId: 's1', isAnonymous: true, channel: 'ONLINE', _count: { _all: 2 } },
          ];
        });
        const res: any = await service.results(admin, 's1');
        const byLocation = prisma.surveyResponse.groupBy.mock.calls.find((c: any[]) => c[0].by[0] === 'locationId');
        expect(byLocation[0].where).toEqual({ surveyId: { in: ['s1'] }, isAnonymous: false });
        expect(res.data.breakdowns[0].note).toMatch(/2 responses were given without a name and are not counted by group/);
        expect(res.data.breakdowns[1].note).toMatch(/given without a name/);
      });

      it('lists them unnamed and numbered among themselves once closed with 5 (not while open)', async () => {
        givenSurvey(named());
        const row = (id: string, isAnonymous: boolean, at: string, text: string) => ({
          id,
          surveyId: 's1',
          recipientId: isAnonymous ? null : 'r1',
          recipient: isAnonymous ? null : { id: 'r1', employeeId: 'emp-1', serviceUserId: null },
          submittedAt: new Date(at),
          respondentRelation: null,
          respondentName: null,
          channel: 'ONLINE',
          isAnonymous,
          recordedById: null,
          contactedAt: null,
          contactNumber: null,
          contactNotes: null,
          consentGiven: null,
          answers: [
            {
              id: `${id}-a`,
              booleanValue: null,
              textValue: text,
              numberValue: null,
              selectedOptions: null,
              otherText: null,
              comment: null,
              question: { id: 'q1', questionText: 'Better?', questionType: 'TEXTAREA', options: null, sortOrder: 0, sectionTitle: null, otherOption: null },
            },
          ],
        });
        prisma.surveyResponse.findMany.mockResolvedValue([
          row('resp-named-2', false, '2026-11-04T15:00:00.000Z', 'Named'),
          row('resp-anon', true, '2026-11-04T00:00:00.000Z', 'Secret'),
          row('resp-named-1', false, '2026-11-03T09:00:00.000Z', 'Earlier'),
          ...[2, 3, 4, 5].map((n) => row(`resp-anon-${n}`, true, '2026-11-04T00:00:00.000Z', `Secret ${n}`)),
        ]);
        prisma.employeePersonalDetail.findMany.mockResolvedValue([{ employeeId: 'emp-1', firstName: 'Jo', lastName: 'Bloggs' }]);
        const open: any = await service.listResponses(admin, 's1');
        expect(open.data.responses.map((r: any) => r.id)).toEqual(['resp-named-2', 'resp-named-1']);
        expect(open.data).toMatchObject({ total: 7, answeredWithoutName: 5, withoutNameAnswersHeldBack: 5 });

        givenSurvey(named({ status: 'CLOSED' }));
        const res: any = await service.listResponses(admin, 's1');
        const anon = res.data.responses.find((r: any) => r.id === 'resp-anon');
        expect(anon).toMatchObject({
          respondentLabel: 'Anonymous respondent #1',
          isAnonymous: true,
          answeredWithoutName: true,
          submittedDateOnly: true,
          employeeId: null,
          respondentRelation: null,
          writtenAnswersWithheld: false,
        });
        expect(anon.answers[0]).toMatchObject({ textValue: 'Secret', withheldFields: [] });
        const namedRow = res.data.responses.find((r: any) => r.id === 'resp-named-2');
        expect(namedRow).toMatchObject({ respondentLabel: 'Jo Bloggs', writtenAnswersWithheld: false });
        expect(namedRow.answers[0].textValue).toBe('Named');
        expect(res.data).toMatchObject({ total: 7, answeredWithoutName: 5, withoutNameAnswersHeldBack: 0 });
      });

      it('does not list them while fewer than 5 answered that way; staff-recorded ones still show', async () => {
        givenSurvey(named({ status: 'CLOSED' }));
        const row = (id: string, isAnonymous: boolean, channel = 'ONLINE') => ({
          id,
          surveyId: 's1',
          recipientId: isAnonymous ? null : 'r1',
          recipient: isAnonymous ? null : { id: 'r1', employeeId: 'emp-1', serviceUserId: null },
          submittedAt: new Date('2026-11-04T00:00:00.000Z'),
          respondentRelation: null,
          respondentName: null,
          channel,
          isAnonymous,
          recordedById: null,
          contactedAt: null,
          contactNumber: null,
          contactNotes: null,
          consentGiven: null,
          answers: [],
        });
        prisma.surveyResponse.findMany.mockResolvedValue([
          row('resp-named', false),
          row('resp-chosen', true),
          row('resp-paper', true, 'PAPER'),
        ]);
        const res: any = await service.listResponses(admin, 's1');
        expect(res.data.responses.map((r: any) => r.id)).toEqual(['resp-named', 'resp-paper']);
        // Numbered without the held-back one, so no gap hints at it.
        expect(res.data.responses[1].respondentLabel).toBe('Anonymous respondent #1');
        expect(res.data).toMatchObject({ total: 3, answeredWithoutName: 2, withoutNameAnswersHeldBack: 1 });
        expect(res.data.withoutNameAnswersNote).toMatch(/^1 response was given without a name/);
      });

      it('per-question answer counts on the survey leave them out too', async () => {
        givenSurvey(named());
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        prisma.surveyResponse.count.mockResolvedValue(2);
        await service.getById(admin, 's1');
        const where = prisma.surveyAnswer.groupBy.mock.calls[0][0].where;
        expect(where.response).toEqual({
          NOT: { isAnonymous: true, channel: { notIn: ['TELEPHONE', 'PAPER', 'IN_PERSON'] } },
        });
        // Five, but still open: held.
        prisma.surveyAnswer.groupBy.mockClear();
        prisma.surveyResponse.count.mockResolvedValue(5);
        await service.getById(admin, 's1');
        expect(prisma.surveyAnswer.groupBy.mock.calls[0][0].where).toHaveProperty('response');
        // Closed with five: counted.
        givenSurvey(named({ status: 'CLOSED' }));
        prisma.surveyAnswer.groupBy.mockClear();
        await service.getById(admin, 's1');
        expect(prisma.surveyAnswer.groupBy.mock.calls[0][0].where).not.toHaveProperty('response');
      });
    });
  });
  /* ─── Anonymity hardening: held answers, deferred unlinked writes ──────────── */

  describe('anonymity hardening', () => {
    const contactQ = () =>
      question({
        id: 'q-contact',
        key: 'q-contact',
        questionText: 'Would you like someone to contact you about your answers?',
        isRequired: true,
        sortOrder: 1,
      });
    const recipientFor = (survey: any, over: Record<string, unknown> = {}) =>
      prisma.surveyRecipient.findUnique.mockResolvedValue({
        id: 'r1',
        token: 'tok',
        status: 'STARTED',
        targetKind: 'EMPLOYEE',
        employeeId: 'emp-1',
        serviceUserId: null,
        response: null,
        survey,
        ...over,
      });

    /**
     * Each unit of work that reaches the database: an explicit transaction, or a call made outside
     * one (its own implicit transaction). Lists the writes that matter here.
     */
    const trackUnits = () => {
      const units: string[][] = [];
      let current: string[] | null = null;
      const watched: Array<[string, string]> = [
        ['surveyRecipient', 'updateMany'],
        ['surveyRecipient', 'update'],
        ['surveyRecipient', 'create'],
        ['surveyResponse', 'create'],
        ['surveyResponse', 'createMany'],
        ['surveyPendingResponse', 'create'],
      ];
      for (const [model, fn] of watched) {
        const original = prisma[model][fn].getMockImplementation();
        prisma[model][fn].mockImplementation(async (...args: unknown[]) => {
          const name = `${model}.${fn}`;
          if (current) current.push(name);
          else units.push([name]);
          return original ? original(...args) : undefined;
        });
      }
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        current = [];
        try {
          return await cb(prisma);
        } finally {
          units.push(current);
          current = null;
        }
      });
      return units;
    };
    const marksRecipient = (u: string[]) => u.some((c) => c.startsWith('surveyRecipient.'));
    const writesAnswers = (u: string[]) =>
      u.includes('surveyResponse.create') ||
      u.includes('surveyResponse.createMany') ||
      u.includes('surveyPendingResponse.create');

    describe('no transaction both marks the person Completed and writes their unlinked answers', () => {
      it('anonymous survey (portal / link / carer app)', async () => {
        const units = trackUnits();
        recipientFor(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
        expect(units.some(marksRecipient)).toBe(true);
        expect(units.some(writesAnswers)).toBe(true);
        expect(units.filter((u) => marksRecipient(u) && writesAnswers(u))).toEqual([]);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        // Claimed first, the answers kept next, then the person marked Completed — three separate
        // units: a crash in between can at worst allow a second answer later, never lose this one.
        const flat = units.flat();
        expect(flat.indexOf('surveyRecipient.updateMany')).toBeLessThan(flat.indexOf('surveyPendingResponse.create'));
        expect(flat.indexOf('surveyPendingResponse.create')).toBeLessThan(flat.lastIndexOf('surveyRecipient.updateMany'));
        expect(flat.filter((c) => c === 'surveyRecipient.updateMany')).toHaveLength(2);
        // Writing them later is its own transaction, with no recipient in it either.
        const before = units.length;
        await flushHeld();
        expect(units.slice(before).filter(marksRecipient)).toEqual([]);
      });

      it('answer without my name on a named survey', async () => {
        const units = trackUnits();
        recipientFor(surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitEmployeeAppResponse('emp-1', 'tok', {
          answerWithoutName: true,
          answers: [{ questionId: 'q1', booleanValue: true }],
        });
        expect(units.filter((u) => marksRecipient(u) && writesAnswers(u))).toEqual([]);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(held()).toMatchObject({ surveyId: 's1', isAnonymous: true });
      });

      it('staff recording a named person’s answers on an anonymous survey', async () => {
        const units = trackUnits();
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          personId: 'emp-1',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any);
        expect(units.some(marksRecipient)).toBe(true);
        expect(units.filter((u) => marksRecipient(u) && writesAnswers(u))).toEqual([]);
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      });

      it('a named answer is unchanged: linked, and written with the Completed mark in one transaction', async () => {
        const units = trackUnits();
        recipientFor(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
        expect(units.filter((u) => marksRecipient(u) && u.includes('surveyResponse.create'))).toHaveLength(1);
        expect(prisma.surveyResponse.create.mock.calls[0][0].data.recipientId).toBe('r1');
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
      });

      it('a recorded anonymous response (nobody marked Completed) is written straight away, as before', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          isAnonymous: true,
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any);
        expect(prisma.surveyResponse.create.mock.calls[0][0].data).toMatchObject({ recipientId: null, isAnonymous: true });
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('claim → hold → mark: racing and crashed submits of an unlinked answer', () => {
      const submit = () => service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
      let logError: jest.SpyInstance;
      beforeEach(() => {
        logError = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      });

      /** A recipient row the conditional updates act on like the database would (one at a time). */
      const liveRecipient = (survey: any, over: Record<string, unknown> = {}) => {
        const row: any = {
          id: 'r1',
          token: 'tok',
          status: 'STARTED',
          targetKind: 'EMPLOYEE',
          employeeId: 'emp-1',
          serviceUserId: null,
          submitClaim: null,
          submitClaimExpiresAt: null,
          ...over,
        };
        const matches = (where: any): boolean =>
          Object.entries(where).every(([key, cond]: [string, any]) => {
            if (key === 'OR') return cond.some((o: any) => matches(o));
            if (key === 'id') return typeof cond === 'string' ? row.id === cond : true;
            if (key === 'status') {
              if (cond?.in) return cond.in.includes(row.status);
              return cond?.not ? row.status !== cond.not : row.status === cond;
            }
            if (key === 'submitClaimExpiresAt' && cond && typeof cond === 'object' && 'lte' in cond) {
              return row.submitClaimExpiresAt != null && row.submitClaimExpiresAt.getTime() <= cond.lte.getTime();
            }
            return (row[key] ?? null) === cond;
          });
        prisma.surveyRecipient.updateMany.mockImplementation(async (args: any) => {
          if (!matches(args.where)) return { count: 0 };
          Object.assign(row, args.data);
          return { count: 1 };
        });
        prisma.surveyRecipient.findUnique.mockImplementation(async (args: any) =>
          args.select ? { status: row.status } : { ...row, response: null, survey },
        );
        prisma.surveyRecipient.findFirst.mockImplementation(async () => ({ id: row.id }));
        return row;
      };
      const anon = () => surveyRow({ isAnonymous: true, status: 'ACTIVE' });
      const heldCount = () => prisma.surveyPendingResponse.create.mock.calls.length;
      beforeEach(() => {
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      });

      it('normal path: claimed, held, then marked Completed with the claim cleared', async () => {
        const row = liveRecipient(anon());
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(heldCount()).toBe(1);
        expect(row).toMatchObject({ status: 'COMPLETED', submitClaim: null, submitClaimExpiresAt: null });
        // The claim is a token with no time in it; its expiry is a quarter-hour boundary.
        const claimData = prisma.surveyRecipient.updateMany.mock.calls[0][0].data;
        expect(claimData.submitClaim).toMatch(/^[0-9a-f-]{36}$/);
        expect(claimData.submitClaimExpiresAt.getTime() % (15 * 60_000)).toBe(0);
        expect(logError).not.toHaveBeenCalled();
      });

      it('two racing submits: only one is held, the other is refused before anything is held', async () => {
        const row = liveRecipient(anon());
        const results = await Promise.allSettled([submit(), submit()]);
        expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
        const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(refused.reason.getStatus()).toBe(409);
        // Said apart by code: an app keeps an in-progress refusal's answer, drops an "already completed" one.
        expect(['SURVEY_ANSWER_IN_PROGRESS', 'SURVEY_ALREADY_COMPLETED']).toContain(refused.reason.getResponse().code);
        expect(heldCount()).toBe(1);
        // Counted once for the day (no audit row per answer).
        expect(unlinkedDayCounts(prisma)).toHaveLength(1);
        expectNoPerAnswerAudit(audit);
        expect(row.status).toBe('COMPLETED');
        // Nothing is ever removed again: there is no second answer to remove.
        expect(prisma.surveyPendingResponse.deleteMany).not.toHaveBeenCalled();
        // And a later submit is refused as answered.
        await expect(submit()).rejects.toThrow(/already completed/);
        expect(heldCount()).toBe(1);
      });

      it('a submit that read the survey before another completed it is refused at the claim', async () => {
        const row = liveRecipient(anon());
        // Its token lookup still saw it unanswered.
        prisma.surveyRecipient.findUnique.mockImplementation(async (args: any) =>
          args.select ? { status: row.status } : { ...row, status: 'STARTED', response: null, survey: anon() },
        );
        row.status = 'COMPLETED';
        await expect(submit()).rejects.toThrow(/already completed/);
        expect(heldCount()).toBe(0);
      });

      it('opening the form never turns a survey that completed meanwhile back to Started (no second answer)', async () => {
        const row = liveRecipient(anon(), { status: 'SENT' });
        // Opened: Sent → Started.
        await service.getPublicByToken('tok');
        expect(row.status).toBe('STARTED');
        // The form's read saw it Sent, but a submit completed it before the Started mark.
        row.status = 'COMPLETED';
        prisma.surveyRecipient.findUnique.mockImplementation(async (args: any) =>
          args.select ? { status: row.status } : { ...row, status: 'SENT', response: null, survey: anon() },
        );
        await service.getPublicByToken('tok');
        expect(row.status).toBe('COMPLETED');
        expect(prisma.surveyRecipient.update).not.toHaveBeenCalled();
        // So a second unlinked answer is still refused.
        await expect(submit()).rejects.toThrow(/already completed/);
        expect(heldCount()).toBe(0);
      });

      it('crash after the claim (nothing held): refused while the claim stands, answerable once it lapses', async () => {
        const row = liveRecipient(anon(), {
          submitClaim: 'left-by-a-crash',
          submitClaimExpiresAt: submitClaimExpiry(new Date()),
        });
        const refused = await submit().catch((e: any) => e);
        expect(refused.message).toMatch(/already being sent/);
        // Nothing was kept: the app must keep this answer and try again, not drop it as answered.
        expect(refused.getResponse()).toMatchObject({ code: 'SURVEY_ANSWER_IN_PROGRESS' });
        expect(heldCount()).toBe(0);
        // The claim has lapsed (15–30 minutes later).
        row.submitClaimExpiresAt = new Date(Date.now() - 1000);
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(heldCount()).toBe(1);
        expect(row).toMatchObject({ status: 'COMPLETED', submitClaim: null });
      });

      it('if the answers cannot be kept, the claim is given back (the person can simply answer again)', async () => {
        const row = liveRecipient(anon());
        prisma.surveyPendingResponse.create.mockRejectedValueOnce(new Error('database blip'));
        await expect(submit()).rejects.toThrow('database blip');
        expect(row).toMatchObject({ status: 'STARTED', submitClaim: null, submitClaimExpiresAt: null });
        expect(audit.logAudit).not.toHaveBeenCalled();
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(row.status).toBe('COMPLETED');
      });

      it('crash after the hold (marking fails): the answer is kept, a retry is refused while the claim stands, and nothing identifying is logged', async () => {
        const row = liveRecipient(anon());
        prisma.surveyPendingResponse.create.mockResolvedValue({ id: 'held-1' });
        const failing = new Prisma.PrismaClientKnownRequestError('Timed out updating SurveyRecipient r1 (employee emp-1)', {
          code: 'P1008',
          clientVersion: 'test',
        });
        const real = prisma.surveyRecipient.updateMany.getMockImplementation();
        prisma.surveyRecipient.updateMany.mockImplementation(async (args: any) =>
          args.data.status === 'COMPLETED' ? Promise.reject(failing) : real(args),
        );
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(heldCount()).toBe(1);
        expect(prisma.surveyPendingResponse.deleteMany).not.toHaveBeenCalled();
        expect(row.status).toBe('STARTED');
        expect(row.submitClaim).toEqual(expect.any(String));
        expect(logError).toHaveBeenCalledTimes(1);
        const logged = String(logError.mock.calls[0][0]);
        expect(logged).toMatch(/Survey s1: an answer was kept but marking it answered failed \(P1008\)/);
        expect(logged).not.toMatch(/r1|emp-1|tok|Timed out/);
        // A retry while the claim stands is refused before anything is held.
        await expect(submit()).rejects.toThrow(/already being sent/);
        expect(heldCount()).toBe(1);
      });

      it('a mark that fails once is tried again: the person ends up Completed', async () => {
        const row = liveRecipient(anon());
        const real = prisma.surveyRecipient.updateMany.getMockImplementation();
        let failed = false;
        prisma.surveyRecipient.updateMany.mockImplementation(async (args: any) => {
          if (args.data.status === 'COMPLETED' && !failed) {
            failed = true;
            throw new Error('blip');
          }
          return real(args);
        });
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(row).toMatchObject({ status: 'COMPLETED', submitClaim: null });
        expect(logError).not.toHaveBeenCalled();
      });

      it('a claim that lapsed and was taken again before the mark (cannot happen in practice) is logged without the person', async () => {
        const row = liveRecipient(anon());
        prisma.surveyPendingResponse.create.mockImplementation(async (args: any) => {
          row.submitClaim = 'someone-else';
          return { id: 'held-2', ...args.data };
        });
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(prisma.surveyPendingResponse.deleteMany).not.toHaveBeenCalled();
        const logged = String(logError.mock.calls[0][0]);
        expect(logged).toMatch(/Survey s1: an answer was kept after its claim had lapsed/);
        expect(logged).not.toMatch(/r1|emp-1|tok|held-2|someone-else/);
      });

      it('an answer already marked Completed is refused before anything is held', async () => {
        liveRecipient(anon(), { status: 'COMPLETED' });
        await expect(submit()).rejects.toThrow();
        expect(heldCount()).toBe(0);
        expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
      });

      describe('staff recording a named person’s answers on an anonymous survey', () => {
        const body = { channel: 'PAPER', personId: 'emp-1', answers: [{ questionId: 'q1', booleanValue: true }] } as any;
        beforeEach(() => {
          givenSurvey(anon());
          prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
        });

        it('claims the person first: their own racing submit is refused while it stands, and they end up Completed', async () => {
          const row = liveRecipient(anon(), { status: 'SENT' });
          let ownSubmit: Promise<unknown> | null = null;
          prisma.surveyPendingResponse.create.mockImplementation(async (args: any) => {
            // The person submits while staff's answer is being kept.
            ownSubmit ??= submit().catch((e: unknown) => e);
            await ownSubmit;
            return { id: 'held-staff', ...args.data };
          });
          await expect(service.recordResponse(admin, 's1', body)).resolves.toMatchObject({ data: { id: 'held-staff' } });
          expect(String(await ownSubmit)).toMatch(/already being sent/);
          expect(heldCount()).toBe(1);
          expect(row).toMatchObject({ status: 'COMPLETED', submitClaim: null });
        });

        it('already answered: still recorded and never refused (whether they answered is not revealed), nobody marked', async () => {
          const row = liveRecipient(anon(), { status: 'COMPLETED' });
          await expect(service.recordResponse(admin, 's1', body)).resolves.toMatchObject({ message: 'Survey response recorded' });
          expect(heldCount()).toBe(1);
          expect(row).toMatchObject({ status: 'COMPLETED', submitClaim: null });
        });

        it('no recipient yet: one is created already claimed (Started, never Sent), then marked Completed', async () => {
          const units = trackUnits();
          prisma.surveyRecipient.findFirst.mockResolvedValue(null);
          await service.recordResponse(admin, 's1', body);
          const flat = units.flat();
          expect(flat.indexOf('surveyRecipient.create')).toBeLessThan(flat.indexOf('surveyPendingResponse.create'));
          expect(flat.indexOf('surveyPendingResponse.create')).toBeLessThan(flat.lastIndexOf('surveyRecipient.updateMany'));
          const created = prisma.surveyRecipient.create.mock.calls[0][0].data;
          expect(created).toMatchObject({ status: 'STARTED', employeeId: 'emp-1', submitClaim: expect.any(String) });
          expect(created.updatedAt).toEqual(created.createdAt);
          expect(prisma.surveyRecipient.updateMany.mock.calls.at(-1)[0]).toMatchObject({
            where: { submitClaim: created.submitClaim },
            data: { status: 'COMPLETED', submitClaim: null, submitClaimExpiresAt: null },
          });
        });

        it('two staff racing to create the recipient: the second is refused before anything is held', async () => {
          prisma.surveyRecipient.findFirst.mockResolvedValue(null);
          prisma.surveyRecipient.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' }),
          );
          await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(/could not be recorded just now/);
          expect(heldCount()).toBe(0);
        });

        it('no recipient yet and the answer cannot be held: the recipient it created is removed again', async () => {
          prisma.surveyRecipient.findFirst.mockResolvedValue(null);
          prisma.surveyPendingResponse.create.mockRejectedValue(new Error('store unavailable'));
          prisma.surveyRecipient.deleteMany.mockResolvedValue({ count: 1 });
          await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow('store unavailable');
          const created = prisma.surveyRecipient.create.mock.calls[0][0].data;
          expect(created.status).toBe('STARTED');
          // Removed only while still exactly as this recording created it (its claim, Started).
          expect(prisma.surveyRecipient.deleteMany).toHaveBeenCalledWith({
            where: { id: 'surveyRecipient-new', submitClaim: created.submitClaim, status: 'STARTED' },
          });
          // Nothing else touches the row, and nothing about the person is logged.
          expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
          expect(prisma.surveyRecipient.update).not.toHaveBeenCalled();
          expect(logError).not.toHaveBeenCalled();
          expect(audit.logAudit).not.toHaveBeenCalled();
        });

        it('the created recipient changed before it could be removed: its claim is released instead', async () => {
          prisma.surveyRecipient.findFirst.mockResolvedValue(null);
          prisma.surveyPendingResponse.create.mockRejectedValue(new Error('store unavailable'));
          prisma.surveyRecipient.deleteMany.mockResolvedValue({ count: 0 });
          await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow('store unavailable');
          const created = prisma.surveyRecipient.create.mock.calls[0][0].data;
          expect(prisma.surveyRecipient.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: 'surveyRecipient-new', submitClaim: created.submitClaim },
              data: expect.objectContaining({ submitClaim: null, submitClaimExpiresAt: null }),
            }),
          );
        });

        it('a recipient that already existed is only released when the answer cannot be held, never removed', async () => {
          const row = liveRecipient(anon(), { status: 'SENT' });
          prisma.surveyPendingResponse.create.mockRejectedValue(new Error('store unavailable'));
          await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow('store unavailable');
          expect(prisma.surveyRecipient.deleteMany).not.toHaveBeenCalled();
          expect(row).toMatchObject({ status: 'SENT', submitClaim: null });
        });

        it('a failed Completed mark keeps the answer and logs no one', async () => {
          liveRecipient(anon(), { status: 'SENT' });
          prisma.surveyPendingResponse.create.mockResolvedValue({ id: 'held-3' });
          const real = prisma.surveyRecipient.updateMany.getMockImplementation();
          prisma.surveyRecipient.updateMany.mockImplementation(async (args: any) =>
            args.data.status === 'COMPLETED' ? Promise.reject(new Error('rec-emp-1 locked')) : real(args),
          );
          await expect(service.recordResponse(admin, 's1', body)).resolves.toMatchObject({
            message: 'Survey response recorded',
            data: { id: 'held-3' },
          });
          expect(prisma.surveyPendingResponse.deleteMany).not.toHaveBeenCalled();
          const logged = String(logError.mock.calls.at(-1)?.[0]);
          expect(logged).toMatch(/Survey s1: a recorded answer was kept but marking it answered failed \(Error\)/);
          expect(logged).not.toMatch(/emp-1|locked/);
        });
      });

      it('named answers are unchanged: the Completed mark and the response are one transaction', async () => {
        recipientFor(surveyRow({ status: 'ACTIVE' }));
        // A racing submit completed it first.
        const read = prisma.surveyRecipient.findUnique.getMockImplementation();
        prisma.surveyRecipient.findUnique.mockImplementation(async (args: any) =>
          args.select ? { status: 'COMPLETED' } : read!(args),
        );
        prisma.surveyRecipient.updateMany.mockResolvedValue({ count: 0 });
        const refused = await submit().catch((e: any) => e);
        expect(refused.message).toMatch(/already completed/);
        expect(refused.getResponse()).toMatchObject({ code: 'SURVEY_ALREADY_COMPLETED' });
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
      });

      it('a named answer waits for an unlinked one in progress for the same person (no claim taken over)', async () => {
        const row = liveRecipient(surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }), {
          submitClaim: 'without-my-name-in-progress',
          submitClaimExpiresAt: submitClaimExpiry(new Date()),
        });
        // Not "already completed": a claim a failed submit left (nothing kept) looks the same, and
        // that person has not answered — they are told to try again, with the in-progress code.
        const refused = await submit().catch((e: any) => e);
        expect(refused.message).toMatch(/already being sent/);
        expect(refused.getResponse()).toMatchObject({ code: 'SURVEY_ANSWER_IN_PROGRESS' });
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(row.status).toBe('STARTED');
        // Without a claim, a named answer is written exactly as before.
        row.submitClaim = null;
        row.submitClaimExpiresAt = null;
        await expect(submit()).resolves.toMatchObject({ message: 'Survey response submitted' });
        expect(prisma.surveyResponse.create.mock.calls[0][0].data.recipientId).toBe('r1');
        expect(row.status).toBe('COMPLETED');
      });
    });

    it('own answers stay unavailable for held answers', async () => {
      prisma.surveyRecipient.findFirst.mockResolvedValue({
        status: 'COMPLETED',
        survey: { title: 'Staff survey', isAnonymous: true },
        response: null,
      });
      await expect(service.getEmployeeAppAnswers('emp-1', 'tok')).rejects.toThrow(
        /anonymous survey are not kept against your name/,
      );
      prisma.surveyRecipient.findFirst.mockResolvedValue({
        status: 'COMPLETED',
        survey: { title: 'Staff survey', isAnonymous: false },
        response: null,
      });
      await expect(service.getEmployeeAppAnswers('emp-1', 'tok')).rejects.toThrow(/without your name/);
    });

    describe('results before and after the held answers are written', () => {
      const answerRow = (n: number) => ({
        booleanValue: true,
        textValue: null,
        numberValue: null,
        selectedOptions: null,
        otherText: null,
        comment: null,
        response: { id: `resp-${n}`, isAnonymous: false, channel: 'ONLINE', recipient: null },
        question: { ...question(), surveyId: 's1' },
      });
      const given = (opts: { status: string; written: number; waiting: number }) => {
        givenSurvey(surveyRow({ isAnonymous: true, status: opts.status }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        prisma.surveyRecipient.groupBy.mockResolvedValue([
          { surveyId: 's1', status: 'COMPLETED', _count: { _all: opts.written + opts.waiting } },
          { surveyId: 's1', status: 'SENT', _count: { _all: 2 } },
        ]);
        prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
          args.by[0] === 'surveyId'
            ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: opts.written } }]
            : [],
        );
        prisma.surveyPendingResponse.groupBy.mockResolvedValue(
          opts.waiting
            ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: opts.waiting } }]
            : [],
        );
        prisma.surveyAnswer.findMany.mockResolvedValue(Array.from({ length: opts.written }, (_, i) => answerRow(i)));
      };

      it('held answers are counted as responses but none of their answers are shown', async () => {
        given({ status: 'ACTIVE', written: 5, waiting: 3 });
        const res: any = await service.results(admin, 's1');
        expect(res.data).toMatchObject({ completed: 8, responses: 8, responsesBeingAdded: 3 });
        expect(res.data.responsesBeingAddedNote).toMatch(/^3 responses are counted but not yet in the answers/);
        expect(res.data.questionSummaries[0].answerCount).toBe(5);
        expect(res.data.questionSummaries[0].options.find((o: any) => o.label === 'Yes').count).toBe(5);
      });

      it('after they are written the totals are the same and their answers are in', async () => {
        given({ status: 'CLOSED', written: 8, waiting: 0 });
        const res: any = await service.results(admin, 's1');
        expect(res.data).toMatchObject({
          completed: 8,
          responses: 8,
          responsesBeingAdded: 0,
          responsesBeingAddedNote: null,
        });
        expect(res.data.questionSummaries[0].answerCount).toBe(8);
      });

      it('the responses list counts them in its total without listing them', async () => {
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        prisma.surveyPendingResponse.groupBy.mockResolvedValue([
          { surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 2 } },
        ]);
        const res: any = await service.listResponses(admin, 's1');
        expect(res.data).toMatchObject({ total: 2, responses: [], responsesBeingAdded: 2 });
      });

      it('named survey: held answers given without a name are explained once (as held back), not twice', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
          args.by[0] === 'surveyId' ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 4 } }] : [],
        );
        prisma.surveyPendingResponse.groupBy.mockResolvedValue([
          { surveyId: 's1', isAnonymous: true, channel: 'ONLINE', _count: { _all: 2 } },
        ]);
        const res: any = await service.results(admin, 's1');
        expect(res.data).toMatchObject({
          responses: 6,
          answeredWithoutName: 2,
          withoutNameAnswersHeldBack: 2,
          responsesBeingAdded: 0,
          responsesBeingAddedNote: null,
        });
      });

      it('the survey and the survey list count them as responses (and questions lock)', async () => {
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        prisma.surveyPendingResponse.count.mockResolvedValue(1);
        const detail: any = await service.getById(admin, 's1');
        expect(detail.data).toMatchObject({ responseCount: 1, questionsLocked: true, settingsLocked: true });

        prisma.survey.findMany.mockResolvedValue([
          {
            ...surveyRow({ isAnonymous: true, status: 'ACTIVE' }),
            _count: { questions: 1, recipients: 6, responses: 2, clones: 0 },
          },
        ]);
        prisma.surveyPendingResponse.groupBy.mockResolvedValue([
          { surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 3 } },
        ]);
        const list: any = await service.list(admin, {} as any);
        expect(list.data[0].responseCount).toBe(5);
      });

      it('a question cannot be reworded when the only answers are still held', async () => {
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        prisma.surveyQuestion.findFirst.mockResolvedValue(question());
        prisma.surveyPendingResponse.count.mockResolvedValue(1);
        await expect(
          service.updateQuestion(admin, 's1', 'q1', { questionText: 'Reworded?' } as any),
        ).rejects.toThrow(/already answered this survey/);
      });
    });

    describe('closing', () => {
      it('writes the held answers before the results are kept as CQC evidence', async () => {
        const order: string[] = [];
        const cqc = {
          onSurveyClosed: jest.fn(async () => {
            order.push('cqc');
          }),
        };
        const withCqc = new SurveysService(
          prisma,
          audit as any,
          config as any,
          mail as any,
          push as any,
          notifications as any,
          new OrgScopeService(prisma),
          orgSettings as any,
          cqc as any,
        );
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        const rows = [1, 2].map((n) => ({
          id: `held-${n}`,
          surveyId: 's1',
          isAnonymous: false,
          channel: 'ONLINE',
          createdAt: new Date('2026-11-04T00:00:00.000Z'),
          payload: { locationId: null, respondentRelation: null, answers: [] },
        }));
        prisma.surveyPendingResponse.groupBy.mockResolvedValue([{ surveyId: 's1', _count: { _all: 2 } }]);
        prisma.surveyPendingResponse.findMany.mockResolvedValue(rows);
        prisma.surveyPendingResponse.deleteMany.mockResolvedValue({ count: 2 });
        prisma.surveyResponse.createMany.mockImplementation(async (args: any) => {
          for (const _ of args.data) order.push('write');
          return { count: args.data.length };
        });
        await withCqc.close(admin, 's1');
        // Forced for this survey: fewer than a batch, but it is closing.
        expect(prisma.surveyPendingResponse.groupBy.mock.calls[0][0].where).toEqual({ surveyId: { in: ['s1'] } });
        expect(order).toEqual(['write', 'write', 'cqc']);
      });

      it('a failed write never fails the close (the job and the CQC capture write them too)', async () => {
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
        prisma.surveyPendingResponse.groupBy.mockRejectedValue(new Error('database blip'));
        await expect(service.close(admin, 's1')).resolves.toMatchObject({ message: 'Survey closed' });
      });
    });

    describe('dates of held answers', () => {
      it('written out on a later day: the response and its answers take that day (organisation time zone), not the day given', async () => {
        jest.useFakeTimers({ now: new Date('2026-11-04T09:30:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
        try {
          recipientFor(surveyRow({ isAnonymous: true, status: 'ACTIVE' }));
          prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
          await service.submitPublicResponse('tok', { answers: [{ questionId: 'q1', booleanValue: true }] });
          expect(held().createdAt).toEqual(new Date('2026-11-04T00:00:00.000Z'));

          const rows = prisma.surveyPendingResponse.create.mock.calls.map((c: any[], i: number) => ({ id: `held-${i}`, ...c[0].data }));
          prisma.surveyPendingResponse.groupBy.mockResolvedValue([{ surveyId: 's1', _count: { _all: rows.length } }]);
          prisma.surveyPendingResponse.findMany.mockResolvedValue(rows);
          prisma.surveyPendingResponse.deleteMany.mockResolvedValue({ count: rows.length });
          orgSettings.getOperationalTimezone.mockResolvedValueOnce('America/New_York');
          // 02:00 UTC on 10 November is still 9 November in New York.
          await service.flushPendingResponses({ now: new Date('2026-11-10T02:00:00.000Z'), force: true });
          const day = new Date('2026-11-09T05:00:00.000Z'); // midnight, 9 November, New York
          const response = prisma.surveyResponse.createMany.mock.calls[0][0].data[0];
          expect(response).toMatchObject({ submittedAt: day, createdAt: day, updatedAt: day });
          const answer = prisma.surveyAnswer.createMany.mock.calls[0][0].data[0];
          expect(answer).toMatchObject({ createdAt: day, updatedAt: day });
        } finally {
          jest.useRealTimers();
        }
      });

      it('answers written straight away (named, or recorded as anonymous) keep their own dates, as before', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        await service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          isAnonymous: true,
          contactedAt: '2026-11-02T10:00:00.000Z',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any);
        const data = prisma.surveyResponse.create.mock.calls[0][0].data;
        expect(data.contactedAt).toEqual(new Date('2026-11-02T00:00:00.000Z'));
      });
    });

    describe('late answers for results already kept as CQC evidence', () => {
      it('writing them marks the survey’s capture to be taken again', async () => {
        const rows = [1].map((n) => ({
          id: `held-${n}`,
          surveyId: 'p1',
          isAnonymous: false,
          channel: 'ONLINE',
          createdAt: new Date('2026-11-04T00:00:00.000Z'),
          payload: { locationId: null, respondentRelation: null, answers: [] },
        }));
        prisma.surveyPendingResponse.groupBy.mockResolvedValue([{ surveyId: 'p1', _count: { _all: 1 } }]);
        prisma.survey.findMany.mockResolvedValue([{ id: 'p1', status: 'CLOSED', closesAt: null, deletedAt: null }]);
        prisma.surveyPendingResponse.findMany.mockResolvedValue(rows);
        prisma.surveyPendingResponse.deleteMany.mockResolvedValue({ count: 1 });
        prisma.cqcSurveyCapture.updateMany.mockResolvedValue({ count: 1 });
        await service.flushPendingResponses({ now: new Date('2026-11-20T10:00:00.000Z') });
        expect(prisma.cqcSurveyCapture.updateMany).toHaveBeenCalledWith({
          where: { surveyId: 'p1' },
          data: { surveyUpdatedAt: new Date(0) },
        });
      });
    });

    describe('staff recording an anonymous paper or phone response', () => {
      it('does not need the contact-me question, and discards an answer to it', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ()]);
        await service.recordResponse(admin, 's1', {
          channel: 'PAPER',
          isAnonymous: true,
          answers: [
            { questionId: 'q1', booleanValue: true },
            { questionId: 'q-contact', booleanValue: true },
          ],
        } as any);
        expect(
          prisma.surveyResponse.create.mock.calls[0][0].data.answers.create.map((a: any) => a.questionId),
        ).toEqual(['q1']);
      });

      it('a named recording still has to answer it', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question(), contactQ()]);
        await expect(
          service.recordResponse(admin, 's1', {
            channel: 'PAPER',
            personId: 'su-1',
            answers: [{ questionId: 'q1', booleanValue: true }],
          } as any),
        ).rejects.toThrow(/Answer required for: Would you like someone to contact you/);
      });

      it('cannot record on a closed survey or on a repeating survey itself (nothing is held there)', async () => {
        const body = {
          channel: 'PAPER',
          personId: 'su-1',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any;
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED', targetKind: 'SERVICE_USER' }));
        await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(/closed/);
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', targetKind: 'SERVICE_USER', recurrence: 'MONTHLY' }));
        await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(/period it belongs to/);
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', targetKind: 'SERVICE_USER' }));
        prisma.survey.count.mockResolvedValue(2); // a stopped repeating survey with periods
        await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(/period it belongs to/);
        expect(prisma.surveyRecipient.updateMany).not.toHaveBeenCalled();
        expect(prisma.surveyRecipient.create).not.toHaveBeenCalled();
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        // A period of a repeating survey can be recorded on.
        prisma.survey.count.mockResolvedValue(0);
        givenSurvey(surveyRow({ isAnonymous: true, status: 'ACTIVE', targetKind: 'SERVICE_USER', clonedFromId: 'src' }));
        prisma.surveyRecipient.findFirst.mockResolvedValue(null);
        prisma.surveyRecipient.create.mockResolvedValue({ id: 'r-new' });
        prisma.surveyPendingResponse.create.mockResolvedValue({ id: 'held-1' });
        prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
        await expect(service.recordResponse(admin, 's1', body)).resolves.toMatchObject({ message: 'Survey response recorded' });
      });

      it('accepted: the same refusals apply to named surveys and to anonymous recordings', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const named = { channel: 'PAPER', personId: 'su-1', answers: [{ questionId: 'q1', booleanValue: true }] } as any;
        const unnamed = { channel: 'TELEPHONE', isAnonymous: true, consentGiven: true, answers: named.answers } as any;
        for (const body of [named, unnamed]) {
          givenSurvey(surveyRow({ status: 'CLOSED', targetKind: 'SERVICE_USER' }));
          await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(
            'This survey is closed. Reopen it before recording responses.',
          );
          givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'SERVICE_USER', recurrence: 'WEEKLY' }));
          await expect(service.recordResponse(admin, 's1', body)).rejects.toThrow(
            'This survey repeats on a schedule. Record the response on the period it belongs to.',
          );
        }
        expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
        expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
      });
    });

    describe('respondent wording', () => {
      it('forms and the carer app say staff can see they answered, not which answers are theirs', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'PUBLIC', allowAnonymousResponses: true }));
        prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
        const form: any = await service.getPublicByToken('share-token-1');
        expect(form.data.answerWithoutNameNote).toBe(
          'Staff can see that you have answered, but not which answers are yours.',
        );
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'PUBLIC' }));
        expect(((await service.getPublicByToken('share-token-1')) as any).data.answerWithoutNameNote).toBeNull();

        prisma.surveyRecipient.findMany.mockResolvedValue([
          {
            token: 'tok',
            status: 'SENT',
            sentAt: null,
            survey: surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }),
            response: null,
          },
        ]);
        const app: any = await service.listForEmployeeApp('emp-1', new Date('2026-11-05T10:00:00.000Z'));
        expect(app.data[0].answerWithoutNameNote).toMatch(/^Staff can see that you have answered/);
      });
    });

    describe('New survey: "Let people choose to answer without their name"', () => {
      it('a copy can turn it on or off (never on an anonymous copy)', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        await service.duplicate(admin, 's1', { allowAnonymousResponses: true } as any);
        expect(prisma.survey.create.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);
        givenSurvey(surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }));
        await service.duplicate(admin, 's1', { allowAnonymousResponses: false } as any);
        expect(prisma.survey.create.mock.calls[1][0].data.allowAnonymousResponses).toBe(false);
        await service.duplicate(admin, 's1', { isAnonymous: true, allowAnonymousResponses: true } as any);
        expect(prisma.survey.create.mock.calls[2][0].data.allowAnonymousResponses).toBe(false);
      });

      it('stays on when the ready-made survey promises it', async () => {
        const template = surveyRow({
          id: 't1',
          isTemplate: true,
          libraryReference: 'SUR-PWS-003',
          librarySourceId: 'cat-1',
          allowAnonymousResponses: true,
        });
        prisma.survey.findFirst.mockImplementation(async (args: any) =>
          args?.where?.isCatalogue === true
            ? { isAnonymous: false, allowAnonymousResponses: true }
            : args?.where?.id === 't1'
              ? template
              : null,
        );
        await service.duplicate(admin, 't1', { title: 'Ours' } as any);
        expect(prisma.survey.create.mock.calls[0][0].data.allowAnonymousResponses).toBe(true);
        await expect(service.duplicate(admin, 't1', { allowAnonymousResponses: false } as any)).rejects.toThrow(
          /ready-made survey SUR-PWS-003/,
        );
      });

      it('the duplicate DTO accepts the setting', async () => {
        const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
        const dto = await pipe.transform(
          { allowAnonymousResponses: true },
          { type: 'body', metatype: DuplicateSurveyDto },
        );
        expect(dto.allowAnonymousResponses).toBe(true);
      });
    });
  });

  /* ─── Results page: participation, how people answered, headline ─────────── */

  describe('results: participation, how people answered and the headline', () => {
    const day = new Date('2026-11-02T00:00:00.000Z');
    let seq = 0;
    /** One answer row as the results query returns it. */
    const ans = (
      q: any,
      value: Record<string, unknown>,
      response: { id: string; isAnonymous?: boolean; channel?: string; submittedAt?: Date },
    ) => ({
      booleanValue: null,
      textValue: null,
      numberValue: null,
      selectedOptions: null,
      otherText: null,
      comment: null,
      ...value,
      id: `a-${(seq += 1)}`,
      response: {
        isAnonymous: false,
        channel: 'ONLINE',
        submittedAt: day,
        recipient: null,
        ...response,
      },
      question: { sourceQuestionId: null, otherOption: null, config: null, ...q },
    });
    const respGroups = (rows: Array<[string, boolean, string, number]>) =>
      rows.map(([surveyId, isAnonymous, channel, n]) => ({ surveyId, isAnonymous, channel, _count: { _all: n } }));
    /** Response groups by how they were given, and by who answered (respondentRelation first). */
    const givenResponses = (groups: any[], byRelation: any[] = []) =>
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'surveyId' ? groups : args.by[0] === 'respondentRelation' ? byRelation : [],
      );
    const givenRecipients = (rows: Array<[string, string, number]>) =>
      prisma.surveyRecipient.groupBy.mockResolvedValue(
        rows.map(([surveyId, status, n]) => ({ surveyId, status, _count: { _all: n } })),
      );

    describe('participation', () => {
      it('counts sent to, answered, rate, opened but not finished and not opened yet', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        givenRecipients([
          ['s1', 'PENDING', 1],
          ['s1', 'SENT', 3],
          ['s1', 'STARTED', 2],
          ['s1', 'COMPLETED', 4],
        ]);
        givenResponses(respGroups([['s1', false, 'ONLINE', 4], ['s1', false, 'TELEPHONE', 1]]));
        const res: any = await service.results(admin, 's1');
        expect(res.data.participation).toMatchObject({
          sentTo: 10,
          answered: 5,
          answeredFromSent: 4,
          responseRate: 40,
          openedNotFinished: 2,
          notOpened: 4,
          answeredThroughLink: null,
          recordedByStaff: null,
        });
      });

      it('repeating survey: adds up every period', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', recurrence: 'MONTHLY' }));
        prisma.survey.findMany.mockResolvedValue([
          { id: 'p2', title: 'Staff survey — Nov 2026', periodKey: '2026-11', opensAt: null, closesAt: null, status: 'ACTIVE' },
          { id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10', opensAt: null, closesAt: null, status: 'CLOSED' },
        ]);
        givenRecipients([
          ['p1', 'COMPLETED', 3],
          ['p1', 'SENT', 2],
          ['p2', 'STARTED', 1],
          ['p2', 'COMPLETED', 1],
          ['p2', 'PENDING', 3],
        ]);
        givenResponses(respGroups([['p1', false, 'ONLINE', 3], ['p2', false, 'ONLINE', 1]]));
        const res: any = await service.results(admin, 's1');
        expect(res.data.participation).toMatchObject({
          sentTo: 10,
          answered: 4,
          answeredFromSent: 4,
          responseRate: 40,
          openedNotFinished: 1,
          notOpened: 5,
        });
      });

      it('public survey: no sent to, rate or not opened; answered through the link and recorded by staff', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'PUBLIC' }));
        givenResponses(respGroups([['s1', false, 'ONLINE', 7], ['s1', false, 'PAPER', 2], ['s1', false, 'TELEPHONE', 1]]));
        const res: any = await service.results(admin, 's1');
        expect(res.data.participation).toMatchObject({
          sentTo: null,
          answeredFromSent: null,
          responseRate: null,
          openedNotFinished: null,
          notOpened: null,
          answered: 10,
          answeredThroughLink: 7,
          recordedByStaff: 3,
        });
      });
    });

    describe('answered every question or skipped some', () => {
      /** Questions that were on the form before anyone answered. */
      const oldQ = (o: Record<string, unknown>) => question({ createdAt: new Date('2026-10-01T00:00:00.000Z'), ...o });
      const yesNo = oldQ({ id: 'q1', key: 'q-care', questionText: 'Are you happy with your care?', isRequired: true });
      const why = oldQ({
        id: 'q2',
        key: 'q-why',
        questionType: 'TEXTAREA',
        questionText: 'What could be better?',
        isRequired: false,
        sortOrder: 1,
        showIf: { questionKey: 'q-care', answers: ['No'] },
      });
      const extra = oldQ({ id: 'q3', key: 'q-extra', questionType: 'TEXT', questionText: 'Anything else?', isRequired: false, sortOrder: 2 });
      const contact = oldQ({
        id: 'q4',
        key: 'q-contact',
        questionText: 'Would you like someone to contact you about your answers?',
        isRequired: false,
        sortOrder: 3,
      });
      const qs = [yesNo, why, extra, contact];
      const qRow = (q: any) => ({ id: q.id, surveyId: 's1', questionType: q.questionType, questionText: q.questionText, options: null, sortOrder: q.sortOrder });

      it('counts only the questions that applied: an unmet "Show only if" was not asked', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        prisma.surveyQuestion.findMany.mockResolvedValue(qs);
        givenResponses(respGroups([['s1', false, 'ONLINE', 3]]));
        prisma.surveyAnswer.findMany.mockResolvedValue([
          // Yes: "What could be better?" was not asked; answered the rest → every question.
          ans(qRow(yesNo), { booleanValue: true }, { id: 'r1' }),
          ans(qRow(extra), { textValue: 'Thanks' }, { id: 'r1' }),
          ans(qRow(contact), { booleanValue: false }, { id: 'r1' }),
          // No: "What could be better?" was asked and left blank → skipped some.
          ans(qRow(yesNo), { booleanValue: false }, { id: 'r2' }),
          ans(qRow(extra), { textValue: 'Fine' }, { id: 'r2' }),
          ans(qRow(contact), { booleanValue: true }, { id: 'r2' }),
        ]);
        const res: any = await service.results(admin, 's1');
        // r3 gave no answers at all (everything optional left blank): skipped some.
        expect(res.data.participation).toMatchObject({
          answeredEveryQuestion: 1,
          skippedSomeQuestions: 2,
          responsesInFigures: 3,
        });
      });

      it('the contact-me question is not asked of anyone answering without a name, nor on anonymous surveys', async () => {
        const unlinked = async (survey: any, isAnonymous: boolean) => {
          givenSurvey(survey);
          prisma.surveyQuestion.findMany.mockResolvedValue(qs);
          givenResponses(respGroups([['s1', isAnonymous, 'PAPER', 1]]));
          prisma.surveyAnswer.findMany.mockResolvedValue([
            ans(qRow(yesNo), { booleanValue: true }, { id: 'r1', isAnonymous, channel: 'PAPER' }),
            ans(qRow(extra), { textValue: 'x' }, { id: 'r1', isAnonymous, channel: 'PAPER' }),
          ]);
          return ((await service.results(admin, 's1')) as any).data.participation;
        };
        expect(await unlinked(surveyRow({ status: 'ACTIVE' }), true)).toMatchObject({ answeredEveryQuestion: 1, skippedSomeQuestions: 0 });
        expect(await unlinked(surveyRow({ status: 'ACTIVE', isAnonymous: true }), false)).toMatchObject({
          answeredEveryQuestion: 1,
          skippedSomeQuestions: 0,
        });
        // A named answer that left it blank skipped it.
        expect(await unlinked(surveyRow({ status: 'ACTIVE' }), false)).toMatchObject({ answeredEveryQuestion: 0, skippedSomeQuestions: 1 });
      });

      it('a question added after someone answered was not on their form', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE' }));
        const later = { ...extra, createdAt: new Date('2026-11-04T10:00:00.000Z') };
        prisma.surveyQuestion.findMany.mockResolvedValue([{ ...yesNo, createdAt: new Date('2026-10-01') }, later]);
        givenResponses(respGroups([['s1', false, 'ONLINE', 2]]));
        prisma.surveyAnswer.findMany.mockResolvedValue([
          ans(qRow(yesNo), { booleanValue: true }, { id: 'before', submittedAt: new Date('2026-11-03T09:00:00.000Z') }),
          ans(qRow(yesNo), { booleanValue: true }, { id: 'after', submittedAt: new Date('2026-11-05T09:00:00.000Z') }),
        ]);
        const res: any = await service.results(admin, 's1');
        expect(res.data.participation).toMatchObject({ answeredEveryQuestion: 1, skippedSomeQuestions: 1 });
      });

      it('repeating survey: each period is judged by its own copy of the questions', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', recurrence: 'MONTHLY' }));
        prisma.survey.findMany.mockResolvedValue([
          { id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10', opensAt: null, closesAt: null, status: 'CLOSED' },
        ]);
        const own = [oldQ({ id: 'src-1', key: 'q-a', questionText: 'Q A' })];
        const periodQs = [
          { ...oldQ({ id: 'p1-1', key: 'q-a', questionText: 'Q A' }), surveyId: 'p1' },
          { ...oldQ({ id: 'p1-2', key: 'q-b', questionText: 'Q B', isRequired: false }), surveyId: 'p1' },
        ];
        prisma.surveyQuestion.findMany.mockImplementation(async (args: any) =>
          args.where.surveyId?.in ? periodQs : own,
        );
        givenResponses(respGroups([['p1', false, 'ONLINE', 2]]));
        const pq = (q: any) => ({ id: q.id, surveyId: 'p1', sourceQuestionId: 'src-1', questionType: 'YES_NO', questionText: q.questionText, options: null, sortOrder: 0 });
        prisma.surveyAnswer.findMany.mockResolvedValue([
          ans(pq(periodQs[0]), { booleanValue: true }, { id: 'r1' }),
          ans(pq(periodQs[1]), { booleanValue: true }, { id: 'r1' }),
          ans(pq(periodQs[0]), { booleanValue: true }, { id: 'r2' }),
        ]);
        const res: any = await service.results(admin, 's1');
        expect(prisma.surveyQuestion.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { surveyId: { in: ['p1'] }, deletedAt: null, isActive: true } }),
        );
        expect(res.data.participation).toMatchObject({ answeredEveryQuestion: 1, skippedSomeQuestions: 1 });
      });

      describe('anonymity', () => {
        it('answers given without a name that are held back are left out (the totals less the named ones would be theirs)', async () => {
          // Named survey, open: 3 named responses (visible by name) and 2 given without a name.
          givenSurvey(surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }));
          prisma.surveyQuestion.findMany.mockResolvedValue([yesNo, extra]);
          givenResponses(respGroups([['s1', false, 'ONLINE', 3], ['s1', true, 'ONLINE', 2]]));
          const named = (id: string) => [
            ans(qRow(yesNo), { booleanValue: true }, { id }),
            ans(qRow(extra), { textValue: 'ok' }, { id }),
          ];
          const unnamed = (id: string) => [ans(qRow(yesNo), { booleanValue: true }, { id, isAnonymous: true })];
          prisma.surveyAnswer.findMany.mockResolvedValue([...named('n1'), ...named('n2'), ...named('n3'), ...unnamed('w1'), ...unnamed('w2')]);
          const open: any = await service.results(admin, 's1');
          // Only the named three: the two who skipped "Anything else?" without a name do not show.
          expect(open.data.participation).toMatchObject({
            answered: 5,
            answeredEveryQuestion: 3,
            skippedSomeQuestions: 0,
            responsesInFigures: 3,
          });
          expect(open.data.withoutNameAnswersHeldBack).toBe(2);
        });

        it('responses still waiting in the pending store are counted as answered but never judged', async () => {
          givenSurvey(surveyRow({ status: 'ACTIVE', isAnonymous: true }));
          prisma.surveyQuestion.findMany.mockResolvedValue([yesNo, extra]);
          givenResponses(respGroups([['s1', false, 'ONLINE', 5]]));
          prisma.surveyPendingResponse.groupBy.mockResolvedValue(respGroups([['s1', false, 'ONLINE', 1]]));
          prisma.surveyAnswer.findMany.mockResolvedValue(
            ['a', 'b', 'c', 'd', 'e'].map((id) => ans(qRow(yesNo), { booleanValue: true }, { id })),
          );
          const res: any = await service.results(admin, 's1');
          expect(res.data.participation).toMatchObject({
            answered: 6,
            responsesInFigures: 5,
            answeredEveryQuestion: 0,
            skippedSomeQuestions: 5,
          });
        });
      });
    });

    describe('how people answered', () => {
      const breakdown = (res: any, dimension: string) =>
        res.data.howPeopleAnswered.find((b: any) => b.dimension === dimension);

      it('named staff survey: by channel; answers given online without a name are one group, never split', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', allowAnonymousResponses: true }));
        givenResponses(
          respGroups([
            ['s1', false, 'ONLINE', 6],
            ['s1', false, 'TELEPHONE', 1],
            ['s1', true, 'PAPER', 1],
            ['s1', true, 'ONLINE', 1],
          ]),
        );
        prisma.surveyPendingResponse.groupBy.mockResolvedValue(respGroups([['s1', true, 'ONLINE', 1]]));
        const res: any = await service.results(admin, 's1');
        expect(res.data.howPeopleAnswered.map((b: any) => b.dimension)).toEqual(['channel']);
        expect(breakdown(res, 'channel')).toMatchObject({
          suppressed: false,
          groups: [
            { key: 'ONLINE', label: 'Survey link or carer app', responses: 6 },
            { key: 'without-name', label: 'Online, without a name', responses: 2 },
            { key: 'PAPER', label: 'Paper', responses: 1 },
            { key: 'TELEPHONE', label: 'Phone', responses: 1 },
          ],
        });
      });

      it('named service-user survey: who answered, with answers given without a name as "Not recorded"', async () => {
        givenSurvey(surveyRow({ status: 'ACTIVE', targetKind: 'SERVICE_USER', allowAnonymousResponses: true }));
        givenResponses(
          respGroups([['s1', false, 'PORTAL', 5], ['s1', false, 'IN_PERSON', 2], ['s1', true, 'PORTAL', 1]]),
          [
            { respondentRelation: 'SELF', surveyId: 's1', isAnonymous: false, _count: { _all: 3 } },
            { respondentRelation: 'FAMILY_MEMBER', surveyId: 's1', isAnonymous: false, _count: { _all: 2 } },
            { respondentRelation: 'STAFF', surveyId: 's1', isAnonymous: false, _count: { _all: 2 } },
            { respondentRelation: null, surveyId: 's1', isAnonymous: true, _count: { _all: 1 } },
          ],
        );
        prisma.surveyPendingResponse.count.mockResolvedValue(2);
        const res: any = await service.results(admin, 's1');
        expect(breakdown(res, 'channel').groups).toEqual([
          { key: 'PORTAL', label: 'Portal', responses: 5 },
          { key: 'IN_PERSON', label: 'Visit', responses: 2 },
          { key: 'without-name', label: 'Portal or survey link, without a name', responses: 1 },
        ]);
        expect(breakdown(res, 'respondent').groups).toEqual([
          { key: 'unknown', label: 'Not recorded', responses: 3 },
          { key: 'SELF', label: 'The person themselves', responses: 3 },
          { key: 'FAMILY_MEMBER', label: 'A family member', responses: 2 },
          { key: 'STAFF', label: 'Staff on their behalf', responses: 2 },
        ]);
      });

      describe('anonymous surveys', () => {
        it('nothing while open: watching a count tick up would show who just answered', async () => {
          givenSurvey(surveyRow({ status: 'ACTIVE', isAnonymous: true, targetKind: 'SERVICE_USER' }));
          givenResponses(respGroups([['s1', false, 'PORTAL', 12]]));
          const res: any = await service.results(admin, 's1');
          for (const dimension of ['channel', 'respondent']) {
            expect(breakdown(res, dimension)).toMatchObject({ suppressed: true, groups: [] });
            expect(breakdown(res, dimension).note).toMatch(/once the survey is closed/);
          }
          expect(prisma.surveyResponse.groupBy.mock.calls.some((c: any[]) => c[0].by[0] === 'respondentRelation')).toBe(false);
        });

        it('once closed: groups under 5 are combined, or withheld when the combined group is still under 5', async () => {
          givenSurvey(surveyRow({ status: 'CLOSED', isAnonymous: true, targetKind: 'SERVICE_USER' }));
          givenResponses(respGroups([['s1', false, 'PORTAL', 9], ['s1', false, 'TELEPHONE', 3], ['s1', false, 'PAPER', 1]]), [
            { respondentRelation: 'SELF', surveyId: 's1', isAnonymous: false, _count: { _all: 8 } },
            { respondentRelation: 'FAMILY_MEMBER', surveyId: 's1', isAnonymous: false, _count: { _all: 3 } },
            { respondentRelation: 'STAFF', surveyId: 's1', isAnonymous: false, _count: { _all: 2 } },
          ]);
          const res: any = await service.results(admin, 's1');
          // 3 by phone + 1 on paper = 4: still fewer than 5, so channel is withheld altogether.
          expect(breakdown(res, 'channel')).toMatchObject({ suppressed: true, groups: [] });
          expect(breakdown(res, 'channel').note).toMatch(/fewer than 5/);
          // 3 + 2 = 5 combined.
          expect(breakdown(res, 'respondent')).toMatchObject({
            suppressed: false,
            groups: [
              { key: 'SELF', responses: 8 },
              { key: 'other', label: 'Other groups (combined)', responses: 5 },
            ],
          });
        });

        it('repeating survey: closed periods only', async () => {
          givenSurvey(surveyRow({ status: 'ACTIVE', isAnonymous: true, recurrence: 'MONTHLY' }));
          prisma.survey.findMany.mockResolvedValue([
            { id: 'p2', title: 'Staff survey — Nov 2026', periodKey: '2026-11', opensAt: null, closesAt: null, status: 'ACTIVE' },
            { id: 'p1', title: 'Staff survey — Oct 2026', periodKey: '2026-10', opensAt: null, closesAt: null, status: 'CLOSED' },
          ]);
          // The open period has 5 (the threshold): below it, it would be left out of every figure.
          givenResponses(respGroups([['p1', false, 'ONLINE', 6], ['p2', false, 'ONLINE', 5]]));
          const res: any = await service.results(admin, 's1');
          expect(breakdown(res, 'channel')).toMatchObject({
            suppressed: false,
            groups: [{ key: 'ONLINE', responses: 6 }],
            note: 'Closed periods only.',
          });
        });
      });
    });

    describe('percentages, not-counted answers, top two and the headline', () => {
      const overall = question({
        id: 'q-ov',
        key: 'q-overall',
        questionType: 'SINGLE_SELECT',
        questionText: 'Overall, how was your experience of our service?',
        options: ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor', "Don't know"],
        config: { notCountedOptions: ["Don't know"] },
      });
      const often = question({
        id: 'q-often',
        key: 'q-often',
        questionType: 'LIKERT',
        questionText: 'Do your care workers arrive on time?',
        options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'],
        sortOrder: 1,
      });
      const row = (q: any) => ({ id: q.id, surveyId: 's1', questionType: q.questionType, questionText: q.questionText, options: q.options, config: q.config ?? null, sortOrder: q.sortOrder });
      const pick = (q: any, labels: string[], id: string) => ans(row(q), { selectedOptions: labels }, { id });

      beforeEach(() => {
        givenSurvey(surveyRow({ status: 'CLOSED', targetKind: 'SERVICE_USER' }));
        prisma.surveyQuestion.findMany.mockResolvedValue([overall, often]);
        givenResponses(respGroups([['s1', false, 'PORTAL', 5]]));
        prisma.surveyAnswer.findMany.mockResolvedValue([
          pick(overall, ['Very good'], 'r1'),
          pick(overall, ['Good'], 'r2'),
          pick(overall, ['Poor'], 'r3'),
          pick(overall, ["Don't know"], 'r4'),
          pick(often, ['Always'], 'r1'),
          pick(often, ['Sometimes'], 'r2'),
        ]);
      });

      it('answers marked not counted are shown with their count but left out of every percentage', async () => {
        const res: any = await service.results(admin, 's1');
        const s = res.data.questionSummaries.find((q: any) => q.questionId === 'q-ov');
        expect(s).toMatchObject({ answerCount: 4, countedAnswers: 3 });
        expect(s.options).toEqual([
          { label: 'Very good', count: 1, percent: 33, notCounted: false },
          { label: 'Good', count: 1, percent: 33, notCounted: false },
          { label: 'Neither good nor poor', count: 0, percent: 0, notCounted: false },
          { label: 'Poor', count: 1, percent: 33, notCounted: false },
          { label: 'Very poor', count: 0, percent: 0, notCounted: false },
          { label: "Don't know", count: 1, percent: null, notCounted: true },
        ]);
      });

      it('top two for each scale question, and the headline from the overall question (found by its key)', async () => {
        const res: any = await service.results(admin, 's1');
        const often = res.data.questionSummaries.find((q: any) => q.questionId === 'q-often');
        expect(often.topTwo).toEqual({ labels: ['Always', 'Usually'], positive: 1, base: 2, percent: 50 });
        expect(res.data.headline).toEqual({
          questionId: 'q-ov',
          questionText: 'Overall, how was your experience of our service?',
          labels: ['Very good', 'Good'],
          positive: 2,
          base: 3,
          percent: 67,
        });
      });

      it('no headline without the overall question, and no top two on questions without a standard scale', async () => {
        prisma.surveyQuestion.findMany.mockResolvedValue([
          question({ id: 'q-yn', questionText: 'Do you feel safe?' }),
          question({ id: 'q-pick', questionType: 'SINGLE_SELECT', questionText: 'Favourite day', options: ['Mon', 'Tue'], sortOrder: 1 }),
        ]);
        prisma.surveyAnswer.findMany.mockResolvedValue([]);
        const res: any = await service.results(admin, 's1');
        expect(res.data.headline).toBeNull();
        expect(res.data.questionSummaries.map((q: any) => q.topTwo)).toEqual([null, null]);
      });
    });
  });

  /* ─── Send to chosen people we support ────────────────────────────────────── */

  describe('send to chosen people we support', () => {
    const future = '2030-03-04T09:00:00.000Z';
    const withPortal = (id: string, locationId = 'loc-leeds') => ({
      id,
      locationId,
      isActive: true,
      portalAccount: { isEnabled: true, deletedAt: null } as { isEnabled: boolean; deletedAt: null } | null,
      assignments: [] as Array<{ locationId: string }>,
    });
    const noPortal = (id: string, locationId = 'loc-leeds') => ({
      id,
      locationId,
      isActive: true,
      portalAccount: null,
      assignments: [] as Array<{ locationId: string }>,
    });
    const NAMES: Record<string, [string, string]> = {
      'su-1': ['Ann', 'Jones'],
      'su-2': ['Bob', 'Smith'],
      'su-3': ['Cara', 'Lee'],
    };
    /** The chosen people (target lookup) and their names (result lookup). */
    const givenPeople = (rows: any[]) => {
      prisma.serviceUser.count.mockResolvedValue(rows.length);
      prisma.serviceUser.findMany.mockImplementation(async (args: any) => {
        const ids: string[] | undefined = args?.where?.id?.in;
        const picked = rows.filter((r) => !ids || ids.includes(r.id));
        if (args?.select?.assignments) return picked;
        if (args?.select?.firstName) {
          return picked.map((r) => ({
            id: r.id,
            firstName: NAMES[r.id]?.[0] ?? 'Person',
            lastName: NAMES[r.id]?.[1] ?? r.id,
            serviceUserNumber: null,
            isActive: r.isActive ?? true,
            portalAccount: r.portalAccount,
          }));
        }
        return [];
      });
    };
    const sentAudit = () =>
      audit.logAudit.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.action === 'survey_sent');
    const named = (overrides: Record<string, unknown> = {}) =>
      surveyRow({ targetKind: 'SERVICE_USER', title: 'Six-week review', ...overrides });

    beforeEach(() => givenQuestions(3));

    it('send now: everyone chosen becomes a recipient; those without a portal are named in the result, never in the audit', async () => {
      givenSurvey(named());
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      const res = await service.send(admin, 's1', { serviceUserIds: ['su-1', 'su-2'] });
      const rows = prisma.surveyRecipient.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.serviceUserId).sort()).toEqual(['su-1', 'su-2']);
      expect(rows.every((r: any) => r.employeeId === null && r.targetKind === 'SERVICE_USER')).toBe(true);
      expect(res.data).toMatchObject({ sent: 2, skippedNoPortal: 0, noPortal: [{ id: 'su-2', name: 'Bob Smith' }] });
      const saved = prisma.survey.update.mock.calls.map((c: any[]) => c[0].data).find((d: any) => d.audienceServiceUserIds);
      expect(saved).toMatchObject({ audienceServiceUserIds: ['su-1', 'su-2'], locationIds: ['loc-leeds'] });
      expect(sentAudit().newValues).toMatchObject({ sent: 2, addedWithoutPortal: 1 });
      expect(JSON.stringify(sentAudit())).not.toMatch(/Bob|Smith|Ann|Jones/);
    });

    it('someone whose record is no longer active cannot sign in to the portal, so they are treated as having none', async () => {
      givenSurvey(named());
      givenPeople([{ ...withPortal('su-3'), isActive: false }]);
      const res = await service.send(admin, 's1', { serviceUserIds: ['su-3'] });
      expect(res.data).toMatchObject({ sent: 1, noPortal: [{ id: 'su-3', name: 'Cara Lee' }] });
      const candidates = await service.listSendCandidates(admin, 's1', 'cara');
      expect(candidates.data[0]).toMatchObject({ id: 'su-3', hasPortal: false });
    });

    it('branch sends are unchanged: people without a portal are still skipped and only counted', async () => {
      givenSurvey(named({ locationIds: ['loc-leeds'] }));
      prisma.serviceUser.findMany.mockResolvedValue([{ id: 'su-1', locationId: 'loc-leeds' }]);
      prisma.serviceUser.count.mockResolvedValue(3);
      const res = await service.send(admin, 's1', { locationIds: ['loc-leeds'], serviceUserIds: [] });
      expect(prisma.surveyRecipient.createMany.mock.calls[0][0].data).toHaveLength(1);
      expect(res.data).toMatchObject({ sent: 1, skippedNoPortal: 2, noPortal: [] });
      const where = prisma.serviceUser.findMany.mock.calls[0][0].where;
      expect(where.portalAccount).toEqual({ is: { isEnabled: true, deletedAt: null } });
    });

    it('anonymous: chosen people reach portal accounts only, the minimum still applies, and no one is named', async () => {
      givenSurvey(named({ isAnonymous: true }));
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      await expect(service.send(admin, 's1', { serviceUserIds: ['su-1', 'su-2'] })).rejects.toThrow(
        /at least 5 people/,
      );
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();

      const five = ['a', 'b', 'c', 'd', 'e'].map((x) => withPortal(`su-${x}`));
      givenPeople([...five, noPortal('su-2')]);
      const res = await service.send(admin, 's1', { serviceUserIds: [...five.map((p) => p.id), 'su-2'] });
      const rows = prisma.surveyRecipient.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.serviceUserId)).not.toContain('su-2');
      expect(rows).toHaveLength(5);
      expect(res.data).toMatchObject({ sent: 5, skippedNoPortal: 1, noPortal: [] });
    });

    it('a branch user can only choose people in their branches, and only people still receiving care', async () => {
      givenSurvey(named({ locationIds: ['loc-leeds'] }));
      prisma.serviceUser.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(service.send(leedsManager, 's1', { serviceUserIds: ['su-york'] })).rejects.toThrow(
        /not in your branches/,
      );
      const scopeWhere = prisma.serviceUser.count.mock.calls[0][0].where.AND[1];
      expect(JSON.stringify(scopeWhere)).toContain('loc-leeds');

      prisma.serviceUser.count.mockReset();
      prisma.serviceUser.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      await expect(service.send(leedsManager, 's1', { serviceUserIds: ['su-gone'] })).rejects.toThrow(
        /cannot be sent surveys \(they have died, are inactive, their care has not started, or it ended more than 3 months ago\)/,
      );
      // Someone whose care has ended can still be chosen (the "When your care ends" survey).
      const statusWhere = JSON.stringify(prisma.serviceUser.count.mock.calls[1][0].where);
      expect(statusWhere).toContain('DECEASED');
      // Someone whose care ended is allowed only within 3 months of their service end date.
      expect(statusWhere).toContain('serviceEndDate');
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
    });

    it('a person assigned to the sender’s branch keeps the survey in that branch', async () => {
      givenSurvey(named({ locationIds: ['loc-leeds'] }));
      givenPeople([{ ...noPortal('su-1', 'loc-york'), assignments: [{ locationId: 'loc-leeds' }] }]);
      await service.send(leedsManager, 's1', { serviceUserIds: ['su-1'] });
      const saved = prisma.survey.update.mock.calls.map((c: any[]) => c[0].data).find((d: any) => d.audienceServiceUserIds);
      expect(saved.locationIds).toEqual(['loc-leeds']);
    });

    it('"Send to more" adds new people without resending to anyone who already has it', async () => {
      givenSurvey(named({ status: 'ACTIVE', locationIds: ['loc-leeds'] }));
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      prisma.surveyRecipient.findMany.mockImplementation(async (args: any) =>
        args?.where?.serviceUserId?.in ? [{ serviceUserId: 'su-1', employeeId: null }] : [],
      );
      const res = await service.send(admin, 's1', { serviceUserIds: ['su-1', 'su-2'] });
      const rows = prisma.surveyRecipient.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.serviceUserId)).toEqual(['su-2']);
      expect(res.data).toMatchObject({ sent: 1, skippedExisting: 1, noPortal: [{ id: 'su-2', name: 'Bob Smith' }] });
    });

    it('scheduling saves the chosen people; the run adds them and tells the scheduler how many need a call (no names)', async () => {
      givenSurvey(named());
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      const res = await service.send(admin, 's1', { serviceUserIds: ['su-1', 'su-2'], distributeAt: future });
      expect(prisma.surveyRecipient.createMany).not.toHaveBeenCalled();
      expect(prisma.survey.update.mock.calls[0][0].data).toMatchObject({
        audienceServiceUserIds: ['su-1', 'su-2'],
        distributeAt: new Date(future),
      });
      expect(res.data).toMatchObject({ scheduled: true, noPortal: [{ id: 'su-2', name: 'Bob Smith' }] });

      jest.clearAllMocks();
      resetDefaults(prisma);
      givenQuestions(3);
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      notifications.notifyUsers.mockResolvedValue({});
      const due = named({
        distributeAt: new Date('2026-11-05T09:00:00.000Z'),
        locationIds: ['loc-leeds'],
        audienceServiceUserIds: ['su-1', 'su-2'],
        scheduledById: 'mgr-leeds',
      });
      prisma.survey.findMany.mockResolvedValue([due]);
      const out = await service.runDueDistributions(new Date('2026-11-05T09:00:30.000Z'));
      expect(out[0].ok).toBe(true);
      const rows = prisma.surveyRecipient.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.serviceUserId).sort()).toEqual(['su-1', 'su-2']);
      expect(sentAudit().newValues).toMatchObject({ sent: 2, addedWithoutPortal: 1 });
      const note = notifications.notifyUsers.mock.calls[0][0];
      expect(note.recipientUserIds).toEqual(['mgr-leeds']);
      expect(note.message).toMatch(/1 of the chosen people has no portal account/);
      expect(JSON.stringify(note)).not.toMatch(/Bob|Smith|su-2/);
    });

    it('a scheduled run drops people who have died or become inactive since, and fails only when no one is left', async () => {
      givenPeople([]);
      const due = named({
        distributeAt: new Date('2026-11-05T09:00:00.000Z'),
        audienceServiceUserIds: ['su-gone'],
        scheduledById: 'mgr-leeds',
      });
      prisma.survey.findMany.mockResolvedValue([due]);
      const out = await service.runDueDistributions(new Date('2026-11-05T09:00:30.000Z'));
      expect(out[0].ok).toBe(false);
      expect(out[0].detail).toMatch(/have died, are inactive, have not started care/);
      const where = prisma.serviceUser.findMany.mock.calls[0][0].where;
      // A one-off schedule never reaches anyone who has died; someone whose care ended only within 3 months
      // (or at any time on a survey about care ending).
      expect(JSON.stringify(where)).toMatch(/DECEASED/);
      expect(JSON.stringify(where)).toMatch(/serviceEndDate/);
    });

    it('a repeating survey never sends a period to someone whose care has ended', async () => {
      givenSurvey(named());
      givenPeople([withPortal('su-1')]);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      prisma.survey.update.mockImplementation(async (args: any) => named({ id: args.where.id, ...args.data }));
      await service.send(admin, 's1', { serviceUserIds: ['su-1'], recurrence: SurveyRecurrence.MONTHLY });
      const targetWhere = prisma.serviceUser.findMany.mock.calls
        .map((c: any[]) => c[0])
        .filter((a: any) => a?.select?.assignments)
        .at(-1)?.where;
      expect(JSON.stringify(targetWhere.NOT)).toMatch(/DISCHARGED/);
    });

    it('Record response refuses someone who has died, and marks people whose care has ended', async () => {
      givenSurvey(named({ status: 'ACTIVE', locationIds: ['loc-leeds'] }));
      prisma.serviceUser.findFirst.mockResolvedValue({ status: { code: 'DECEASED' } });
      await expect(
        service.recordResponse(admin, 's1', {
          personId: 'su-1',
          channel: 'IN_PERSON',
          answers: [{ questionId: 'q1', booleanValue: true }],
        } as any),
      ).rejects.toThrow(/cannot be recorded for this person/);

      prisma.surveyRecipient.findMany.mockResolvedValue([]);
      prisma.serviceUser.findMany.mockResolvedValue([
        { id: 'su-3', firstName: 'Cara', lastName: 'Lee', serviceUserNumber: null, portalAccount: null, status: { code: 'DISCHARGED' } },
      ]);
      const res = await service.listRecordCandidates(admin, 's1');
      expect(res.data[0]).toMatchObject({ id: 'su-3', careEnded: true });
      const where = JSON.stringify(prisma.serviceUser.findMany.mock.calls.at(-1)[0].where);
      expect(where).toContain('DECEASED');
      expect(where).not.toContain('DISCHARGED');
    });

    it('branch sends never reach people whose care has not started or has ended', async () => {
      givenSurvey(named({ locationIds: ['loc-leeds'] }));
      prisma.serviceUser.findMany.mockResolvedValue([{ id: 'su-1', locationId: 'loc-leeds' }]);
      prisma.serviceUser.count.mockResolvedValue(1);
      await service.send(admin, 's1', { locationIds: ['loc-leeds'] });
      const where = JSON.stringify(prisma.serviceUser.findMany.mock.calls[0][0].where.NOT);
      for (const code of ['DISCHARGED', 'DECEASED', 'INACTIVE', 'PENDING', 'PRE_ADMISSION']) expect(where).toContain(code);
    });

    it('a repeating survey sends each period to the same chosen people, without a portal too', async () => {
      givenSurvey(named());
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      prisma.surveyQuestion.findMany.mockResolvedValue([question()]);
      // The saved row keeps the survey's own fields (a real update returns the whole row).
      prisma.survey.update.mockImplementation(async (args: any) => named({ id: args.where.id, ...args.data }));
      const res = await service.send(admin, 's1', {
        serviceUserIds: ['su-1', 'su-2'],
        recurrence: SurveyRecurrence.MONTHLY,
      });
      const clone = prisma.survey.create.mock.calls[0][0].data;
      expect(clone.audienceServiceUserIds).toEqual(['su-1', 'su-2']);
      const rows = prisma.surveyRecipient.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.serviceUserId).sort()).toEqual(['su-1', 'su-2']);
      expect(res.data).toMatchObject({ sent: 2, noPortal: [{ id: 'su-2', name: 'Bob Smith' }] });
    });

    it('Record response lists people sent it without a portal first, marked as such', async () => {
      givenSurvey(named({ status: 'ACTIVE', locationIds: ['loc-leeds'] }));
      prisma.surveyRecipient.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.status) return [{ serviceUserId: 'su-2' }];
        return [{ serviceUserId: 'su-2', employeeId: null, status: 'SENT' }];
      });
      const row = (id: string, portal: boolean) => ({
        id,
        firstName: NAMES[id][0],
        lastName: NAMES[id][1],
        serviceUserNumber: null,
        isActive: true,
        portalAccount: portal ? { isEnabled: true, deletedAt: null } : null,
      });
      prisma.serviceUser.findMany
        .mockResolvedValueOnce([row('su-2', false)])
        .mockResolvedValueOnce([row('su-1', true)]);
      const res = await service.listRecordCandidates(admin, 's1');
      expect(res.data.map((p: any) => [p.id, p.hasPortal, p.recipientStatus])).toEqual([
        ['su-2', false, 'SENT'],
        ['su-1', true, null],
      ]);
      const firstWhere = prisma.serviceUser.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(firstWhere)).toContain('"su-2"');
      expect(JSON.stringify(firstWhere)).toContain('portalAccount');
    });

    it('send candidates show portal status and who already has it (never on anonymous surveys)', async () => {
      givenSurvey(named({ status: 'ACTIVE' }));
      givenPeople([withPortal('su-1'), noPortal('su-2')]);
      prisma.surveyRecipient.findMany.mockResolvedValue([{ serviceUserId: 'su-1' }]);
      const res = await service.listSendCandidates(admin, 's1', 'a');
      expect(res.data).toEqual([
        { id: 'su-1', name: 'Ann Jones', hasPortal: true, careEnded: false, alreadySent: true },
        { id: 'su-2', name: 'Bob Smith', hasPortal: false, careEnded: false, alreadySent: false },
      ]);

      prisma.surveyRecipient.findMany.mockClear();
      givenSurvey(named({ status: 'ACTIVE', isAnonymous: true }));
      const anon = await service.listSendCandidates(admin, 's1', undefined, ['su-1', 'not-a-uuid']);
      expect(anon.data.every((p: any) => p.alreadySent === null)).toBe(true);
      expect(prisma.surveyRecipient.findMany).not.toHaveBeenCalled();

      givenSurvey(surveyRow({ targetKind: 'EMPLOYEE' }));
      await expect(service.listSendCandidates(admin, 's1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('send candidates for a branch user stay within their branches', async () => {
      givenSurvey(named({ status: 'ACTIVE', locationIds: ['loc-leeds'] }));
      givenPeople([]);
      await service.listSendCandidates(leedsManager, 's1', 'b');
      const where = prisma.serviceUser.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('loc-leeds');
    });

    it('validates chosen people as UUIDs', async () => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      await expect(
        pipe.transform({ serviceUserIds: ['nope'] }, { type: 'body', metatype: SendSurveyDto }),
      ).rejects.toBeDefined();
      await expect(
        pipe.transform(
          { serviceUserIds: ['0b8f5f3e-8c1e-4c63-9d3c-5f3a3f2c1a10'] },
          { type: 'body', metatype: SendSurveyDto },
        ),
      ).resolves.toMatchObject({ serviceUserIds: ['0b8f5f3e-8c1e-4c63-9d3c-5f3a3f2c1a10'] });
    });
  });

  describe('options from a CareFlow list (ethnicity …)', () => {
    const list = [
      { code: 'ARAB', name: 'Arab', isActive: true },
      { code: 'ASIAN_GUJARATI', name: 'Asian - Gujarati', isActive: true },
      { code: 'ASIAN_PUNJABI', name: 'Asian - Punjabi', isActive: true },
      { code: 'OLD', name: 'White - Old', isActive: false },
    ];
    const eth = () => question({ id: 'q-eth', key: 'q-eth', questionText: 'What is your ethnic group?', questionType: 'SINGLE_SELECT', options: null, optionsFrom: 'ETHNICITY' });
    beforeEach(() => {
      prisma.$queryRawUnsafe = jest.fn().mockResolvedValue(list);
    });

    it('reports by group, with detail only where at least 10 chose it, by code', async () => {
      givenSurvey(surveyRow({ status: 'CLOSED' }));
      prisma.surveyQuestion.findMany.mockResolvedValue([eth()]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'surveyId' ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 12 } }] : [],
      );
      const ans = (code: string, name: string) => ({
        lookupCodes: [code], booleanValue: null, textValue: null, numberValue: null, selectedOptions: [name], otherText: null, comment: null,
        response: { id: `r-${Math.random()}`, isAnonymous: false, channel: 'ONLINE', submittedAt: new Date(), recipient: null },
        question: { ...eth(), surveyId: 's1', sourceQuestionId: null, config: null, otherOption: null, sortOrder: 0 },
      });
      prisma.surveyAnswer.findMany.mockResolvedValue([...Array.from({ length: 10 }, () => ans('ASIAN_GUJARATI', 'Asian - Gujarati')), ans('ASIAN_PUNJABI', 'Asian - Punjabi'), ans('ARAB', 'Arab')]);
      const res = await service.results(admin, 's1');
      const s: any = res.data.questionSummaries.find((q: any) => q.questionId === 'q-eth');
      expect(s.options.map((o: any) => [o.label, o.count])).toEqual([['Asian', 11], ['Arab', 1]]);
      expect(s.lookupDetails).toEqual([{ group: 'Asian', label: 'Asian - Gujarati', count: 10 }]);
      expect(s.lookupDetailsNote).toMatch(/at least 10 people/);
    });

    it('on an anonymous survey folds groups chosen by fewer than 10 into one figure', async () => {
      givenSurvey(surveyRow({ isAnonymous: true, status: 'CLOSED' }));
      prisma.surveyQuestion.findMany.mockResolvedValue([eth()]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'surveyId' ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 12 } }] : [],
      );
      const ans = (code: string, name: string) => ({
        lookupCodes: [code], booleanValue: null, textValue: null, numberValue: null, selectedOptions: [name], otherText: null, comment: null,
        response: { id: `r-${Math.random()}`, isAnonymous: false, channel: 'ONLINE', submittedAt: new Date(), recipient: null },
        question: { ...eth(), surveyId: 's1', sourceQuestionId: null, config: null, otherOption: null, sortOrder: 0 },
      });
      prisma.surveyAnswer.findMany.mockResolvedValue([...Array.from({ length: 10 }, () => ans('ASIAN_GUJARATI', 'Asian - Gujarati')), ans('ASIAN_PUNJABI', 'Asian - Punjabi'), ans('ARAB', 'Arab')]);
      const res = await service.results(admin, 's1');
      const s: any = res.data.questionSummaries.find((q: any) => q.questionId === 'q-eth');
      // The one person who chose Arab is not shown as their own group.
      expect(s.options.map((o: any) => [o.label, o.count])).toEqual([['Asian', 11], ['Other groups (fewer than 10 each)', 1]]);
    });

    it('answers by name or code are kept with the code', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyQuestion.findMany.mockResolvedValue([eth()]);
      const { questions, answerByQuestion } = await (service as any).validateAnswers('s1', {
        answers: [{ questionId: 'q-eth', selectedOptions: ['ASIAN_PUNJABI'] }],
      });
      const rows = (service as any).mapAnswersForCreate(questions, answerByQuestion, null);
      expect(rows[0]).toMatchObject({ selectedOptions: ['Asian - Punjabi'], lookupCodes: ['ASIAN_PUNJABI'] });
    });

    it('refuses a retired entry when answering', async () => {
      givenSurvey(surveyRow({ status: 'ACTIVE' }));
      prisma.surveyQuestion.findMany.mockResolvedValue([eth()]);
      await expect(
        (service as any).validateAnswers('s1', { answers: [{ questionId: 'q-eth', selectedOptions: ['White - Old'] }] }),
      ).rejects.toThrow();
    });
  });

  describe("who it's for", () => {
    it('keeps a group that fits the audience, refuses one that does not, and asks for words with Other', async () => {
      await service.create(admin, { title: 'Family views', targetKind: 'PUBLIC', audienceGroup: 'FAMILIES' } as any);
      expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({ audienceGroup: 'FAMILIES', audienceGroupOther: null });
      await expect(service.create(admin, { title: 'x', targetKind: 'PUBLIC', audienceGroup: 'CARE_WORKERS' } as any)).rejects.toThrow(/Choose who this survey is for/);
      await expect(service.create(admin, { title: 'x', targetKind: 'PUBLIC', audienceGroup: 'OTHER' } as any)).rejects.toThrow(/Say who the survey is for/);
      const res = await service.create(admin, { title: 'x', targetKind: 'PUBLIC', audienceGroup: 'OTHER', audienceGroupOther: 'Local GPs' } as any);
      expect(res.data.audienceGroupLabel).toBe('Local GPs');
    });

    it('Several groups adds the standard "Who are you?" question first', async () => {
      prisma.surveyQuestion.aggregate = jest.fn().mockResolvedValue({ _min: { sortOrder: 0 } });
      await service.create(admin, { title: 'Everyone', targetKind: 'PUBLIC', audienceGroup: 'SEVERAL' } as any);
      const q = prisma.surveyQuestion.create.mock.calls[0][0].data;
      expect(q).toMatchObject({ key: 'who-are-you', questionText: 'Who are you?', questionType: 'SINGLE_SELECT', isRequired: true, sortOrder: -1 });
      expect(q.options).toContain('Families and representatives');
      expect(q.options).toContain('People we support');
      expect(q.options).toContain('Advocates and community organisations');
      expect(q.options).not.toContain('Several groups');
    });

    it('refuses to change to Several groups once anyone has answered ("Who are you?" could not be added)', async () => {
      givenSurvey(surveyRow({ targetKind: 'PUBLIC', audienceGroup: 'FAMILIES', status: 'ACTIVE' }));
      prisma.surveyResponse.count.mockResolvedValue(3);
      await expect(service.update(admin, 's1', { audienceGroup: 'SEVERAL' } as any)).rejects.toThrow(/cannot change to Several groups/);
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('public forms can be for the people we support or for advocates and community organisations', async () => {
      await service.create(admin, { title: 'Your views', targetKind: 'PUBLIC', audienceGroup: 'PEOPLE_WE_SUPPORT' } as any);
      expect(prisma.survey.create.mock.calls[0][0].data).toMatchObject({ audienceGroup: 'PEOPLE_WE_SUPPORT' });
      const res = await service.create(admin, { title: 'Partners', targetKind: 'PUBLIC', audienceGroup: 'ADVOCATES' } as any);
      expect(res.data.audienceGroupLabel).toBe('Advocates and community organisations');
      await expect(service.create(admin, { title: 'x', targetKind: 'EMPLOYEE', audienceGroup: 'ADVOCATES' } as any)).rejects.toThrow(/Choose who this survey is for/);
    });

    it('filters the survey list by group', async () => {
      await service.list(admin, { audienceGroup: 'FAMILIES' } as any);
      expect(prisma.survey.findMany.mock.calls[0][0].where).toMatchObject({ audienceGroup: 'FAMILIES' });
    });

    it('splits Results by the "Who are you?" answer, the threshold applying to that group alone', async () => {
      givenSurvey(surveyRow({ targetKind: 'PUBLIC', audienceGroup: 'SEVERAL', status: 'CLOSED' }));
      const who = question({ id: 'q-who', key: 'who-are-you', questionText: 'Who are you?', questionType: 'SINGLE_SELECT', options: ['A relative', 'A professional'] });
      const yes = question({ id: 'q-yes', key: 'q-yes', questionText: 'Are you happy?', questionType: 'YES_NO', sortOrder: 1 });
      prisma.surveyQuestion.findMany.mockResolvedValue([who, yes]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'surveyId' ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 3 } }] : [],
      );
      const ans = (rid: string, q: any, v: Record<string, unknown>) => ({
        booleanValue: null, textValue: null, numberValue: null, selectedOptions: null, otherText: null, comment: null, lookupCodes: null,
        response: { id: rid, isAnonymous: false, channel: 'ONLINE', submittedAt: new Date(), recipient: null },
        question: { ...q, surveyId: 's1', sourceQuestionId: null }, ...v,
      });
      prisma.surveyAnswer.findMany.mockResolvedValue([
        ans('r1', who, { selectedOptions: ['A relative'] }), ans('r1', yes, { booleanValue: true }),
        ans('r2', who, { selectedOptions: ['A relative'] }), ans('r2', yes, { booleanValue: false }),
        ans('r3', who, { selectedOptions: ['A professional'] }), ans('r3', yes, { booleanValue: true }),
      ]);
      const all = await service.results(admin, 's1');
      expect(all.data.respondentGroups).toEqual(expect.arrayContaining([{ label: 'A relative', responses: 2 }, { label: 'A professional', responses: 1 }]));
      const rel = await service.results(admin, 's1', { respondentGroup: 'A relative' });
      expect(rel.data.participation.responsesInFigures).toBe(2);
      expect((rel.data.questionSummaries.find((q: any) => q.questionId === 'q-yes') as any).answerCount).toBe(2);
      expect(rel.data.breakdowns).toEqual([]);

      // With a threshold of 2 the professional (1 answer) is under it: showing the relatives'
      // figures beside the totals would give the professional's answer, so no group is shown.
      givenSurvey(surveyRow({ targetKind: 'PUBLIC', audienceGroup: 'SEVERAL', status: 'CLOSED', reportingThreshold: 2 }));
      const blocked = await service.results(admin, 's1', { respondentGroup: 'A relative' });
      expect(blocked.data.reporting.belowThreshold).toBe(true);
      expect(blocked.data.questionSummaries).toEqual([]);
      expect(blocked.data.respondentGroupNote).toMatch(/every group has at least 2 answers/);
      expect(blocked.data.reporting.note).toMatch(/every group has at least 2 answers/);
    });

    it('"Prefer not to say" counts in the overall figures, is never a group, and a small number of them blocks group views', async () => {
      givenSurvey(surveyRow({ targetKind: 'PUBLIC', audienceGroup: 'SEVERAL', status: 'CLOSED', reportingThreshold: 2 }));
      const who = question({ id: 'q-who', key: 'who-are-you', questionText: 'Who are you?', questionType: 'SINGLE_SELECT', options: ['A relative', 'A professional', 'Prefer not to say'] });
      const yes = question({ id: 'q-yes', key: 'q-yes', questionText: 'Are you happy?', questionType: 'YES_NO', sortOrder: 1 });
      prisma.surveyQuestion.findMany.mockResolvedValue([who, yes]);
      prisma.surveyResponse.groupBy.mockImplementation(async (args: any) =>
        args.by[0] === 'surveyId' ? [{ surveyId: 's1', isAnonymous: false, channel: 'ONLINE', _count: { _all: 5 } }] : [],
      );
      const ans = (rid: string, q: any, v: Record<string, unknown>) => ({
        booleanValue: null, textValue: null, numberValue: null, selectedOptions: null, otherText: null, comment: null, lookupCodes: null,
        response: { id: rid, isAnonymous: false, channel: 'ONLINE', submittedAt: new Date(), recipient: null },
        question: { ...q, surveyId: 's1', sourceQuestionId: null }, ...v,
      });
      const rows = [
        ['r1', 'A relative'], ['r2', 'A relative'], ['r3', 'A professional'], ['r4', 'A professional'], ['r5', 'Prefer not to say'],
      ].flatMap(([rid, g]) => [ans(rid, who, { selectedOptions: [g] }), ans(rid, yes, { booleanValue: true })]);
      prisma.surveyAnswer.findMany.mockResolvedValue(rows);

      const all = await service.results(admin, 's1');
      expect(all.data.participation.responsesInFigures).toBe(5);
      expect(all.data.respondentGroups.map((g: any) => g.label).sort()).toEqual(['A professional', 'A relative']);
      // Both groups have 2 (the threshold), but the one "Prefer not to say" answer is overall minus both.
      const rel = await service.results(admin, 's1', { respondentGroup: 'A relative' });
      expect(rel.data.questionSummaries).toEqual([]);
      expect(rel.data.respondentGroupNote).toMatch(/every group has at least 2 answers/);
      // Never shown as a group of its own, even when there are plenty.
      const pnts = await service.results(admin, 's1', { respondentGroup: 'Prefer not to say' });
      expect(pnts.data.questionSummaries).toEqual([]);
      expect(pnts.data.respondentGroupNote).toMatch(/counted in the overall results only/);

      // Once enough people preferred not to say, single groups show (and still never that one).
      rows.push(...[ans('r6', who, { selectedOptions: ['Prefer not to say'] }), ans('r6', yes, { booleanValue: false })]);
      const shown = await service.results(admin, 's1', { respondentGroup: 'A relative' });
      expect(shown.data.participation.responsesInFigures).toBe(2);
    });

    it('the standard "Who are you?" question ends with "Prefer not to say", for every audience', async () => {
      prisma.surveyQuestion.aggregate = jest.fn().mockResolvedValue({ _min: { sortOrder: 0 } });
      for (const kind of ['PUBLIC', 'EMPLOYEE', 'SERVICE_USER']) {
        prisma.surveyQuestion.create.mockClear();
        await service.create(admin, { title: 'Everyone', targetKind: kind, audienceGroup: 'SEVERAL' } as any);
        const options = prisma.surveyQuestion.create.mock.calls[0][0].data.options as string[];
        expect(options[options.length - 1]).toBe('Prefer not to say');
        expect(options).not.toContain('Other (please tell us)');
        expect(options).not.toContain('Several groups');
        expect(prisma.surveyQuestion.create.mock.calls[0][0].data.config).toEqual({ notCountedOptions: ['Prefer not to say'] });
      }
    });
  });
});
