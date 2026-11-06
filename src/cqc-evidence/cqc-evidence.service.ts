import { surveysWithoutResultsAccess } from '../surveys/survey-access';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CqcEvidenceSourceType, CqcEvidenceStatus, Prisma } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
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
import { contentDisposition } from '../policies/policy-upload.util';
import { CqcFrameworkService, type ActiveFramework } from './cqc-framework.service';
import type { CqcSurveyMetrics } from './cqc-survey-metrics.util';
import {
  buildEvidenceCsv,
  buildEvidencePdf,
  type ExportEvidence,
  type ExportPack,
} from './cqc-evidence-export.util';
import {
  assertCqcEvidenceUpload,
  newCqcEvidenceStoragePath,
  resolveSafeCqcEvidencePath,
  writeCqcEvidenceFile,
  deleteCqcEvidenceFile,
} from './cqc-evidence-upload.util';
import type {
  CreateCqcEvidenceDto,
  ExportCqcEvidenceQueryDto,
  ListCqcEvidenceQueryDto,
  OverviewQueryDto,
  UpdateCqcEvidenceDto,
} from './dto/cqc-evidence.dto';

const DAY_MS = 86_400_000;

export const evidenceInclude = {
  statements: {
    include: {
      statement: {
        select: {
          id: true,
          code: true,
          title: true,
          frameworkVersionId: true,
          keyQuestion: { select: { code: true, title: true } },
          frameworkVersion: { select: { version: true } },
        },
      },
    },
  },
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CqcEvidenceInclude;

export type EvidenceRow = Prisma.CqcEvidenceGetPayload<{ include: typeof evidenceInclude }>;

export type YouSaidWeDid = { youSaid: string; weDid: string };

export function readActions(value: Prisma.JsonValue | null | undefined): YouSaidWeDid[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) =>
    a && typeof a === 'object' && !Array.isArray(a) && typeof a.youSaid === 'string' && typeof a.weDid === 'string'
      ? [{ youSaid: a.youSaid, weDid: a.weDid }]
      : [],
  );
}

export function readMetrics(value: Prisma.JsonValue | null | undefined): CqcSurveyMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (value as { kind?: unknown }).kind === 'survey-result' ? (value as unknown as CqcSurveyMetrics) : null;
}

const toIso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const parseDate = (s: string | undefined | null) => (s ? new Date(s) : null);

/**
 * CQC evidence: records kept for inspection, linked to quality statements of the active
 * framework and an evidence category. Survey results arrive automatically (CqcSurveyEvidenceService);
 * anything else is added by hand for now (later: policies, audits, incidents, training,
 * complaints and compliments feed the same records through their sourceType and sourceId).
 *
 * Branch scope: evidence lists the branches it is about (none = the whole organisation).
 * Branch-restricted users see organisation-wide evidence and evidence only about their branches,
 * and can add or change evidence only for their own branches.
 */
@Injectable()
export class CqcEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
    private readonly framework: CqcFrameworkService,
  ) {}

  // ─── Scope ────────────────────────────────────────────────────────────────

  scopeOf(user: RequestUser): OrgScope {
    return this.orgScope.fromRequestUser(user);
  }

  /**
   * Evidence a user may see: nothing about a branch outside their scope, and (given the user) no
   * survey results from a survey whose results are limited to other people (survey-access.ts).
   */
  async visibleWhere(scope: OrgScope, user?: RequestUser): Promise<Prisma.CqcEvidenceWhereInput> {
    const and: Prisma.CqcEvidenceWhereInput[] = [];
    if (scope.locationIds !== null) {
      const outside = await this.prisma.location.findMany({
        where: { id: { notIn: scope.locationIds } },
        select: { id: true },
      });
      if (outside.length) and.push({ NOT: { locationIds: { hasSome: outside.map((l) => l.id) } } });
    }
    if (user) {
      const sources = await this.prisma.cqcEvidence.findMany({
        where: { sourceType: CqcEvidenceSourceType.SURVEY_RESULT, sourceId: { not: null } },
        select: { sourceId: true },
        distinct: ['sourceId'],
      });
      const hidden = await surveysWithoutResultsAccess(this.prisma, user, sources.map((r) => r.sourceId!));
      if (hidden.size) and.push({ NOT: { sourceType: CqcEvidenceSourceType.SURVEY_RESULT, sourceId: { in: [...hidden] } } });
    }
    return and.length ? { AND: and } : {};
  }

  /** Branch filter: evidence about that branch, plus organisation-wide evidence (it applies there too). */
  branchWhere(scope: OrgScope, locationId: string | undefined): Prisma.CqcEvidenceWhereInput {
    if (!locationId) return {};
    this.orgScope.assertLocationAccess(scope, locationId);
    return { OR: [{ locationIds: { has: locationId } }, { locationIds: { isEmpty: true } }] };
  }

  /** Branches a user may give evidence: their own; whole-organisation evidence needs all branches. */
  async assertWritableBranches(scope: OrgScope, locationIds: string[]): Promise<string[]> {
    const ids = [...new Set(locationIds)];
    if (scope.locationIds !== null) {
      if (!ids.length) {
        throw new ForbiddenException(
          'Evidence for the whole organisation can only be added or changed by someone with access to all branches. Choose your branch.',
        );
      }
      const allowed = new Set(scope.locationIds);
      if (ids.some((id) => !allowed.has(id))) throw new ForbiddenException('You can only choose your own branches.');
    }
    if (ids.length) {
      const found = await this.prisma.location.count({ where: { id: { in: ids }, deletedAt: null } });
      if (found !== ids.length) throw new BadRequestException('Some branches were not found');
    }
    return ids;
  }

  private async requireVisible(user: RequestUser, id: string): Promise<EvidenceRow> {
    const row = await this.prisma.cqcEvidence.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(this.scopeOf(user), user)] },
      include: evidenceInclude,
    });
    if (!row) throw new NotFoundException('Evidence not found');
    return row;
  }

  // ─── Framework ────────────────────────────────────────────────────────────

  private assertStatements(framework: ActiveFramework, statementIds: string[]): string[] {
    const ids = [...new Set(statementIds)];
    const known = new Set(framework.statements.map((s) => s.id));
    if (!ids.length) throw new BadRequestException('Choose at least one quality statement');
    if (ids.some((id) => !known.has(id))) {
      throw new BadRequestException('Choose quality statements from the current CQC framework');
    }
    return ids;
  }

  private assertCategory(framework: ActiveFramework, code: string): string {
    if (!framework.categories.some((c) => c.code === code)) {
      throw new BadRequestException(`Unknown evidence category ${code}`);
    }
    return code;
  }

  private assertPeriod(start: Date | null, end: Date | null) {
    if (start && end && start.getTime() > end.getTime()) {
      throw new BadRequestException('The period must start before it ends');
    }
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  /**
   * Key question → quality statement: current evidence count, latest evidence date, reviews
   * overdue, and gaps (statements with no current evidence).
   */
  async overview(user: RequestUser, query: OverviewQueryDto = {}, now: Date = new Date()) {
    const scope = this.scopeOf(user);
    const framework = await this.framework.active();
    const where: Prisma.CqcEvidenceWhereInput = {
      AND: [{ status: CqcEvidenceStatus.CURRENT }, await this.visibleWhere(scope, user), this.branchWhere(scope, query.locationId)],
    };
    const links = await this.prisma.cqcEvidenceStatement.findMany({
      where: { statement: { frameworkVersionId: framework.id }, evidence: where },
      select: {
        statementId: true,
        evidence: { select: { id: true, periodEnd: true, createdAt: true, reviewDueAt: true, sourceType: true, categoryCode: true } },
      },
    });
    type Stat = { count: number; latest: Date | null; reviewOverdue: number; sources: Set<string>; categories: Set<string> };
    const stats = new Map<string, Stat>();
    const evidenceIds = new Set<string>();
    const overdueIds = new Set<string>();
    for (const l of links) {
      const s = stats.get(l.statementId) ?? { count: 0, latest: null, reviewOverdue: 0, sources: new Set(), categories: new Set() };
      const date = l.evidence.periodEnd ?? l.evidence.createdAt;
      s.count += 1;
      if (!s.latest || date.getTime() > s.latest.getTime()) s.latest = date;
      const overdue = Boolean(l.evidence.reviewDueAt && l.evidence.reviewDueAt.getTime() < now.getTime());
      if (overdue) {
        s.reviewOverdue += 1;
        overdueIds.add(l.evidence.id);
      }
      s.sources.add(l.evidence.sourceType);
      s.categories.add(l.evidence.categoryCode);
      stats.set(l.statementId, s);
      evidenceIds.add(l.evidence.id);
    }
    const keyQuestions = framework.keyQuestions.map((k) => {
      const statements = k.statements.map((st) => {
        const s = stats.get(st.id);
        return {
          id: st.id,
          code: st.code,
          title: st.title,
          summary: st.summary,
          verified: st.verified,
          evidenceCount: s?.count ?? 0,
          latestEvidenceAt: toIso(s?.latest),
          reviewOverdue: s?.reviewOverdue ?? 0,
          sourceTypes: [...(s?.sources ?? [])].sort(),
          categoryCodes: [...(s?.categories ?? [])].sort(),
          gap: !s?.count,
        };
      });
      return {
        id: k.id,
        code: k.code,
        title: k.title,
        summary: k.summary,
        statementCount: statements.length,
        coveredCount: statements.filter((s) => !s.gap).length,
        gapCount: statements.filter((s) => s.gap).length,
        statements,
      };
    });
    const all = keyQuestions.flatMap((k) => k.statements);
    return {
      data: {
        framework: { id: framework.id, version: framework.version, code: framework.code, title: framework.title, checkedOn: framework.checkedOn },
        categories: framework.categories,
        totals: {
          statements: all.length,
          covered: all.filter((s) => !s.gap).length,
          gaps: all.filter((s) => s.gap).length,
          currentEvidence: evidenceIds.size,
          reviewOverdue: overdueIds.size,
          unverifiedTitles: all.filter((s) => !s.verified).length,
        },
        keyQuestions,
      },
    };
  }

  // ─── List / detail ────────────────────────────────────────────────────────

  async list(user: RequestUser, query: ListCqcEvidenceQueryDto) {
    const scope = this.scopeOf(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const framework = await this.framework.active();
    const and: Prisma.CqcEvidenceWhereInput[] = [await this.visibleWhere(scope, user), this.branchWhere(scope, query.locationId)];
    if (!query.status) and.push({ status: CqcEvidenceStatus.CURRENT });
    else if (query.status !== 'ALL') and.push({ status: query.status });
    if (query.statementId) and.push({ statements: { some: { statementId: query.statementId } } });
    if (query.keyQuestion) {
      and.push({ statements: { some: { statement: { frameworkVersionId: framework.id, keyQuestion: { code: query.keyQuestion } } } } });
    }
    if (query.sourceType) and.push({ sourceType: query.sourceType });
    if (query.categoryCode) and.push({ categoryCode: query.categoryCode });
    if (query.from) and.push({ OR: [{ periodEnd: { gte: new Date(query.from) } }, { periodEnd: null, createdAt: { gte: new Date(query.from) } }] });
    if (query.to) and.push({ OR: [{ periodStart: { lte: new Date(query.to) } }, { periodStart: null, createdAt: { lte: new Date(query.to) } }] });
    if (query.search?.trim()) {
      const q = query.search.trim();
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
          { sourceLabel: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.CqcEvidenceWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      this.prisma.cqcEvidence.count({ where }),
      this.prisma.cqcEvidence.findMany({
        where,
        include: evidenceInclude,
        orderBy: [{ periodEnd: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const lookups = await this.lookups(rows);
    return {
      data: rows.map((r) => this.serialize(r, framework, lookups)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async get(user: RequestUser, id: string) {
    const row = await this.requireVisible(user, id);
    const framework = await this.framework.active();
    const lookups = await this.lookups([row]);
    return { data: this.serialize(row, framework, lookups, true) };
  }

  // ─── Create / update ──────────────────────────────────────────────────────

  async create(user: RequestUser, dto: CreateCqcEvidenceDto, meta?: RequestAuditMeta) {
    const scope = this.scopeOf(user);
    const framework = await this.framework.active();
    const statementIds = this.assertStatements(framework, dto.statementIds);
    const categoryCode = this.assertCategory(framework, dto.categoryCode);
    const locationIds = await this.assertWritableBranches(scope, dto.locationIds ?? []);
    const periodStart = parseDate(dto.periodStart);
    const periodEnd = parseDate(dto.periodEnd);
    this.assertPeriod(periodStart, periodEnd);
    const created = await this.prisma.cqcEvidence.create({
      data: {
        title: dto.title.trim(),
        summary: dto.summary?.trim() || null,
        sourceType: dto.sourceType ?? CqcEvidenceSourceType.MANUAL,
        sourceLabel: dto.sourceLabel?.trim() || null,
        categoryCode,
        periodStart,
        periodEnd,
        locationIds,
        reviewDueAt: parseDate(dto.reviewDueAt),
        notes: dto.notes?.trim() || null,
        actions: (dto.actions ?? []).map((a) => ({ youSaid: a.youSaid.trim(), weDid: a.weDid.trim() })),
        createdById: user.id,
        updatedById: user.id,
        statements: { create: statementIds.map((statementId) => ({ statementId })) },
      },
      include: evidenceInclude,
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_EVIDENCE,
      action: AuditAction.CQC_EVIDENCE_CREATED,
      recordType: 'CqcEvidence',
      recordId: created.id,
      newValues: auditSnapshot(created),
      ...meta,
    });
    const lookups = await this.lookups([created]);
    return { message: 'Evidence added', data: this.serialize(created, framework, lookups, true) };
  }

  async update(user: RequestUser, id: string, dto: UpdateCqcEvidenceDto, meta?: RequestAuditMeta) {
    const scope = this.scopeOf(user);
    const existing = await this.requireVisible(user, id);
    await this.assertWritableBranches(scope, existing.locationIds);
    const framework = await this.framework.active();
    const data: Prisma.CqcEvidenceUncheckedUpdateInput = { updatedById: user.id };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.summary !== undefined) data.summary = dto.summary.trim() || null;
    if (dto.sourceLabel !== undefined) data.sourceLabel = dto.sourceLabel.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
    if (dto.categoryCode !== undefined) data.categoryCode = this.assertCategory(framework, dto.categoryCode);
    if (dto.locationIds !== undefined) data.locationIds = await this.assertWritableBranches(scope, dto.locationIds);
    if (dto.actions !== undefined) {
      data.actions = dto.actions.map((a) => ({ youSaid: a.youSaid.trim(), weDid: a.weDid.trim() }));
    }
    if (dto.reviewDueAt !== undefined) data.reviewDueAt = parseDate(dto.reviewDueAt);
    // Survey figures and their period come from the survey; they are not edited by hand.
    const fromSurvey = existing.sourceType === CqcEvidenceSourceType.SURVEY_RESULT;
    if (!fromSurvey) {
      if (dto.periodStart !== undefined) data.periodStart = parseDate(dto.periodStart);
      if (dto.periodEnd !== undefined) data.periodEnd = parseDate(dto.periodEnd);
    } else if (dto.periodStart !== undefined || dto.periodEnd !== undefined) {
      throw new BadRequestException('The period of survey evidence comes from the survey and cannot be changed');
    }
    this.assertPeriod(
      (data.periodStart as Date | null | undefined) ?? existing.periodStart,
      (data.periodEnd as Date | null | undefined) ?? existing.periodEnd,
    );
    if (dto.status !== undefined && dto.status !== existing.status) {
      data.status = dto.status;
      if (dto.status === CqcEvidenceStatus.ARCHIVED) {
        data.archivedAt = new Date();
        data.archivedById = user.id;
      } else {
        data.archivedAt = null;
        data.archivedById = null;
        if (dto.status === CqcEvidenceStatus.CURRENT) data.supersededById = null;
      }
    }
    let statementIds: string[] | null = null;
    if (dto.statementIds !== undefined) statementIds = this.assertStatements(framework, dto.statementIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (statementIds) {
        // Only the active framework's links are replaced; links to an older framework stay as history.
        await tx.cqcEvidenceStatement.deleteMany({
          where: { evidenceId: id, statement: { frameworkVersionId: framework.id }, statementId: { notIn: statementIds } },
        });
        await tx.cqcEvidenceStatement.createMany({
          data: statementIds.map((statementId) => ({ evidenceId: id, statementId })),
          skipDuplicates: true,
        });
      }
      return tx.cqcEvidence.update({ where: { id }, data, include: evidenceInclude });
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_EVIDENCE,
      action:
        dto.status === CqcEvidenceStatus.ARCHIVED && existing.status !== CqcEvidenceStatus.ARCHIVED
          ? AuditAction.CQC_EVIDENCE_ARCHIVED
          : AuditAction.CQC_EVIDENCE_UPDATED,
      recordType: 'CqcEvidence',
      recordId: id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    const lookups = await this.lookups([updated]);
    return { message: 'Evidence updated', data: this.serialize(updated, framework, lookups, true) };
  }

  // ─── Attachments ──────────────────────────────────────────────────────────

  async addAttachment(
    user: RequestUser,
    id: string,
    file: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer } | undefined,
    meta?: RequestAuditMeta,
  ) {
    const evidence = await this.requireVisible(user, id);
    await this.assertWritableBranches(this.scopeOf(user), evidence.locationIds);
    const upload = assertCqcEvidenceUpload(file);
    const storagePath = newCqcEvidenceStoragePath(id, upload.ext);
    writeCqcEvidenceFile(storagePath, upload.buffer);
    let attachment;
    try {
      attachment = await this.prisma.cqcEvidenceAttachment.create({
        data: {
          evidenceId: id,
          fileName: upload.originalName,
          mimeType: upload.mime,
          sizeBytes: upload.buffer.length,
          storagePath,
          uploadedById: user.id,
        },
      });
    } catch (err) {
      deleteCqcEvidenceFile(storagePath);
      throw err;
    }
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_EVIDENCE,
      action: AuditAction.CQC_EVIDENCE_ATTACHMENT_ADDED,
      recordType: 'CqcEvidence',
      recordId: id,
      metadata: { attachmentId: attachment.id, fileName: attachment.fileName, sizeBytes: attachment.sizeBytes },
      ...meta,
    });
    return {
      message: 'File added',
      data: {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt.toISOString(),
      },
    };
  }

  /** The stored file, for a user who can see the evidence. */
  async readAttachment(user: RequestUser, id: string, attachmentId: string, inline: boolean) {
    await this.requireVisible(user, id);
    const a = await this.prisma.cqcEvidenceAttachment.findFirst({ where: { id: attachmentId, evidenceId: id, deletedAt: null } });
    if (!a) throw new NotFoundException('File not found');
    const absolute = resolveSafeCqcEvidencePath(a.storagePath);
    if (!existsSync(absolute)) throw new NotFoundException('File not found');
    return {
      buffer: readFileSync(absolute),
      mimeType: a.mimeType,
      disposition: contentDisposition(a.fileName, inline),
    };
  }

  /** Removes the file from the evidence. The stored copy is kept (evidence is an audit record). */
  async removeAttachment(user: RequestUser, id: string, attachmentId: string, meta?: RequestAuditMeta) {
    const evidence = await this.requireVisible(user, id);
    await this.assertWritableBranches(this.scopeOf(user), evidence.locationIds);
    const a = await this.prisma.cqcEvidenceAttachment.findFirst({ where: { id: attachmentId, evidenceId: id, deletedAt: null } });
    if (!a) throw new NotFoundException('File not found');
    await this.prisma.cqcEvidenceAttachment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_EVIDENCE,
      action: AuditAction.CQC_EVIDENCE_ATTACHMENT_REMOVED,
      recordType: 'CqcEvidence',
      recordId: id,
      metadata: { attachmentId: a.id, fileName: a.fileName },
      ...meta,
    });
    return { message: 'File removed', data: { id: a.id } };
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  /** Current evidence for one statement or all of them, as a PDF or CSV pack for inspection. */
  async export(user: RequestUser, query: ExportCqcEvidenceQueryDto, meta?: RequestAuditMeta, now: Date = new Date()) {
    const scope = this.scopeOf(user);
    const framework = await this.framework.active();
    const statements = query.statementId
      ? framework.statements.filter((s) => s.id === query.statementId)
      : framework.statements;
    if (!statements.length) throw new NotFoundException('Quality statement not found');
    const rows = await this.prisma.cqcEvidence.findMany({
      where: {
        AND: [
          { status: CqcEvidenceStatus.CURRENT },
          await this.visibleWhere(scope, user),
          this.branchWhere(scope, query.locationId),
          { statements: { some: { statementId: { in: statements.map((s) => s.id) } } } },
        ],
      },
      include: evidenceInclude,
      orderBy: [{ periodEnd: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const lookups = await this.lookups(rows);
    const [profile, actor] = await Promise.all([
      this.prisma.companyProfile.findFirst({ select: { companyName: true } }),
      this.userNames([user.id]),
    ]);
    const categoryTitle = new Map(framework.categories.map((c) => [c.code, c.title]));
    const toExport = (r: EvidenceRow): ExportEvidence => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      sourceType: r.sourceType,
      sourceLabel: r.sourceLabel,
      categoryTitle: categoryTitle.get(r.categoryCode) ?? r.categoryCode,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      reviewDueAt: r.reviewDueAt,
      addedBy: r.createdById ? (lookups.users.get(r.createdById) ?? 'User') : 'CareFlow (automatic)',
      addedAt: r.createdAt,
      branches: r.locationIds.map((id) => lookups.locations.get(id) ?? 'Branch'),
      metrics: readMetrics(r.metrics),
      actions: readActions(r.actions),
      attachments: r.attachments.map((a) => a.fileName),
    });
    const branchName = query.locationId ? (await this.locationNames([query.locationId])).get(query.locationId) : null;
    const single = query.statementId ? statements[0] : null;
    const pack: ExportPack = {
      organisationName: profile?.companyName?.trim() || 'Organisation',
      generatedAt: now,
      generatedBy: actor.get(user.id) ?? 'User',
      frameworkTitle: `${framework.title} (version ${framework.version})`,
      scopeLabel: `${single ? `${single.keyQuestionTitle}: ${single.title}` : 'All quality statements'}${branchName ? ` - ${branchName}` : ''}`,
      statements: statements.map((s) => ({
        keyQuestionTitle: s.keyQuestionTitle,
        code: s.code,
        title: s.title,
        summary: s.summary,
        evidence: rows.filter((r) => r.statements.some((l) => l.statementId === s.id)).map(toExport),
      })),
    };
    const stamp = now.toISOString().slice(0, 10);
    const slug = single ? single.code.toLowerCase().replace(/_/g, '-') : 'all-statements';
    const fileName = `cqc-evidence-${slug}-${stamp}.${query.format}`;
    const buffer =
      query.format === 'csv' ? Buffer.from(buildEvidenceCsv(pack), 'utf8') : await buildEvidencePdf(pack);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_EVIDENCE,
      action: AuditAction.CQC_EVIDENCE_EXPORTED,
      recordType: 'CqcEvidence',
      recordId: query.statementId ?? null,
      metadata: {
        format: query.format,
        statementId: query.statementId ?? null,
        locationId: query.locationId ?? null,
        evidenceCount: rows.length,
      },
      ...meta,
    });
    return {
      buffer,
      fileName,
      contentType: query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
      disposition: contentDisposition(fileName, false),
    };
  }

  // ─── Shaping ──────────────────────────────────────────────────────────────

  private async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || 'User']));
  }

  private async locationNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.location.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((l) => [l.id, l.name]));
  }

  async lookups(rows: EvidenceRow[]) {
    const [users, locations] = await Promise.all([
      this.userNames(rows.flatMap((r) => [r.createdById, r.updatedById, ...r.attachments.map((a) => a.uploadedById)])),
      this.locationNames(rows.flatMap((r) => r.locationIds)),
    ]);
    return { users, locations };
  }

  serialize(
    r: EvidenceRow,
    framework: ActiveFramework,
    lookups: { users: Map<string, string>; locations: Map<string, string> },
    detail = false,
    now: Date = new Date(),
  ) {
    const category = framework.categories.find((c) => c.code === r.categoryCode);
    const metrics = readMetrics(r.metrics);
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      sourceLabel: r.sourceLabel,
      source:
        r.sourceType === CqcEvidenceSourceType.SURVEY_RESULT && r.sourceId
          ? { kind: 'survey' as const, surveyId: r.sourceId, seriesId: metrics?.seriesId ?? null }
          : null,
      categoryCode: r.categoryCode,
      categoryTitle: category?.title ?? r.categoryCode,
      periodStart: toIso(r.periodStart),
      periodEnd: toIso(r.periodEnd),
      locationIds: r.locationIds,
      locations: r.locationIds.map((id) => ({ id, name: lookups.locations.get(id) ?? 'Branch' })),
      status: r.status,
      reviewDueAt: toIso(r.reviewDueAt),
      reviewOverdue: Boolean(r.status === CqcEvidenceStatus.CURRENT && r.reviewDueAt && r.reviewDueAt.getTime() < now.getTime()),
      reviewDueSoon: Boolean(
        r.status === CqcEvidenceStatus.CURRENT &&
          r.reviewDueAt &&
          r.reviewDueAt.getTime() >= now.getTime() &&
          r.reviewDueAt.getTime() - now.getTime() < 30 * DAY_MS,
      ),
      metrics,
      actions: readActions(r.actions),
      notes: detail ? r.notes : undefined,
      statements: r.statements
        .map((l) => ({
          id: l.statement.id,
          code: l.statement.code,
          title: l.statement.title,
          keyQuestionCode: l.statement.keyQuestion.code,
          keyQuestionTitle: l.statement.keyQuestion.title,
          frameworkVersion: l.statement.frameworkVersion.version,
          current: l.statement.frameworkVersionId === framework.id,
        }))
        .sort((a, b) => Number(b.current) - Number(a.current) || a.code.localeCompare(b.code)),
      attachmentCount: r.attachments.length,
      attachments: detail
        ? r.attachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            createdAt: a.createdAt.toISOString(),
            uploadedByName: a.uploadedById ? (lookups.users.get(a.uploadedById) ?? 'User') : null,
          }))
        : undefined,
      automatic: r.sourceKey !== null,
      addedBy: r.createdById ? { id: r.createdById, name: lookups.users.get(r.createdById) ?? 'User' } : null,
      updatedBy: r.updatedById ? { id: r.updatedById, name: lookups.users.get(r.updatedById) ?? 'User' } : null,
      supersededById: r.supersededById,
      archivedAt: toIso(r.archivedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
