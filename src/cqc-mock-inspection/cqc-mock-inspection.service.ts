import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CqcEvidenceStatus,
  CqcEvidenceSourceType,
  CqcMockActionStatus,
  CqcMockInspectionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { surveysWithoutResultsAccess } from '../surveys/survey-access';
import { CqcEvidenceService } from '../cqc-evidence/cqc-evidence.service';
import { CqcFrameworkService } from '../cqc-evidence/cqc-framework.service';
import { contentDisposition } from '../policies/policy-upload.util';
import {
  buildMockInspectionPdf,
  reportFileName,
} from './cqc-mock-inspection-pdf.util';
import {
  compareInspections,
  type ComparableInspection,
} from './cqc-mock-inspection-compare.util';
import {
  DEFAULT_CHECK_SCORING,
  checkScoringProblem,
  inspectionResult,
  isValidScore,
  parseScoringRules,
  readCheckScoring,
  scoreFromChecks,
  type CheckScoring,
  type CqcScoringRules,
  type InspectionResult,
} from './cqc-mock-inspection-scoring.util';
import type {
  CreateCqcMockActionDto,
  CreateCqcMockInspectionDto,
  ListCqcMockInspectionsQueryDto,
  ScoreStatementDto,
  UpdateCqcMockActionDto,
  UpdateCqcMockInspectionDto,
  UpdateCqcMockInspectionSettingsDto,
} from './dto/cqc-mock-inspection.dto';
import { CHECK_PARTS } from './dto/cqc-mock-inspection.dto';

export const inspectionInclude = {
  frameworkVersion: {
    select: {
      id: true,
      version: true,
      code: true,
      title: true,
      scoringRules: true,
      keyQuestions: {
        select: { code: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  },
  template: { select: { id: true, code: true, title: true, statements: true } },
  statements: {
    include: {
      statement: {
        select: {
          id: true,
          code: true,
          title: true,
          summary: true,
          displayOrder: true,
          keyQuestion: {
            select: { code: true, title: true, displayOrder: true },
          },
        },
      },
    },
  },
  actions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CqcMockInspectionInclude;

export type InspectionRow = Prisma.CqcMockInspectionGetPayload<{
  include: typeof inspectionInclude;
}>;

/** One piece of evidence as it was when the snapshot was taken. */
export type SnapshotItem = {
  evidenceId: string;
  title: string;
  sourceType: CqcEvidenceSourceType;
  sourceId: string | null;
  sourceLabel: string | null;
  categoryCode: string;
  /** End of the period it covers, or when it was added. */
  date: string;
  reviewDueAt: string | null;
  reviewOverdue: boolean;
  attachmentCount: number;
};

/** The frozen result kept on a completed inspection. */
export type StoredResult = InspectionResult & {
  frameworkVersion: number;
  completedAt: string;
};

/** One statement as detail() returns it: evidence the viewer may see, and how much is hidden. */
export type DetailStatement = {
  id: string;
  code: string;
  title: string;
  summary: string;
  score: number | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
  reviewedBy: { id: string; name: string | null } | null;
  reviewedAt: string | null;
  snapshotAt: string | null;
  gap: boolean;
  evidence: SnapshotItem[];
  hiddenEvidenceCount: number;
  /** From the ready-made template: what it asks you to focus on, and what to check. */
  focus: string | null;
  guidance: TemplateGuidance | null;
  /** Answers to the checks in `guidance`. */
  checks: StatementCheck[];
};

/** One answered check of a statement, as stored in CqcMockInspectionStatement.checks. */
export type StatementCheck = {
  part: 'lookAt' | 'askPeople' | 'askStaff';
  text: string;
  answer: 'MET' | 'PARTIALLY_MET' | 'NOT_MET';
  /** What was found; always there when not met or partially met. */
  note: string | null;
};

export function readChecks(
  value: Prisma.JsonValue | null | undefined,
): StatementCheck[] {
  return Array.isArray(value)
    ? (value as unknown as StatementCheck[]).map((c) => ({
        ...c,
        note: c.note ?? null,
      }))
    : [];
}

export type TemplateGuidance = {
  lookAt: string[];
  askPeople: string[];
  askStaff: string[];
  inCareFlow: string[];
  /** POL-… references of the ready-made policies behind the statement (missing on templates seeded before them). */
  policies?: string[];
};
/** A template statement as stored (prisma/seed-lib/mock-inspection-library.ts). */
export type TemplateStatementRow = {
  code: string;
  focus: string | null;
  guidance: TemplateGuidance;
};

export function readTemplateStatements(
  value: Prisma.JsonValue | null | undefined,
): TemplateStatementRow[] {
  return Array.isArray(value)
    ? (value as unknown as TemplateStatementRow[])
    : [];
}

/** Every key question of the inspection's framework version, in order (an overall rating needs all of them). */
const frameworkKeyQuestionCodes = (
  row: Pick<InspectionRow, 'frameworkVersion'>,
) => row.frameworkVersion.keyQuestions.map((k) => k.code);

const toIso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const text = (v: string | undefined) =>
  v === undefined ? undefined : v.trim() || null;

export function readSnapshot(
  value: Prisma.JsonValue | null | undefined,
): SnapshotItem[] {
  return Array.isArray(value) ? (value as unknown as SnapshotItem[]) : [];
}

/**
 * Governance → Mock CQC inspection. A manager scores each quality statement of the active CQC
 * framework (1–4) against the CQC evidence kept for the branch; key question and overall ratings
 * come from the framework version's scoring rules (cqc-mock-inspection-scoring.util.ts) and are
 * frozen when the inspection is completed. Improvement actions can be added until it is cancelled.
 *
 * Branch scope: an inspection is about one branch, or the whole organisation (locationId null).
 * Branch-restricted users see their branches' inspections and whole-organisation ones, and can run
 * them only for their own branches.
 */
@Injectable()
export class CqcMockInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly framework: CqcFrameworkService,
    private readonly evidence: CqcEvidenceService,
  ) {}

  // ─── Scope ────────────────────────────────────────────────────────────────

  visibleWhere(scope: OrgScope): Prisma.CqcMockInspectionWhereInput {
    if (scope.locationIds === null) return {};
    return {
      OR: [{ locationId: { in: scope.locationIds } }, { locationId: null }],
    };
  }

  async assertWritableLocation(
    scope: OrgScope,
    locationId: string | null,
  ): Promise<void> {
    if (scope.locationIds !== null) {
      if (!locationId) {
        throw new ForbiddenException(
          'A mock inspection of the whole organisation needs access to all branches. Choose your branch.',
        );
      }
      if (!scope.locationIds.includes(locationId))
        throw new ForbiddenException('You can only choose your own branches.');
    }
    if (locationId) {
      const found = await this.prisma.location.count({
        where: { id: locationId, deletedAt: null },
      });
      if (!found) throw new BadRequestException('Branch not found');
    }
  }

  private async requireVisible(
    user: RequestUser,
    id: string,
  ): Promise<InspectionRow> {
    const scope = this.orgScope.fromRequestUser(user);
    const row = await this.prisma.cqcMockInspection.findFirst({
      where: { AND: [{ id }, this.visibleWhere(scope)] },
      include: inspectionInclude,
    });
    if (!row) throw new NotFoundException('Mock inspection not found');
    return row;
  }

  /** Visible, and the user may change it (their branch, or any for whole-organisation access). */
  private async requireWritable(
    user: RequestUser,
    id: string,
    statuses: CqcMockInspectionStatus[],
  ): Promise<InspectionRow> {
    const row = await this.requireVisible(user, id);
    await this.assertWritableLocation(
      this.orgScope.fromRequestUser(user),
      row.locationId,
    );
    if (!statuses.includes(row.status)) {
      throw new BadRequestException(
        row.status === CqcMockInspectionStatus.COMPLETED
          ? 'This mock inspection is completed; its scores can no longer change.'
          : row.status === CqcMockInspectionStatus.CANCELLED
            ? 'This mock inspection was cancelled.'
            : 'This mock inspection cannot be changed now.',
      );
    }
    return row;
  }

  private async assertUser(
    id: string | null | undefined,
    what: string,
  ): Promise<void> {
    if (!id) return;
    const found = await this.prisma.user.count({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!found) throw new BadRequestException(`${what} was not found`);
  }

  private rulesOf(
    row: Pick<InspectionRow, 'frameworkVersion'>,
  ): CqcScoringRules {
    const rules = parseScoringRules(row.frameworkVersion.scoringRules);
    if (!rules)
      throw new BadRequestException(
        `${row.frameworkVersion.title} has no scoring rules for mock inspections.`,
      );
    return rules;
  }

  // ─── Evidence snapshot ────────────────────────────────────────────────────

  /**
   * Current evidence per statement for the branch (its own evidence and whole-organisation evidence).
   * Survey results are kept whatever the survey's access; they are hidden per viewer on reading.
   */
  async evidenceSnapshot(
    scope: OrgScope,
    locationId: string | null,
    statementIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, SnapshotItem[]>> {
    const where: Prisma.CqcEvidenceWhereInput = {
      AND: [
        { status: CqcEvidenceStatus.CURRENT },
        await this.evidence.visibleWhere(scope),
        this.evidence.branchWhere(scope, locationId ?? undefined),
      ],
    };
    const links = await this.prisma.cqcEvidenceStatement.findMany({
      where: { statementId: { in: statementIds }, evidence: where },
      select: {
        statementId: true,
        evidence: {
          select: {
            id: true,
            title: true,
            sourceType: true,
            sourceId: true,
            sourceLabel: true,
            categoryCode: true,
            periodEnd: true,
            createdAt: true,
            reviewDueAt: true,
            _count: { select: { attachments: { where: { deletedAt: null } } } },
          },
        },
      },
    });
    const out = new Map<string, SnapshotItem[]>(
      statementIds.map((id) => [id, []]),
    );
    for (const l of links) {
      const e = l.evidence;
      out.get(l.statementId)?.push({
        evidenceId: e.id,
        title: e.title,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        sourceLabel: e.sourceLabel,
        categoryCode: e.categoryCode,
        date: (e.periodEnd ?? e.createdAt).toISOString(),
        reviewDueAt: toIso(e.reviewDueAt),
        reviewOverdue: Boolean(
          e.reviewDueAt && e.reviewDueAt.getTime() < now.getTime(),
        ),
        attachmentCount: e._count.attachments,
      });
    }
    for (const items of out.values())
      items.sort((a, b) => b.date.localeCompare(a.date));
    return out;
  }

  // ─── List / detail ────────────────────────────────────────────────────────

  async list(user: RequestUser, query: ListCqcMockInspectionsQueryDto) {
    const scope = this.orgScope.fromRequestUser(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const and: Prisma.CqcMockInspectionWhereInput[] = [
      this.visibleWhere(scope),
    ];
    if (query.status) and.push({ status: query.status });
    if (query.locationId) {
      this.orgScope.assertLocationAccess(scope, query.locationId);
      and.push({
        OR: [{ locationId: query.locationId }, { locationId: null }],
      });
    }
    const where: Prisma.CqcMockInspectionWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      this.prisma.cqcMockInspection.count({ where }),
      this.prisma.cqcMockInspection.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          frameworkVersion: { select: { version: true, title: true } },
          template: { select: { code: true, title: true } },
          statements: { select: { score: true } },
          actions: { select: { status: true } },
        },
      }),
    ]);
    const [locations, users] = await Promise.all([
      this.locationNames(rows.map((r) => r.locationId)),
      this.userNames(rows.map((r) => r.leadReviewerId)),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        location: r.locationId
          ? { id: r.locationId, name: locations.get(r.locationId) ?? null }
          : null,
        framework: {
          version: r.frameworkVersion.version,
          title: r.frameworkVersion.title,
        },
        template: r.template
          ? { code: r.template.code, title: r.template.title }
          : null,
        leadReviewer: r.leadReviewerId
          ? { id: r.leadReviewerId, name: users.get(r.leadReviewerId) ?? null }
          : null,
        startedAt: r.startedAt.toISOString(),
        completedAt: toIso(r.completedAt),
        statementCount: r.statements.length,
        scoredCount: r.statements.filter((s) => s.score !== null).length,
        overall: (r.result as StoredResult | null)?.overall ?? null,
        openActions: r.actions.filter(
          (a) => a.status === CqcMockActionStatus.OPEN,
        ).length,
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  /**
   * Ready-made inspections, in library order, with each statement's title and key question from the
   * active framework and what to check. A statement the active framework no longer has is left out
   * and the template is marked as not usable (`matchesFramework: false`).
   */
  async templates() {
    const [rows, framework] = await Promise.all([
      this.prisma.cqcMockInspectionTemplate.findMany({
        where: { retiredAt: null },
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      }),
      this.framework.active(),
    ]);
    const byCode = new Map(framework.statements.map((s) => [s.code, s]));
    const kqOrder = framework.keyQuestions.map((k) => k.code);
    return {
      data: rows.map((t) => {
        const stored = readTemplateStatements(t.statements);
        const statements = stored.flatMap((s) => {
          const fs = byCode.get(s.code);
          return fs
            ? [
                {
                  code: s.code,
                  title: fs.title,
                  keyQuestionCode: fs.keyQuestionCode,
                  keyQuestionTitle: fs.keyQuestionTitle,
                  focus: s.focus,
                  guidance: s.guidance,
                },
              ]
            : [];
        });
        const keyQuestionCodes = kqOrder.filter((code) =>
          statements.some((s) => s.keyQuestionCode === code),
        );
        return {
          code: t.code,
          groupCode: t.groupCode,
          groupName: t.groupName,
          title: t.title,
          summary: t.summary,
          whenToUse: t.whenToUse,
          estimatedMinutes: t.estimatedMinutes,
          statementCount: statements.length,
          keyQuestionCodes,
          /** Rated overall only when it covers every key question (like a full CQC assessment). */
          givesOverallRating: kqOrder.every((code) =>
            keyQuestionCodes.includes(code),
          ),
          matchesFramework: statements.length === stored.length,
          statements,
          sources: t.sources,
          researchedOn: t.researchedOn.toISOString().slice(0, 10),
        };
      }),
    };
  }

  async get(user: RequestUser, id: string) {
    return {
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  /** The inspection by key question, with evidence the viewer may see and the (live or frozen) result. */
  async detail(user: RequestUser, row: InspectionRow) {
    const rules = parseScoringRules(row.frameworkVersion.scoringRules);
    const statements = [...row.statements].sort(
      (a, b) =>
        a.statement.keyQuestion.displayOrder -
          b.statement.keyQuestion.displayOrder ||
        a.statement.displayOrder - b.statement.displayOrder,
    );
    const surveyIds = statements.flatMap((s) =>
      readSnapshot(s.evidenceSnapshot)
        .filter(
          (e) =>
            e.sourceType === CqcEvidenceSourceType.SURVEY_RESULT && e.sourceId,
        )
        .map((e) => e.sourceId!),
    );
    const hidden = await surveysWithoutResultsAccess(
      this.prisma,
      user,
      surveyIds,
    );
    const [users, locations, employees] = await Promise.all([
      this.userNames([
        row.leadReviewerId,
        row.createdById,
        ...statements.map((s) => s.reviewedById),
        ...row.actions.map((a) => a.ownerId),
      ]),
      this.locationNames([row.locationId]),
      this.employeeNames(row.actions.flatMap((a) => a.assignedEmployeeIds)),
    ]);
    const person = (uid: string | null) =>
      uid ? { id: uid, name: users.get(uid) ?? null } : null;
    const templateStatement = new Map(
      readTemplateStatements(row.template?.statements).map((t) => [t.code, t]),
    );
    // What to check is the same for a statement in every template (statement-guidance.json), so a
    // statement its own template does not cover (or an inspection of every statement) takes it from another.
    const sharedGuidance = await this.sharedGuidance(
      statements
        .map((s) => s.statement.code)
        .filter((code) => !templateStatement.has(code)),
    );

    const keyQuestions: {
      code: string;
      title: string;
      statements: DetailStatement[];
    }[] = [];
    for (const s of statements) {
      const kq = s.statement.keyQuestion;
      let group = keyQuestions.find((k) => k.code === kq.code);
      if (!group) {
        group = { code: kq.code, title: kq.title, statements: [] };
        keyQuestions.push(group);
      }
      const all = readSnapshot(s.evidenceSnapshot);
      const evidence = all.filter(
        (e) =>
          !(
            e.sourceType === CqcEvidenceSourceType.SURVEY_RESULT &&
            e.sourceId &&
            hidden.has(e.sourceId)
          ),
      );
      group.statements.push({
        id: s.statementId,
        code: s.statement.code,
        title: s.statement.title,
        summary: s.statement.summary,
        score: s.score,
        strengths: s.strengths,
        concerns: s.concerns,
        notes: s.notes,
        reviewedBy: person(s.reviewedById),
        reviewedAt: toIso(s.reviewedAt),
        snapshotAt: toIso(s.snapshotAt),
        gap: all.length === 0,
        evidence,
        hiddenEvidenceCount: all.length - evidence.length,
        focus: templateStatement.get(s.statement.code)?.focus ?? null,
        guidance:
          templateStatement.get(s.statement.code)?.guidance ??
          sharedGuidance.get(s.statement.code) ??
          null,
        checks: readChecks(s.checks),
      });
    }

    const live = rules
      ? inspectionResult(
          statements.map((s) => ({
            statementId: s.statementId,
            keyQuestionCode: s.statement.keyQuestion.code,
            score: s.score,
          })),
          keyQuestions.map((k) => k.code),
          rules,
          frameworkKeyQuestionCodes(row),
        )
      : null;
    const result =
      row.status === CqcMockInspectionStatus.COMPLETED && row.result
        ? (row.result as unknown as StoredResult)
        : live;

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      notes: row.notes,
      location: row.locationId
        ? { id: row.locationId, name: locations.get(row.locationId) ?? null }
        : null,
      framework: {
        id: row.frameworkVersion.id,
        version: row.frameworkVersion.version,
        code: row.frameworkVersion.code,
        title: row.frameworkVersion.title,
      },
      template: row.template
        ? { code: row.template.code, title: row.template.title }
        : null,
      scale: rules?.scale ?? [],
      checkScoring: readCheckScoring(row.checkScoring),
      leadReviewer: person(row.leadReviewerId),
      createdBy: person(row.createdById),
      startedAt: row.startedAt.toISOString(),
      completedAt: toIso(row.completedAt),
      cancelledAt: toIso(row.cancelledAt),
      result,
      keyQuestions,
      actions: row.actions.map((a) => ({
        id: a.id,
        statementId: a.statementId,
        checkText: a.checkText,
        title: a.title,
        detail: a.detail,
        owner: person(a.ownerId),
        assignedEmployees: a.assignedEmployeeIds.map((eid) => ({
          id: eid,
          name: employees.get(eid) ?? null,
        })),
        dueAt: toIso(a.dueAt),
        status: a.status,
        completedAt: toIso(a.completedAt),
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  // ─── Comparison ───────────────────────────────────────────────────────────

  /** The inspection's statements in framework order, its key questions and its (frozen or live) result. */
  private comparable(row: InspectionRow): ComparableInspection {
    const ordered = [...row.statements].sort(
      (a, b) =>
        a.statement.keyQuestion.displayOrder -
          b.statement.keyQuestion.displayOrder ||
        a.statement.displayOrder - b.statement.displayOrder,
    );
    const keyQuestions: { code: string; title: string }[] = [];
    for (const s of ordered) {
      const kq = s.statement.keyQuestion;
      if (!keyQuestions.some((k) => k.code === kq.code))
        keyQuestions.push({ code: kq.code, title: kq.title });
    }
    const rules = parseScoringRules(row.frameworkVersion.scoringRules);
    const result =
      row.status === CqcMockInspectionStatus.COMPLETED && row.result
        ? (row.result as unknown as StoredResult)
        : rules
          ? inspectionResult(
              ordered.map((s) => ({
                statementId: s.statementId,
                keyQuestionCode: s.statement.keyQuestion.code,
                score: s.score,
              })),
              keyQuestions.map((k) => k.code),
              rules,
              frameworkKeyQuestionCodes(row),
            )
          : null;
    return {
      result,
      keyQuestions,
      statements: ordered.map((s) => ({
        code: s.statement.code,
        title: s.statement.title,
        score: s.score,
      })),
    };
  }

  /**
   * The inspection against the last completed one for the same service (same branch, or both whole
   * organisation) that the user may see: completed before this one, or before now if it is in progress.
   */
  async comparison(user: RequestUser, id: string) {
    const current = await this.requireVisible(user, id);
    const scope = this.orgScope.fromRequestUser(user);
    const previous = await this.prisma.cqcMockInspection.findFirst({
      where: {
        AND: [
          this.visibleWhere(scope),
          {
            id: { not: id },
            locationId: current.locationId,
            status: CqcMockInspectionStatus.COMPLETED,
            ...(current.completedAt
              ? { completedAt: { lt: current.completedAt } }
              : {}),
          },
        ],
      },
      orderBy: { completedAt: 'desc' },
      include: inspectionInclude,
    });
    if (!previous) return { data: { previous: null, comparison: null } };
    const before = this.comparable(previous);
    return {
      data: {
        previous: {
          id: previous.id,
          title: previous.title,
          completedAt: toIso(previous.completedAt),
          overall: before.result?.overall ?? null,
        },
        comparison: compareInspections(this.comparable(current), before),
      },
    };
  }

  // ─── Report ───────────────────────────────────────────────────────────────

  /** PDF of the inspection as the user sees it (survey evidence they cannot see stays a count). */
  async export(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const d = await this.detail(user, await this.requireVisible(user, id));
    const [profile, actor] = await Promise.all([
      this.prisma.companyProfile.findFirst({ select: { companyName: true } }),
      this.userNames([user.id]),
    ]);
    const date = (iso: string | null) => (iso ? new Date(iso) : null);
    const buffer = await buildMockInspectionPdf({
      organisationName: profile?.companyName?.trim() || 'Care provider',
      generatedAt: now,
      generatedBy: actor.get(user.id) ?? 'User',
      title: d.title,
      status: d.status,
      serviceName: d.location?.name ?? 'Whole organisation',
      templateTitle: d.template?.title ?? null,
      frameworkTitle: d.framework.title,
      frameworkVersion: d.framework.version,
      leadReviewer: d.leadReviewer?.name ?? null,
      startedAt: new Date(d.startedAt),
      completedAt: date(d.completedAt),
      scale: d.scale,
      result: d.result,
      keyQuestions: d.keyQuestions,
      actions: d.actions.map((a) => ({
        statementId: a.statementId,
        title: a.title,
        detail: a.detail,
        owner: a.owner?.name ?? null,
        dueAt: date(a.dueAt),
        status: a.status,
        completedAt: date(a.completedAt),
      })),
    });
    await this.log(user, AuditAction.CQC_MOCK_INSPECTION_EXPORTED, id, meta);
    return {
      buffer,
      contentType: 'application/pdf',
      disposition: contentDisposition(reportFileName(d.title, now), false),
    };
  }

  // ─── Create / update ──────────────────────────────────────────────────────

  async create(
    user: RequestUser,
    dto: CreateCqcMockInspectionDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const scope = this.orgScope.fromRequestUser(user);
    const locationId = dto.locationId ?? null;
    await this.assertWritableLocation(scope, locationId);
    const leadReviewerId = dto.leadReviewerId ?? user.id;
    await this.assertUser(leadReviewerId, 'The lead reviewer');

    const framework = await this.framework.active();
    const version = await this.prisma.cqcFrameworkVersion.findUnique({
      where: { id: framework.id },
      select: { scoringRules: true },
    });
    if (!parseScoringRules(version?.scoringRules)) {
      throw new BadRequestException(
        `${framework.title} has no scoring rules, so a mock inspection cannot be scored.`,
      );
    }
    // From a ready-made template: only its statements. Otherwise every statement of the framework.
    let templateId: string | null = null;
    let statementIds = framework.statements.map((s) => s.id);
    if (dto.templateCode) {
      const template = await this.prisma.cqcMockInspectionTemplate.findFirst({
        where: { code: dto.templateCode, retiredAt: null },
        select: { id: true, title: true, statements: true },
      });
      if (!template)
        throw new BadRequestException(
          'That ready-made inspection was not found.',
        );
      const codes = new Set(
        readTemplateStatements(template.statements).map((s) => s.code),
      );
      const matched = framework.statements.filter((s) => codes.has(s.code));
      if (matched.length !== codes.size) {
        throw new BadRequestException(
          `${template.title} does not match the current CQC framework yet. Choose another inspection or a full one.`,
        );
      }
      templateId = template.id;
      statementIds = matched.map((s) => s.id);
    }
    const snapshot = await this.evidenceSnapshot(
      scope,
      locationId,
      statementIds,
      now,
    );

    const checkScoring = await this.currentCheckScoring();
    const created = await this.prisma.cqcMockInspection.create({
      data: {
        frameworkVersionId: framework.id,
        templateId,
        checkScoring,
        locationId,
        title: dto.title.trim(),
        leadReviewerId,
        notes: text(dto.notes) ?? null,
        startedAt: now,
        createdById: user.id,
        updatedById: user.id,
        statements: {
          create: statementIds.map((statementId) => ({
            statementId,
            evidenceSnapshot: snapshot.get(statementId) ?? [],
            snapshotAt: now,
          })),
        },
      },
      include: inspectionInclude,
    });
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_CREATED,
      created.id,
      meta,
      undefined,
      {
        id: created.id,
        title: created.title,
        locationId,
        frameworkVersion: created.frameworkVersion.version,
        templateCode: created.template?.code ?? null,
        leadReviewerId,
      },
    );
    return {
      message: 'Mock inspection started',
      data: await this.detail(user, created),
    };
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateCqcMockInspectionDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
    ]);
    const data: Prisma.CqcMockInspectionUncheckedUpdateInput = {
      updatedById: user.id,
    };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.notes !== undefined) data.notes = text(dto.notes);
    if (dto.leadReviewerId !== undefined) {
      await this.assertUser(dto.leadReviewerId, 'The lead reviewer');
      data.leadReviewerId = dto.leadReviewerId;
    }
    const updated = await this.prisma.cqcMockInspection.update({
      where: { id },
      data,
      include: inspectionInclude,
    });
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_UPDATED,
      id,
      meta,
      {
        title: existing.title,
        notes: existing.notes,
        leadReviewerId: existing.leadReviewerId,
      },
      {
        title: updated.title,
        notes: updated.notes,
        leadReviewerId: updated.leadReviewerId,
      },
    );
    return {
      message: 'Mock inspection updated',
      data: await this.detail(user, updated),
    };
  }

  async scoreStatement(
    user: RequestUser,
    id: string,
    statementId: string,
    dto: ScoreStatementDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
    ]);
    const existing = row.statements.find((s) => s.statementId === statementId);
    if (!existing)
      throw new NotFoundException(
        'That quality statement is not part of this mock inspection',
      );
    const rules = this.rulesOf(row);
    // A statement with checks is scored from their answers (scoreFromChecks); a score sent with it is ignored.
    const guidance =
      readTemplateStatements(row.template?.statements).find(
        (t) => t.code === existing.statement.code,
      )?.guidance ??
      (await this.sharedGuidance([existing.statement.code])).get(
        existing.statement.code,
      );
    const statementChecks = guidance
      ? CHECK_PARTS.flatMap((part) =>
          (guidance[part] ?? []).map((t) => ({ part, text: t })),
        )
      : [];
    const scoredByChecks = statementChecks.length > 0;
    const data: Prisma.CqcMockInspectionStatementUncheckedUpdateInput = {};
    if (dto.score !== undefined && !scoredByChecks) {
      if (dto.score !== null && !isValidScore(rules, dto.score)) {
        throw new BadRequestException(
          `Score must be one of ${rules.scale.map((s) => s.score).join(', ')}`,
        );
      }
      data.score = dto.score;
      data.reviewedById = dto.score === null ? null : user.id;
      data.reviewedAt = dto.score === null ? null : now;
    }
    if (dto.strengths !== undefined) data.strengths = text(dto.strengths);
    if (dto.concerns !== undefined) data.concerns = text(dto.concerns);
    if (dto.notes !== undefined) data.notes = text(dto.notes);
    if (dto.checks !== undefined) {
      const seen = new Set<string>();
      const checks: StatementCheck[] = [];
      for (const c of dto.checks) {
        const key = `${c.part}\u0000${c.text.trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const note = c.note?.trim() || null;
        if (!note && c.answer !== 'MET')
          throw new BadRequestException(
            `Add a note for "${c.text.trim()}": it is ${c.answer === 'NOT_MET' ? 'not met' : 'partially met'}`,
          );
        checks.push({
          part: c.part,
          text: c.text.trim(),
          answer: c.answer,
          note,
        });
      }
      data.checks = checks;
      if (scoredByChecks) {
        const worked = scoreFromChecks(
          statementChecks,
          checks,
          readCheckScoring(row.checkScoring),
        ).score;
        const score =
          worked !== null && isValidScore(rules, worked) ? worked : null;
        data.score = score;
        data.reviewedById = score === null ? null : user.id;
        data.reviewedAt = score === null ? null : now;
      }
    }
    await this.prisma.cqcMockInspectionStatement.update({
      where: { id: existing.id },
      data,
    });
    await this.prisma.cqcMockInspection.update({
      where: { id },
      data: { updatedById: user.id },
    });
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_STATEMENT_SCORED,
      id,
      meta,
      { statement: existing.statement.code, score: existing.score },
      {
        statement: existing.statement.code,
        score: data.score === undefined ? existing.score : data.score,
      },
    );
    return {
      message: 'Saved',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  /** Statement code → what to check, from the ready-made templates, for the codes given. */
  private async sharedGuidance(
    codes: string[],
  ): Promise<Map<string, TemplateGuidance>> {
    const out = new Map<string, TemplateGuidance>();
    if (!codes.length) return out;
    const wanted = new Set(codes);
    const templates = await this.prisma.cqcMockInspectionTemplate.findMany({
      where: { retiredAt: null },
      select: { statements: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    });
    for (const t of templates) {
      for (const s of readTemplateStatements(t.statements)) {
        if (wanted.has(s.code) && s.guidance && !out.has(s.code))
          out.set(s.code, s.guidance);
      }
    }
    return out;
  }

  /** Takes the evidence again for every statement (scores and notes are kept). */
  async refreshEvidence(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
    ]);
    const scope = this.orgScope.fromRequestUser(user);
    const snapshot = await this.evidenceSnapshot(
      scope,
      row.locationId,
      row.statements.map((s) => s.statementId),
      now,
    );
    await this.prisma.$transaction(
      row.statements.map((s) =>
        this.prisma.cqcMockInspectionStatement.update({
          where: { id: s.id },
          data: {
            evidenceSnapshot: snapshot.get(s.statementId) ?? [],
            snapshotAt: now,
          },
        }),
      ),
    );
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_EVIDENCE_REFRESHED,
      id,
      meta,
    );
    return {
      message: 'Evidence refreshed',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  /** Freezes the ratings. Every statement must be scored. */
  async complete(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
    ]);
    const rules = this.rulesOf(row);
    const ordered = [...row.statements].sort(
      (a, b) =>
        a.statement.keyQuestion.displayOrder -
          b.statement.keyQuestion.displayOrder ||
        a.statement.displayOrder - b.statement.displayOrder,
    );
    const kqCodes = [
      ...new Set(ordered.map((s) => s.statement.keyQuestion.code)),
    ];
    const result = inspectionResult(
      ordered.map((s) => ({
        statementId: s.statementId,
        keyQuestionCode: s.statement.keyQuestion.code,
        score: s.score,
      })),
      kqCodes,
      rules,
      frameworkKeyQuestionCodes(row),
    );
    if (!result.complete) {
      const n = result.unscoredStatementIds.length;
      throw new BadRequestException(
        `Score every quality statement first (${n} still to score).`,
      );
    }
    const stored: StoredResult = {
      ...result,
      frameworkVersion: row.frameworkVersion.version,
      completedAt: now.toISOString(),
    };
    const done = await this.prisma.cqcMockInspection.updateMany({
      where: { id, status: CqcMockInspectionStatus.IN_PROGRESS },
      data: {
        status: CqcMockInspectionStatus.COMPLETED,
        completedAt: now,
        result: stored,
        updatedById: user.id,
      },
    });
    if (!done.count)
      throw new BadRequestException(
        'This mock inspection was changed by someone else. Reload it.',
      );
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_COMPLETED,
      id,
      meta,
      undefined,
      {
        overall: stored.overall,
        keyQuestions: stored.keyQuestions.map((k) => ({
          code: k.keyQuestionCode,
          rating: k.rating,
          percent: k.percent,
        })),
      },
    );
    return {
      message: 'Mock inspection completed',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  async cancel(
    user: RequestUser,
    id: string,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    await this.requireWritable(user, id, [CqcMockInspectionStatus.IN_PROGRESS]);
    await this.prisma.cqcMockInspection.update({
      where: { id },
      data: {
        status: CqcMockInspectionStatus.CANCELLED,
        cancelledAt: now,
        updatedById: user.id,
      },
    });
    await this.log(user, AuditAction.CQC_MOCK_INSPECTION_CANCELLED, id, meta);
    return {
      message: 'Mock inspection cancelled',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async createAction(
    user: RequestUser,
    id: string,
    dto: CreateCqcMockActionDto,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
      CqcMockInspectionStatus.COMPLETED,
    ]);
    if (
      dto.statementId &&
      !row.statements.some((s) => s.statementId === dto.statementId)
    ) {
      throw new BadRequestException(
        'That quality statement is not part of this mock inspection',
      );
    }
    if (dto.checkText?.trim() && !dto.statementId)
      throw new BadRequestException(
        'An action for a check needs its quality statement',
      );
    await this.assertUser(dto.ownerId, 'The action owner');
    const assignedEmployeeIds = await this.assignees(dto.assignedEmployeeIds);
    const action = await this.prisma.cqcMockInspectionAction.create({
      data: {
        inspectionId: id,
        statementId: dto.statementId ?? null,
        checkText: dto.checkText?.trim() || null,
        title: dto.title.trim(),
        detail: text(dto.detail) ?? null,
        ownerId: dto.ownerId ?? null,
        assignedEmployeeIds,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        createdById: user.id,
      },
    });
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_ACTION_CREATED,
      id,
      meta,
      undefined,
      auditSnapshot(action),
    );
    return {
      message: 'Action added',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  async updateAction(
    user: RequestUser,
    id: string,
    actionId: string,
    dto: UpdateCqcMockActionDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const row = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
      CqcMockInspectionStatus.COMPLETED,
    ]);
    const existing = row.actions.find((a) => a.id === actionId);
    if (!existing) throw new NotFoundException('Action not found');
    const data: Prisma.CqcMockInspectionActionUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.detail !== undefined) data.detail = text(dto.detail);
    if (dto.ownerId !== undefined) {
      await this.assertUser(dto.ownerId, 'The action owner');
      data.ownerId = dto.ownerId;
    }
    if (dto.dueAt !== undefined)
      data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (
      dto.statementId !== undefined &&
      dto.statementId !== existing.statementId
    ) {
      if (existing.checkText)
        throw new BadRequestException(
          'An action made from a check stays with its quality statement',
        );
      if (
        dto.statementId &&
        !row.statements.some((s) => s.statementId === dto.statementId)
      )
        throw new BadRequestException(
          'That quality statement is not part of this mock inspection',
        );
      data.statementId = dto.statementId;
    }
    if (dto.assignedEmployeeIds !== undefined)
      data.assignedEmployeeIds = await this.assignees(dto.assignedEmployeeIds);
    if (dto.status !== undefined && dto.status !== existing.status) {
      data.status = dto.status;
      data.completedAt = dto.status === CqcMockActionStatus.DONE ? now : null;
    }
    const updated = await this.prisma.cqcMockInspectionAction.update({
      where: { id: actionId },
      data,
    });
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_ACTION_UPDATED,
      id,
      meta,
      auditSnapshot(existing),
      auditSnapshot(updated),
    );
    return {
      message: 'Action updated',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  /** Removes an action; the audit log keeps what it said. */
  async deleteAction(
    user: RequestUser,
    id: string,
    actionId: string,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.requireWritable(user, id, [
      CqcMockInspectionStatus.IN_PROGRESS,
      CqcMockInspectionStatus.COMPLETED,
    ]);
    const existing = row.actions.find((a) => a.id === actionId);
    if (!existing) throw new NotFoundException('Action not found');
    await this.prisma.cqcMockInspectionAction.delete({
      where: { id: actionId },
    });
    await this.log(
      user,
      AuditAction.CQC_MOCK_INSPECTION_ACTION_DELETED,
      id,
      meta,
      auditSnapshot(existing),
      undefined,
    );
    return {
      message: 'Action deleted',
      data: await this.detail(user, await this.requireVisible(user, id)),
    };
  }

  /** The staff an action is for: each once, and each must exist. */
  private async assignees(ids: string[] | undefined): Promise<string[]> {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return [];
    const found = await this.prisma.employee.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length)
      throw new BadRequestException(
        unique.length === 1
          ? 'That staff member was not found'
          : 'One of those staff members was not found',
      );
    return unique;
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  /** The settings new inspections copy (the defaults until someone saves them). */
  private async currentCheckScoring(): Promise<CheckScoring> {
    const row = await this.prisma.cqcMockInspectionSettings.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!row) return DEFAULT_CHECK_SCORING;
    return readCheckScoring({
      metPoints: row.metPoints,
      partlyMetPoints: row.partlyMetPoints,
      notMetPoints: row.notMetPoints,
      score4Percent: row.score4Percent,
      score3Percent: row.score3Percent,
      score2Percent: row.score2Percent,
    });
  }

  async settings() {
    return {
      data: {
        ...(await this.currentCheckScoring()),
        defaults: DEFAULT_CHECK_SCORING,
      },
    };
  }

  async updateSettings(
    user: RequestUser,
    dto: UpdateCqcMockInspectionSettingsDto,
    meta?: RequestAuditMeta,
  ) {
    const next: CheckScoring = {
      metPoints: dto.metPoints,
      partlyMetPoints: dto.partlyMetPoints,
      notMetPoints: dto.notMetPoints,
      score4Percent: dto.score4Percent,
      score3Percent: dto.score3Percent,
      score2Percent: dto.score2Percent,
    };
    const problem = checkScoringProblem(next);
    if (problem) throw new BadRequestException(problem);
    const before = await this.currentCheckScoring();
    const row = await this.prisma.cqcMockInspectionSettings.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const saved = row
      ? await this.prisma.cqcMockInspectionSettings.update({
          where: { id: row.id },
          data: { ...next, updatedById: user.id },
        })
      : await this.prisma.cqcMockInspectionSettings.create({
          data: { ...next, updatedById: user.id },
        });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_MOCK_INSPECTION,
      action: AuditAction.CQC_MOCK_INSPECTION_SETTINGS_UPDATED,
      recordType: 'CqcMockInspectionSettings',
      recordId: saved.id,
      oldValues: before,
      newValues: next,
      ...meta,
    });
    return {
      message: 'Settings saved. New mock inspections will use them.',
      data: { ...next, defaults: DEFAULT_CHECK_SCORING },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async log(
    user: RequestUser,
    action: AuditAction,
    recordId: string,
    meta?: RequestAuditMeta,
    oldValues?: unknown,
    newValues?: unknown,
  ) {
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_MOCK_INSPECTION,
      action,
      recordType: 'CqcMockInspection',
      recordId,
      ...(oldValues !== undefined ? { oldValues } : {}),
      ...(newValues !== undefined ? { newValues } : {}),
      ...meta,
    });
  }

  private async userNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.email ||
          'User',
      ]),
    );
  }

  /** Employee id → "First Last". */
  private async employeeNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
      },
    });
    return new Map(
      rows.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Staff member',
      ]),
    );
  }

  private async locationNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.location.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((l) => [l.id, l.name]));
  }
}
