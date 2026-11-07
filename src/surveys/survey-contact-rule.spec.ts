import { surveyAccessFor } from './survey-access';
import { SurveyContactRuleService } from './survey-contact-rule.service';
import {
  checkContactRuleInput,
  checkSamplingInput,
  chooseSample,
  defaultContactRule,
  effectiveContactRule,
  freeFromDay,
  isHeldBack,
  libraryContactRule,
} from './survey-contact-rule.util';
import { sentWithProblems, validateLibrarySurvey } from '../../prisma/seed-lib/survey-library';

jest.mock('./survey-access', () => ({ surveyAccessFor: jest.fn() }));
const access = surveyAccessFor as jest.Mock;

const exemptLib = { timing: { contactRule: { holdBack: false, countsAsContact: true } } };

describe('the 4-week rule (helpers)', () => {
  it('is free 28 days after the last contact day', () => {
    expect(freeFromDay('2026-11-01')).toBe('2026-11-29');
    expect(isHeldBack('2026-11-01', '2026-11-28')).toBe(true);
    expect(isHeldBack('2026-11-01', '2026-11-29')).toBe(false);
  });

  it('follows the survey’s own setting, then the library’s, then both on', () => {
    expect(effectiveContactRule({ contactRule: null })).toMatchObject({ holdBack: true, countsAsContact: true, source: 'DEFAULT' });
    expect(effectiveContactRule({ contactRule: null }, exemptLib)).toMatchObject({ holdBack: false, source: 'LIBRARY' });
    expect(effectiveContactRule({ contactRule: { holdBack: true, countsAsContact: true, reason: 'Part B follow-up' } }, exemptLib)).toMatchObject({
      holdBack: true,
      source: 'SURVEY',
    });
  });

  it('a setting different from the default needs a reason, in either direction (a copy can switch hold-back back on)', () => {
    expect(checkContactRuleInput({ holdBack: false, countsAsContact: true }, null)).toMatchObject({ ok: false });
    expect(checkContactRuleInput({ holdBack: false, countsAsContact: true, reason: 'Required by complaints policy' }, null)).toMatchObject({ ok: true });
    expect(checkContactRuleInput({ holdBack: true, countsAsContact: true }, exemptLib)).toMatchObject({ ok: false });
    expect(checkContactRuleInput({ holdBack: true, countsAsContact: true, reason: 'Part B: follow-up copy' }, exemptLib)).toEqual({
      ok: true,
      rule: { holdBack: true, countsAsContact: true, whenHeld: 'DELAY', reason: 'Part B: follow-up copy' },
    });
    // The same as the default is stored as the default.
    expect(checkContactRuleInput({ holdBack: false, countsAsContact: true }, exemptLib)).toEqual({ ok: true, rule: null });
  });

  it('sampling takes the share asked least often first, never below the minimum', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const asked = new Map(ids.map((id, i) => [id, i < 5 ? 2 : 0]));
    const picked = chooseSample(ids, 30, asked, 0, () => 0);
    expect(picked).toHaveLength(3);
    expect(picked.every((id) => ['f', 'g', 'h', 'i', 'j'].includes(id))).toBe(true);
    expect(chooseSample(ids, 10, new Map(), 5)).toHaveLength(5);
    expect(checkSamplingInput({ percent: 2 })).toMatchObject({ ok: false });
    expect(checkSamplingInput({ percent: 100 })).toEqual({ ok: true, sampling: null });
  });
});

function setup(rows: any[], surveys: Record<string, any> = {}) {
  const prisma: any = {
    survey: {
      findUnique: jest.fn(async ({ where }: any) => surveys[where.id] ?? null),
      findFirst: jest.fn(async ({ where }: any) => surveys[where.id] ?? null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ where, data }: any) => ({ ...surveys[where.id], ...data })),
    },
    surveyRecipient: { findMany: jest.fn(async () => rows), groupBy: jest.fn(async () => []) },
    surveyHeldBack: { findMany: jest.fn(async () => []), createMany: jest.fn() },
    employeePersonalDetail: { findMany: jest.fn(async () => [{ employeeId: 'e1', firstName: 'Zara', lastName: 'Ali' }]) },
    serviceUser: { findMany: jest.fn(async () => []) },
  };
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }) };
  const orgSettings = { getOperationalTimezone: async () => 'Europe/London' };
  return { svc: new SurveyContactRuleService(prisma, audit as any, orgScope as any, orgSettings as any), prisma, audit };
}

const NOW = new Date('2026-11-11T11:00:00Z');
const row = (over: any = {}) => ({
  employeeId: 'e1',
  serviceUserId: null,
  sentAt: new Date('2026-11-02T10:00:00Z'),
  addedByAnswer: false,
  ...over,
  survey: { id: 'other', isAnonymous: false, contactRule: null, libraryMeta: null, libraryReference: null, clonedFrom: null, ...(over.survey ?? {}) },
});
const actor = { id: 'u1', roles: [], permissions: [] } as any;
const thisSurvey = {
  id: 's1',
  title: 'Staff survey',
  targetKind: 'EMPLOYEE',
  clonedFromId: null,
  contactRule: null,
  libraryMeta: null,
  libraryReference: null,
  sampling: null,
  deletedAt: null,
  locationIds: [],
};

describe('SurveyContactRuleService', () => {
  beforeEach(() => access.mockReset());

  it('a survey sent in the last 4 weeks is a contact; one that does not count, or rows made by answering an anonymous survey, are not', async () => {
    const { svc } = setup([
      row(),
      row({ employeeId: 'e2', survey: { contactRule: { holdBack: false, countsAsContact: false, reason: 'Pulse' } } }),
      row({ employeeId: 'e3', addedByAnswer: true, survey: { isAnonymous: true } }),
      row({ employeeId: 'e4', addedByAnswer: true }),
    ]);
    const last = await svc.lastContacts('EMPLOYEE', ['e1', 'e2', 'e3', 'e4'], 's1', NOW, 'Europe/London');
    expect([...last.keys()].sort()).toEqual(['e1', 'e4']);
    expect(last.get('e1')).toEqual({ day: '2026-11-02', surveyId: 'other' });
  });

  it('leaves out only this series, keeping surveys that are not periods (no NOT on a null column)', async () => {
    const { svc, prisma } = setup([]);
    await svc.lastContacts('EMPLOYEE', ['e1'], 's1', NOW, 'Europe/London');
    const where = prisma.surveyRecipient.findMany.mock.calls[0][0].where.survey;
    expect(where).toMatchObject({ id: { not: 's1' }, OR: [{ clonedFromId: null }, { clonedFromId: { not: 's1' } }] });
    expect(where).not.toHaveProperty('NOT');
  });

  it('a response recorded by staff on a named survey counts as a contact', async () => {
    const { svc } = setup([row({ addedByAnswer: true })]);
    expect((await svc.lastContacts('EMPLOYEE', ['e1'], 's1', NOW, 'Europe/London')).has('e1')).toBe(true);
  });

  it('library rules come from the ready-made survey by its reference', async () => {
    const { svc, prisma } = setup([row({ survey: { libraryReference: 'SUR-STF-002' } })]);
    prisma.survey.findMany.mockResolvedValue([
      { libraryReference: 'SUR-STF-002', libraryMeta: { timing: { contactRule: { holdBack: false, countsAsContact: false } } } },
    ]);
    expect((await svc.lastContacts('EMPLOYEE', ['e1'], 's1', NOW, 'Europe/London')).size).toBe(0);
  });

  it('holds back recently surveyed people unless sent anyway', async () => {
    const { svc } = setup([row()], { s1: thisSurvey });
    const res = await svc.apply(thisSurvey as any, 'EMPLOYEE', ['e1', 'e9'], { now: NOW, chosenPeople: false });
    expect(res.sendIds).toEqual(['e9']);
    expect(res.held).toEqual([{ personId: 'e1', lastContactDay: '2026-11-02', freeFrom: '2026-11-30' }]);
    const anyway = await svc.apply(thisSurvey as any, 'EMPLOYEE', ['e1', 'e9'], { now: NOW, chosenPeople: false, override: true });
    expect(anyway.sendIds).toEqual(['e1', 'e9']);
  });

  it('never names the other survey (or its date) to someone who cannot see its results', async () => {
    const other = { id: 'other', title: 'After a distressing event', deletedAt: null, locationIds: [] };
    const { svc, prisma } = setup([row()], { s1: thisSurvey, other });
    prisma.surveyHeldBack.findMany.mockResolvedValue([
      { id: 'h1', employeeId: 'e1', serviceUserId: null, status: 'HELD', freeFrom: new Date('2026-11-30T00:00:00Z'), resolvedAt: null, overrideReason: null },
    ]);
    access.mockResolvedValue({ results: false, responses: false });
    // Someone who can only read surveys does not see free days either.
    expect((await svc.getSettings(actor, 's1')).data.held[0].freeFrom).toBeNull();
    const manager = { ...actor, permissions: ['surveys.manage'] };
    const hidden = await svc.getSettings(manager, 's1');
    expect(hidden.data.held[0]).toMatchObject({ name: 'Zara Ali', freeFrom: '2026-11-30', otherSurvey: null });
    expect(JSON.stringify(hidden)).not.toMatch(/distressing|2026-11-02/);
    access.mockResolvedValue({ results: true, responses: true });
    const shown = await svc.getSettings(manager, 's1');
    expect(shown.data.held[0].otherSurvey).toEqual({ id: 'other', title: 'After a distressing event', on: '2026-11-02' });
  });

  it('changing the rule is audited, and needs a reason when it differs from the default', async () => {
    const { svc, audit } = setup([], { s1: thisSurvey });
    await expect(svc.saveSettings(actor, 's1', { rule: { holdBack: false, countsAsContact: true } })).rejects.toThrow(/Say why/);
    await svc.saveSettings(actor, 's1', { rule: { holdBack: false, countsAsContact: true, reason: 'Short pulse, 3 minutes' } });
    expect(audit.logAudit.mock.calls[0][0]).toMatchObject({
      action: 'survey_contact_rule_changed',
      newValues: { rule: { holdBack: false, reason: 'Short pulse, 3 minutes' } },
    });
  });

  it('linked parts sent together (timing.sentWith) never hold each other back, within a few days', async () => {
    const partnerMeta = { timing: { sentWith: ['SUR-STF-001'] } };
    const { svc, prisma } = setup([
      row({ survey: { id: 'p12', libraryReference: 'SUR-STF-012' } }),
      row({ employeeId: 'e2', sentAt: new Date('2026-10-20T10:00:00Z'), survey: { id: 'p12', libraryReference: 'SUR-STF-012' } }),
    ]);
    prisma.survey.findMany.mockResolvedValue([{ libraryReference: 'SUR-STF-012', libraryMeta: partnerMeta }]);
    const linked = { reference: 'SUR-STF-001', sentWith: ['SUR-STF-012'] };
    // Sent 2 days ago? No: 9 days before NOW is outside the few days, so it still counts.
    const near = await svc.lastContacts('EMPLOYEE', ['e1'], 's1', new Date('2026-11-05T10:00:00Z'), 'Europe/London', linked);
    expect(near.has('e1')).toBe(false);
    const far = await svc.lastContacts('EMPLOYEE', ['e2'], 's1', new Date('2026-11-05T10:00:00Z'), 'Europe/London', linked);
    expect(far.has('e2')).toBe(true);
    // Unlinked surveys still count.
    const none = await svc.lastContacts('EMPLOYEE', ['e1'], 's1', new Date('2026-11-05T10:00:00Z'), 'Europe/London');
    expect(none.has('e1')).toBe(true);
  });

  it('skip, do not delay: a survey that skips held people sends to the free ones and records the rest as not sent', async () => {
    const skipping = { ...thisSurvey, contactRule: { holdBack: true, countsAsContact: true, whenHeld: 'SKIP', reason: 'Tier 4: supervision feedback' } };
    const { svc, prisma } = setup([row()], { s1: skipping });
    const res = await svc.apply(skipping as any, 'EMPLOYEE', ['e1', 'e9'], { now: NOW, chosenPeople: false });
    expect(res.sendIds).toEqual(['e9']);
    expect(res.held).toEqual([]);
    expect(res.skipped.map((h) => h.personId)).toEqual(['e1']);
    await svc.recordHeld('s1', 'EMPLOYEE', res.skipped, 'SKIPPED');
    expect(prisma.surveyHeldBack.createMany.mock.calls[0][0].data[0]).toMatchObject({ status: 'SKIPPED', employeeId: 'e1' });
  });

  it('with sampling on, people held back are still reported as held (never dropped silently)', async () => {
    const sampled = { ...thisSurvey, sampling: { percent: 50 } };
    const { svc } = setup([row()], { s1: sampled });
    const res = await svc.apply(sampled as any, 'EMPLOYEE', ['e1', 'e8', 'e9'], { now: NOW, chosenPeople: false });
    expect(res.held.map((h) => h.personId)).toEqual(['e1']);
    expect(res.sendIds).toHaveLength(1);
    expect(res.sampledOut).toBe(1);
  });

  it('"Do not send" on held people is audited as a count and the reason only', async () => {
    const { svc, prisma, audit } = setup([], { s1: thisSurvey });
    prisma.surveyHeldBack.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
    prisma.surveyHeldBack.updateMany = jest.fn(async () => ({ count: 2 }));
    await expect(svc.skipHeld(actor, 's1', { reason: 'no' })).rejects.toThrow(/5 to 300/);
    const res = await svc.skipHeld(actor, 's1', { reason: 'Covered at supervision' });
    expect(res.data.notSent).toBe(2);
    const entry = audit.logAudit.mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'survey_held_back_not_sent', newValues: { notSent: 2, reason: 'Covered at supervision' } });
    expect(JSON.stringify(entry)).not.toMatch(/Zara|e1|h1/);
  });
});

describe('the 4-week rule: defaults, library reasons and linked parts', () => {
  it('anonymous staff surveys follow the all-staff calendar: they neither hold back nor count', () => {
    expect(defaultContactRule({ targetKind: 'EMPLOYEE', isAnonymous: true })).toMatchObject({ holdBack: false, countsAsContact: false, calendar: true });
    expect(defaultContactRule({ targetKind: 'EMPLOYEE', isAnonymous: false })).toMatchObject({ holdBack: true, countsAsContact: true });
    // People we support: one survey in any 4 weeks, anonymous or not.
    expect(defaultContactRule({ targetKind: 'SERVICE_USER', isAnonymous: true })).toMatchObject({ holdBack: true, countsAsContact: true });
    expect(effectiveContactRule({ contactRule: null, targetKind: 'EMPLOYEE', isAnonymous: true })).toMatchObject({ countsAsContact: false, source: 'DEFAULT' });
    // A copy may switch it back on with a reason.
    expect(checkContactRuleInput({ holdBack: true, countsAsContact: true }, null, { targetKind: 'EMPLOYEE', isAnonymous: true })).toMatchObject({ ok: false });
  });

  it('the library rule keeps its reason and whenHeld', () => {
    expect(libraryContactRule({ timing: { contactRule: { holdBack: true, countsAsContact: true, whenHeld: 'skip', reason: 'Tier 4' } } })).toEqual({
      holdBack: true, countsAsContact: true, whenHeld: 'SKIP', reason: 'Tier 4',
    });
    // whenHeld differs from the default: needs a reason on a copy.
    expect(checkContactRuleInput({ holdBack: true, countsAsContact: true, whenHeld: 'SKIP' }, null)).toMatchObject({ ok: false });
    expect(checkContactRuleInput({ holdBack: true, countsAsContact: true, whenHeld: 'SKIP', reason: 'Routine, sampled' }, null)).toEqual({
      ok: true, rule: { holdBack: true, countsAsContact: true, whenHeld: 'SKIP', reason: 'Routine, sampled' },
    });
  });

  it('the library checker wants a reason on every rule, and linked parts that exist and link back', () => {
    const base = { reference: 'SUR-STF-006', timing: { when: 'x', recurrence: null, trigger: null, contactRule: { holdBack: true, countsAsContact: true, whenHeld: 'skip' } } };
    const errs = validateLibrarySurvey(base, 'f.json');
    expect(errs.some((e) => /contactRule\.reason/.test(e))).toBe(true);
    const ok = validateLibrarySurvey({ ...base, timing: { ...base.timing, contactRule: { ...base.timing.contactRule, reason: 'Tier 4: skipped, not delayed' } } }, 'f.json');
    expect(ok.some((e) => /contactRule/.test(e))).toBe(false);
    const t = (sentWith?: string[]) => ({ when: 'x', recurrence: null, trigger: null, ...(sentWith ? { sentWith } : {}) });
    expect(sentWithProblems([
      { reference: 'SUR-STF-001', audience: 'EMPLOYEE', timing: t(['SUR-STF-012']) },
      { reference: 'SUR-STF-012', audience: 'EMPLOYEE', timing: t(['SUR-STF-001']) },
    ] as any)).toEqual([]);
    expect(sentWithProblems([
      { reference: 'SUR-STF-001', audience: 'EMPLOYEE', timing: t(['SUR-STF-012']) },
      { reference: 'SUR-STF-012', audience: 'EMPLOYEE', timing: t() },
    ] as any)).toEqual(['SUR-STF-001: timing.sentWith SUR-STF-012 must list SUR-STF-001 back']);
    expect(sentWithProblems([{ reference: 'SUR-STF-001', audience: 'EMPLOYEE', timing: t(['SUR-STF-099']) }] as any)[0]).toMatch(/not in the library/);
  });
});
