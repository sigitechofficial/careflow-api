import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  Prisma,
  SpecialistPathwayPlanStatus,
  SpecialistPathwayReviewOutcome,
  SpecialistPathwayRiskStatus,
  SpecialistPathwayStatus,
  SpecialistPathwayType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService, andWhereFragment } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateSpecialistPathwayCaseDto } from './dto/create-case.dto';
import { UpdateSpecialistPathwayCaseDto } from './dto/update-case.dto';
import { CreateSpecialistPathwayPlanDto } from './dto/create-plan.dto';
import { UpdateSpecialistPathwayPlanDto } from './dto/update-plan.dto';
import { SpecialistPathwayPlanDecisionDto } from './dto/plan-decision.dto';
import { ListSpecialistPathwayCasesQueryDto } from './dto/list-cases-query.dto';
import { CreatePathwayRiskDto, UpdatePathwayRiskDto } from './dto/risk.dto';
import { ClosePathwayCaseDto, CreatePathwayReviewDto } from './dto/review.dto';
import { CreatePathwayProfessionalDto, UpdatePathwayProfessionalDto } from './dto/professional.dto';
import { CreatePathwayDocumentDto } from './dto/document.dto';
import { pathwayDocumentRoot } from './pathway-document.config';
import { incidentAttachmentContentMatchesType } from '../incidents/incident-attachment.config';
import { existsSync, promises as fsp } from 'fs';
import { join } from 'path';

type Tx = Prisma.TransactionClient;
type PlanRow = Prisma.SpecialistPathwayCarePlanGetPayload<object>;
type RiskRow = Prisma.SpecialistPathwayRiskGetPayload<object>;
type ReviewRow = Prisma.SpecialistPathwayReviewGetPayload<object>;
type EventRow = Prisma.SpecialistPathwayEventGetPayload<object>;
type ProfessionalRow = Prisma.SpecialistPathwayProfessionalGetPayload<object>;
type DocumentRow = Prisma.SpecialistPathwayDocumentGetPayload<object>;
const CASE_INCLUDE = {
  plans: true,
  serviceUser: true,
  risks: true,
  reviews: true,
  events: true,
  professionals: true,
  documents: true,
} satisfies Prisma.SpecialistPathwayCaseInclude;
type CaseRow = Prisma.SpecialistPathwayCaseGetPayload<{ include: typeof CASE_INCLUDE }>;

/** Human ref prefix per pathway type (e.g. LD-26001). */
const REF_PREFIX: Record<SpecialistPathwayType, string> = {
  LEARNING_DISABILITY: 'LD',
  DEMENTIA: 'DEM',
  END_OF_LIFE: 'EOL',
  CHILDREN: 'CYP',
  SUPPORTED_LIVING: 'SL',
};

export const REVIEW_OUTCOME_LABELS: Record<SpecialistPathwayReviewOutcome, string> = {
  NO_CHANGE: 'No change needed',
  PLAN_UPDATE_NEEDED: 'Care plan needs updating',
  ESCALATED: 'Escalated',
  CASE_CLOSED: 'Case closed',
};

/** Score bands: 1–4 Low, 5–9 Medium, 10–14 High, 15–25 Very high. */
export function riskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
  if (score >= 15) return 'VERY_HIGH';
  if (score >= 10) return 'HIGH';
  if (score >= 5) return 'MEDIUM';
  return 'LOW';
}

const DATE_ONLY: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'Europe/London' };

type UserName = { id: string; firstName: string | null; lastName: string | null };

function personName(u?: UserName | null): string | null {
  if (!u) return null;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

/**
 * Keep only the known care-plan fields (structured needs + consent), trimmed and bounded.
 * Legacy keys `goals` / `support` from the v1 plan format are preserved.
 */
export function sanitizePlanContent(raw: unknown): Prisma.InputJsonValue {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 4000) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const out: Record<string, unknown> = {};
  for (const k of ['summary', 'goals', 'support', 'reviewDate'] as const) {
    const v = str(c[k]);
    if (v) out[k] = v;
  }
  if (Array.isArray(c.needs)) {
    out.needs = c.needs
      .slice(0, 50)
      .map(n => {
        const r = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
        return {
          area: str(r.area, 200) ?? '',
          need: str(r.need) ?? '',
          outcome: str(r.outcome) ?? '',
          support: str(r.support) ?? '',
          whoHelps: str(r.whoHelps, 200) ?? '',
          frequency: str(r.frequency, 200) ?? '',
        };
      })
      .filter(n => Object.values(n).some(Boolean));
  }
  if (c.consent && typeof c.consent === 'object') {
    const k = c.consent as Record<string, unknown>;
    out.consent = {
      agreed: k.agreed === true,
      agreedBy: str(k.agreedBy, 200) ?? '',
      relationship: str(k.relationship, 200) ?? '',
      date: str(k.date, 40) ?? '',
      method: str(k.method, 200) ?? '',
    };
  }
  return out as Prisma.InputJsonValue;
}

@Injectable()
export class SpecialistPathwaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  /* ─── helpers ───────────────────────────────────────────────────────── */

  private parseDate(value: string | null | undefined, field = 'date'): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return d;
  }

  /** Cases the actor may see: those of service users in their branches (unrestricted for company-wide). */
  private scopeWhere(actor: RequestUser, locationId?: string): Prisma.SpecialistPathwayCaseWhereInput {
    const where: Prisma.SpecialistPathwayCaseWhereInput = { deletedAt: null };
    const scope = this.orgScope.fromRequestUser(actor);
    const suWhere = this.orgScope.serviceUserScopeWhere(scope);
    if (suWhere) {
      // Empty scope must empty the case list itself, not filter ServiceUser.id through the relation.
      if ('id' in suWhere) andWhereFragment(where, { id: { in: [] } });
      else andWhereFragment(where, { serviceUser: suWhere });
    }
    if (locationId) andWhereFragment(where, { serviceUser: { locationId } });
    return where;
  }

  private async getInScope(actor: RequestUser, id: string, tx: Tx = this.prisma) {
    const row = await tx.specialistPathwayCase.findFirst({ where: { ...this.scopeWhere(actor), id } });
    if (!row) throw new NotFoundException('Pathway case not found');
    return row;
  }

  private async loadCase(id: string, tx: Tx = this.prisma) {
    return tx.specialistPathwayCase.findFirstOrThrow({ where: { id }, include: CASE_INCLUDE });
  }

  private event(tx: Tx, caseId: string, userId: string, action: string, note?: string | null) {
    return tx.specialistPathwayEvent.create({ data: { caseId, userId, action, note: note ?? null } });
  }

  private logCase(
    tx: Tx,
    userId: string,
    caseRow: { id: string; ref: string },
    description: string,
    meta?: RequestAuditMeta,
    extra: Record<string, unknown> = {},
  ) {
    return this.audit.logAudit({
      tx,
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.SPECIALIST_PATHWAY_CASE_UPDATED,
      eventType: AuditEventType.UPDATE,
      recordType: 'SpecialistPathwayCase',
      recordId: caseRow.id,
      description: `${caseRow.ref}: ${description}`,
      metadata: extra,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

  private async userNameMap(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map<string, string | null>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map(u => [u.id, personName(u)]));
  }

  /* ─── mapping ───────────────────────────────────────────────────────── */

  private mapPlan(row: PlanRow, names: Map<string, string | null>) {
    return {
      id: row.id,
      caseId: row.caseId,
      version: row.version,
      status: row.status,
      content: row.content,
      comment: row.comment,
      submittedById: row.submittedById,
      submittedByName: row.submittedById ? names.get(row.submittedById) ?? null : null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedById: row.decidedById,
      decidedByName: row.decidedById ? names.get(row.decidedById) ?? null : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapRisk(row: RiskRow) {
    const score = row.likelihood * row.impact;
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      description: row.description,
      likelihood: row.likelihood,
      impact: row.impact,
      score,
      level: riskLevel(score),
      controls: row.controls,
      reviewDate: row.reviewDate?.toISOString() ?? null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapReview(row: ReviewRow, names: Map<string, string | null>) {
    return {
      id: row.id,
      reviewedAt: row.reviewedAt.toISOString(),
      reviewedById: row.reviewedById,
      reviewedByName: row.reviewedById ? names.get(row.reviewedById) ?? null : null,
      outcome: row.outcome,
      notes: row.notes,
      nextReviewDate: row.nextReviewDate?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapProfessional(row: ProfessionalRow) {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      organisation: row.organisation,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapDocument(row: DocumentRow, names: Map<string, string | null>) {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      originalName: row.originalName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      uploadedById: row.uploadedById,
      uploadedByName: row.uploadedById ? names.get(row.uploadedById) ?? null : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapEvent(row: EventRow, names: Map<string, string | null>) {
    return {
      id: row.id,
      action: row.action,
      note: row.note,
      userId: row.userId,
      userName: row.userId ? names.get(row.userId) ?? null : null,
      at: row.at.toISOString(),
    };
  }

  private mapCase(row: CaseRow, names: Map<string, string | null>) {
    const su = row.serviceUser;
    const plans = row.plans.filter(p => p.deletedAt === null).sort((a, b) => b.version - a.version);
    const risks = row.risks
      .filter(r => r.deletedAt === null)
      .map(r => this.mapRisk(r))
      .sort((a, b) => (a.status === b.status ? b.score - a.score : a.status === 'OPEN' ? -1 : 1));
    const openRiskScores = risks.filter(r => r.status === 'OPEN').map(r => r.score);
    const reviews = [...row.reviews].sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime());
    const events = [...row.events].sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      serviceUserName: su ? personName({ id: su.id, firstName: su.firstName, lastName: su.lastName }) : null,
      pathwayType: row.pathwayType,
      ref: row.ref,
      status: row.status,
      reviewDueDate: row.reviewDueDate?.toISOString() ?? null,
      reviewOverdue:
        row.status !== SpecialistPathwayStatus.CLOSED &&
        !!row.reviewDueDate &&
        row.reviewDueDate.getTime() < Date.now(),
      sections: row.sections,
      closedReason: row.closedReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      plans: plans.map(p => this.mapPlan(p, names)),
      risks,
      highestRiskScore: openRiskScores.length ? Math.max(...openRiskScores) : null,
      reviews: reviews.map(r => this.mapReview(r, names)),
      events: events.map(e => this.mapEvent(e, names)),
      professionals: row.professionals
        .filter(p => p.deletedAt === null)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(p => this.mapProfessional(p)),
      documents: row.documents
        .filter(d => d.deletedAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(d => this.mapDocument(d, names)),
    };
  }

  private async present(rows: CaseRow[]) {
    const names = await this.userNameMap(
      rows.flatMap(r => [
        ...r.plans.flatMap(p => [p.submittedById, p.decidedById]),
        ...r.reviews.map(v => v.reviewedById),
        ...r.events.map(e => e.userId),
        ...r.documents.map(d => d.uploadedById),
      ]),
    );
    return rows.map(r => this.mapCase(r, names));
  }

  private async presentOne(id: string, tx: Tx = this.prisma) {
    const [data] = await this.present([await this.loadCase(id, tx)]);
    return data;
  }

  /* ─── cases ─────────────────────────────────────────────────────────── */

  async list(actor: RequestUser, query: ListSpecialistPathwayCasesQueryDto) {
    const where = this.scopeWhere(actor, query.locationId);
    andWhereFragment(where, {
      ...(query.type ? { pathwayType: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.serviceUserId ? { serviceUserId: query.serviceUserId } : {}),
    });
    const rows = await this.prisma.specialistPathwayCase.findMany({
      where,
      include: CASE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { data: await this.present(rows) };
  }

  /** Per-pathway counts for the module dashboard. */
  async summary(actor: RequestUser, locationId?: string) {
    const rows = await this.prisma.specialistPathwayCase.findMany({
      where: this.scopeWhere(actor, locationId),
      select: {
        pathwayType: true,
        status: true,
        reviewDueDate: true,
        plans: { where: { deletedAt: null }, select: { status: true } },
        risks: { where: { deletedAt: null, status: SpecialistPathwayRiskStatus.OPEN }, select: { likelihood: true, impact: true } },
      },
    });
    const now = Date.now();
    const blank = () => ({ open: 0, closed: 0, reviewsOverdue: 0, plansAwaitingApproval: 0, highRisks: 0 });
    const byPathway = Object.fromEntries(
      Object.values(SpecialistPathwayType).map(t => [t, blank()]),
    ) as Record<SpecialistPathwayType, ReturnType<typeof blank>>;
    const totals = blank();
    for (const r of rows) {
      const b = byPathway[r.pathwayType];
      const closed = r.status === SpecialistPathwayStatus.CLOSED;
      const inc = (k: keyof ReturnType<typeof blank>, n = 1) => {
        b[k] += n;
        totals[k] += n;
      };
      inc(closed ? 'closed' : 'open');
      if (!closed && r.reviewDueDate && r.reviewDueDate.getTime() < now) inc('reviewsOverdue');
      inc('plansAwaitingApproval', r.plans.filter(p => p.status === SpecialistPathwayPlanStatus.SUBMITTED).length);
      inc('highRisks', r.risks.filter(k => k.likelihood * k.impact >= 15).length);
    }
    return { data: { totals, byPathway } };
  }

  async getById(actor: RequestUser, id: string) {
    await this.getInScope(actor, id);
    return { data: await this.presentOne(id) };
  }

  async create(actor: RequestUser, dto: CreateSpecialistPathwayCaseDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const su = await this.prisma.serviceUser.findFirst({ where: { id: dto.serviceUserId, deletedAt: null } });
    if (!su) throw new NotFoundException('Service user not found');
    await this.orgScope.assertServiceUserInScope(this.orgScope.fromRequestUser(actor), dto.serviceUserId);
    const reviewDueDate = this.parseDate(dto.reviewDueDate, 'reviewDueDate');

    return this.prisma.$transaction(async tx => {
      const year = new Date().getFullYear();
      const count = await tx.specialistPathwayCase.count({ where: { pathwayType: dto.pathwayType } });
      const ref = `${REF_PREFIX[dto.pathwayType]}-${year}${String(count + 1).padStart(3, '0')}`;

      const created = await tx.specialistPathwayCase.create({
        data: {
          serviceUserId: dto.serviceUserId,
          pathwayType: dto.pathwayType,
          ref,
          sections: (dto.sections ?? {}) as Prisma.InputJsonValue,
          reviewDueDate: reviewDueDate ?? null,
          createdById: userId,
          events: { create: { action: 'Case opened', userId } },
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.SPECIALIST_PATHWAY_CASE_CREATED,
        eventType: AuditEventType.CREATE,
        recordType: 'SpecialistPathwayCase',
        recordId: created.id,
        description: `Specialist pathway case ${ref} created`,
        newValues: auditSnapshot({ ref, pathwayType: created.pathwayType }),
        metadata: { serviceUserId: dto.serviceUserId, pathwayType: created.pathwayType },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Pathway case created', data: await this.presentOne(created.id, tx) };
    });
  }

  async update(actor: RequestUser, id: string, dto: UpdateSpecialistPathwayCaseDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const reviewDueDate = this.parseDate(dto.reviewDueDate, 'reviewDueDate');

    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      const data: Prisma.SpecialistPathwayCaseUpdateInput = { updatedById: userId };
      const events: string[] = [];
      if (dto.sections !== undefined) {
        data.sections = dto.sections as Prisma.InputJsonValue;
        events.push('Assessment updated');
      }
      if (dto.status !== undefined && dto.status !== before.status) {
        data.status = dto.status;
        events.push(`Status changed to ${dto.status}`);
      }
      if (reviewDueDate !== undefined && reviewDueDate?.getTime() !== before.reviewDueDate?.getTime()) {
        data.reviewDueDate = reviewDueDate;
        events.push(
          reviewDueDate ? `Review due date set to ${reviewDueDate.toLocaleDateString('en-GB', DATE_ONLY)}` : 'Review due date cleared',
        );
      }
      if (dto.closedReason !== undefined) data.closedReason = dto.closedReason;
      if (events.length) data.events = { create: events.map(action => ({ action, userId })) };

      const updated = await tx.specialistPathwayCase.update({ where: { id }, data });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.SPECIALIST_PATHWAY_CASE_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SpecialistPathwayCase',
        recordId: updated.id,
        description: `Specialist pathway case ${updated.ref} updated`,
        oldValues: auditSnapshot({ status: before.status, closedReason: before.closedReason }),
        newValues: auditSnapshot({ status: updated.status, closedReason: updated.closedReason }),
        metadata: { serviceUserId: updated.serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Pathway case updated', data: await this.presentOne(id, tx) };
    });
  }

  async close(actor: RequestUser, id: string, dto: ClosePathwayCaseDto, meta?: RequestAuditMeta) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('A reason is required to close a case');
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);
      if (before.status === SpecialistPathwayStatus.CLOSED) {
        throw new BadRequestException('Case is already closed');
      }
      await tx.specialistPathwayCase.update({
        where: { id },
        data: { status: SpecialistPathwayStatus.CLOSED, closedReason: reason, updatedById: actor.id },
      });
      await this.event(tx, id, actor.id, 'Case closed', reason);
      await this.logCase(tx, actor.id, before, 'case closed', meta, { reason });
      return { message: 'Case closed', data: await this.presentOne(id, tx) };
    });
  }

  async reopen(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);
      if (before.status !== SpecialistPathwayStatus.CLOSED) {
        throw new BadRequestException('Only a closed case can be reopened');
      }
      await tx.specialistPathwayCase.update({
        where: { id },
        data: { status: SpecialistPathwayStatus.ACTIVE, closedReason: null, updatedById: actor.id },
      });
      await this.event(tx, id, actor.id, 'Case reopened');
      await this.logCase(tx, actor.id, before, 'case reopened', meta);
      return { message: 'Case reopened', data: await this.presentOne(id, tx) };
    });
  }

  /* ─── risks ─────────────────────────────────────────────────────────── */

  async addRisk(actor: RequestUser, id: string, dto: CreatePathwayRiskDto, meta?: RequestAuditMeta) {
    const reviewDate = this.parseDate(dto.reviewDate, 'reviewDate');
    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      const risk = await tx.specialistPathwayRisk.create({
        data: {
          caseId: id,
          title: dto.title.trim(),
          category: dto.category?.trim() || null,
          description: dto.description?.trim() || null,
          likelihood: dto.likelihood,
          impact: dto.impact,
          controls: dto.controls?.trim() || null,
          reviewDate: reviewDate ?? null,
          createdById: actor.id,
        },
      });
      const score = risk.likelihood * risk.impact;
      await this.event(tx, id, actor.id, `Risk added: ${risk.title}`, `Score ${score} (${riskLevel(score).replace('_', ' ').toLowerCase()})`);
      await this.logCase(tx, actor.id, c, `risk added (${risk.title})`, meta, { riskId: risk.id, score });
      return { message: 'Risk added', data: await this.presentOne(id, tx) };
    });
  }

  async updateRisk(
    actor: RequestUser,
    id: string,
    riskId: string,
    dto: UpdatePathwayRiskDto,
    meta?: RequestAuditMeta,
  ) {
    const reviewDate = this.parseDate(dto.reviewDate, 'reviewDate');
    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      const before = await tx.specialistPathwayRisk.findFirst({ where: { id: riskId, caseId: id, deletedAt: null } });
      if (!before) throw new NotFoundException('Risk not found');

      const data: Prisma.SpecialistPathwayRiskUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title.trim();
      if (dto.category !== undefined) data.category = dto.category?.trim() || null;
      if (dto.description !== undefined) data.description = dto.description?.trim() || null;
      if (dto.likelihood !== undefined) data.likelihood = dto.likelihood;
      if (dto.impact !== undefined) data.impact = dto.impact;
      if (dto.controls !== undefined) data.controls = dto.controls?.trim() || null;
      if (reviewDate !== undefined) data.reviewDate = reviewDate;
      if (dto.status !== undefined) data.status = dto.status;

      const after = await tx.specialistPathwayRisk.update({ where: { id: riskId }, data });
      const score = after.likelihood * after.impact;
      const action =
        dto.status && dto.status !== before.status
          ? dto.status === SpecialistPathwayRiskStatus.CLOSED
            ? `Risk closed: ${after.title}`
            : `Risk reopened: ${after.title}`
          : `Risk updated: ${after.title}`;
      await this.event(tx, id, actor.id, action, `Score ${score}`);
      await this.logCase(tx, actor.id, c, action, meta, { riskId, score });
      return { message: 'Risk updated', data: await this.presentOne(id, tx) };
    });
  }

  /* ─── professionals ─────────────────────────────────────────────────── */

  async addProfessional(actor: RequestUser, id: string, dto: CreatePathwayProfessionalDto, meta?: RequestAuditMeta) {
    const name = dto.name.trim();
    const role = dto.role.trim();
    if (!name || !role) throw new BadRequestException('Name and role are required');
    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      const p = await tx.specialistPathwayProfessional.create({
        data: {
          caseId: id,
          name,
          role,
          organisation: dto.organisation?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: actor.id,
        },
      });
      await this.event(tx, id, actor.id, `Professional added: ${p.name} (${p.role})`, p.organisation);
      await this.logCase(tx, actor.id, c, `professional added (${p.name})`, meta, { professionalId: p.id });
      return { message: 'Professional added', data: await this.presentOne(id, tx) };
    });
  }

  async updateProfessional(
    actor: RequestUser,
    id: string,
    professionalId: string,
    dto: UpdatePathwayProfessionalDto,
    meta?: RequestAuditMeta,
  ) {
    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      const before = await tx.specialistPathwayProfessional.findFirst({
        where: { id: professionalId, caseId: id, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Professional not found');
      const data: Prisma.SpecialistPathwayProfessionalUpdateInput = {};
      if (dto.name !== undefined) {
        if (!dto.name.trim()) throw new BadRequestException('Name is required');
        data.name = dto.name.trim();
      }
      if (dto.role !== undefined) {
        if (!dto.role.trim()) throw new BadRequestException('Role is required');
        data.role = dto.role.trim();
      }
      if (dto.organisation !== undefined) data.organisation = dto.organisation?.trim() || null;
      if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
      if (dto.email !== undefined) data.email = dto.email?.trim() || null;
      if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
      const after = await tx.specialistPathwayProfessional.update({ where: { id: professionalId }, data });
      await this.event(tx, id, actor.id, `Professional updated: ${after.name} (${after.role})`);
      await this.logCase(tx, actor.id, c, `professional updated (${after.name})`, meta, { professionalId });
      return { message: 'Professional updated', data: await this.presentOne(id, tx) };
    });
  }

  async removeProfessional(actor: RequestUser, id: string, professionalId: string, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      const p = await tx.specialistPathwayProfessional.findFirst({
        where: { id: professionalId, caseId: id, deletedAt: null },
      });
      if (!p) throw new NotFoundException('Professional not found');
      await tx.specialistPathwayProfessional.update({ where: { id: professionalId }, data: { deletedAt: new Date() } });
      await this.event(tx, id, actor.id, `Professional removed: ${p.name} (${p.role})`);
      await this.logCase(tx, actor.id, c, `professional removed (${p.name})`, meta, { professionalId });
      return { message: 'Professional removed', data: await this.presentOne(id, tx) };
    });
  }

  /* ─── documents ─────────────────────────────────────────────────────── */

  async addDocument(
    actor: RequestUser,
    id: string,
    file: Express.Multer.File | undefined,
    dto: CreatePathwayDocumentDto,
    meta?: RequestAuditMeta,
  ) {
    try {
      await this.getInScope(actor, id);
      if (!file) throw new BadRequestException('Upload a PDF, JPEG, PNG or WebP file');
      if (!(await incidentAttachmentContentMatchesType(file.path, file.mimetype))) {
        throw new BadRequestException('The file content does not match its type (allowed: PDF, JPEG, PNG, WebP)');
      }
      const title = dto.title?.trim();
      if (!title) throw new BadRequestException('Give the document a title');
      return await this.prisma.$transaction(async tx => {
        const c = await this.getInScope(actor, id, tx);
        const doc = await tx.specialistPathwayDocument.create({
          data: {
            caseId: id,
            title,
            category: dto.category?.trim() || null,
            fileName: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            uploadedById: actor.id,
          },
        });
        await this.event(tx, id, actor.id, `Document uploaded: ${doc.title}`, doc.category);
        await this.logCase(tx, actor.id, c, `document uploaded (${doc.title})`, meta, { documentId: doc.id });
        return { message: 'Document uploaded', data: await this.presentOne(id, tx) };
      });
    } catch (e) {
      // Multer has already written the file to disk, so remove it whenever the upload is rejected.
      if (file) await fsp.unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  async getDocumentForDownload(actor: RequestUser, id: string, documentId: string) {
    await this.getInScope(actor, id);
    const doc = await this.prisma.specialistPathwayDocument.findFirst({
      where: { id: documentId, caseId: id, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const absolutePath = join(pathwayDocumentRoot(), doc.fileName);
    if (!existsSync(absolutePath)) throw new NotFoundException('File is no longer available');
    return { absolutePath, originalName: doc.originalName, mimeType: doc.mimeType };
  }

  async removeDocument(actor: RequestUser, id: string, documentId: string, meta?: RequestAuditMeta) {
    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      const doc = await tx.specialistPathwayDocument.findFirst({
        where: { id: documentId, caseId: id, deletedAt: null },
      });
      if (!doc) throw new NotFoundException('Document not found');
      await tx.specialistPathwayDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
      await this.event(tx, id, actor.id, `Document removed: ${doc.title}`);
      await this.logCase(tx, actor.id, c, `document removed (${doc.title})`, meta, { documentId });
      return { message: 'Document removed', data: await this.presentOne(id, tx) };
    });
  }

  /* ─── reviews ───────────────────────────────────────────────────────── */

  async addReview(actor: RequestUser, id: string, dto: CreatePathwayReviewDto, meta?: RequestAuditMeta) {
    const reviewedAt = this.parseDate(dto.reviewedAt, 'reviewedAt');
    if (!reviewedAt) throw new BadRequestException('reviewedAt is required');
    const nextReviewDate = this.parseDate(dto.nextReviewDate, 'nextReviewDate') ?? null;
    const closing = dto.outcome === SpecialistPathwayReviewOutcome.CASE_CLOSED;

    return this.prisma.$transaction(async tx => {
      const c = await this.getInScope(actor, id, tx);
      if (c.status === SpecialistPathwayStatus.CLOSED) {
        throw new BadRequestException('Reopen the case before recording a review');
      }
      await tx.specialistPathwayReview.create({
        data: {
          caseId: id,
          reviewedAt,
          reviewedById: actor.id,
          outcome: dto.outcome,
          notes: dto.notes?.trim() || null,
          nextReviewDate,
        },
      });
      await tx.specialistPathwayCase.update({
        where: { id },
        data: {
          reviewDueDate: closing ? c.reviewDueDate : nextReviewDate,
          updatedById: actor.id,
          ...(closing
            ? { status: SpecialistPathwayStatus.CLOSED, closedReason: dto.notes?.trim() || 'Closed at review' }
            : {}),
        },
      });
      await this.event(
        tx,
        id,
        actor.id,
        `Review recorded: ${REVIEW_OUTCOME_LABELS[dto.outcome]}`,
        [
          dto.notes?.trim(),
          !closing && nextReviewDate ? `next review ${nextReviewDate.toLocaleDateString('en-GB', DATE_ONLY)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      );
      if (closing) await this.event(tx, id, actor.id, 'Case closed', 'Closed at review');
      await this.logCase(tx, actor.id, c, `review recorded (${dto.outcome})`, meta);
      return { message: 'Review recorded', data: await this.presentOne(id, tx) };
    });
  }

  /* ─── care plans ────────────────────────────────────────────────────── */

  async createPlan(actor: RequestUser, caseId: string, dto: CreateSpecialistPathwayPlanDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      await this.getInScope(actor, caseId, tx);
      const latest = await tx.specialistPathwayCarePlan.findFirst({
        where: { caseId, deletedAt: null },
        orderBy: { version: 'desc' },
      });
      const version = (latest?.version ?? 0) + 1;

      // A new draft starts from the latest version's content when none is supplied.
      const content = dto.content !== undefined ? dto.content : (latest?.content ?? {});
      const created = await tx.specialistPathwayCarePlan.create({
        data: { caseId, version, content: sanitizePlanContent(content), createdById: userId },
      });
      await this.event(tx, caseId, userId, `Care plan v${version} draft created`);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.SPECIALIST_PATHWAY_PLAN_CREATED,
        eventType: AuditEventType.CREATE,
        recordType: 'SpecialistPathwayCarePlan',
        recordId: created.id,
        description: `Specialist pathway care plan v${version} created`,
        metadata: { caseId, version },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Care plan draft created', data: this.mapPlan(created, new Map()) };
    });
  }

  async updatePlan(
    actor: RequestUser,
    caseId: string,
    planId: string,
    dto: UpdateSpecialistPathwayPlanDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      await this.getInScope(actor, caseId, tx);
      const plan = await tx.specialistPathwayCarePlan.findFirst({
        where: { id: planId, caseId, deletedAt: null },
      });
      if (!plan) throw new NotFoundException('Care plan not found');
      if (plan.status !== SpecialistPathwayPlanStatus.DRAFT) {
        throw new BadRequestException('Only a DRAFT care plan can be edited');
      }

      const submitting = dto.submit === true;
      const data: Prisma.SpecialistPathwayCarePlanUpdateInput = {};
      if (dto.content !== undefined) data.content = sanitizePlanContent(dto.content);
      if (submitting) {
        data.status = SpecialistPathwayPlanStatus.SUBMITTED;
        data.submittedById = userId;
        data.submittedAt = new Date();
      }

      const updated = await tx.specialistPathwayCarePlan.update({ where: { id: planId }, data });
      if (submitting) await this.event(tx, caseId, userId, `Care plan v${updated.version} submitted for approval`);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: submitting
          ? AuditAction.SPECIALIST_PATHWAY_PLAN_SUBMITTED
          : AuditAction.SPECIALIST_PATHWAY_PLAN_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SpecialistPathwayCarePlan',
        recordId: updated.id,
        description: submitting
          ? `Specialist pathway care plan v${updated.version} submitted for approval`
          : `Specialist pathway care plan v${updated.version} updated`,
        metadata: { caseId, version: updated.version },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const names = await this.userNameMap([updated.submittedById, updated.decidedById]);
      return {
        message: submitting ? 'Care plan submitted for approval' : 'Care plan updated',
        data: this.mapPlan(updated, names),
      };
    });
  }

  async decidePlan(
    actor: RequestUser,
    caseId: string,
    planId: string,
    dto: SpecialistPathwayPlanDecisionDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      await this.getInScope(actor, caseId, tx);
      const plan = await tx.specialistPathwayCarePlan.findFirst({
        where: { id: planId, caseId, deletedAt: null },
      });
      if (!plan) throw new NotFoundException('Care plan not found');
      if (plan.status !== SpecialistPathwayPlanStatus.SUBMITTED) {
        throw new BadRequestException('Only a SUBMITTED care plan can be decided');
      }
      // Separation of duties: the submitter cannot approve their own plan.
      if (dto.decision === 'APPROVE' && plan.submittedById === userId) {
        throw new ForbiddenException('You cannot approve a care plan you submitted');
      }

      const now = new Date();
      if (dto.decision === 'APPROVE') {
        // Supersede any currently approved plan on the same case.
        await tx.specialistPathwayCarePlan.updateMany({
          where: { caseId, status: SpecialistPathwayPlanStatus.APPROVED, deletedAt: null },
          data: { status: SpecialistPathwayPlanStatus.SUPERSEDED },
        });
      }

      const updated = await tx.specialistPathwayCarePlan.update({
        where: { id: planId },
        data: {
          status:
            dto.decision === 'APPROVE'
              ? SpecialistPathwayPlanStatus.APPROVED
              : SpecialistPathwayPlanStatus.RETURNED,
          decidedById: userId,
          decidedAt: now,
          comment: dto.comment ?? null,
        },
      });
      await this.event(
        tx,
        caseId,
        userId,
        `Care plan v${updated.version} ${dto.decision === 'APPROVE' ? 'approved' : 'returned'}`,
        dto.comment ?? null,
      );

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.SPECIALIST_PATHWAY_PLAN_DECIDED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SpecialistPathwayCarePlan',
        recordId: updated.id,
        description: `Specialist pathway care plan v${updated.version} ${updated.status.toLowerCase()}`,
        newValues: auditSnapshot({ status: updated.status, comment: updated.comment }),
        metadata: { caseId, version: updated.version, decision: dto.decision },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const names = await this.userNameMap([updated.submittedById, updated.decidedById]);
      return {
        message: dto.decision === 'APPROVE' ? 'Care plan approved' : 'Care plan returned',
        data: this.mapPlan(updated, names),
      };
    });
  }
}
