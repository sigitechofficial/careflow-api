import { SurveyOutsidePeopleService, checkContactInput } from './survey-outside-people.service';
import { SurveyContactRuleService } from './survey-contact-rule.service';

const NOW = new Date('2026-11-20T10:00:00Z');
const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'GP feedback',
  targetKind: 'PUBLIC',
  isAnonymous: false,
  isTemplate: false,
  isCatalogue: false,
  recurrence: null,
  status: 'ACTIVE',
  closesAt: null,
  deletedAt: null,
  publishedAt: null,
  locationIds: [],
  contactPlan: null,
  clonedFromId: null,
  libraryReference: null,
  ...over,
});
const contact = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  kind: 'PROFESSIONAL',
  name: 'Dr Sam Patel',
  organisation: 'Hill Surgery',
  role: 'GP',
  email: 'sam@hill.example',
  mobile: null,
  phone: null,
  sourceType: 'TYPED',
  sourceId: null,
  serviceUserId: null,
  locationIds: [],
  deletedAt: null,
  ...over,
});

function setup(opts: { survey?: any; contacts?: any[]; optOuts?: any[]; last?: Map<string, any> } = {}) {
  const s = opts.survey ?? survey();
  const prisma: any = {
    survey: { findFirst: jest.fn(async () => s), update: jest.fn() },
    surveyQuestion: { count: jest.fn(async () => 2) },
    surveyExternalContact: {
      findMany: jest.fn(async () => opts.contacts ?? [contact()]),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'fam-1', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ ...(opts.contacts ?? [contact()]).find((c: any) => c.id === where.id), ...data })),
    },
    surveyContactListMember: { findMany: jest.fn(async () => []) },
    surveyContactOptOut: { findMany: jest.fn(async () => opts.optOuts ?? []) },
    surveyRecipient: {
      findMany: jest.fn(async ({ where }: any) => (where.token ? where.token.in.map((t: string, i: number) => ({ token: t, externalContactId: (opts.contacts ?? [contact()])[i]?.id })) : [])),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    serviceUser: { count: jest.fn(async () => 1) },
    serviceUserContact: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    companyProfile: { findFirst: jest.fn(async () => ({ displayName: 'Sunrise Care' })) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }), serviceUserScopeWhere: () => null };
  const config = { get: () => 'https://care.example' };
  const mail = { send: jest.fn() };
  const texts = { isEnabled: () => true, supportsReplies: () => false, send: jest.fn(async () => ({ sent: true })) };
  const contactRule = {
    ruleFor: jest.fn(async () => ({ owner: s, libraryMeta: null, rule: { holdBack: true } })),
    lastContactsExternal: jest.fn(async () => opts.last ?? new Map()),
  };
  const svc = new SurveyOutsidePeopleService(prisma, audit as any, orgScope as any, config as any, mail as any, texts as any, contactRule as any, undefined);
  return { svc, prisma, audit, mail, texts, contactRule };
}
const actor = { id: 'u1', permissions: ['surveys.manage'] } as any;

describe('outside people: contacts', () => {
  it('a contact needs a name and a way to reach them; mobiles are UK mobiles', () => {
    expect(checkContactInput({ kind: 'PROFESSIONAL', name: 'X' } as any)).toMatchObject({ ok: false });
    expect(checkContactInput({ kind: 'PROFESSIONAL', name: 'Dr Patel' } as any)).toMatchObject({ ok: false, message: expect.stringMatching(/email address, a mobile or a phone/) });
    expect(checkContactInput({ kind: 'PROFESSIONAL', name: 'Dr Patel', email: 'nope' } as any)).toMatchObject({ ok: false });
    expect(checkContactInput({ kind: 'PROFESSIONAL', name: 'Dr Patel', mobile: '020 7946 0000' } as any)).toMatchObject({ ok: false });
    expect(checkContactInput({ kind: 'COMMISSIONER', name: 'Jo Bloggs', mobile: '07700 900123' } as any)).toMatchObject({ ok: true, value: { mobile: '+447700900123' } });
  });
});

describe('outside people: sending', () => {
  it('each person gets their own link by email; the audit holds counts only', async () => {
    const { svc, mail, audit, prisma } = setup();
    const res = await svc.sendOutside(actor, 's1', { contactIds: ['x1'] });
    expect(res.data.sent).toBe(1);
    expect(prisma.surveyRecipient.createMany.mock.calls[0][0].data[0]).toMatchObject({ externalContactId: 'x1', targetKind: 'PUBLIC', status: 'SENT' });
    await new Promise((r) => setImmediate(r));
    expect(mail.send.mock.calls[0][0]).toMatchObject({ to: 'sam@hill.example' });
    expect(mail.send.mock.calls[0][0].text).toMatch(/https:\/\/care\.example\/survey\//);
    const entry = audit.logAudit.mock.calls.find((c: any) => c[0].action === 'survey_sent')[0];
    expect(JSON.stringify(entry)).not.toMatch(/Patel|hill\.example/);
  });

  it('anonymous public surveys never get personal links', async () => {
    const { svc } = setup({ survey: survey({ isAnonymous: true }) });
    await expect(svc.sendOutside(actor, 's1', { contactIds: ['x1'] })).rejects.toThrow(/anonymous/);
  });

  it('honours opt-outs, and holds back anyone surveyed in the last 4 weeks unless sent anyway with a reason', async () => {
    const opted = setup({ optOuts: [{ subjectKind: 'EXTERNAL', subjectId: 'x1', channel: 'ALL' }] });
    await expect(opted.svc.sendOutside(actor, 's1', { contactIds: ['x1'] })).rejects.toThrow(/Nobody here/);
    const held = setup({ last: new Map([['x1', { day: '2026-11-10', surveyId: 'other' }]]) });
    const check = await held.svc.checkSendOutside(actor, 's1', { contactIds: ['x1'] });
    expect(check.data).toMatchObject({ sendNow: 0, heldBack: 1 });
    await expect(held.svc.sendOutside(actor, 's1', { contactIds: ['x1'] })).rejects.toThrow(/Nobody here/);
    const anyway = await held.svc.sendOutside(actor, 's1', { contactIds: ['x1'], contactRuleOverride: { reason: 'Contract review this month' } });
    expect(anyway.data.sent).toBe(1);
  });

  it('families: only People involved who agreed to be contacted', async () => {
    const { svc, prisma } = setup({ contacts: [] });
    prisma.serviceUserContact.findMany.mockResolvedValue([{ id: 'c-no', canReceiveUpdates: false }]);
    const check = await svc.checkSendOutside(actor, 's1', { familyContactIds: ['c-no'] });
    expect(check.data).toMatchObject({ noConsent: 1, sendNow: 0 });
  });
});

describe('outside people: family consent and deaths (review)', () => {
  const fam = contact({ id: 'f1', kind: 'FAMILY', name: 'Ann Lee', email: 'ann@example.com', sourceType: 'SERVICE_USER_CONTACT', sourceId: 'c1', serviceUserId: 'su1' });
  const record = (over: any = {}) => ({ id: 'c1', firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com', mobile: null, phone: null, relationshipType: null, deletedAt: null, isActive: true, canReceiveUpdates: true, serviceUserId: 'su1', ...over });

  it('a family member chosen as a contact or from a list is not sent it once consent is withdrawn', async () => {
    const { svc, prisma, mail } = setup({ contacts: [fam] });
    prisma.serviceUserContact.findFirst.mockResolvedValue(record({ canReceiveUpdates: false }));
    prisma.serviceUserContact.findMany.mockResolvedValue([record({ canReceiveUpdates: false })]);
    prisma.serviceUser.findMany = jest.fn(async () => [{ id: 'su1', dateOfDeath: null, status: null }]);
    const check = await svc.checkSendOutside(actor, 's1', { contactIds: ['f1'] });
    expect(check.data).toMatchObject({ sendNow: 0, noConsent: 1 });
    await expect(svc.sendOutside(actor, 's1', { contactIds: ['f1'] })).rejects.toThrow(/Nobody here/);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('never the family of someone who has died, except the bereaved-family survey', async () => {
    const died = [{ id: 'su1', dateOfDeath: new Date('2026-11-01'), status: { code: 'DECEASED' } }];
    const a = setup({ contacts: [fam] });
    a.prisma.serviceUserContact.findFirst.mockResolvedValue(record());
    a.prisma.serviceUserContact.findMany.mockResolvedValue([record()]);
    a.prisma.serviceUser.findMany = jest.fn(async () => died);
    expect((await a.svc.checkSendOutside(actor, 's1', { contactIds: ['f1'] })).data).toMatchObject({ sendNow: 0, died: 1 });
    const b = setup({ contacts: [fam], survey: survey({ libraryReference: 'SUR-FAM-002' }) });
    b.prisma.serviceUserContact.findFirst.mockResolvedValue(record());
    b.prisma.serviceUserContact.findMany.mockResolvedValue([record()]);
    b.prisma.serviceUser.findMany = jest.fn(async () => died);
    expect((await b.svc.checkSendOutside(actor, 's1', { contactIds: ['f1'] })).data).toMatchObject({ sendNow: 1, died: 0 });
  });
});

describe('outside people: after a death, resend, branches (decisions)', () => {
  const died = [{ id: 'su-d', dateOfDeath: new Date('2026-11-01'), status: { code: 'DECEASED' } }];

  it('a survey about one person who has died: professionals only with a recorded reason', async () => {
    const { svc, prisma, audit, mail } = setup({ survey: survey({ aboutServiceUserId: 'su-d' }) });
    prisma.serviceUser.findMany = jest.fn(async () => died);
    expect((await svc.checkSendOutside(actor, 's1', { contactIds: ['x1'] })).data).toMatchObject({ sendNow: 0, afterDeath: 1 });
    await expect(svc.sendOutside(actor, 's1', { contactIds: ['x1'] })).rejects.toThrow(/Nobody here/);
    await expect(svc.sendOutside(actor, 's1', { contactIds: ['x1'], afterDeathReason: 'no' })).rejects.toThrow(/5 to 300/);
    const res = await svc.sendOutside(actor, 's1', { contactIds: ['x1'], afterDeathReason: 'End-of-life care review' });
    expect(res.data.sent).toBe(1);
    const entry = audit.logAudit.mock.calls.at(-1)[0];
    expect(entry.newValues).toMatchObject({ afterDeath: 1, afterDeathReason: 'End-of-life care review' });
    expect(JSON.stringify(entry)).not.toMatch(/Patel|hill\.example/);
    await new Promise((r) => setImmediate(r));
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('send again (lapsed): the same checks, then their own link by the agreed email, never copied to MAIL_BCC', async () => {
    const { svc, prisma, mail } = setup({ survey: survey({ aboutServiceUserId: 'su-d' }) });
    prisma.surveyExternalContact.findFirst.mockResolvedValue(contact());
    prisma.serviceUser.findMany = jest.fn(async () => died);
    const s1 = survey({ aboutServiceUserId: 'su-d' }) as any;
    await expect(svc.checkResend(s1, 'x1')).rejects.toThrow(/has died\. Say why/);
    const ok = await svc.checkResend(s1, 'x1', 'End-of-life care review');
    expect(ok.reasonUsed).toBe('End-of-life care review');
    await svc.deliverOne(s1, 'tok-9', ok.row, undefined);
    const sent = mail.send.mock.calls[0][0];
    expect(sent).toMatchObject({ to: 'sam@hill.example', skipBcc: true });
    expect(sent.text).toContain('https://care.example/survey/tok-9');
    expect(sent.html).toContain('tok-9');
    // Opted out of everything: refused.
    const opted = setup({ optOuts: [{ subjectKind: 'EXTERNAL', subjectId: 'x1', channel: 'ALL' }] });
    opted.prisma.surveyExternalContact.findFirst.mockResolvedValue(contact());
    await expect(opted.svc.checkResend(survey() as any, 'x1')).rejects.toThrow(/asked not to be contacted/);
  });

  it('pathway professionals are listed and added only from cases in the user’s branches', async () => {
    const { svc, prisma } = setup();
    const scoped = { fromRequestUser: () => ({ locationIds: ['loc-1'] }), serviceUserScopeWhere: () => ({ locationId: { in: ['loc-1'] } }) };
    (svc as any).orgScope = scoped;
    prisma.specialistPathwayProfessional = { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) };
    await svc.listSources(actor, 'PATHWAY_PROFESSIONAL');
    expect(prisma.specialistPathwayProfessional.findMany.mock.calls[0][0].where).toMatchObject({ case: { serviceUser: { locationId: { in: ['loc-1'] } } } });
    await expect(svc.addFromSource(actor, 'PATHWAY_PROFESSIONAL', 'p-other')).rejects.toThrow(/Not found/);
  });
});

describe('the 4-week rule for outside people (one real person), and P10', () => {
  function rule(sent: any[], answered: any[], contacts: any[]) {
    const prisma: any = {
      survey: { findMany: jest.fn(async () => []) },
      surveyExternalContact: { findMany: jest.fn(async () => contacts) },
      surveyRecipient: { findMany: jest.fn(async () => sent) },
      surveyResponse: { findMany: jest.fn(async () => answered) },
    };
    return new SurveyContactRuleService(prisma, { logAudit: jest.fn() } as any, { fromRequestUser: () => ({}) } as any, { getOperationalTimezone: async () => 'Europe/London' } as any);
  }
  const sv = (over: any = {}) => ({ id: 'other', isAnonymous: false, targetKind: 'PUBLIC', contactRule: null, libraryMeta: null, libraryReference: null, clonedFrom: null, ...over });

  it('a survey sent to them, or an answer they gave for the person, counts as their contact', async () => {
    const svc = rule(
      [{ externalContactId: 'x1', sentAt: new Date('2026-11-12T10:00:00Z'), survey: sv() }],
      [{ respondentContactId: 'c2', submittedAt: new Date('2026-11-15T10:00:00Z'), survey: sv({ id: 'pws', targetKind: 'SERVICE_USER' }) }],
      [{ id: 'x1', sourceType: 'TYPED', sourceId: null }, { id: 'x2', sourceType: 'SERVICE_USER_CONTACT', sourceId: 'c2' }],
    );
    const last = await svc.lastContactsExternal(['x1', 'x2'], 's1', NOW, 'Europe/London');
    expect(last.get('x1')).toEqual({ day: '2026-11-12', surveyId: 'other' });
    expect(last.get('x2')).toEqual({ day: '2026-11-15', surveyId: 'pws' });
  });

  it('P10: the person’s survey they answered for (SUR-PWS-003) and their own family survey (SUR-FAM-001), linked, are one contact', async () => {
    const svc = rule(
      [],
      [{ respondentContactId: 'c2', submittedAt: new Date('2026-11-17T10:00:00Z'), survey: sv({ id: 'pws', targetKind: 'SERVICE_USER', libraryReference: 'SUR-PWS-003', libraryMeta: { timing: { sentWith: ['SUR-FAM-001'] } } }) }],
      [{ id: 'x2', sourceType: 'SERVICE_USER_CONTACT', sourceId: 'c2' }],
    );
    const linked = await svc.lastContactsExternal(['x2'], 'fam', NOW, 'Europe/London', { reference: 'SUR-FAM-001', sentWith: ['SUR-PWS-003'] });
    expect(linked.has('x2')).toBe(false);
    const other = await svc.lastContactsExternal(['x2'], 'fam', NOW, 'Europe/London', { reference: 'SUR-FAM-003', sentWith: [] });
    expect(other.has('x2')).toBe(true);
  });
});
