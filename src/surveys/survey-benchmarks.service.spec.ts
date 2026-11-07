import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SurveyBenchmarksService } from './survey-benchmarks.service';
import { BENCHMARK_AGREEMENT_VERSION, benchmarkRows, quantile, sameAsLibrary, sectorFigures } from './survey-benchmark.util';

const now = new Date('2026-11-09T06:00:00Z');
const KEY = 'agency-key-1';
const hash = (k: string) => createHash('sha256').update(k).digest('hex');

describe('survey benchmark rules', () => {
  it('shares a question only with 10 or more answers, as a whole per cent and a size band', () => {
    const rows = benchmarkRows(
      new Map([
        ['SUR-PWS-001|q1', { positive: 8, base: 9 }],
        ['SUR-PWS-001|q2', { positive: 7, base: 12 }],
        ['SUR-STF-002|q-tell', { positive: 101, base: 130 }],
      ]),
    );
    expect(rows).toEqual([
      { reference: 'SUR-PWS-001', questionKey: 'q2', percent: 58, band: '10-29' },
      { reference: 'SUR-STF-002', questionKey: 'q-tell', percent: 78, band: '100+' },
    ]);
  });

  it('sector figures need 5 agencies, one figure each, shown as the median and middle half', () => {
    const c = (who: string, percent: number, questionKey = 'q1') => ({ contributorHash: who, reference: 'SUR-PWS-001', questionKey, percent });
    const figures = sectorFigures([c('a', 60), c('b', 70), c('c', 80), c('d', 90), c('e', 50), c('a', 99, 'q2'), c('b', 98, 'q2'), c('c', 97, 'q2'), c('d', 96, 'q2')]);
    expect(figures).toEqual([{ reference: 'SUR-PWS-001', questionKey: 'q1', organisations: 5, median: 70, lowerQuartile: 60, upperQuartile: 80 }]);
    expect(quantile([10, 20], 0.5)).toBe(15);
  });

  it('a question changed from the ready-made wording or answers is not comparable', () => {
    const lib = { questionType: 'SINGLE_SELECT', questionText: 'Do carers arrive on time?', options: ['Always', 'Usually'] };
    expect(sameAsLibrary({ ...lib, questionText: ' Do carers  arrive on time? ' }, lib)).toBe(true);
    expect(sameAsLibrary({ ...lib, questionText: 'Do our carers arrive on time?' }, lib)).toBe(false);
    expect(sameAsLibrary({ ...lib, options: ['Always', 'Mostly'] }, lib)).toBe(false);
    expect(sameAsLibrary(lib, undefined)).toBe(false);
  });
});

function setup(opts: { env?: Record<string, string>; setting?: any; companyWide?: boolean; units?: any[]; questions?: any[]; answers?: any[]; library?: any[] } = {}) {
  let setting = opts.setting ?? null;
  const contributions: any[] = [];
  const figures: any[] = [];
  const prisma: any = {
    surveyBenchmarkSetting: {
      findUnique: jest.fn(async () => setting),
      upsert: jest.fn(async ({ create, update }: any) => (setting = setting ? { ...setting, ...update } : { ...create })),
    },
    surveyBenchmarkFigure: {
      findMany: jest.fn(async () => figures),
      deleteMany: jest.fn(async () => figures.splice(0).length),
      createMany: jest.fn(async ({ data }: any) => figures.push(...data)),
    },
    surveyBenchmarkContribution: {
      deleteMany: jest.fn(async ({ where }: any) => {
        for (let i = contributions.length - 1; i >= 0; i--) if (contributions[i].contributorHash === where.contributorHash) contributions.splice(i, 1);
      }),
      createMany: jest.fn(async ({ data }: any) => contributions.push(...data)),
      findMany: jest.fn(async () => contributions),
    },
    survey: {
      findMany: jest.fn(async ({ where }: any) => (where.isCatalogue ? (opts.library ?? []) : (opts.units ?? []))),
    },
    surveyQuestion: { findMany: jest.fn(async ({ where }: any) => (opts.questions ?? []).filter((q: any) => q.surveyId === where.surveyId)) },
    surveyAnswer: { findMany: jest.fn(async ({ where }: any) => (opts.answers ?? []).filter((a: any) => where.questionId.in.includes(a.questionId))) },
    user: { findUnique: jest.fn(async () => ({ firstName: 'Sam', lastName: 'Lee' })) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const env: Record<string, string> = opts.env ?? {};
  const config = { get: (k: string) => env[k] };
  const audit = { logAudit: jest.fn(async () => undefined) };
  const orgScope = { fromRequestUser: () => ({ companyWide: opts.companyWide ?? true, locationIds: null }) };
  const service = new SurveyBenchmarksService(prisma, config as any, audit as any, orgScope as any);
  return { service, prisma, audit, contributions, figures, getSetting: () => setting };
}

const admin: any = { id: 'u1', permissions: ['surveys.manage', 'settings.company.update'] };

describe('SurveyBenchmarksService', () => {
  const yes = (questionId: string) => ({ questionId, booleanValue: true, selectedOptions: null });
  const no = (questionId: string) => ({ questionId, booleanValue: false, selectedOptions: null });
  const lib = [{ libraryReference: 'SUR-PWS-001', title: 'Your care', questions: [{ key: 'q1', questionType: 'YES_NO', questionText: 'Do you feel safe?', options: null, sortOrder: 1 }, { key: 'q2', questionType: 'YES_NO', questionText: 'Are you listened to?', options: null, sortOrder: 2 }] }];

  it('our figures: only closed ready-made surveys, only questions asked exactly as the ready-made survey', async () => {
    const { service } = setup({
      units: [{ id: 's1', libraryReference: 'SUR-PWS-001' }],
      library: lib,
      questions: [
        { id: 'a1', surveyId: 's1', key: 'q1', questionType: 'YES_NO', questionText: 'Do you feel safe?', options: null },
        { id: 'a2', surveyId: 's1', key: 'q2', questionType: 'YES_NO', questionText: 'Do we listen to you?', options: null }, // reworded
      ],
      answers: [...Array(9).fill(yes('a1')), no('a1'), ...Array(10).fill(yes('a2'))],
    });
    const tallies = await service.ourTallies(now);
    expect([...tallies]).toEqual([['SUR-PWS-001|q1', { positive: 9, base: 10 }]]);
  });

  it('only someone who can change company settings agrees, to the current agreement; recorded and audited', async () => {
    const { service, audit, getSetting } = setup();
    await expect(service.setSharing({ ...admin, permissions: ['surveys.manage'] }, { sharing: true, agreementVersion: BENCHMARK_AGREEMENT_VERSION })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setSharing(admin, { sharing: true, agreementVersion: 'old' })).rejects.toBeInstanceOf(BadRequestException);
    const res = await service.setSharing(admin, { sharing: true, agreementVersion: BENCHMARK_AGREEMENT_VERSION });
    expect(getSetting()).toMatchObject({ sharing: true, agreementVersion: BENCHMARK_AGREEMENT_VERSION, agreedById: 'u1' });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_benchmark_sharing_changed', newValues: { sharing: true, agreementVersion: BENCHMARK_AGREEMENT_VERSION } }));
    expect(res.data.serviceConnected).toBe(false);
  });

  it('benchmarks are whole-organisation figures: refused to staff limited to some branches', async () => {
    const { service } = setup({ companyWide: false });
    await expect(service.status(admin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.compare(admin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sends only our figures to the service and keeps the sector figures; stopping withdraws them', async () => {
    const env = { SURVEY_BENCHMARK_HUB_URL: 'https://bench.example.test/', SURVEY_BENCHMARK_KEY: KEY };
    const { service, figures } = setup({
      env,
      setting: { id: 'default', sharing: true, agreementVersion: BENCHMARK_AGREEMENT_VERSION },
      units: [{ id: 's1', libraryReference: 'SUR-PWS-001' }],
      library: lib,
      questions: [{ id: 'a1', surveyId: 's1', key: 'q1', questionType: 'YES_NO', questionText: 'Do you feel safe?', options: null }],
      answers: [...Array(12).fill(yes('a1'))],
    });
    const sector = { reference: 'SUR-PWS-001', questionKey: 'q1', organisations: 6, median: 80, lowerQuartile: 70, upperQuartile: 90 };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: { figures: [sector, { ...sector, questionKey: 'q2', organisations: 2 }] } }) } as any);
    try {
      expect(await service.sync(now)).toBe('sent');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://bench.example.test/survey-benchmark-hub/contributions');
      expect(JSON.parse(init.body as string)).toEqual({ rows: [{ reference: 'SUR-PWS-001', questionKey: 'q1', percent: 100, band: '10-29' }] });
      expect(figures).toEqual([{ ...sector, receivedAt: now }]); // a figure from too few agencies is never kept

      const compared = await service.compare(admin);
      expect(compared.data.surveys).toEqual([
        { reference: 'SUR-PWS-001', title: 'Your care', questions: [{ key: 'q1', questionText: 'Do you feel safe?', ours: { percent: 100, band: '10-29' }, sector: { organisations: 6, median: 80, lowerQuartile: 70, upperQuartile: 90 } }] },
      ]);

      await service.setSharing(admin, { sharing: false });
      expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ rows: [] });
      expect(figures).toEqual([]);
      expect((await service.compare(admin)).data).toEqual({ sharing: false, surveys: [] });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('the service: only known keys, only well-formed figures, replaces an agency’s last figures, needs 5 agencies', async () => {
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5'];
    const { service, contributions } = setup({ env: { SURVEY_BENCHMARK_HUB_KEYS: keys.map(hash).join(',') } });
    const row = (percent: number) => ({ reference: 'SUR-PWS-001', questionKey: 'q1', percent, band: '10-29' });
    await expect(service.receive('nope', [row(50)], now)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.receive(undefined, [row(50)], now)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.receive('k1', [{ ...row(50), name: 'Allfor Care' }], now)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.receive('k1', [row(101)], now)).rejects.toBeInstanceOf(BadRequestException);

    expect((await service.receive('k1', [row(10)], now)).data.figures).toEqual([]); // alone: nothing to see
    await service.receive('k1', [row(50)], now); // replaces k1's figure
    for (const [i, k] of ['k2', 'k3', 'k4'].entries()) await service.receive(k, [row(60 + i * 10)], now);
    expect(contributions.filter((c) => c.contributorHash === hash('k1'))).toHaveLength(1);
    const res = await service.receive('k5', [row(90)], now);
    expect(res.data.figures).toEqual([{ reference: 'SUR-PWS-001', questionKey: 'q1', organisations: 5, median: 70, lowerQuartile: 60, upperQuartile: 80 }]);
    expect(contributions.every((c) => !('name' in c) && c.contributorHash.length === 64)).toBe(true);

    expect((await service.receive('k5', [], now)).data.figures).toEqual([]); // stopped sharing: withdrawn, sees nothing
    expect(contributions.some((c) => c.contributorHash === hash('k5'))).toBe(false);
  });
});
