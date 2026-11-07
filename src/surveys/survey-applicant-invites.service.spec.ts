import { BadRequestException } from '@nestjs/common';
import {
  APPLICANT_MIN_BATCH,
  SurveyApplicantInvitesService,
  applicantInviteEmail,
  applicantInvitesBlock,
  isApplicantToken,
} from './survey-applicant-invites.service';

const now = new Date('2026-11-09T09:00:00Z'); // a Monday
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60_000);

const survey = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Your application with us',
  targetKind: 'PUBLIC',
  isAnonymous: true,
  isTemplate: false,
  isCatalogue: false,
  status: 'ACTIVE',
  recurrence: null,
  clonedFromId: null,
  opensAt: null,
  closesAt: null,
  deletedAt: null,
  locationId: null,
  applicantInvitesFrom: daysAgo(20),
  ...over,
});

const candidate = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  firstName: `Ann${id}`,
  email: `${id}@example.com`,
  stage: 'REJECTED',
  stageHistory: [{ toStage: 'REJECTED', createdAt: daysAgo(3) }],
  ...over,
});

function setup(opts: { candidates?: any[]; earlier?: any[]; survey?: any; invited?: string[]; invitedOn?: Record<string, Date>; optedOut?: string[]; base?: string } = {}) {
  const invites: any[] = [];
  const invited: any[] = (opts.invited ?? []).map((candidateId) => ({ candidateId, surveyId: 's1', invitedOn: opts.invitedOn?.[candidateId] ?? daysAgo(30) }));
  const s = opts.survey ?? survey();
  const prisma: any = {
    survey: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id && typeof where.id === 'string') return where.id === s.id ? s : null;
        if (where.applicantInvitesFrom && where.id?.not) return null;
        if (where.applicantInvitesFrom) return s.applicantInvitesFrom ? s : null;
        return s;
      }),
      count: jest.fn(async () => 0),
      update: jest.fn(async ({ data }: any) => Object.assign(s, data)),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
    },
    candidate: { findMany: jest.fn(async ({ where }: any) => (where.id?.notIn ? (opts.earlier ?? []) : (opts.candidates ?? []))) },
    surveyApplicantInvited: {
      findMany: jest.fn(async ({ where }: any) => invited.filter((r) => where.candidateId.in.includes(r.candidateId))),
      createMany: jest.fn(async ({ data }: any) => {
        invited.push(...data);
        return { count: data.length };
      }),
      count: jest.fn(async () => invited.length),
    },
    surveyApplicantInvite: {
      createMany: jest.fn(async ({ data }: any) => {
        invites.push(...data.map((d: any) => ({ used: false, ...d })));
        return { count: data.length };
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = invites.find((i) => i.tokenHash === where.tokenHash);
        return row ? { ...row, survey: s } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = invites.find((i) => i.id === where.id && i.used === where.used && (!where.expiresOn || i.expiresOn >= where.expiresOn.gte));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    surveyContactOptOut: {
      findMany: jest.fn(async ({ where }: any) => (opts.optedOut ?? []).filter((id) => where.subjectId.in.includes(id)).map((subjectId) => ({ subjectId }))),
    },
    companyProfile: { findFirst: jest.fn(async () => ({ displayName: 'Allfor Care Services Limited', companyName: 'Allfor Care Services Limited' })) },
    surveyQuestion: { findMany: jest.fn(async () => []), count: jest.fn(async () => 5) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const audit = { logAudit: jest.fn(async () => undefined) };
  const mail = { send: jest.fn(async () => ({ messageId: 'm' })) };
  const config = { get: jest.fn(() => opts.base ?? 'https://care.example.com') };
  const orgScope = { fromRequestUser: () => ({ locationIds: null }) };
  const unsubscribe = { link: jest.fn(async () => 'https://care.example.com/survey-unsubscribe/x') };
  const service = new SurveyApplicantInvitesService(prisma, audit as any, orgScope as any, config as any, mail as any, unsubscribe as any);
  return { service, prisma, audit, mail, invites, invited, survey: s, unsubscribe };
}

const actor: any = { id: 'u1', permissions: ['surveys.manage'] };

describe('job applicants: one-time links that never identify the applicant', () => {
  it('invites the applicants told the outcome, each with their own one-time link, in a batch of 3 or more', async () => {
    const { service, mail, invites, invited, prisma, audit } = setup({ candidates: [candidate('a'), candidate('b'), candidate('c', { stage: 'WITHDRAWN', stageHistory: [{ toStage: 'WITHDRAWN', createdAt: daysAgo(1) }] })] });
    expect(await service.runBatch(now)).toBe(3);
    expect(mail.send).toHaveBeenCalledTimes(3);
    expect(invites).toHaveLength(3);
    expect(invited.map((r) => r.candidateId).sort()).toEqual(['a', 'b', 'c']);
    // The links: each different, in the email only; the database keeps a hash and never the applicant.
    const links = mail.send.mock.calls.map((c: any) => /https:\/\/care\.example\.com\/survey\/(ap-[\w-]+)/.exec(c[0].text)![1]);
    expect(new Set(links).size).toBe(3);
    for (const row of invites) {
      expect(Object.keys(row).sort()).toEqual(['createdOn', 'expiresOn', 'id', 'surveyId', 'tokenHash', 'used']);
      expect(links).not.toContain(row.tokenHash);
    }
    expect(mail.send.mock.calls[0][0]).toMatchObject({ skipBcc: true, subject: 'How was applying to Allfor Care?' });
    // The audit row has counts only.
    expect(JSON.stringify(audit.logAudit.mock.calls)).not.toMatch(/example\.com|Anna/);
    // Never twice.
    prisma.candidate.findMany.mockResolvedValue([candidate('a'), candidate('b'), candidate('c')]);
    expect(await service.runBatch(now)).toBe(0);
  });

  it('fewer than 3 waiting: nobody is invited this week (the day sent could point to one applicant)', async () => {
    const { service, mail } = setup({ candidates: [candidate('a'), candidate('b')] });
    expect(APPLICANT_MIN_BATCH).toBe(3);
    expect(await service.runBatch(now)).toBe(0);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('leaves out applicants who opted out, were told before invitations were on, or moved on to another stage', async () => {
    const { service, invited } = setup({
      candidates: [
        candidate('a'),
        candidate('b'),
        candidate('c'),
        candidate('d'),
        candidate('old', { stageHistory: [{ toStage: 'REJECTED', createdAt: daysAgo(30) }] }),
        candidate('moved', { stage: 'REJECTED', stageHistory: [{ toStage: 'INTERVIEW', createdAt: daysAgo(1) }] }),
      ],
      optedOut: ['d'],
    });
    expect(await service.runBatch(now)).toBe(3);
    expect(invited.map((r) => r.candidateId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('one invitation per person in 6 months, even when they apply again or have two applications', async () => {
    const { service, invited } = setup({
      candidates: [
        candidate('a'),
        candidate('b'),
        candidate('c'),
        candidate('twice', { email: 'A@example.com' }), // same person as a, a second application
        candidate('again', { email: 'back@example.com' }),
        candidate('later', { email: 'long@example.com' }),
      ],
      earlier: [
        { id: 'old1', email: 'back@example.com' },
        { id: 'old2', email: 'Long@example.com' },
      ],
      invited: ['old1', 'old2'],
      invitedOn: { old1: daysAgo(100), old2: daysAgo(200) },
    });
    expect(await service.runBatch(now)).toBe(4);
    expect(invited.filter((r) => r.surveyId === 's1' && !['old1', 'old2'].includes(r.candidateId)).map((r) => r.candidateId).sort()).toEqual(['a', 'b', 'c', 'later']);
  });

  it('sends nothing without the app’s web address, while the survey is not open, or when it closes within days', async () => {
    const people = [candidate('a'), candidate('b'), candidate('c')];
    expect(await setup({ candidates: people, base: '' }).service.runBatch(now)).toBe(0);
    expect(await setup({ candidates: people, survey: survey({ status: 'DRAFT' }) }).service.runBatch(now)).toBe(0);
    expect(await setup({ candidates: people, survey: survey({ closesAt: daysAgo(-1) }) }).service.runBatch(now)).toBe(0);
    expect(await setup({ candidates: people, survey: survey({ applicantInvitesFrom: null }) }).service.runBatch(now)).toBe(0);
  });

  it('a link works once: used, it says the survey was answered; a refused answer frees it again', async () => {
    const { service, mail } = setup({ candidates: [candidate('a'), candidate('b'), candidate('c')] });
    await service.runBatch(now);
    const token = /\/survey\/(ap-[\w-]+)/.exec(mail.send.mock.calls[0][0].text)![1];
    expect(isApplicantToken(token)).toBe(true);
    const found = (await service.resolve(token, now))!;
    expect(found).toMatchObject({ used: false, expired: false });
    expect(await service.claim(found.id, now)).toBe(true);
    expect(await service.claim(found.id, now)).toBe(false);
    await service.release(found.id);
    expect(await service.claim(found.id, now)).toBe(true);
    expect((await service.resolve(token, now))!.used).toBe(true);
    // Past its last day it can no longer be used.
    const later = new Date(now.getTime() + 40 * 24 * 60 * 60_000);
    expect(await service.resolve('ap-' + 'x'.repeat(32), later)).toBeNull();
    expect(await service.resolve('not-a-link', now)).toBeNull();
  });

  it('only an anonymous survey for people outside the organisation can invite applicants; one survey at a time', async () => {
    expect(applicantInvitesBlock(survey({ targetKind: 'EMPLOYEE' }) as any, false)).toMatch(/outside the organisation/);
    expect(applicantInvitesBlock(survey({ isAnonymous: false }) as any, false)).toMatch(/anonymous/);
    expect(applicantInvitesBlock(survey({ recurrence: { every: 'MONTH' } }) as any, false)).toMatch(/repeating/);
    expect(applicantInvitesBlock(survey() as any, false)).toBeNull();
    const { service, prisma, audit } = setup({ survey: survey({ applicantInvitesFrom: null, isAnonymous: false }) });
    await expect(service.setOn(actor, 's1', true)).rejects.toBeInstanceOf(BadRequestException);
    const ok = setup({ survey: survey({ applicantInvitesFrom: null }) });
    ok.prisma.survey.findMany.mockResolvedValue([{ id: 's0', title: 'Last quarter' }]);
    const res: any = await ok.service.setOn(actor, 's1', true);
    expect(res.data.on).toBe(true);
    expect(ok.prisma.survey.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['s0'] } }, data: { applicantInvitesFrom: null } });
    expect(ok.audit.logAudit.mock.calls[0][0].description).toMatch(/instead of "Last quarter"/);
    expect(prisma.survey.update).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('the email: anonymous and up to them, cannot affect any application, one clear button, a way to stop', () => {
    const m = applicantInviteEmail({
      title: 'Your application with us',
      firstName: 'Sam',
      link: 'https://care.example.com/survey/ap-x',
      brand: { organisation: 'Allfor Care', legalName: null, companyNumber: null, cqcProviderId: null, website: null, contactPhone: '01234 567890', contactEmail: null, logoUrl: null, brandColour: '#132573' },
      minutes: 5,
      linkUntil: 'Wednesday 9 December 2026',
      unsubscribeLink: 'https://care.example.com/survey-unsubscribe/t',
    });
    expect(m.text).toContain('Hi Sam,');
    expect(m.text).toContain('cannot affect this or any future application');
    expect(m.text).toContain('Start the survey: https://care.example.com/survey/ap-x');
    expect(m.text).toContain('The link works until Wednesday 9 December 2026');
    expect(m.html).toContain('https://care.example.com/survey-unsubscribe/t');
  });
});
