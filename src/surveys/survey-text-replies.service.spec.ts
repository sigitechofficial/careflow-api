import { SURVEY_TEXT_STOP_REASON, SurveyTextRepliesService } from './survey-text-replies.service';

function setup(opts: { staff?: any[]; supported?: any[]; optOuts?: any[] } = {}) {
  const optOuts = [...(opts.optOuts ?? [])];
  const prisma: any = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce(opts.staff ?? [{ employeeId: 'e1', mobileTelephone: '07700 900123' }, { employeeId: 'e2', mobileTelephone: '01632 900123' }])
      .mockResolvedValueOnce(opts.supported ?? [{ id: 'su1', mobile: null, phone: '+44 (0)7700 900123' }]),
    surveyContactOptOut: {
      findMany: jest.fn(async ({ where }: any) => optOuts.filter((o) => o.subjectKind === where.subjectKind && o.subjectId === where.subjectId)),
      create: jest.fn(async ({ data }: any) => optOuts.push(data)),
      deleteMany: jest.fn(),
    },
  };
  const audit = { logAudit: jest.fn() };
  const texts = { onReply: jest.fn() };
  return { svc: new SurveyTextRepliesService(prisma, audit as any, texts as any), prisma, audit, texts };
}

describe('SurveyTextRepliesService', () => {
  it('registers with the text message service', () => {
    const { svc, texts } = setup();
    svc.onModuleInit();
    expect(texts.onReply).toHaveBeenCalledTimes(1);
  });

  it('STOP stops survey texts for everyone whose record holds that mobile, without the number in the audit trail', async () => {
    const { svc, prisma, audit } = setup();
    expect(await svc.handle({ kind: 'STOP', from: '+447700900123' })).toBe(2);
    expect(prisma.surveyContactOptOut.create.mock.calls.map((c: any) => c[0].data)).toEqual([
      { subjectKind: 'EMPLOYEE', subjectId: 'e1', channel: 'TEXT', reason: SURVEY_TEXT_STOP_REASON, recordedById: null },
      { subjectKind: 'SERVICE_USER', subjectId: 'su1', channel: 'TEXT', reason: SURVEY_TEXT_STOP_REASON, recordedById: null },
    ]);
    expect(JSON.stringify(audit.logAudit.mock.calls)).not.toMatch(/7700|900123/);
  });

  it('START lifts only an opt-out a STOP reply made, never one recorded by staff', async () => {
    const { svc, prisma } = setup({
      optOuts: [
        { subjectKind: 'EMPLOYEE', subjectId: 'e1', channel: 'TEXT', reason: SURVEY_TEXT_STOP_REASON },
        { subjectKind: 'SERVICE_USER', subjectId: 'su1', channel: 'TEXT', reason: 'Asked at review not to be texted' },
      ],
    });
    expect(await svc.handle({ kind: 'START', from: '+447700900123' })).toBe(1);
    expect(prisma.surveyContactOptOut.deleteMany).toHaveBeenCalledWith({ where: { subjectKind: 'EMPLOYEE', subjectId: 'e1', channel: 'TEXT', reason: SURVEY_TEXT_STOP_REASON } });
  });
});
