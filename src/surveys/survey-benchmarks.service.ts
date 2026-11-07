import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SurveyStatus } from '@prisma/client';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { answerTally } from './survey-insight.service';
import {
  BENCHMARK_AGREEMENT,
  BENCHMARK_AGREEMENT_VERSION,
  BENCHMARK_BANDS,
  BENCHMARK_KEY,
  BENCHMARK_MIN_ANSWERS,
  BENCHMARK_MIN_ORGANISATIONS,
  BENCHMARK_REFERENCE,
  BENCHMARK_STALE_DAYS,
  BENCHMARK_WINDOW_DAYS,
  benchmarkRows,
  sameAsLibrary,
  sectorFigures,
  type BenchmarkRow,
  type BenchmarkTally,
  type SectorFigure,
} from './survey-benchmark.util';

const SETTING_ID = 'default';
const DAY_MS = 24 * 60 * 60_000;
const MAX_ROWS = 3000;
const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Anonymised sector benchmarks (Phase 3).
 *
 * This agency (when it opts in, under BENCHMARK_AGREEMENT) sends the benchmark service its figures for ready-made
 * questions asked unchanged (survey-benchmark.util.ts) every Monday, and gets back the sector figures. The same API
 * can run the benchmark service itself (SURVEY_BENCHMARK_HUB_KEYS): it keeps each agency's current figures under a
 * hash of its key, never its name, and gives sector figures only to agencies that share, only for questions shared
 * by at least BENCHMARK_MIN_ORGANISATIONS agencies.
 *
 * Settings: SURVEY_BENCHMARK_HUB_URL + SURVEY_BENCHMARK_KEY (an agency); SURVEY_BENCHMARK_HUB_KEYS (the service:
 * comma-separated SHA-256 hex of the agencies' keys).
 */
@Injectable()
export class SurveyBenchmarksService {
  private readonly logger = new Logger(SurveyBenchmarksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private hub(): { url: string; key: string } | null {
    const url = this.config.get<string>('SURVEY_BENCHMARK_HUB_URL')?.trim().replace(/\/+$/, '');
    const key = this.config.get<string>('SURVEY_BENCHMARK_KEY')?.trim();
    return url && key ? { url, key } : null;
  }

  private async setting() {
    return (
      (await this.prisma.surveyBenchmarkSetting.findUnique({ where: { id: SETTING_ID } })) ?? {
        id: SETTING_ID,
        sharing: false,
        agreementVersion: null,
        agreedById: null,
        agreedAt: null,
        lastSyncedAt: null,
        lastSyncError: null,
        updatedAt: new Date(0),
      }
    );
  }

  /** Benchmarks are organisation-wide figures: only for staff who see every branch. */
  private requireWholeOrganisation(actor: RequestUser) {
    const scope = this.orgScope.fromRequestUser(actor);
    if (!scope.companyWide) throw new ForbiddenException('Benchmarks cover the whole organisation, so only staff who see every branch can open them.');
  }

  // ─── Our figures ────────────────────────────────────────────────────────

  /**
   * Our share of positive answers per ready-made question over the last 12 months: closed surveys started from a
   * ready-made survey, only questions still exactly as the ready-made survey asks them. Key `${reference}|${key}`.
   */
  async ourTallies(now = new Date()): Promise<Map<string, BenchmarkTally>> {
    const from = new Date(now.getTime() - BENCHMARK_WINDOW_DAYS * DAY_MS);
    const units = await this.prisma.survey.findMany({
      where: {
        libraryReference: { not: null },
        isTemplate: false,
        isCatalogue: false,
        deletedAt: null,
        status: SurveyStatus.CLOSED,
        OR: [{ closesAt: { gte: from, lte: now } }, { closesAt: null, updatedAt: { gte: from } }],
      },
      select: { id: true, libraryReference: true },
    });
    const tallies = new Map<string, BenchmarkTally>();
    if (!units.length) return tallies;
    const references = [...new Set(units.map((u) => u.libraryReference!))];
    const library = await this.prisma.survey.findMany({
      where: { isCatalogue: true, libraryReference: { in: references } },
      select: { libraryReference: true, questions: { select: { key: true, questionType: true, questionText: true, options: true } } },
    });
    const libQuestion = new Map<string, { questionType: string; questionText: string; options: unknown }>();
    for (const l of library) for (const q of l.questions) if (q.key) libQuestion.set(`${l.libraryReference}|${q.key}`, q);

    for (const unit of units) {
      const questions = await this.prisma.surveyQuestion.findMany({
        where: { surveyId: unit.id, key: { not: null }, optionsFrom: null },
        select: { id: true, key: true, questionText: true, questionType: true, options: true, config: true, sectionTitle: true, sortOrder: true },
      });
      const byId = new Map(
        questions
          .filter((q) => sameAsLibrary(q, libQuestion.get(`${unit.libraryReference}|${q.key}`)))
          .map((q) => [q.id, q]),
      );
      if (!byId.size) continue;
      const answers = await this.prisma.surveyAnswer.findMany({
        where: { questionId: { in: [...byId.keys()] }, response: { surveyId: unit.id } },
        select: { questionId: true, booleanValue: true, selectedOptions: true },
      });
      for (const a of answers) {
        const q = byId.get(a.questionId)!;
        const t = answerTally(q, a);
        if (!t) continue;
        const k = `${unit.libraryReference}|${q.key}`;
        const sum = tallies.get(k) ?? { positive: 0, base: 0 };
        sum.positive += t.positive;
        sum.base += t.base;
        tallies.set(k, sum);
      }
    }
    return tallies;
  }

  /** The ready-made questions' wording, for showing figures (catalogue surveys). */
  private async libraryQuestions(references: string[]) {
    const rows = await this.prisma.survey.findMany({
      where: { isCatalogue: true, libraryReference: { in: references } },
      select: { libraryReference: true, title: true, questions: { select: { key: true, questionText: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { libraryReference: 'asc' },
    });
    return rows;
  }

  // ─── Status and choice ──────────────────────────────────────────────────

  async status(actor: RequestUser) {
    this.requireWholeOrganisation(actor);
    const s = await this.setting();
    const rows = benchmarkRows(await this.ourTallies());
    const library = await this.libraryQuestions([...new Set(rows.map((r) => r.reference))]);
    const titleOf = new Map(library.map((l) => [l.libraryReference, l.title]));
    const textOf = new Map(library.flatMap((l) => l.questions.map((q) => [`${l.libraryReference}|${q.key}`, q.questionText] as const)));
    const agreedBy = s.agreedById
      ? await this.prisma.user.findUnique({ where: { id: s.agreedById }, select: { firstName: true, lastName: true } }).catch(() => null)
      : null;
    return {
      message: 'Survey benchmarks',
      data: {
        sharing: s.sharing,
        agreement: { version: BENCHMARK_AGREEMENT_VERSION, text: BENCHMARK_AGREEMENT },
        agreed: s.agreedAt
          ? { version: s.agreementVersion, at: s.agreedAt.toISOString(), by: agreedBy ? `${agreedBy.firstName ?? ''} ${agreedBy.lastName ?? ''}`.trim() || null : null }
          : null,
        /** The agreement changed since it was accepted: sharing stops until it is accepted again. */
        agreementOutdated: Boolean(s.sharing && s.agreementVersion !== BENCHMARK_AGREEMENT_VERSION),
        serviceConnected: Boolean(this.hub()),
        lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
        lastSyncError: s.lastSyncError,
        canChange: (actor.permissions ?? []).includes('settings.company.update'),
        minAnswers: BENCHMARK_MIN_ANSWERS,
        minOrganisations: BENCHMARK_MIN_ORGANISATIONS,
        /** Exactly what would be shared now (the wording is for reading here; only the row itself is sent). */
        wouldShare: rows.map((r) => ({ ...r, surveyTitle: titleOf.get(r.reference) ?? r.reference, questionText: textOf.get(`${r.reference}|${r.questionKey}`) ?? r.questionKey })),
      },
    };
  }

  async setSharing(actor: RequestUser, dto: { sharing: boolean; agreementVersion?: string | null }, meta?: RequestAuditMeta) {
    this.requireWholeOrganisation(actor);
    if (!(actor.permissions ?? []).includes('settings.company.update')) {
      throw new ForbiddenException('Only someone who can change the company settings can agree to share benchmark figures.');
    }
    if (dto.sharing && dto.agreementVersion !== BENCHMARK_AGREEMENT_VERSION) {
      throw new BadRequestException('Read and accept the current data-sharing agreement first.');
    }
    const before = await this.setting();
    const now = new Date();
    await this.prisma.surveyBenchmarkSetting.upsert({
      where: { id: SETTING_ID },
      create: { id: SETTING_ID, sharing: dto.sharing, ...(dto.sharing ? { agreementVersion: BENCHMARK_AGREEMENT_VERSION, agreedById: actor.id, agreedAt: now } : {}) },
      update: { sharing: dto.sharing, ...(dto.sharing ? { agreementVersion: BENCHMARK_AGREEMENT_VERSION, agreedById: actor.id, agreedAt: now } : {}) },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_BENCHMARK_SHARING_CHANGED,
      recordType: 'SurveyBenchmarkSetting',
      recordId: SETTING_ID,
      description: dto.sharing
        ? `Agreed to share anonymised survey figures with the sector benchmark (agreement ${BENCHMARK_AGREEMENT_VERSION})`
        : 'Stopped sharing survey figures with the sector benchmark',
      oldValues: { sharing: before.sharing },
      newValues: { sharing: dto.sharing, ...(dto.sharing ? { agreementVersion: BENCHMARK_AGREEMENT_VERSION } : {}) },
      ...meta,
    });
    // Share (or withdraw) straight away; the weekly run retries a failure.
    await this.sync(now);
    return this.status(actor);
  }

  // ─── Comparison ─────────────────────────────────────────────────────────

  /** Our figures beside the sector's, per ready-made survey we share. Only while sharing. */
  async compare(actor: RequestUser) {
    this.requireWholeOrganisation(actor);
    const s = await this.setting();
    if (!s.sharing) return { message: 'Survey benchmarks', data: { sharing: false, surveys: [] } };
    const ours = new Map(benchmarkRows(await this.ourTallies()).map((r) => [`${r.reference}|${r.questionKey}`, r]));
    const figures = await this.prisma.surveyBenchmarkFigure.findMany();
    const sector = new Map(figures.map((f) => [`${f.reference}|${f.questionKey}`, f]));
    const references = [...new Set([...[...ours.values()].map((r) => r.reference), ...figures.map((f) => f.reference)])];
    const surveys = (await this.libraryQuestions(references))
      .map((l) => ({
        reference: l.libraryReference!,
        title: l.title,
        questions: l.questions
          .filter((q) => q.key && (ours.has(`${l.libraryReference}|${q.key}`) || sector.has(`${l.libraryReference}|${q.key}`)))
          .map((q) => {
            const k = `${l.libraryReference}|${q.key}`;
            const mine = ours.get(k);
            const f = sector.get(k);
            return {
              key: q.key!,
              questionText: q.questionText,
              ours: mine ? { percent: mine.percent, band: mine.band } : null,
              sector: f ? { organisations: f.organisations, median: f.median, lowerQuartile: f.lowerQuartile, upperQuartile: f.upperQuartile } : null,
            };
          }),
      }))
      .filter((x) => x.questions.length);
    return {
      message: 'Survey benchmarks',
      data: { sharing: true, receivedAt: figures[0]?.receivedAt.toISOString() ?? null, surveys },
    };
  }

  // ─── Sending ────────────────────────────────────────────────────────────

  @Cron('0 6 * * 1', { timeZone: 'Europe/London' })
  async weekly() {
    await this.sync().catch((e) => this.logger.warn(`Survey benchmark sync failed: ${e instanceof Error ? e.message : e}`));
  }

  /**
   * Send our figures (none when not sharing, which withdraws them) and keep the sector figures that come back.
   * Returns what happened; failures are kept for the settings page, never thrown.
   */
  async sync(now = new Date()): Promise<'not-connected' | 'sent' | 'withdrawn' | 'failed'> {
    const hub = this.hub();
    const s = await this.setting();
    // Sharing needs the current agreement: an older one shares nothing until accepted again.
    const sharing = s.sharing && s.agreementVersion === BENCHMARK_AGREEMENT_VERSION;
    if (!hub) {
      if (!sharing) await this.prisma.surveyBenchmarkFigure.deleteMany();
      return 'not-connected';
    }
    const rows = sharing ? benchmarkRows(await this.ourTallies(now)) : [];
    try {
      const res = await fetch(`${hub.url}/survey-benchmark-hub/contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CareFlow-Benchmark-Key': hub.key },
        body: JSON.stringify({ rows }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`The benchmark service answered ${res.status}`);
      const body = (await res.json()) as { data?: { figures?: SectorFigure[] } };
      const figures = (body.data?.figures ?? []).filter(validFigure);
      await this.prisma.$transaction([
        this.prisma.surveyBenchmarkFigure.deleteMany(),
        ...(sharing ? [this.prisma.surveyBenchmarkFigure.createMany({ data: figures.map((f) => ({ ...f, receivedAt: now })) })] : []),
        this.prisma.surveyBenchmarkSetting.upsert({
          where: { id: SETTING_ID },
          create: { id: SETTING_ID, sharing: false, lastSyncedAt: now, lastSyncError: null },
          update: { lastSyncedAt: now, lastSyncError: null },
        }),
      ]);
      return sharing ? 'sent' : 'withdrawn';
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Survey benchmark sync failed: ${why}`);
      await this.prisma.surveyBenchmarkSetting.upsert({
        where: { id: SETTING_ID },
        create: { id: SETTING_ID, sharing: false, lastSyncError: why.slice(0, 300) },
        update: { lastSyncError: why.slice(0, 300) },
      });
      return 'failed';
    }
  }

  // ─── The benchmark service ──────────────────────────────────────────────

  /** The agency's key hash, if the key is one this service accepts. */
  private contributor(key: string | undefined): string {
    const allowed = (this.config.get<string>('SURVEY_BENCHMARK_HUB_KEYS') ?? '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter((k) => /^[0-9a-f]{64}$/.test(k));
    if (!allowed.length || !key || key.length > 200) throw new UnauthorizedException();
    const hash = hashOf(key);
    const ok = allowed.some((a) => timingSafeEqual(Buffer.from(a), Buffer.from(hash)));
    if (!ok) throw new UnauthorizedException();
    return hash;
  }

  /** An agency's figures replace its last ones (none = it stopped sharing); it gets the sector figures back. */
  async receive(key: string | undefined, rows: unknown, now = new Date()) {
    const contributorHash = this.contributor(key);
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new BadRequestException('rows must be a list');
    const clean = new Map<string, BenchmarkRow>();
    for (const r of rows) {
      if (!validRow(r)) throw new BadRequestException('A row is not a benchmark figure');
      clean.set(`${r.reference}|${r.questionKey}`, r);
    }
    await this.prisma.$transaction([
      this.prisma.surveyBenchmarkContribution.deleteMany({ where: { contributorHash } }),
      this.prisma.surveyBenchmarkContribution.createMany({ data: [...clean.values()].map((r) => ({ contributorHash, ...r, receivedAt: now })) }),
    ]);
    if (!clean.size) return { message: 'Withdrawn', data: { figures: [] } };
    const current = await this.prisma.surveyBenchmarkContribution.findMany({
      where: { receivedAt: { gte: new Date(now.getTime() - BENCHMARK_STALE_DAYS * DAY_MS) } },
      select: { contributorHash: true, reference: true, questionKey: true, percent: true },
    });
    return { message: 'Sector figures', data: { figures: sectorFigures(current) } };
  }
}

function validRow(r: unknown): r is BenchmarkRow {
  const x = r as Partial<BenchmarkRow> | null;
  return Boolean(
    x &&
      typeof x.reference === 'string' &&
      BENCHMARK_REFERENCE.test(x.reference) &&
      typeof x.questionKey === 'string' &&
      BENCHMARK_KEY.test(x.questionKey) &&
      Number.isInteger(x.percent) &&
      x.percent! >= 0 &&
      x.percent! <= 100 &&
      (BENCHMARK_BANDS as readonly string[]).includes(x.band as string) &&
      Object.keys(x).length === 4,
  );
}

function validFigure(f: unknown): f is SectorFigure {
  const x = f as Partial<SectorFigure> | null;
  const pc = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100;
  return Boolean(
    x &&
      typeof x.reference === 'string' &&
      BENCHMARK_REFERENCE.test(x.reference) &&
      typeof x.questionKey === 'string' &&
      BENCHMARK_KEY.test(x.questionKey) &&
      Number.isInteger(x.organisations) &&
      x.organisations! >= BENCHMARK_MIN_ORGANISATIONS &&
      pc(x.median) &&
      pc(x.lowerQuartile) &&
      pc(x.upperQuartile),
  );
}
