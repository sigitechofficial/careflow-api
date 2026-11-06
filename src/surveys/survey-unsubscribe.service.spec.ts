import { SurveyUnsubscribeService } from './survey-unsubscribe.service';
import { SurveyTextRepliesService } from './survey-text-replies.service';
import { SurveyRemindersService } from './survey-reminders.service';
import { SURVEY_UNSUBSCRIBE_REASON } from './survey-eligibility.util';
import { surveyContactMessages } from './survey-contact-messages.util';

const config = { get: (k: string) => (k === 'JWT_ACCESS_TOKEN_SECRET' ? 'test-secret' : undefined) } as any;
const EMP = '11111111-1111-4111-8111-111111111111';

function setup() {
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
  };
  const audit = { logAudit: jest.fn() };
  return { svc: new SurveyUnsubscribeService(prisma, audit as any, config), prisma, audit };
}

describe('Unsubscribe from all surveys (former people)', () => {
  it('a signed link names the person only; a changed link is refused', () => {
    const { svc } = setup();
    const token = svc.token({ subjectKind: 'EMPLOYEE', subjectId: EMP });
    expect(svc.read(token)).toEqual({ subjectKind: 'EMPLOYEE', subjectId: EMP });
    expect(svc.read(`${token.split('.')[0]}.AAAA${token.split('.')[1].slice(4)}`)).toBeNull();
    expect(svc.read('nonsense')).toBeNull();
    // A signature of the right length in characters but not in bytes is refused, never an error.
    expect(svc.read(`${token.split('.')[0]}.${'é'.repeat(token.split('.')[1].length)}`)).toBeNull();
    // Another person's id with this person's signature is refused.
    const other = Buffer.from('EMPLOYEE:22222222-2222-4222-8222-222222222222').toString('base64url');
    expect(svc.read(`${other}.${token.split('.')[1]}`)).toBeNull();
    expect(svc.link('https://care.example', { subjectKind: 'EMPLOYEE', subjectId: EMP })).toMatch(/^https:\/\/care\.example\/survey-unsubscribe\//);
  });

  it('one click stops every survey message, for good; audited without the person’s details', async () => {
    const { svc, prisma, audit } = setup();
    await svc.unsubscribe(svc.token({ subjectKind: 'EMPLOYEE', subjectId: EMP }));
    expect(prisma.surveyContactOptOut.upsert).toHaveBeenCalledWith({
      where: { subjectKind_subjectId_channel: { subjectKind: 'EMPLOYEE', subjectId: EMP, channel: 'ALL' } },
      create: { subjectKind: 'EMPLOYEE', subjectId: EMP, channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON, recordedById: null },
      update: { reason: SURVEY_UNSUBSCRIBE_REASON },
    });
    expect(audit.logAudit.mock.calls[0][0].newValues).toEqual({ channels: ['ALL'], permanent: true });
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
