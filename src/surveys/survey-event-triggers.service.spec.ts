import { SurveyEventTriggersService } from './survey-event-triggers.service';

const mockResultsAccess = { results: true };
jest.mock('./survey-access', () => ({
  surveyResultsAudience: jest.fn(async () => ({ restricted: true })),
  surveyAccessFor: jest.fn(async () => mockResultsAccess),
}));

const NOW = new Date('2026-11-20T10:00:00Z');
const TZ = 'Europe/London';
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const trigger = (over: Record<string, unknown> = {}) => ({
  event: 'HOSPITAL_DISCHARGE',
  delayDays: 10,
  windowDays: 4,
  exclusions: [],
  options: { minNights: 1 },
  checkFirst: false,
  since: '2026-10-01',
  ownerKey: 'CARE_COORDINATOR',
  ...over,
});
const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Coming home from hospital',
  targetKind: 'SERVICE_USER',
  status: 'DRAFT',
  isAnonymous: false,
  isTemplate: false,
  isCatalogue: false,
  clonedFromId: null,
  recurrence: null,
  deletedAt: null,
  locationIds: [],
  roleIds: [],
  libraryReference: null,
  libraryMeta: null,
  eventTrigger: trigger(),
  ...over,
});
const occ = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  surveyId: 's1',
  event: 'HOSPITAL_DISCHARGE',
  sourceKey: 'hospital:00000000-0000-4000-8000-0000000000a1',
  employeeId: null,
  serviceUserId: 'su1',
  eventOn: day('2026-11-10'),
  dueOn: day('2026-11-20'),
  lastDay: day('2026-11-24'),
  status: 'WAITING',
  reason: null,
  sentSurveyId: null,
  resolvedById: null,
  resolvedAt: null,
  createdAt: NOW,
  ...over,
});

function setup(opts: { survey?: any; rows?: any[]; serviceUsers?: any[] } = {}) {
  const s = opts.survey ?? survey();
  const prisma: any = {
    survey: {
      findFirst: jest.fn(async () => s),
      findUnique: jest.fn(async () => s),
      findMany: jest.fn(async () => [s]),
      update: jest.fn(async ({ data }: any) => ({ ...s, ...data })),
    },
    surveyQuestion: { count: jest.fn(async () => 3) },
    surveyRecipient: { count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 0 })) },
    surveyEventOccurrence: {
      findMany: jest.fn(async () => opts.rows ?? []),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
      updateMany: jest.fn(async ({ where }: any) => ({ count: Array.isArray(where.id?.in) ? where.id.in.length : 1 })),
      update: jest.fn(),
      groupBy: jest.fn(async () => []),
    },
    surveyHeldBack: { updateMany: jest.fn(async () => ({ count: 0 })) },
    serviceUser: {
      findMany: jest.fn(async () => opts.serviceUsers ?? [{ id: 'su1', deletedAt: null, dateOfDeath: null, status: { code: 'ACTIVE' }, firstName: 'Ada', lastName: 'Lane', preferredName: null }]),
    },
    serviceUserAbsence: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => ({ deletedAt: null, isActive: true, endDate: day('2026-11-10') })),
    },
    safeguardingCase: { findMany: jest.fn(async () => []) },
    feedbackRecord: { findMany: jest.fn(async () => []), findUnique: jest.fn() },
    employee: { findMany: jest.fn(async () => []) },
    employeeLeavingRecord: { findMany: jest.fn(async () => []) },
    employeePersonalDetail: { findMany: jest.fn(async () => []) },
    roleTask: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
    role: { findMany: jest.fn(async () => [{ id: 'r1', name: 'Care Coordinator' }]) },
    surveyAlertOwnerRole: { findUnique: jest.fn(async () => null) },
    userRole: { findMany: jest.fn(async () => [{ userId: 'u9' }]) },
  };
  prisma.$executeRaw = jest.fn(async () => 1);
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }) };
  const surveys = {
    sendForEvents: jest.fn(async (_s: any, ids: string[]) => ({ periodId: 'p-nov', sent: ids, held: [], skipped: [], already: [], unreachable: [], deferred: false })),
  };
  const notifications = { notifyUsers: jest.fn() };
  const orgSettings = { getOperationalTimezone: async () => TZ };
  const svc = new SurveyEventTriggersService(prisma, audit as any, orgScope as any, surveys as any, notifications as any, orgSettings as any);
  return { svc, prisma, audit, surveys, notifications };
}

const manager = { id: 'u1', roles: [], permissions: ['surveys.manage', 'surveys.read'] } as any;
const reader = { id: 'u2', roles: [], permissions: ['surveys.read'] } as any;

describe('SurveyEventTriggersService: finding events in the records', () => {
  it('a hospital stay of a night or more that has ended is an event on the day they came home', async () => {
    const { svc, prisma } = setup();
    prisma.serviceUserAbsence.findMany.mockResolvedValueOnce([
      { id: 'a1', serviceUserId: 'su1', startDate: new Date('2026-11-05T10:00:00Z'), endDate: new Date('2026-11-10T10:00:00Z') },
      { id: 'a2', serviceUserId: 'su2', startDate: new Date('2026-11-10T08:00:00Z'), endDate: new Date('2026-11-10T18:00:00Z') },
    ]);
    const found = await svc.findEvents(survey() as any, trigger() as any, '2026-11-06', '2026-11-20', TZ);
    expect(found).toEqual([{ personId: 'su1', sourceKey: 'hospital:a1', eventDay: '2026-11-10' }]);
    expect(prisma.serviceUserAbsence.findMany.mock.calls[0][0].where.absenceReasonCatalog).toEqual({ code: 'HOSPITALISED' });
  });

  it('adds each event once, with its due and last days; never one whose last day has passed', async () => {
    const { svc, prisma } = setup();
    prisma.serviceUserAbsence.findMany.mockResolvedValueOnce([
      { id: 'a1', serviceUserId: 'su1', startDate: new Date('2026-11-05T10:00:00Z'), endDate: new Date('2026-11-10T10:00:00Z') },
    ]);
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([]);
    expect(await svc.detect(NOW)).toBe(1);
    expect(prisma.surveyEventOccurrence.createMany.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [{ surveyId: 's1', sourceKey: 'hospital:a1', serviceUserId: 'su1', employeeId: null, status: 'WAITING' }],
    });
    // Already known: not added again.
    prisma.serviceUserAbsence.findMany.mockResolvedValueOnce([
      { id: 'a1', serviceUserId: 'su1', startDate: new Date('2026-11-05T10:00:00Z'), endDate: new Date('2026-11-10T10:00:00Z') },
    ]);
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([{ sourceKey: 'hospital:a1', serviceUserId: 'su1', employeeId: null, eventOn: day('2026-11-10') }]);
    expect(await svc.detect(NOW)).toBe(0);
  });

  it('several of the same event for one person within 4 weeks become one survey', async () => {
    const { svc, prisma } = setup();
    prisma.serviceUserAbsence.findMany.mockResolvedValueOnce([
      { id: 'a1', serviceUserId: 'su1', startDate: day('2026-11-01'), endDate: day('2026-11-08') },
      { id: 'a2', serviceUserId: 'su1', startDate: day('2026-11-09'), endDate: day('2026-11-12') },
    ]);
    expect(await svc.detect(NOW)).toBe(1);
  });

  it('a medicine change in the first weeks of a new package is not an event', async () => {
    const { svc, prisma } = setup();
    prisma.serviceUserMedication = {
      findMany: jest.fn(async () => [
        { serviceUserId: 'new', createdAt: new Date('2026-11-12T10:00:00Z'), statusEndedAt: null, serviceUser: { serviceStartDate: day('2026-11-01') } },
        { serviceUserId: 'old', createdAt: new Date('2026-11-12T10:00:00Z'), statusEndedAt: null, serviceUser: { serviceStartDate: day('2025-01-01') } },
      ]),
    };
    const found = await svc.findEvents(survey() as any, trigger({ event: 'MEDICINES_CHANGE', options: { ignoreFirstDays: 42 } }) as any, '2026-11-01', '2026-11-20', TZ);
    expect(found).toEqual([{ personId: 'old', sourceKey: 'medicines:old:2026-11-12', eventDay: '2026-11-12' }]);
  });

  it('back from a long absence: the day after it ends, only when long enough', async () => {
    const { svc, prisma } = setup();
    prisma.employeeAbsenceRecord = {
      findMany: jest.fn(async () => [
        { id: 'x1', employeeId: 'e1', fromDateTime: day('2026-10-01'), toDateTime: day('2026-11-09') },
        { id: 'x2', employeeId: 'e2', fromDateTime: day('2026-11-01'), toDateTime: day('2026-11-09') },
      ]),
    };
    const found = await svc.findEvents(survey({ targetKind: 'EMPLOYEE' }) as any, trigger({ event: 'RETURN_FROM_LONG_ABSENCE', options: { minDays: 28 } }) as any, '2026-11-01', '2026-11-20', TZ);
    expect(found).toEqual([{ personId: 'e1', sourceKey: 'absence:x1', eventDay: '2026-11-10' }]);
  });
});

describe('SurveyEventTriggersService: when it falls due', () => {
  it('sends through the normal path and records where it went', async () => {
    const { svc, prisma, surveys } = setup({ rows: [occ()] });
    const res = await svc.processDue(NOW);
    expect(surveys.sendForEvents).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), ['su1'], NOW);
    expect(res.sent).toBe(1);
    const marks = prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data);
    expect(marks).toContainEqual({ status: 'SENT', reason: null, sentSurveyId: 'p-nov' });
  });

  it('never sends to someone who has died, is back in hospital, or whose stay was removed', async () => {
    const died = setup({ rows: [occ()], serviceUsers: [{ id: 'su1', deletedAt: null, dateOfDeath: day('2026-11-15'), status: { code: 'DECEASED' } }] });
    await died.svc.processDue(NOW);
    expect(died.surveys.sendForEvents).not.toHaveBeenCalled();
    expect(died.prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual(expect.objectContaining({ status: 'SKIPPED', reason: 'DIED' }));

    const back = setup({ rows: [occ()] });
    back.prisma.serviceUserAbsence.findMany.mockResolvedValueOnce([{ serviceUserId: 'su1' }]);
    await back.svc.processDue(NOW);
    expect(back.prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual(expect.objectContaining({ reason: 'IN_HOSPITAL' }));

    const removed = setup({ rows: [occ()] });
    removed.prisma.serviceUserAbsence.findUnique.mockResolvedValueOnce(null);
    await removed.svc.processDue(NOW);
    expect(removed.prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual(expect.objectContaining({ reason: 'RECORD_REMOVED' }));
  });

  it('lets go of one not sent in time', async () => {
    const { svc, prisma, surveys } = setup({ rows: [occ({ dueOn: day('2026-11-10'), lastDay: day('2026-11-14') })] });
    await svc.processDue(NOW);
    expect(surveys.sendForEvents).not.toHaveBeenCalled();
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'EXPIRED', reason: 'WINDOW_PASSED' });
  });

  it('check first: waits for staff, with a task that names no one', async () => {
    const s = survey({ eventTrigger: trigger({ checkFirst: true }) });
    const { svc, prisma, notifications } = setup({ survey: s, rows: [occ()] });
    const res = await svc.processDue(NOW);
    expect(res.due).toBe(1);
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual({ status: 'DUE' });
    prisma.surveyEventOccurrence.groupBy.mockResolvedValueOnce([{ surveyId: 's1', _count: { _all: 2 } }]);
    await svc.syncTasks(NOW);
    const task = prisma.roleTask.create.mock.calls[0][0].data;
    expect(task).toMatchObject({ sourceType: 'SURVEY_EVENT_DUE', sourceId: 's1', roleId: 'r1', title: 'Check who should be sent a survey' });
    expect(JSON.stringify(task)).not.toMatch(/Ada|Lane|hospital/i);
    expect(JSON.stringify(notifications.notifyUsers.mock.calls[0][0])).not.toMatch(/Ada|Lane/);
  });

  it('anonymous surveys go only when at least 5 people are due at once', async () => {
    const s = survey({ isAnonymous: true });
    const four = [1, 2, 3, 4].map((i) => occ({ id: `o${i}`, serviceUserId: `su${i}`, sourceKey: `hospital:00000000-0000-4000-8000-00000000000${i}` }));
    const sus = [1, 2, 3, 4, 5].map((i) => ({ id: `su${i}`, deletedAt: null, dateOfDeath: null, status: { code: 'ACTIVE' } }));
    const few = setup({ survey: s, rows: four, serviceUsers: sus });
    await few.svc.processDue(NOW);
    expect(few.surveys.sendForEvents).not.toHaveBeenCalled();
    expect(few.prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual({ status: 'BATCH' });
    const five = [...four, occ({ id: 'o5', serviceUserId: 'su5', sourceKey: 'hospital:00000000-0000-4000-8000-000000000005' })];
    const enough = setup({ survey: s, rows: five, serviceUsers: sus });
    await enough.svc.processDue(NOW);
    expect(enough.surveys.sendForEvents).toHaveBeenCalledTimes(1);
  });
});

describe('SurveyEventTriggersService: staff decisions, deaths and the list', () => {
  it('"Don’t send" needs a reason; the audit holds counts and the reason only', async () => {
    const s = survey({ eventTrigger: trigger({ checkFirst: true }) });
    const { svc, prisma, audit } = setup({ survey: s, rows: [occ({ status: 'DUE' })] });
    await expect(svc.decide(manager, 's1', { ids: ['o1'], action: 'DONT_SEND', reason: 'no' })).rejects.toThrow(/Say why/);
    await svc.decide(manager, 's1', { ids: ['o1'], action: 'DONT_SEND', reason: 'Ombudsman review open' });
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'SKIPPED', reason: 'Ombudsman review open', resolvedById: 'u1' });
    const entry = audit.logAudit.mock.calls[0][0];
    expect(entry.newValues).toEqual({ action: 'DONT_SEND', people: 1, sent: 0, reason: 'Ombudsman review open' });
    expect(JSON.stringify(entry)).not.toMatch(/su1|Ada/);
  });

  it('family surveys are offered by staff, never sent by CareFlow', async () => {
    const s = survey({ targetKind: 'PUBLIC', eventTrigger: trigger({ event: 'DEATH', checkFirst: true, delayDays: 42, windowDays: 14 }) });
    const { svc } = setup({ survey: s, rows: [occ({ status: 'DUE', event: 'DEATH' })] });
    await expect(svc.decide(manager, 's1', { ids: ['o1'], action: 'SEND' })).rejects.toThrow(/offered by staff/);
    await expect(svc.decide(manager, 's1', { ids: ['o1'], action: 'OFFERED', reason: 'Phoned the daughter' })).resolves.toMatchObject({ data: { people: 1 } });
  });

  it('a death stops contact still waiting (not the bereaved-family survey) and is audited as counts', async () => {
    const { svc, prisma, audit } = setup({ serviceUsers: [{ id: 'su1' }] });
    prisma.surveyEventOccurrence.updateMany.mockResolvedValueOnce({ count: 2 });
    prisma.surveyHeldBack.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.surveyRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await svc.stopAfterDeaths(NOW)).toBe(4);
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls[0][0]).toMatchObject({
      where: { serviceUserId: { in: ['su1'] }, event: { not: 'DEATH' } },
      data: { status: 'CANCELLED', reason: 'DIED' },
    });
    expect(prisma.surveyHeldBack.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' });
    expect(prisma.surveyRecipient.updateMany.mock.calls[0][0].data).toEqual({ invitationTextPending: false });
    expect(audit.logAudit.mock.calls[0][0].newValues).toEqual({ eventSends: 2, heldBack: 1, waitingTexts: 1 });
    expect(JSON.stringify(audit.logAudit.mock.calls[0][0])).not.toMatch(/su1/);
  });

  it('the list of people and events is for people who manage surveys only', async () => {
    const { svc } = setup({ rows: [occ()] });
    const asReader = await svc.getSettings(reader, 's1');
    expect(asReader.data.canSeeList).toBe(false);
    expect(asReader.data.occurrences).toEqual([]);
    const asManager = await svc.getSettings(manager, 's1');
    expect(asManager.data.occurrences[0]).toMatchObject({ name: 'Ada Lane', eventLabel: 'Home from hospital', dueOn: '2026-11-20', status: 'WAITING' });
  });

  it('switching on is audited; it is refused on a survey already sent, and off cancels what waits', async () => {
    const s = survey({ eventTrigger: null });
    const { svc, prisma, audit } = setup({ survey: s });
    prisma.surveyRecipient.count.mockResolvedValueOnce(3);
    await expect(svc.saveSettings(manager, 's1', trigger())).rejects.toThrow(/already been sent/);
    await svc.saveSettings(manager, 's1', { event: 'HOSPITAL_DISCHARGE', delayDays: 10, windowDays: 4, exclusions: [], options: {} });
    expect(audit.logAudit.mock.calls[0][0]).toMatchObject({ action: 'survey_event_trigger_changed' });
    const on = setup({ survey: survey() });
    await on.svc.saveSettings(manager, 's1', null);
    expect(on.prisma.surveyEventOccurrence.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', reason: 'SURVEY_STOPPED' });
  });
});


describe('SurveyEventTriggersService: review fixes', () => {
  afterEach(() => {
    mockResultsAccess.results = true;
  });

  it('two servers: rows another run claimed first are left to it, and none is left marked sent but not sent', async () => {
    const rows = [occ({ id: 'o1', serviceUserId: 'su1' }), occ({ id: 'o2', serviceUserId: 'su2', sourceKey: 'hospital:00000000-0000-4000-8000-0000000000a2' })];
    const sus = ['su1', 'su2'].map((id) => ({ id, deletedAt: null, dateOfDeath: null, status: { code: 'ACTIVE' } }));
    const { svc, prisma, surveys } = setup({ rows, serviceUsers: sus });
    prisma.serviceUserAbsence.findUnique.mockImplementation(async () => ({ deletedAt: null, isActive: true, endDate: day('2026-11-10') }));
    // The claim read: only o2 carries this run's mark (o1 was taken by another server).
    prisma.surveyEventOccurrence.findMany.mockImplementation(async (args: any) => (args?.where?.reason ? [{ id: 'o2' }] : rows));
    await svc.processDue(NOW);
    expect(surveys.sendForEvents).toHaveBeenCalledWith(expect.anything(), ['su2'], NOW);
    const claimCall = prisma.surveyEventOccurrence.updateMany.mock.calls.find((c: any) => String(c[0].data.reason ?? '').startsWith('CLAIM:'));
    expect(claimCall[0].data.status).toBe('SENT');
    // Leftovers of this claim are never left as sent.
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0])).toContainEqual(
      expect.objectContaining({ where: { id: { in: ['o2'] }, reason: claimCall[0].data.reason }, data: { status: 'SKIPPED', reason: 'NOT_REACHABLE' } }),
    );
  });

  it('a corrected discharge date moves the row instead of losing the survey', async () => {
    const { svc, prisma } = setup();
    prisma.serviceUserAbsence.findMany.mockResolvedValueOnce([{ id: 'a1', serviceUserId: 'su1', startDate: day('2026-11-01'), endDate: day('2026-11-12') }]);
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([
      { id: 'o1', sourceKey: 'hospital:a1', serviceUserId: 'su1', employeeId: null, eventOn: day('2026-11-08'), status: 'SKIPPED', reason: 'RECORD_REMOVED' },
    ]);
    expect(await svc.detect(NOW)).toBe(1);
    expect(prisma.surveyEventOccurrence.createMany).not.toHaveBeenCalled();
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'o1', status: 'SKIPPED' },
      data: { sourceKey: 'hospital:a1', status: 'WAITING', reason: null, dueOn: day('2026-11-22') },
    });
  });

  it('care ended happens once per person: editing the record later never sends it again', async () => {
    const s = survey({ eventTrigger: trigger({ event: 'CARE_ENDED', delayDays: 14, windowDays: 7, options: {} }) });
    const { svc, prisma } = setup({ survey: s });
    prisma.serviceUser.findMany.mockResolvedValueOnce([{ id: 'su1', serviceEndDate: null, updatedAt: new Date('2026-11-15T09:00:00Z') }]);
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([
      { id: 'o1', sourceKey: 'care-ended:su1:2026-11-01', serviceUserId: 'su1', employeeId: null, eventOn: day('2026-11-01'), status: 'SENT', reason: null },
    ]);
    expect(await svc.detect(NOW)).toBe(0);
    expect(prisma.surveyEventOccurrence.createMany).not.toHaveBeenCalled();
  });

  it('a moved care plan review moves its waiting row (not a second survey, and not none)', async () => {
    const s = survey({ eventTrigger: trigger({ event: 'CARE_REVIEW_DUE', delayDays: -10, windowDays: 3, options: { firstReviewOnly: true } }) });
    const { svc, prisma } = setup({ survey: s });
    prisma.serviceUserCarePlanInstance = { findMany: jest.fn(async () => [{ id: 'p1', serviceUserId: 'su1', nextReviewDueAt: day('2026-11-29') }]) };
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([
      { id: 'o1', sourceKey: 'care-review:p1:2026-11-27', serviceUserId: 'su1', employeeId: null, eventOn: day('2026-11-27'), status: 'WAITING', reason: null },
    ]);
    expect(await svc.detect(NOW)).toBe(1);
    expect(prisma.surveyEventOccurrence.createMany).not.toHaveBeenCalled();
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls[0][0].data).toMatchObject({ sourceKey: 'care-review:p1:2026-11-29', status: 'WAITING' });
  });

  it('rows raised for another event (setting changed) are cancelled, never sent as this survey', async () => {
    const { svc, prisma, surveys } = setup({ rows: [occ({ event: 'FIRST_VISIT', sourceKey: 'first-visit:su1' })] });
    await svc.processDue(NOW);
    expect(surveys.sendForEvents).not.toHaveBeenCalled();
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', reason: 'SURVEY_STOPPED' });
  });

  it('an anonymous checked-first batch is not sent back for a second check', async () => {
    const s = survey({ isAnonymous: true, eventTrigger: trigger({ checkFirst: true }) });
    const { svc, prisma } = setup({ survey: s, rows: [occ({ status: 'BATCH' })] });
    const res = await svc.processDue(NOW);
    expect(res.due).toBe(0);
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual({ status: 'BATCH' });
  });

  it('cannot be switched on while a scheduled send is waiting', async () => {
    const s = survey({ eventTrigger: null, distributeAt: new Date('2026-12-01T09:00:00Z'), distributedAt: null });
    const { svc } = setup({ survey: s });
    await expect(svc.saveSettings(manager, 's1', trigger())).rejects.toThrow(/scheduled/);
  });

  it("the names list is hidden from managers who may not see this survey's results", async () => {
    mockResultsAccess.results = false;
    const { svc } = setup({ rows: [occ()] });
    const res = await svc.getSettings(manager, 's1');
    expect(res.data.canSeeList).toBe(false);
    expect(res.data.occurrences).toEqual([]);
  });

  it('a death recorded late (date of death long ago) still stops contact', async () => {
    const { svc, prisma } = setup({ serviceUsers: [] });
    await svc.stopAfterDeaths(NOW);
    expect(prisma.serviceUser.findMany.mock.calls[0][0].where.OR).toContainEqual(expect.objectContaining({ dateOfDeath: { not: null }, updatedAt: expect.anything() }));
  });
});


describe('SurveyEventTriggersService: review fixes', () => {
  it('no real date (care ended without an end date, a death without a date): staff decide, never a guessed send', async () => {
    const { svc, prisma } = setup({ survey: survey({ eventTrigger: trigger({ event: 'CARE_ENDED', delayDays: 14, windowDays: 7 }) }) });
    prisma.serviceUser.findMany.mockResolvedValueOnce([{ id: 'su1', serviceEndDate: null, updatedAt: new Date('2026-11-19T10:00:00Z') }]);
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([]);
    await svc.detect(NOW);
    expect(prisma.surveyEventOccurrence.createMany.mock.calls[0][0].data[0]).toMatchObject({ sourceKey: 'care-ended:su1:nodate', status: 'DUE', reason: 'NO_DATE' });
    const found = await svc.findEvents(survey() as any, trigger({ event: 'DEATH' }) as any, '2026-11-01', '2026-11-20', TZ);
    expect(found).toEqual([]);
    prisma.serviceUser.findMany.mockResolvedValueOnce([{ id: 'su2', dateOfDeath: null, updatedAt: new Date('2026-11-10T10:00:00Z') }]);
    const death = await svc.findEvents(survey() as any, trigger({ event: 'DEATH' }) as any, '2026-11-01', '2026-11-20', TZ);
    expect(death[0]).toMatchObject({ personId: 'su2', noDate: true });
  });

  it('a new delay moves rows still waiting to their new days', async () => {
    const { svc, prisma } = setup();
    prisma.surveyEventOccurrence.findMany.mockResolvedValueOnce([{ id: 'o1', eventOn: day('2026-11-10'), status: 'WAITING' }]);
    await svc.saveSettings(manager, 's1', { event: 'HOSPITAL_DISCHARGE', delayDays: 12, windowDays: 4, exclusions: [], options: { minNights: 1 } });
    const move = prisma.surveyEventOccurrence.updateMany.mock.calls.find((c: any) => c[0].where.id === 'o1')[0];
    expect(move.data).toEqual({ dueOn: day('2026-11-22'), lastDay: day('2026-11-26') });
  });

  it('one staff task per survey even when two servers run at once (a lock, then look again)', async () => {
    const s = survey({ eventTrigger: trigger({ checkFirst: true }) });
    const { svc, prisma } = setup({ survey: s });
    prisma.surveyEventOccurrence.groupBy.mockResolvedValueOnce([{ surveyId: 's1', _count: { _all: 1 } }]);
    // The other server made it while this one waited for the lock.
    prisma.roleTask.findFirst = jest.fn(async () => ({ id: 'already' }));
    await svc.syncTasks(NOW);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.roleTask.create).not.toHaveBeenCalled();
  });

  it('a month copy closed by hand says so (not "could not be reached")', async () => {
    const { svc, prisma, surveys } = setup({ rows: [occ()] });
    surveys.sendForEvents.mockResolvedValueOnce({ periodId: null, sent: [], held: [], skipped: [], already: [], unreachable: ['su1'], deferred: false, periodClosed: true } as any);
    await svc.processDue(NOW);
    expect(prisma.surveyEventOccurrence.updateMany.mock.calls.map((c: any) => c[0].data)).toContainEqual(expect.objectContaining({ status: 'SKIPPED', reason: 'SURVEY_CLOSED' }));
  });

  it('notice given: someone whose leaving record was entered after they left is still checked as due', async () => {
    const s = survey({ targetKind: 'EMPLOYEE', eventTrigger: trigger({ event: 'NOTICE_GIVEN', options: {} }) });
    const row = occ({ serviceUserId: null, employeeId: 'e1', event: 'NOTICE_GIVEN', sourceKey: 'leaving:00000000-0000-4000-8000-0000000000aa' });
    const { svc, prisma } = setup({ survey: s, rows: [row] });
    prisma.employee.findMany.mockResolvedValue([{ id: 'e1', deletedAt: null, isActive: false }]);
    prisma.employeeLeavingRecord.findMany.mockResolvedValue([{ id: '00000000-0000-4000-8000-0000000000aa', employeeId: 'e1', leavingDate: day('2026-11-01'), leavingReason: { name: 'Resigned' } }]);
    const checks = await svc.checkRows([row] as any, readTrigger(s), NOW, TZ);
    expect(checks.get('o1')).toBeNull();
  });
});

function readTrigger(s: any) {
  return { ...s.eventTrigger };
}
