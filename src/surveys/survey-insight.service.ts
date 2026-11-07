import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleTaskStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { POSITIVE_SCALES, questionResult, type MetricsQuestion } from '../cqc-evidence/cqc-survey-metrics.util';
import { keyQuestionPrefix } from '../cqc-evidence/cqc-statement-match.util';
import { SurveysService } from './surveys.service';
import { RESULTS_RESTRICTED, RESPONSES_RESTRICTED, isAdminActor, surveyAccessFor, type SurveyAccess } from './survey-access';
import { isAnsweredWithoutName, offersAnswerWithoutName, withoutNameAnswersHeldBack } from './survey-respondent-anonymity.util';
import {
  OTHER_BRANCHES_KEY,
  UNIT_HIDDEN_NOTES,
  cellsToHide,
  heatmapMinimum,
  planColumns,
  pointOf,
  poolPoints,
  questionLineKey,
  unitHiddenReason,
  unitYear,
  type QuestionPoint,
  type SummaryLike,
  type UnitHiddenReason,
} from './survey-insight.util';
import { MIN_ANONYMOUS_GROUP_SIZE, UNKNOWN_GROUP_KEY } from './survey-breakdown.util';
import { THEME_MIN_COUNT, countThemes, writtenPartsOf } from './survey-text-themes.util';
import { QUALITY_FLAGS, QUALITY_FLAG_LABELS, duplicateIds, readQualityFlags, straightLined, type QualityAnswer, type QualityFlag } from './survey-quality.util';
import { bandOf, readScoring, scoreScales, validateScoring, type ScoreBand, type ScoringAnswer } from './survey-scoring.util';

type Unit = Survey;
type Figures = Awaited<ReturnType<SurveysService['figuresFor']>>;
type ShownUnit = { unit: Unit; figures: Figures; hidden: UnitHiddenReason | null };

const OPEN_TASK: RoleTaskStatus[] = [RoleTaskStatus.OPEN, RoleTaskStatus.IN_PROGRESS];

/** CQC key questions, in CQC's order. */
export const KEY_QUESTIONS = [
  { code: 'SAFE', label: 'Safe' },
  { code: 'EFFECTIVE', label: 'Effective' },
  { code: 'CARING', label: 'Caring' },
  { code: 'RESPONSIVE', label: 'Responsive' },
  { code: 'WELL_LED', label: 'Well-led' },
] as const;

/** The 360 report's audiences and the ready-made annual surveys that serve them. */
export const AUDIENCES_360 = [
  { code: 'PEOPLE', label: 'People we support', targetKind: SurveyTargetKind.SERVICE_USER, references: ['SUR-PWS-003'] },
  { code: 'FAMILIES', label: 'Families and representatives', targetKind: SurveyTargetKind.PUBLIC, references: ['SUR-FAM-001'] },
  { code: 'STAFF', label: 'Staff', targetKind: SurveyTargetKind.EMPLOYEE, references: ['SUR-STF-001'] },
  { code: 'PROFESSIONALS', label: 'Professionals', targetKind: SurveyTargetKind.PUBLIC, references: ['SUR-PRO-001'] },
] as const;
export type Audience360 = (typeof AUDIENCES_360)[number]['code'];

export const DASHBOARD_VIEWS = ['REGISTERED_MANAGER', 'BRANCH_MANAGER', 'NOMINATED_INDIVIDUAL'] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

/**
 * Insight (Phase 2 part 5): trends across periods and years, pooled copies of one template, the branch heatmap,
 * themes in written answers, response quality, scores, role dashboards and the 360 report. Every figure comes from
 * the Results engine (SurveysService.figuresFor) or follows its rules: per-survey results access, branch scope,
 * reporting thresholds, held "without a name" answers, and units hidden from every total (see survey-insight.util).
 */
@Injectable()
export class SurveyInsightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditLogsService,
  ) {}

  // ─── Units ──────────────────────────────────────────────────────────────

  async requireResults(actor: RequestUser, surveyId: string): Promise<{ survey: Survey; access: SurveyAccess }> {
    const survey = await this.surveys.visibleSurvey(actor, surveyId);
    if (!survey || survey.isTemplate) throw new NotFoundException('Survey not found');
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.results) throw new ForbiddenException(RESULTS_RESTRICTED);
    return { survey, access };
  }

  /** The survey's units, oldest first: its periods (and its own answers from before it repeated), or itself. */
  private async unitsOf(survey: Survey): Promise<Unit[]> {
    if (survey.clonedFromId) return [survey];
    const periods = await this.prisma.survey.findMany({
      where: { clonedFromId: survey.id, deletedAt: null },
      orderBy: [{ opensAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!periods.length) return [survey];
    const own = await this.prisma.surveyResponse.count({ where: { surveyId: survey.id } });
    return own > 0 ? [survey, ...periods] : periods;
  }

  /** The survey that holds the settings (a period's repeating survey). */
  private async ownerOf(survey: Survey): Promise<Survey> {
    if (!survey.clonedFromId) return survey;
    return (await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey;
  }

  private unlinkedPossible(owner: Survey) {
    return owner.isAnonymous || offersAnswerWithoutName(owner);
  }

  private async shownUnits(owner: Survey, units: Unit[], threshold: number): Promise<ShownUnit[]> {
    const out: ShownUnit[] = [];
    for (const unit of units) {
      const figures = await this.surveys.figuresFor(unit, threshold);
      const hidden = unitHiddenReason({
        responsesInFigures: figures.participation.responsesInFigures,
        threshold,
        closed: unit.status === 'CLOSED',
        unlinkedPossible: this.unlinkedPossible(owner),
      });
      out.push({ unit, figures, hidden });
    }
    return out;
  }

  private unitLabel(owner: Survey, unit: Unit): string {
    if (unit.id === owner.id && unit.clonedFromId === null && owner.recurrence) return 'Before it repeated';
    return unit.title.startsWith(`${owner.title} — `) ? unit.title.slice(owner.title.length + 3) : unit.title;
  }

  private unitOut(owner: Survey, s: ShownUnit) {
    return {
      id: s.unit.id,
      title: s.unit.title,
      label: this.unitLabel(owner, s.unit),
      periodKey: s.unit.periodKey,
      opensAt: iso(s.unit.opensAt),
      closesAt: iso(s.unit.closesAt),
      status: s.unit.status,
      year: unitYear(s.unit),
      shown: s.hidden === null,
      hiddenNote: s.hidden ? UNIT_HIDDEN_NOTES[s.hidden] : null,
      responses: s.hidden === null ? s.figures.participation.responsesInFigures : null,
    };
  }

  /** Lines (questions by wording and type) over shown units, with a point per unit, per year and pooled. */
  private lines(units: ShownUnit[]) {
    type Line = { key: string; questionText: string; questionType: string; sectionTitle: string | null; sortOrder: number; points: Map<string, QuestionPoint> };
    const lines = new Map<string, Line>();
    for (const s of units) {
      if (s.hidden) continue;
      for (const q of (s.figures.questionSummaries ?? []) as Array<SummaryLike & { questionText: string; sectionTitle?: string | null; sortOrder: number; status?: string }>) {
        if (q.status && q.status !== 'current') continue;
        const point = pointOf(q);
        if (!point) continue;
        const key = questionLineKey(q);
        const line = lines.get(key) ?? { key, questionText: q.questionText, questionType: q.questionType, sectionTitle: q.sectionTitle ?? null, sortOrder: q.sortOrder, points: new Map() };
        line.points.set(s.unit.id, point);
        line.sortOrder = q.sortOrder; // the newest unit's order
        lines.set(key, line);
      }
    }
    const years = [...new Set(units.filter((u) => !u.hidden).map((u) => unitYear(u.unit)).filter((y): y is number => y !== null))].sort();
    return [...lines.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.questionText.localeCompare(b.questionText))
      .map((l) => ({
        key: l.key,
        questionText: l.questionText,
        questionType: l.questionType,
        sectionTitle: l.sectionTitle,
        points: units.map((u) => ({ unitId: u.unit.id, point: u.hidden ? null : (l.points.get(u.unit.id) ?? null) })),
        years: years.map((year) => ({
          year,
          point: poolPoints(units.filter((u) => !u.hidden && unitYear(u.unit) === year).map((u) => l.points.get(u.unit.id))),
        })),
        pooled: poolPoints(units.filter((u) => !u.hidden).map((u) => l.points.get(u.unit.id))),
      }));
  }

  // ─── Trends ─────────────────────────────────────────────────────────────

  /** A repeating (or event-sent) survey's questions across its periods and years. */
  async trends(actor: RequestUser, surveyId: string) {
    const { survey, access } = await this.requireResults(actor, surveyId);
    const owner = await this.ownerOf(survey);
    const units = await this.shownUnits(owner, await this.unitsOf(survey), access.threshold);
    const shown = units.filter((u) => !u.hidden);
    return {
      message: 'Survey trends',
      data: {
        surveyId: survey.id,
        title: owner.title,
        isAnonymous: owner.isAnonymous,
        threshold: access.threshold,
        units: units.map((u) => this.unitOut(owner, u)),
        questions: this.lines(units),
        responsesInFigures: shown.reduce((n, u) => n + u.figures.participation.responsesInFigures, 0),
        note: units.some((u) => u.hidden)
          ? 'Periods with too few answers to show (or, where answers can be linked to no one, still open) are left out of every figure and total.'
          : null,
        /** Copies started from the same template or ready-made survey can be pooled. */
        pool: survey.createdFromTemplateId
          ? { templateId: survey.createdFromTemplateId }
          : owner.libraryReference
            ? { libraryReference: owner.libraryReference }
            : null,
      },
    };
  }

  // ─── Pooling ────────────────────────────────────────────────────────────

  private async poolRoots(actor: RequestUser, by: { templateId?: string; libraryReference?: string }) {
    if (!by.templateId && !by.libraryReference) throw new BadRequestException('Choose a template or a ready-made survey to pool.');
    const roots = await this.prisma.survey.findMany({
      where: {
        deletedAt: null,
        isTemplate: false,
        isCatalogue: false,
        clonedFromId: null,
        ...(by.templateId ? { createdFromTemplateId: by.templateId } : { libraryReference: by.libraryReference }),
      },
      orderBy: [{ opensAt: 'asc' }, { createdAt: 'asc' }],
    });
    const out: Array<{ root: Survey; access: SurveyAccess }> = [];
    for (const root of roots) {
      if (!this.surveys.inScope(actor, root)) continue;
      const access = await surveyAccessFor(this.prisma, actor, root);
      if (access.results) out.push({ root, access });
    }
    return out;
  }

  /** Templates and ready-made surveys this user has two or more copies of (results access, their branches). */
  async poolOptions(actor: RequestUser) {
    const rows = await this.prisma.survey.findMany({
      where: { deletedAt: null, isTemplate: false, isCatalogue: false, clonedFromId: null, OR: [{ createdFromTemplateId: { not: null } }, { libraryReference: { not: null } }] },
      select: { id: true, locationIds: true, isTemplate: true, createdFromTemplateId: true, libraryReference: true, clonedFromId: true, createdById: true, isAnonymous: true, allowAnonymousResponses: true, libraryMeta: true, accessPolicy: true, reportingThreshold: true },
    });
    const groups = new Map<string, { templateId: string | null; libraryReference: string | null; copies: number }>();
    for (const r of rows) {
      if (!this.surveys.inScope(actor, r)) continue;
      if (!(await surveyAccessFor(this.prisma, actor, r)).results) continue;
      const key = r.createdFromTemplateId ? `t:${r.createdFromTemplateId}` : `l:${r.libraryReference}`;
      const g = groups.get(key) ?? { templateId: r.createdFromTemplateId, libraryReference: r.createdFromTemplateId ? null : r.libraryReference, copies: 0 };
      g.copies += 1;
      groups.set(key, g);
    }
    const list = [...groups.values()].filter((g) => g.copies >= 2);
    const templates = await this.prisma.survey.findMany({ where: { id: { in: list.map((g) => g.templateId).filter((x): x is string => Boolean(x)) } }, select: { id: true, title: true } });
    const catalogue = await this.prisma.survey.findMany({ where: { isCatalogue: true, libraryReference: { in: list.map((g) => g.libraryReference).filter((x): x is string => Boolean(x)) } }, select: { libraryReference: true, title: true } });
    return {
      message: 'Surveys that can be pooled',
      data: list.map((g) => ({
        ...g,
        title: g.templateId
          ? (templates.find((t) => t.id === g.templateId)?.title ?? 'Template')
          : (catalogue.find((c) => c.libraryReference === g.libraryReference)?.title ?? g.libraryReference),
      })),
    };
  }

  /** One report over every copy of a template or ready-made survey (course sessions, monthly pulses, yearly runs). */
  async pool(actor: RequestUser, by: { templateId?: string; libraryReference?: string }) {
    const roots = await this.poolRoots(actor, by);
    const threshold = roots.reduce((m, r) => Math.max(m, r.access.threshold), 0);
    const units: ShownUnit[] = [];
    const owners = new Map<string, Survey>();
    for (const { root, access } of roots) {
      for (const u of await this.shownUnits(root, await this.unitsOf(root), access.threshold)) {
        units.push(u);
        owners.set(u.unit.id, root);
      }
    }
    units.sort((a, b) => (a.unit.opensAt ?? a.unit.createdAt).getTime() - (b.unit.opensAt ?? b.unit.createdAt).getTime());
    const shown = units.filter((u) => !u.hidden);
    const pooledResponses = shown.reduce((n, u) => n + u.figures.participation.responsesInFigures, 0);
    // The pooled figure needs the highest threshold among the copies (a copy with a stricter rule).
    const pooledBlocked = threshold > 0 && pooledResponses < threshold;
    const lines = this.lines(units).map((l) => (pooledBlocked ? { ...l, pooled: null, years: l.years.map((y) => ({ ...y, point: null })) } : l));
    return {
      message: 'Pooled results',
      data: {
        by,
        copies: roots.map((r) => ({ id: r.root.id, title: r.root.title })),
        threshold,
        units: units.map((u) => ({ ...this.unitOut(owners.get(u.unit.id)!, u), label: u.unit.title })),
        questions: lines,
        responsesInFigures: pooledBlocked ? null : pooledResponses,
        note: 'Only copies whose results you may see, in your branches, are included. Copies with too few answers to show (or, where answers can be linked to no one, still open) are left out of every total.',
      },
    };
  }

  // ─── Answers of shown units (heatmap, themes, quality, scores) ──────────

  private async unitAnswers(owner: Survey, units: ShownUnit[]) {
    const ids = units.filter((u) => !u.hidden).map((u) => u.unit.id);
    const [responses, questions] = await Promise.all([
      this.prisma.surveyResponse.findMany({
        where: { surveyId: { in: ids } },
        select: {
          id: true,
          surveyId: true,
          locationId: true,
          isAnonymous: true,
          channel: true,
          qualityFlags: true,
          answers: { select: { questionId: true, booleanValue: true, textValue: true, numberValue: true, selectedOptions: true, otherText: true, comment: true } },
        },
        orderBy: [{ id: 'asc' }],
      }),
      this.prisma.surveyQuestion.findMany({
        where: { surveyId: { in: ids } },
        select: { id: true, surveyId: true, key: true, questionText: true, questionType: true, options: true, config: true, sectionTitle: true, sortOrder: true, optionsFrom: true },
      }),
    ]);
    // Named survey: answers given without a name stay out until their unit has closed with enough of them.
    const withoutName = new Map<string, number>();
    for (const r of responses) if (isAnsweredWithoutName(r)) withoutName.set(r.surveyId, (withoutName.get(r.surveyId) ?? 0) + 1);
    const status = new Map(units.map((u) => [u.unit.id, u.unit.status]));
    const held = new Set(ids.filter((id) => withoutNameAnswersHeldBack(owner.isAnonymous, withoutName.get(id) ?? 0, status.get(id) === 'CLOSED')));
    return {
      responses: responses
        .filter((r) => !(held.has(r.surveyId) && isAnsweredWithoutName(r)))
        .map((r) => ({ ...r, answers: r.answers.map((a) => ({ ...a, numberValue: a.numberValue == null ? null : Number(a.numberValue) })) })),
      questions: new Map(questions.map((q) => [q.id, q])),
    };
  }

  // ─── Branch heatmap ─────────────────────────────────────────────────────

  async heatmap(actor: RequestUser, surveyId: string) {
    const { survey, access } = await this.requireResults(actor, surveyId);
    const owner = await this.ownerOf(survey);
    const min = heatmapMinimum(access.threshold);
    const base = { surveyId: survey.id, title: owner.title, minimum: min, columns: [] as Array<{ key: string; label: string; responses: number }>, rows: [] as unknown[] };
    if (owner.targetKind === SurveyTargetKind.PUBLIC) {
      return { message: 'Branch heatmap', data: { ...base, note: 'Surveys for the public are not split by branch.' } };
    }
    const all = await this.shownUnits(owner, await this.unitsOf(survey), access.threshold);
    // One period at a time: a branch combined (or left blank) in one period but shown in another would otherwise be
    // worked out by subtracting one period's heatmap from the all-periods one. A repeating survey shows its latest
    // shown period; each period's own heatmap is on that period's results.
    const latest = all.filter((u) => !u.hidden).at(-1) ?? null;
    const units = all.length > 1 ? (latest ? [latest] : []) : all;
    const period = all.length > 1 && latest ? { id: latest.unit.id, label: this.unitLabel(owner, latest.unit) } : null;
    const periodNote = period ? `Showing ${period.label}, the latest period that can be shown; open a period's own results for its branches. ` : '';
    const { responses, questions } = await this.unitAnswers(owner, units);
    const colOf = (r: { locationId: string | null }) => r.locationId ?? UNKNOWN_GROUP_KEY;
    const counts = new Map<string, number>();
    for (const r of responses) counts.set(colOf(r), (counts.get(colOf(r)) ?? 0) + 1);
    const names = new Map(
      (await this.prisma.location.findMany({ where: { id: { in: [...counts.keys()].filter((k) => k !== UNKNOWN_GROUP_KEY) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]),
    );
    const plan = planColumns(
      [...counts].map(([key, n]) => ({ key, label: key === UNKNOWN_GROUP_KEY ? 'No branch recorded' : (names.get(key) ?? 'A branch no longer in use'), responses: n })),
      min,
    );
    const columnOf = new Map<string, string>();
    for (const c of plan.shown) columnOf.set(c.key, c.key);
    for (const k of plan.other?.keys ?? []) columnOf.set(k, OTHER_BRANCHES_KEY);
    const columns = [...plan.shown, ...(plan.other ? [{ key: OTHER_BRANCHES_KEY, label: 'Other branches (combined)', responses: plan.other.responses }] : [])];
    if (responses.length < min || !columns.length) {
      return {
        message: 'Branch heatmap',
        data: {
          ...base,
          note: periodNote + (responses.length < min
            ? `Shown once at least ${min} answers can be counted, so nobody can be identified.`
            : `Not shown: the branches have too few answers each to compare without pointing at someone.`),
          unitsLeftOut: all.filter((u) => u.hidden).length,
          period,
        },
      };
    }
    type Tally = { positive: number; base: number };
    const rows = new Map<string, { key: string; questionText: string; questionType: string; sortOrder: number; kind: 'TOP_TWO' | 'YES'; all: Tally; cells: Map<string, Tally> }>();
    for (const r of responses) {
      const col = columnOf.get(colOf(r)) ?? null;
      for (const a of r.answers) {
        const q = questions.get(a.questionId);
        if (!q || q.optionsFrom) continue;
        const t = answerTally(q, a);
        if (!t) continue;
        const key = questionLineKey(q);
        const row = rows.get(key) ?? { key, questionText: q.questionText, questionType: q.questionType, sortOrder: q.sortOrder, kind: t.kind, all: { positive: 0, base: 0 }, cells: new Map() };
        row.all.positive += t.positive;
        row.all.base += t.base;
        if (col) {
          const c = row.cells.get(col) ?? { positive: 0, base: 0 };
          c.positive += t.positive;
          c.base += t.base;
          row.cells.set(col, c);
        }
        rows.set(key, row);
      }
    }
    const outRows = [...rows.values()]
      .filter((r) => r.all.base > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => {
        const hide = cellsToHide(columns.map((c) => ({ key: c.key, base: r.cells.get(c.key)?.base ?? 0 })), min);
        return {
          key: r.key,
          questionText: r.questionText,
          kind: r.kind,
          overall: { percent: pct(r.all.positive, r.all.base), base: r.all.base },
          cells: columns.map((c) => {
            const t = r.cells.get(c.key);
            return hide.has(c.key) || !t ? { key: c.key, percent: null, base: null } : { key: c.key, percent: pct(t.positive, t.base), base: t.base };
          }),
        };
      });
    return {
      message: 'Branch heatmap',
      data: {
        ...base,
        columns,
        rows: outRows,
        unitsLeftOut: all.filter((u) => u.hidden).length,
        period,
        note: `${periodNote}Each branch shows only with at least ${min} answers; smaller branches are combined, and a cell with too few answers is left blank (with the next smallest when needed), so no branch's figures can be worked out from the others.`,
      },
    };
  }

  // ─── Themes in written answers ──────────────────────────────────────────

  async themes(actor: RequestUser, surveyId: string) {
    const { survey, access } = await this.requireResults(actor, surveyId);
    const owner = await this.ownerOf(survey);
    const allUnits = await this.shownUnits(owner, await this.unitsOf(survey), access.threshold);
    // As the heatmap: one period at a time ("fewer than 3" in one period could otherwise be subtracted from a total).
    const latest = allUnits.filter((u) => !u.hidden).at(-1) ?? null;
    const units = allUnits.length > 1 ? (latest ? [latest] : []) : allUnits;
    const period = allUnits.length > 1 && latest ? { id: latest.unit.id, label: this.unitLabel(owner, latest.unit) } : null;
    const { responses, questions } = await this.unitAnswers(owner, units);
    const min = Math.max(MIN_ANONYMOUS_GROUP_SIZE, access.threshold);
    const all: string[] = [];
    const byLine = new Map<string, { questionText: string; sortOrder: number; texts: string[] }>();
    for (const r of responses) {
      for (const a of r.answers) {
        const parts = writtenPartsOf(a);
        if (!parts.length) continue;
        const q = questions.get(a.questionId);
        if (!q) continue;
        const text = parts.join(' \n ');
        all.push(text);
        const key = questionLineKey(q);
        const line = byLine.get(key) ?? { questionText: q.questionText, sortOrder: q.sortOrder, texts: [] };
        line.texts.push(text);
        byLine.set(key, line);
      }
    }
    const shape = (texts: string[]) =>
      countThemes(texts).map((t) => ({ code: t.code, label: t.label, count: t.count >= THEME_MIN_COUNT ? t.count : null }));
    const enough = all.length >= min;
    return {
      message: 'Themes in written answers',
      data: {
        surveyId: survey.id,
        minimum: min,
        writtenAnswers: enough ? all.length : null,
        themes: enough ? shape(all) : [],
        questions: enough
          ? [...byLine.values()]
              .filter((l) => l.texts.length >= min)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => ({ questionText: l.questionText, writtenAnswers: l.texts.length, themes: shape(l.texts) }))
          : [],
        period,
        note: (period ? `Showing ${period.label}, the latest period that can be shown; open a period's own results for its themes. ` : '') + (enough
          ? `Counted inside CareFlow from the words people used; no written answer is sent anywhere. A theme mentioned fewer than ${THEME_MIN_COUNT} times shows as "fewer than ${THEME_MIN_COUNT}".`
          : `Themes show once at least ${min} written answers can be counted${this.unlinkedPossible(owner) ? ' and the survey (or period) has closed' : ''}, so nobody can be identified.`),
        unitsLeftOut: allUnits.filter((u) => u.hidden).length,
      },
    };
  }

  // ─── Response quality ───────────────────────────────────────────────────

  private qualityOf(
    responses: Awaited<ReturnType<SurveyInsightService['unitAnswers']>>['responses'],
    questions: Map<string, QuestionRow>,
    /** Units whose responses may be compared for duplicates (shown units only: never an open anonymous period). */
    duplicateUnits?: ReadonlySet<string>,
  ) {
    const dup = duplicateIds(duplicateUnits ? responses.filter((r) => duplicateUnits.has(r.surveyId)) : responses);
    const flags = new Map<string, QualityFlag[]>();
    for (const r of responses) {
      const f = new Set<QualityFlag>(readQualityFlags(r.qualityFlags));
      if (straightLined(r.answers, (a) => scalePosition(questions.get(a.questionId), a))) f.add('STRAIGHT_LINE');
      if (dup.has(r.id)) f.add('DUPLICATE');
      if (f.size) flags.set(r.id, [...f]);
    }
    return flags;
  }

  async quality(actor: RequestUser, surveyId: string) {
    const { survey, access } = await this.requireResults(actor, surveyId);
    const owner = await this.ownerOf(survey);
    const units = await this.shownUnits(owner, await this.unitsOf(survey), access.threshold);
    const { responses, questions } = await this.unitAnswers(owner, units);
    const flags = this.qualityOf(responses, questions);
    const counted = responses.length;
    const shown = counted > 0 && counted >= Math.max(1, access.threshold);
    return {
      message: 'Response quality',
      data: {
        surveyId: survey.id,
        responses: shown ? counted : null,
        flagged: shown ? flags.size : null,
        flags: shown
          ? QUALITY_FLAGS.map((f) => ({ flag: f, label: QUALITY_FLAG_LABELS[f], count: [...flags.values()].filter((x) => x.includes(f)).length }))
          : [],
        note: 'Flagged answers are for you to look at. They are never removed and stay in the figures unless you decide otherwise.',
      },
    };
  }

  /** Each flagged response's flags (individual responses access only). */
  async responseFlags(actor: RequestUser, surveyId: string) {
    const { survey, access } = await this.requireResults(actor, surveyId);
    if (!access.responses) throw new ForbiddenException(RESPONSES_RESTRICTED);
    const owner = await this.ownerOf(survey);
    // Every unit (open ones too): the response list shows them already. Duplicates are compared only within units
    // that can be shown (a match on an open anonymous period would date an answer against another).
    const allUnits = await this.unitsOf(survey);
    const units: ShownUnit[] = allUnits.map((unit) => ({ unit, figures: null as never, hidden: null }));
    const shownIds = new Set((await this.shownUnits(owner, allUnits, access.threshold)).filter((u) => !u.hidden).map((u) => u.unit.id));
    const { responses, questions } = await this.unitAnswers(owner, units);
    const flags = this.qualityOf(responses, questions, shownIds);
    return {
      message: 'Response quality flags',
      data: [...flags].map(([responseId, f]) => ({ responseId, flags: f.map((flag) => ({ flag, label: QUALITY_FLAG_LABELS[flag] })) })),
    };
  }

  // ─── Scores ─────────────────────────────────────────────────────────────

  async scores(actor: RequestUser, surveyId: string) {
    const { survey, access } = await this.requireResults(actor, surveyId);
    const owner = await this.ownerOf(survey);
    const scoring = readScoring(owner.scoring);
    if (!scoring) return { message: 'Scores', data: { surveyId: survey.id, scoring: null, scales: [], units: [], note: null } };
    const units = await this.shownUnits(owner, await this.unitsOf(survey), access.threshold);
    const { responses, questions } = await this.unitAnswers(owner, units);
    const qs = [...questions.values()].map((q) => ({ ...q, questionType: q.questionType as string }));
    const asMaps = (rs: typeof responses) => rs.map((r) => new Map(r.answers.map((a) => [a.questionId, a as ScoringAnswer])));
    // Questions by key across units: one key may have a question per unit; scale scores read each unit's own.
    const score = (rs: typeof responses) => {
      const out: ReturnType<typeof scoreScales>[] = [];
      for (const unitId of new Set(rs.map((r) => r.surveyId))) {
        out.push(scoreScales(scoring, qs.filter((q) => q.surveyId === unitId), asMaps(rs.filter((r) => r.surveyId === unitId))));
      }
      return combineScaleResults(scoring.scales, out);
    };
    const enough = responses.length > 0 && responses.length >= Math.max(1, access.threshold);
    return {
      message: 'Scores',
      data: {
        surveyId: survey.id,
        scoring,
        scales: enough ? score(responses) : [],
        units: units
          .filter((u) => !u.hidden)
          .map((u) => ({ id: u.unit.id, label: this.unitLabel(owner, u.unit), scales: score(responses.filter((r) => r.surveyId === u.unit.id)) })),
        note: enough ? null : `Scores show once at least ${Math.max(1, access.threshold)} answers can be counted.`,
      },
    };
  }

  async saveScoring(actor: RequestUser, surveyId: string, input: unknown, meta?: RequestAuditMeta, unlockReasonInput?: unknown) {
    const survey = await this.surveys.visibleSurvey(actor, surveyId);
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.clonedFromId) throw new BadRequestException('Scores are set on the repeating survey, not on one period.');
    // Locked once anyone has answered (the survey or any period): changing scales or bands afterwards would change
    // what earlier figures meant. Admins may unlock with a reason (audited); otherwise change it on the next copy.
    const answered =
      (await this.prisma.surveyResponse.count({ where: { survey: { OR: [{ id: surveyId }, { clonedFromId: surveyId }] } } })) +
      (await this.prisma.surveyPendingResponse.count({ where: { survey: { OR: [{ id: surveyId }, { clonedFromId: surveyId }] } } }));
    const unlockReason = typeof unlockReasonInput === 'string' ? unlockReasonInput.trim() : '';
    if (answered > 0) {
      if (!isAdminActor(actor)) throw new ForbiddenException('Scores are locked once people have answered. Change them on the next copy of the survey, or ask an admin.');
      if (unlockReason.length < 5 || unlockReason.length > 300) throw new BadRequestException('Scores are locked once people have answered. Give the reason for changing them (5 to 300 characters).');
    }
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null },
      select: { id: true, key: true, questionType: true, options: true, config: true },
    });
    const scoring = validateScoring(input, questions);
    await this.prisma.survey.update({ where: { id: surveyId }, data: { scoring: scoring ? (scoring as unknown as Prisma.InputJsonValue) : Prisma.DbNull, updatedById: actor.id } });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SCORING_CHANGED,
      recordType: 'Survey',
      recordId: surveyId,
      description: scoring ? `Survey scoring set (${scoring.scales.length} scale${scoring.scales.length === 1 ? '' : 's'})` : 'Survey scoring removed',
      newValues: {
        scales: scoring?.scales.map((s) => ({ key: s.key, label: s.label, method: s.method, questions: s.questionKeys.length })) ?? [],
        ...(answered > 0 ? { unlockedAfterAnswers: true, reason: unlockReason } : {}),
      },
      ...(meta ?? {}),
    });
    return { message: scoring ? 'Scoring saved' : 'Scoring removed', data: { scoring } };
  }

  // ─── Role dashboards ────────────────────────────────────────────────────

  async dashboard(actor: RequestUser, viewInput?: string, locationId?: string) {
    const view = (DASHBOARD_VIEWS as readonly string[]).includes(viewInput ?? '')
      ? (viewInput as DashboardView)
      : await this.defaultView(actor);
    const all = await this.prisma.survey.findMany({
      where: { deletedAt: null, isTemplate: false, isCatalogue: false, ...(locationId ? { locationIds: { has: locationId } } : {}) },
      orderBy: [{ createdAt: 'desc' }],
    });
    const visible = all.filter((s) => this.surveys.inScope(actor, s));
    const accessOf = new Map<string, SurveyAccess>();
    for (const s of visible) accessOf.set(s.id, await surveyAccessFor(this.prisma, actor, s));
    const results = visible.filter((s) => accessOf.get(s.id)!.results);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Open surveys (periods included) with response rates for those whose counts the viewer may see.
    const open = visible.filter((s) => s.status === 'ACTIVE');
    const openIds = open.map((s) => s.id);
    const recipientGroups = openIds.length
      ? await this.prisma.surveyRecipient.groupBy({ by: ['surveyId', 'status'], where: { surveyId: { in: openIds } }, _count: { _all: true } })
      : [];
    const openSurveys = await Promise.all(open.map(async (s) => {
      const shown = await this.surveys.countsVisible(actor, s);
      const sent = recipientGroups.filter((g) => g.surveyId === s.id).reduce((n, g) => n + g._count._all, 0);
      const done = recipientGroups.filter((g) => g.surveyId === s.id && g.status === 'COMPLETED').reduce((n, g) => n + g._count._all, 0);
      return {
        id: s.id,
        title: s.title,
        targetKind: s.targetKind,
        isAnonymous: s.isAnonymous,
        closesAt: iso(s.closesAt),
        sentTo: s.targetKind === 'PUBLIC' ? null : sent,
        responseRate: shown && s.targetKind !== 'PUBLIC' ? (sent ? Math.round((done / sent) * 100) : 0) : null,
        countsRestricted: !shown,
      };
    }));

    // Alerts on surveys whose results the viewer may see (counts; follow-ups hold the details).
    const resultIds = results.map((s) => s.id);
    const alerts = resultIds.length
      ? await this.prisma.surveyAlert.findMany({ where: { surveyId: { in: resultIds }, roleTaskId: { not: null } }, select: { roleTaskId: true, dueDate: true, urgent: true } })
      : [];
    const openTasks = new Set(
      (await this.prisma.roleTask.findMany({ where: { id: { in: alerts.map((a) => a.roleTaskId!) }, status: { in: OPEN_TASK } }, select: { id: true } })).map((t) => t.id),
    );
    const openAlerts = alerts.filter((a) => openTasks.has(a.roleTaskId!));
    const manage = actor.permissions.includes('surveys.manage');
    const visibleIds = visible.map((s) => s.id);
    const [eventsWaiting, heldBack, callTasks] = manage && visibleIds.length
      ? await Promise.all([
          this.prisma.surveyEventOccurrence.count({ where: { surveyId: { in: visibleIds }, status: 'DUE' } }),
          this.prisma.surveyHeldBack.count({ where: { surveyId: { in: visibleIds }, status: 'HELD' } }),
          this.prisma.roleTask.count({ where: { sourceType: 'SURVEY_CALL_LIST', sourceId: { in: visibleIds }, status: { in: OPEN_TASK } } }),
        ])
      : [null, null, null];

    // Trends: the latest shown periods' headline for each repeating series the viewer may see.
    const series = results.filter((s) => !s.clonedFromId && (s.recurrence || s.eventTrigger)).slice(0, view === 'NOMINATED_INDIVIDUAL' ? 8 : 5);
    const trends = [] as Array<{ surveyId: string; title: string; points: Array<{ label: string; percent: number | null; base: number | null }> }>;
    for (const s of series) {
      const periods = (await this.unitsOf(s)).filter((u) => u.id !== s.id).slice(-4);
      if (!periods.length) continue;
      const units = await this.shownUnits(s, periods, accessOf.get(s.id)!.threshold);
      trends.push({
        surveyId: s.id,
        title: s.title,
        points: units.map((u) => {
          const h = u.hidden ? null : (u.figures.headline as { percent: number | null; base: number } | null);
          return { label: this.unitLabel(s, u.unit), percent: h?.percent ?? null, base: h?.base ?? null };
        }),
      });
    }

    return {
      message: 'Surveys dashboard',
      data: {
        view,
        locationId: locationId ?? null,
        openSurveys: view === 'NOMINATED_INDIVIDUAL' ? openSurveys.slice(0, 10) : openSurveys,
        alerts: {
          open: openAlerts.length,
          overdue: openAlerts.filter((a) => a.dueDate < today).length,
          urgent: openAlerts.filter((a) => a.urgent).length,
        },
        work: view === 'NOMINATED_INDIVIDUAL' ? null : { eventsWaiting, heldBack, callLists: callTasks },
        trends,
        actions: await this.actionCounts(results.map((r) => r.id)),
        totals: {
          surveys: visible.length,
          open: open.length,
          closedThisYear: visible.filter((s) => s.status === 'CLOSED' && (s.closesAt ?? s.updatedAt).getUTCFullYear() === now.getUTCFullYear()).length,
        },
      },
    };
  }

  /** Survey actions (part 6) on surveys whose results the viewer may see: open, overdue, done. */
  private async actionCounts(surveyIds: string[]) {
    if (!surveyIds.length) return { open: 0, overdue: 0, done: 0 };
    const rows = await this.prisma.surveyAction.findMany({ where: { surveyId: { in: surveyIds } }, select: { status: true, dueOn: true } });
    const today = new Date().toISOString().slice(0, 10);
    const open = rows.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS');
    return { open: open.length, overdue: open.filter((r) => r.dueOn.toISOString().slice(0, 10) < today).length, done: rows.filter((r) => r.status === 'DONE').length };
  }

  /** The view that fits the user's role names (Nominated Individual, Branch Manager, else Registered Manager). */
  private async defaultView(actor: RequestUser): Promise<DashboardView> {
    const roles = await this.prisma.userRole.findMany({ where: { userId: actor.id }, select: { role: { select: { name: true } } } }).catch(() => []);
    const names = roles.map((r) => r.role.name.toLowerCase());
    if (names.some((n) => n.includes('nominated'))) return 'NOMINATED_INDIVIDUAL';
    if (names.some((n) => n.includes('branch'))) return 'BRANCH_MANAGER';
    return 'REGISTERED_MANAGER';
  }

  // ─── 360 report ─────────────────────────────────────────────────────────

  async report360(actor: RequestUser, year: number, chosen: Partial<Record<Audience360, string>> = {}) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Choose a year.');
    const audiences = [];
    for (const a of AUDIENCES_360) {
      const candidates = await this.candidates360(actor, a);
      const pick = chosen[a.code] ? candidates.find((c) => c.root.id === chosen[a.code]) : candidates.find((c) => c.units.some((u) => unitYear(u) === year));
      const unit = pick?.units.filter((u) => unitYear(u) === year).at(-1) ?? null;
      let block: Record<string, unknown> = { survey: null, unit: null, responses: null, hiddenNote: pick ? 'No copy of this survey ran in that year.' : 'No survey for this audience found.', headline: null, keyQuestions: [] };
      if (pick && unit) {
        const [shown] = await this.shownUnits(pick.root, [unit], pick.access.threshold);
        const meta = await this.libraryMetaOf(pick.root);
        const questions = await this.prisma.surveyQuestion.findMany({ where: { surveyId: unit.id }, select: { id: true, sectionTitle: true } });
        const kqOf = keyQuestionsBySection(meta);
        const surveyKqs = surveyKeyQuestions(meta);
        const tallies = new Map<string, { positive: number; base: number; questions: number }>();
        if (!shown.hidden) {
          for (const s of (shown.figures.questionSummaries ?? []) as Array<SummaryLike & { questionId: string; status?: string }>) {
            if (s.status && s.status !== 'current') continue;
            const p = pointOf(s);
            if (!p || p.kind !== 'TOP_TWO') continue;
            const section = questions.find((q) => q.id === s.questionId)?.sectionTitle ?? null;
            const kqs = kqsForSection(kqOf, surveyKqs, section);
            for (const kq of kqs) {
              const t = tallies.get(kq) ?? { positive: 0, base: 0, questions: 0 };
              t.positive += p.positive;
              t.base += p.base;
              t.questions += 1;
              tallies.set(kq, t);
            }
          }
        }
        const headline = shown.hidden ? null : (shown.figures.headline as { percent: number | null; base: number } | null);
        block = {
          survey: { id: pick.root.id, title: pick.root.title },
          unit: { id: unit.id, title: unit.title, status: unit.status },
          responses: shown.hidden ? null : shown.figures.participation.responsesInFigures,
          hiddenNote: shown.hidden ? UNIT_HIDDEN_NOTES[shown.hidden] : null,
          headline: headline ? { percent: headline.percent, base: headline.base } : null,
          keyQuestions: KEY_QUESTIONS.map((k) => {
            const t = tallies.get(k.code);
            return { code: k.code, label: k.label, percent: t ? pct(t.positive, t.base) : null, answers: t?.base ?? 0, questions: t?.questions ?? 0 };
          }),
        };
      }
      audiences.push({ code: a.code, label: a.label, candidates: candidates.map((c) => ({ id: c.root.id, title: c.root.title })), ...block });
    }
    return {
      message: '360 report',
      data: {
        year,
        keyQuestions: KEY_QUESTIONS,
        audiences,
        note: 'Each figure is the share of positive answers (the top two on each scale) to that audience’s questions for the key question, from the CQC evidence each question gives. A survey with too few answers, or still open where answers can be linked to no one, is not shown. No written answers are included.',
      },
    };
  }

  private async candidates360(actor: RequestUser, a: (typeof AUDIENCES_360)[number]) {
    const roots = await this.prisma.survey.findMany({
      where: {
        deletedAt: null,
        isTemplate: false,
        isCatalogue: false,
        clonedFromId: null,
        targetKind: a.targetKind,
        OR: [{ libraryReference: { in: [...a.references] } }, ...(a.code === 'FAMILIES' ? [{ audienceGroup: 'FAMILIES' }] : []), ...(a.code === 'PROFESSIONALS' ? [{ audienceGroup: 'PROFESSIONALS' }] : [])],
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    const out: Array<{ root: Survey; access: SurveyAccess; units: Unit[] }> = [];
    for (const root of roots) {
      if (!this.surveys.inScope(actor, root)) continue;
      const access = await surveyAccessFor(this.prisma, actor, root);
      if (!access.results) continue;
      out.push({ root, access, units: await this.unitsOf(root) });
    }
    return out;
  }

  private async libraryMetaOf(root: Survey): Promise<unknown> {
    if (root.libraryMeta) return root.libraryMeta;
    if (!root.libraryReference) return null;
    return (await this.prisma.survey.findFirst({ where: { isCatalogue: true, libraryReference: root.libraryReference }, select: { libraryMeta: true } }))?.libraryMeta ?? null;
  }
}

type QuestionRow = {
  id: string;
  surveyId: string;
  key: string | null;
  questionText: string;
  questionType: string;
  options: Prisma.JsonValue;
  config: Prisma.JsonValue;
  sectionTitle: string | null;
  sortOrder: number;
  optionsFrom: string | null;
};

/** One answer's contribution to a heatmap cell: a scale answer (top two) or a Yes / No. */
export function answerTally(
  q: Pick<QuestionRow, 'id' | 'questionText' | 'questionType' | 'options' | 'config' | 'sectionTitle' | 'sortOrder' | 'key'>,
  a: { booleanValue?: boolean | null; selectedOptions?: unknown },
): { kind: 'TOP_TWO' | 'YES'; positive: number; base: number } | null {
  if (q.questionType === 'YES_NO') {
    return typeof a.booleanValue === 'boolean' ? { kind: 'YES', positive: a.booleanValue ? 1 : 0, base: 1 } : null;
  }
  const r = questionResult(q as MetricsQuestion, [{ questionId: q.id, selectedOptions: a.selectedOptions }], 1);
  if (!r || r.base === 0) return null;
  return { kind: 'TOP_TWO', positive: r.positive ?? 0, base: r.base };
}

/** Position on a five-point scale (1 = best), or null when the answer is not on one. */
export function scalePosition(q: { questionType: string } | undefined, a: QualityAnswer): number | null {
  if (!q || !Array.isArray(a.selectedOptions) || a.selectedOptions.length !== 1) return null;
  const label = a.selectedOptions[0] === 'Neutral' ? 'Neither agree nor disagree' : a.selectedOptions[0];
  for (const scale of POSITIVE_SCALES) {
    const at = scale.labels.indexOf(label as string);
    if (at >= 0) return at + 1;
  }
  return null;
}

/** Key questions per section title, from the library's section evidence ("Safe: …"). */
export function keyQuestionsBySection(meta: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const sections = (meta as { sections?: Array<{ title?: unknown; evidence?: unknown }> } | null)?.sections;
  for (const s of Array.isArray(sections) ? sections : []) {
    if (typeof s?.title !== 'string' || !Array.isArray(s.evidence)) continue;
    const kqs = [...new Set((s.evidence as unknown[]).filter((e): e is string => typeof e === 'string').map(keyQuestionPrefix).filter((k): k is string => Boolean(k)))];
    if (kqs.length) out.set(s.title, kqs);
  }
  return out;
}

/**
 * The key questions a question's section counts towards. When the survey maps its sections to CQC evidence, a section
 * that names none ("Overall", "About you") counts towards none; only a survey with no section mapping at all falls
 * back to its own key questions (otherwise an overall question would be counted under every key question).
 */
export function kqsForSection(bySection: ReadonlyMap<string, string[]>, surveyKqs: string[], section: string | null): string[] {
  if (bySection.size) return (section && bySection.get(section)) || [];
  return surveyKqs;
}

/** The survey's own key questions (libraryMeta.cqc.keyQuestions), for a survey whose sections name none. */
export function surveyKeyQuestions(meta: unknown): string[] {
  const kq = (meta as { cqc?: { keyQuestions?: unknown } } | null)?.cqc?.keyQuestions;
  return Array.isArray(kq) ? kq.filter((k): k is string => typeof k === 'string') : [];
}

/** Scale results from several units combined (people-weighted averages; bands only when every unit's bands show). */
export function combineScaleResults(scales: ReadonlyArray<{ key: string; bands: ScoreBand[] }>, perUnit: Array<ReturnType<typeof scoreScales>>) {
  return scales.map(({ key, bands: bandList }) => {
    const parts = perUnit.map((u) => u.find((s) => s.key === key)).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const first = parts[0];
    const people = parts.reduce((n, s) => n + s.people, 0);
    // From the unrounded sums (a share of the most is rounded only once, at the end).
    const sum = parts.reduce((n, s) => n + s.sum, 0);
    const average = people ? Math.round((sum / people) * 100) / 100 : null;
    const bandsShown = parts.length > 0 && parts.every((p) => p.bands !== null);
    const bands = bandsShown
      ? [...parts.flatMap((p) => p.bands ?? []).reduce((m, b) => m.set(b.label, (m.get(b.label) ?? 0) + b.people), new Map<string, number>())].map(([label, n]) => ({ label, people: n }))
      : null;
    return {
      key,
      label: first?.label ?? key,
      method: first?.method ?? 'MEAN',
      people,
      average: average === null ? null : first?.method === 'PERCENT_OF_MAX' ? Math.round(average) : average,
      band: average === null ? null : bandOf(bandList, average),
      bands,
      sum,
    };
  });
}
