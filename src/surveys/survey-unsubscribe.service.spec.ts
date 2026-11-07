import { SurveyUnsubscribeService } from './survey-unsubscribe.service';
import { SurveyTextRepliesService } from './survey-text-replies.service';
import { SurveyRemindersService } from './survey-reminders.service';
import { SURVEY_UNSUBSCRIBE_REASON } from './survey-eligibility.util';
import { surveyContactMessages } from './survey-contact-messages.util';

const EMP = '11111111-1111-4111-8111-111111111111';

/** The token table, in memory: what the service writes ($executeRaw) and reads back ($queryRaw). */
function tokenTable() {
  const rows: Array<{ tokenHash: string; subjectKind: string; subjectId: string; usedAt: Date | null }> = [];
  const executeRaw = jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT')) rows.push({ tokenHash: values[1], subjectKind: values[2], subjectId: values[3], usedAt: null });
    if (sql.includes('UPDATE')) rows.filter((r) => r.tokenHash === values[0]).forEach((r) => (r.usedAt = new Date()));
    return 1;
  });
  const queryRaw = jest.fn(async (_s: TemplateStringsArray, hash: string) =>
    rows.filter((r) => r.tokenHash === hash).map((r) => ({ subjectKind: r.subjectKind, subjectId: r.subjectId })),
  );
  return { rows, executeRaw, queryRaw };
}

function setup() {
  const table = tokenTable();
  const prisma: any = {
    surveyContactOptOut: {
      upsert: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    employee: { findUnique: jest.fn(async () => ({ isActive: false })) },
    serviceUser: { findUnique: jest.fn(async () => null) },
    $executeRaw: table.executeRaw,
    $queryRaw: table.queryRaw,
  };
  const audit = { logAudit: jest.fn() };
  return { svc: new SurveyUnsubscribeService(prisma, audit as any), prisma, audit, table };
}

describe('Unsubscribe from all surveys (former people)', () => {
  it('the link is an opaque random token: it holds no id, is stored only hashed, and a changed or guessed one is refused', async () => {
    const { svc, table } = setup();
    const token = await svc.token({ subjectKind: 'EMPLOYEE', subjectId: EMP });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain(EMP);
    expect(token).not.toContain(Buffer.from(EMP).toString('base64url').slice(0, 12));
    // Only the hash is kept.
    expect(table.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(table.rows)).not.toContain(token);
    expect(await svc.read(token)).toEqual({ subjectKind: 'EMPLOYEE', subjectId: EMP });
    // A new token for every message.
    expect(await svc.token({ subjectKind: 'EMPLOYEE', subjectId: EMP })).not.toBe(token);
    // One character changed, a guess, the wrong shape, or an old signed link (payload.signature): refused.
    const changed = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await svc.read(changed)).toBeNull();
    expect(await svc.read('A'.repeat(43))).toBeNull();
    expect(await svc.read('nonsense')).toBeNull();
    expect(await svc.read(`${Buffer.from(`EMPLOYEE:${EMP}`).toString('base64url')}.${'a'.repeat(32)}`)).toBeNull();
    expect(await svc.read('é'.repeat(43))).toBeNull();
    expect(await svc.link('https://care.example', { subjectKind: 'EMPLOYEE', subjectId: EMP })).toMatch(/^https:\/\/care\.example\/survey-unsubscribe\/[A-Za-z0-9_-]{43}$/);
    expect(await svc.link(null, { subjectKind: 'EMPLOYEE', subjectId: EMP })).toBeNull();
  });

  it('checking a link changes nothing and reveals only whether it is real', async () => {
    const { svc, prisma } = setup();
    const token = await svc.token({ subjectKind: 'EMPLOYEE', subjectId: EMP });
    expect(await svc.check(token)).toEqual({ valid: true, alreadyDone: false });
    expect(await svc.check('A'.repeat(43))).toEqual({ valid: false, alreadyDone: false });
    expect(prisma.surveyContactOptOut.upsert).not.toHaveBeenCalled();
  });

  it('one click stops every survey message, for good; audited without the person’s details', async () => {
    const { svc, prisma, audit, table } = setup();
    await svc.unsubscribe(await svc.token({ subjectKind: 'EMPLOYEE', subjectId: EMP }));
    expect(prisma.surveyContactOptOut.upsert).toHaveBeenCalledWith({
      where: { subjectKind_subjectId_channel: { subjectKind: 'EMPLOYEE', subjectId: EMP, channel: 'ALL' } },
      create: { subjectKind: 'EMPLOYEE', subjectId: EMP, channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON, recordedById: null },
      update: { reason: SURVEY_UNSUBSCRIBE_REASON },
    });
    expect(audit.logAudit.mock.calls[0][0].newValues).toEqual({ channels: ['ALL'], permanent: true });
    expect(table.rows[0].usedAt).not.toBeNull();
    await expect(svc.unsubscribe('bad.token')).rejects.toThrow(/not valid/);
  });

  it('STOP from someone who has left unsubscribes them from all surveys', async () => {
    const { svc, prisma } = setup();
    const texts = { onReply: jest.fn() } as any;
    const replies = new SurveyTextRepliesService(prisma, { logAudit: jest.fn() } as any, texts, svc);
    jest.spyOn(replies, 'peopleWithMobile').mockResolvedValue([{ subjectKind: 'EMPLOYEE', subjectId: EMP }]);
    await replies.handle({ kind: 'STOP', from: '+447700900123' });
    expect(prisma.surveyContactOptOut.upsert.mock.calls[0][0].create).toMatchObject({ channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON });
    expect(prisma.surveyContactOptOut.create).not.toHaveBeenCalled();
  });

  it('staff can never lift it', async () => {
    const prisma: any = {
      surveyContactOptOut: { findMany: jest.fn(async () => [{ channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON }]) },
    };
    const reminders = Object.create(SurveyRemindersService.prototype) as any;
    reminders.prisma = prisma;
    reminders.requireSubjectInScope = jest.fn(async () => undefined);
    await expect(reminders.setOptOuts({ id: 'u1' }, { subjectKind: 'EMPLOYEE', subjectId: EMP, channels: [] })).rejects.toThrow(/cannot be changed by staff/);
  });

  it('messages to former people carry the link', () => {
    const m = surveyContactMessages({
      kind: 'SERVICE_USER', anonymous: false, reminder: true, title: 'Your care', firstName: 'Ada', link: 'https://care.example/survey/t',
      portalLink: null, closesOn: null, organisation: 'Sunrise', textRepliesSupported: false, unsubscribeLink: 'https://care.example/survey-unsubscribe/x.y',
    });
    expect(m.emailText).toContain('To stop all survey messages from us, for good: https://care.example/survey-unsubscribe/x.y');
    expect(m.text).toContain('Stop all surveys: https://care.example/survey-unsubscribe/x.y');
  });
});
