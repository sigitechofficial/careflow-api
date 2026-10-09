import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CareQuotation,
  CareQuotationCharge,
  CareQuotationLine,
  Prisma,
  ServiceUserReferral,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  canMoveReferral,
  formatReferenceNumber,
  isQuotationExpired,
  isReferralDecision,
  nextQuotationStatus,
  quotationLineTotals,
  quotationTotals,
} from './referral-workflow.util';
import {
  CreateQuotationDto,
  CreateReferralDto,
  QuotationStatusDto,
  ReferralFollowUpDto,
  ReferralStatusDto,
  UpdateQuotationDto,
  UpdateReferralDto,
} from './dto/referral.dto';

export const REFERRAL_DOCUMENT_LINK = 'SERVICE_USER_REFERRAL';
const QUOTATION_ACTION_PAST: Record<QuotationStatusDto['action'], string> = {
  SEND: 'sent',
  ACCEPT: 'accepted',
  DECLINE: 'declined',
  WITHDRAW: 'withdrawn',
};
export const QUOTATION_DOCUMENT_LINK = 'CARE_QUOTATION';

type Tx = Prisma.TransactionClient;
type QuotationFull = CareQuotation & {
  lines: CareQuotationLine[];
  charges: CareQuotationCharge[];
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}
function dateOrNull(v: string | null | undefined): Date | null {
  return v ? new Date(v) : null;
}
/** Civil date (YYYY-MM-DD) stored at UTC midnight. */
function civilDateOrNull(v: string | null | undefined): Date | null {
  return v ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : null;
}
function num(v: Prisma.Decimal | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/** Labels for the change list kept on UPDATED events. */
const REFERRAL_FIELD_LABELS: Record<string, string> = {
  sourceType: 'Referral source',
  referringOrganisation: 'Referring organisation',
  referrerName: 'Contact person',
  referrerRole: 'Contact role',
  referrerPhone: 'Contact phone',
  referrerEmail: 'Contact email',
  referralDate: 'Referral date',
  receivedAt: 'Received',
  receivedVia: 'Received via',
  receivedByEmployeeId: 'Received by',
  locationId: 'Branch',
  responsibleEmployeeId: 'Responsible employee',
  priority: 'Priority',
  careRequirements: 'Care requirements',
  expectedStartDate: 'Expected start',
  requestedHoursPerWeek: 'Hours per week',
  fundingTypeId: 'Funding arrangement',
  funderId: 'Funding organisation',
  fundingNotes: 'Funding notes',
  nextFollowUpAt: 'Next follow-up',
  notes: 'Notes',
};

const QUOTATION_FIELD_LABELS: Record<string, string> = {
  referralId: 'Referral',
  visitPlanId: 'Care package',
  responsibleEmployeeId: 'Responsible employee',
  payerType: 'Payer type',
  payerName: 'Payer',
  payerRelationship: 'Payer relationship',
  payerEmail: 'Payer email',
  payerPhone: 'Payer phone',
  payerAddress: 'Payer address',
  validUntil: 'Valid until',
  startDate: 'Proposed start',
  notes: 'Notes',
  terms: 'Terms',
  weeklyTotal: 'Weekly total',
};

type NameRef = {
  employee?: string | null;
  user?: string | null;
  location?: string | null;
  fundingType?: string | null;
  funder?: string | null;
};

/** Comparable / displayable text for a stored value (dates as ISO, decimals as numbers). */
function valueText(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toString();
  if (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return String(v);
  }
  return JSON.stringify(v);
}

type Names = {
  employees: Map<string, string>;
  users: Map<string, string>;
  locations: Map<string, string>;
  fundingTypes: Map<string, { name: string; code: string }>;
  funders: Map<string, string>;
};

@Injectable()
export class ServiceUserReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  // =================================================================== referrals

  async listReferrals(actor: RequestUser, serviceUserId: string) {
    await this.ensureServiceUser(actor, serviceUserId);
    const rows = await this.prisma.serviceUserReferral.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: { receivedAt: 'desc' },
    });
    const names = await this.resolveNames(this.referralIds(rows));
    const quoteCounts = await this.prisma.careQuotation.groupBy({
      by: ['referralId'],
      where: { serviceUserId, deletedAt: null, referralId: { not: null } },
      _count: true,
    });
    const countMap = new Map(quoteCounts.map((q) => [q.referralId, q._count]));
    return {
      data: rows.map((r) => ({
        ...this.referralRow(r, names),
        quotationCount: countMap.get(r.id) ?? 0,
      })),
    };
  }

  async getReferral(
    actor: RequestUser,
    serviceUserId: string,
    referralId: string,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const r = await this.findReferral(serviceUserId, referralId);
    const [events, quotations, documents] = await Promise.all([
      this.prisma.serviceUserReferralEvent.findMany({
        where: { referralId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.careQuotation.findMany({
        where: { referralId, deletedAt: null },
        orderBy: [{ referenceNumber: 'desc' }, { revision: 'desc' }],
        select: {
          id: true,
          referenceNumber: true,
          revision: true,
          status: true,
          weeklyTotal: true,
          validUntil: true,
          createdAt: true,
        },
      }),
      this.linkedDocuments(serviceUserId, REFERRAL_DOCUMENT_LINK, referralId),
    ]);
    const names = await this.resolveNames([
      ...this.referralIds([r]),
      ...events.map((e) => ({ user: e.userId })),
    ]);
    return {
      data: {
        ...this.referralRow(r, names),
        events: events.map((e) => this.eventRow(e, names)),
        quotations: quotations.map((q) => ({
          ...q,
          weeklyTotal: Number(q.weeklyTotal),
          validUntil: q.validUntil?.toISOString().slice(0, 10) ?? null,
          createdAt: q.createdAt.toISOString(),
        })),
        documents,
      },
    };
  }

  async createReferral(
    actor: RequestUser,
    serviceUserId: string,
    dto: CreateReferralDto,
    meta?: RequestAuditMeta,
  ) {
    const su = await this.ensureServiceUser(actor, serviceUserId);
    const refs = await this.validateReferralRefs(actor, dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const receivedAt = new Date(dto.receivedAt);
      const referenceNumber = await this.allocateReference(
        tx,
        'REF',
        receivedAt.getUTCFullYear(),
      );
      const row = await tx.serviceUserReferral.create({
        data: {
          referenceNumber,
          serviceUserId,
          sourceType: dto.sourceType,
          priority: dto.priority ?? 'ROUTINE',
          referringOrganisation: trimOrNull(dto.referringOrganisation),
          referrerName: trimOrNull(dto.referrerName),
          referrerRole: trimOrNull(dto.referrerRole),
          referrerPhone: trimOrNull(dto.referrerPhone),
          referrerEmail: trimOrNull(dto.referrerEmail),
          referralDate: dateOrNull(dto.referralDate),
          receivedAt,
          receivedVia: dto.receivedVia ?? 'EMAIL',
          receivedByEmployeeId: refs.receivedByEmployeeId ?? null,
          // Branch defaults to the service user's branch.
          locationId: refs.locationId ?? su.locationId ?? null,
          responsibleEmployeeId: refs.responsibleEmployeeId ?? null,
          careRequirements: trimOrNull(dto.careRequirements),
          expectedStartDate: civilDateOrNull(dto.expectedStartDate),
          requestedHoursPerWeek: dto.requestedHoursPerWeek ?? null,
          fundingTypeId: refs.fundingTypeId ?? null,
          funderId: refs.funderId ?? null,
          fundingNotes: trimOrNull(dto.fundingNotes),
          nextFollowUpAt: dateOrNull(dto.nextFollowUpAt),
          notes: trimOrNull(dto.notes),
          recordedById: actor.id,
        },
      });
      await this.addEvent(tx, {
        serviceUserId,
        referralId: row.id,
        action: 'RECORDED',
        toStatus: row.status,
        userId: actor.id,
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.REFERRAL_CREATED,
        'ServiceUserReferral',
        row.id,
        null,
        row,
        meta,
      );
      return row;
    });
    return this.getReferral(actor, serviceUserId, created.id);
  }

  async updateReferral(
    actor: RequestUser,
    serviceUserId: string,
    referralId: string,
    dto: UpdateReferralDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const existing = await this.findReferral(serviceUserId, referralId);
    const refs = await this.validateReferralRefs(actor, dto);
    const data: Prisma.ServiceUserReferralUncheckedUpdateInput = {
      updatedById: actor.id,
    };
    const textFields = [
      'referringOrganisation',
      'referrerName',
      'referrerRole',
      'referrerPhone',
      'referrerEmail',
      'careRequirements',
      'fundingNotes',
      'notes',
    ] as const;
    for (const f of textFields) {
      if (dto[f] !== undefined) data[f] = trimOrNull(dto[f]);
    }
    if (dto.sourceType !== undefined) data.sourceType = dto.sourceType;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.receivedVia !== undefined) data.receivedVia = dto.receivedVia;
    if (dto.receivedAt !== undefined)
      data.receivedAt = new Date(dto.receivedAt);
    if (dto.referralDate !== undefined)
      data.referralDate = dateOrNull(dto.referralDate);
    if (dto.expectedStartDate !== undefined)
      data.expectedStartDate = civilDateOrNull(dto.expectedStartDate);
    if (dto.requestedHoursPerWeek !== undefined)
      data.requestedHoursPerWeek = dto.requestedHoursPerWeek;
    if (dto.nextFollowUpAt !== undefined)
      data.nextFollowUpAt = dateOrNull(dto.nextFollowUpAt);
    for (const f of [
      'receivedByEmployeeId',
      'locationId',
      'responsibleEmployeeId',
      'fundingTypeId',
      'funderId',
    ] as const) {
      if (dto[f] !== undefined) data[f] = refs[f] ?? null;
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserReferral.update({
        where: { id: referralId },
        data,
      });
      const changes = await this.describeChanges(
        existing,
        row,
        REFERRAL_FIELD_LABELS,
        tx,
      );
      if (changes.length) {
        const assignment = changes.some((c) =>
          ['Branch', 'Responsible employee'].includes(c.field),
        );
        await this.addEvent(tx, {
          serviceUserId,
          referralId,
          action: assignment ? 'ASSIGNED' : 'UPDATED',
          changes,
          userId: actor.id,
        });
        await this.logAudit(
          tx,
          actor,
          AuditAction.REFERRAL_UPDATED,
          'ServiceUserReferral',
          referralId,
          existing,
          row,
          meta,
        );
      }
    });
    return this.getReferral(actor, serviceUserId, referralId);
  }

  async changeReferralStatus(
    actor: RequestUser,
    serviceUserId: string,
    referralId: string,
    dto: ReferralStatusDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const existing = await this.findReferral(serviceUserId, referralId);
    if (!canMoveReferral(existing.status, dto.status)) {
      throw new BadRequestException(
        `This referral is ${existing.status.toLowerCase().replace(/_/g, ' ')} and cannot be moved to ${dto.status.toLowerCase().replace(/_/g, ' ')}`,
      );
    }
    const reason = trimOrNull(dto.reason);
    const reopening = ![
      'NEW',
      'UNDER_REVIEW',
      'ASSESSMENT_BOOKED',
      'ON_HOLD',
    ].includes(existing.status);
    if (
      (dto.status === 'DECLINED' || dto.status === 'WITHDRAWN' || reopening) &&
      !reason
    ) {
      throw new BadRequestException('Give a reason');
    }
    const data: Prisma.ServiceUserReferralUncheckedUpdateInput = {
      status: dto.status,
      updatedById: actor.id,
    };
    if (isReferralDecision(dto.status)) {
      data.decisionAt = new Date();
      data.decisionById = actor.id;
      data.decisionReason = reason;
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserReferral.update({
        where: { id: referralId },
        data,
      });
      await this.addEvent(tx, {
        serviceUserId,
        referralId,
        action: 'STATUS_CHANGED',
        fromStatus: existing.status,
        toStatus: dto.status,
        note: reason,
        userId: actor.id,
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.REFERRAL_STATUS_CHANGED,
        'ServiceUserReferral',
        referralId,
        existing,
        row,
        meta,
      );
    });
    return this.getReferral(actor, serviceUserId, referralId);
  }

  async addFollowUp(
    actor: RequestUser,
    serviceUserId: string,
    referralId: string,
    dto: ReferralFollowUpDto,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    await this.findReferral(serviceUserId, referralId);
    const next = dateOrNull(dto.nextFollowUpAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserReferral.update({
        where: { id: referralId },
        data: { nextFollowUpAt: next, updatedById: actor.id },
      });
      await this.addEvent(tx, {
        serviceUserId,
        referralId,
        action: 'FOLLOW_UP',
        note: dto.note.trim(),
        changes: next
          ? [{ field: 'Next follow-up', from: null, to: next.toISOString() }]
          : undefined,
        userId: actor.id,
      });
    });
    return this.getReferral(actor, serviceUserId, referralId);
  }

  async addReferralNote(
    actor: RequestUser,
    serviceUserId: string,
    referralId: string,
    note: string,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    await this.findReferral(serviceUserId, referralId);
    await this.addEvent(this.prisma, {
      serviceUserId,
      referralId,
      action: 'NOTE',
      note: note.trim(),
      userId: actor.id,
    });
    return this.getReferral(actor, serviceUserId, referralId);
  }

  /** Everything on referrals and quotations for this service user, newest first. */
  async history(actor: RequestUser, serviceUserId: string) {
    await this.ensureServiceUser(actor, serviceUserId);
    const events = await this.prisma.serviceUserReferralEvent.findMany({
      where: { serviceUserId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const refIds = [
      ...new Set(events.map((e) => e.referralId).filter(Boolean)),
    ] as string[];
    const quoteIds = [
      ...new Set(events.map((e) => e.quotationId).filter(Boolean)),
    ] as string[];
    const [refs, quotes] = await Promise.all([
      refIds.length
        ? this.prisma.serviceUserReferral.findMany({
            where: { id: { in: refIds } },
            select: { id: true, referenceNumber: true },
          })
        : [],
      quoteIds.length
        ? this.prisma.careQuotation.findMany({
            where: { id: { in: quoteIds } },
            select: { id: true, referenceNumber: true, revision: true },
          })
        : [],
    ]);
    const refMap = new Map(refs.map((r) => [r.id, r.referenceNumber]));
    const quoteMap = new Map(
      quotes.map((q) => [q.id, `${q.referenceNumber} rev ${q.revision}`]),
    );
    const names = await this.resolveNames(
      events.map((e) => ({ user: e.userId })),
    );
    return {
      data: events.map((e) => ({
        ...this.eventRow(e, names),
        referralReference: e.referralId
          ? (refMap.get(e.referralId) ?? null)
          : null,
        quotationReference: e.quotationId
          ? (quoteMap.get(e.quotationId) ?? null)
          : null,
      })),
    };
  }

  // ================================================================== quotations

  async listQuotations(actor: RequestUser, serviceUserId: string) {
    await this.ensureServiceUser(actor, serviceUserId);
    const rows = await this.prisma.careQuotation.findMany({
      where: { serviceUserId, deletedAt: null },
      include: { lines: true, charges: true },
      orderBy: [{ referenceNumber: 'desc' }, { revision: 'desc' }],
    });
    const names = await this.resolveNames(
      rows.map((q) => ({ employee: q.responsibleEmployeeId })),
    );
    const referralRefs = await this.referralReferences(
      rows.map((q) => q.referralId),
    );
    return { data: rows.map((q) => this.quotationRow(q, names, referralRefs)) };
  }

  async getQuotation(
    actor: RequestUser,
    serviceUserId: string,
    quotationId: string,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const q = await this.findQuotation(serviceUserId, quotationId);
    const rootId = q.rootQuotationId ?? q.id;
    const [revisions, events, documents, visitPlan] = await Promise.all([
      this.prisma.careQuotation.findMany({
        where: {
          serviceUserId,
          deletedAt: null,
          OR: [{ id: rootId }, { rootQuotationId: rootId }],
        },
        orderBy: { revision: 'desc' },
        select: {
          id: true,
          revision: true,
          status: true,
          weeklyTotal: true,
          createdAt: true,
        },
      }),
      this.prisma.serviceUserReferralEvent.findMany({
        where: { quotationId },
        orderBy: { createdAt: 'desc' },
      }),
      this.linkedDocuments(serviceUserId, QUOTATION_DOCUMENT_LINK, quotationId),
      q.visitPlanId
        ? this.prisma.serviceUserVisitPlan.findFirst({
            where: { id: q.visitPlanId },
            select: {
              id: true,
              status: true,
              effectiveFrom: true,
              weeklyContractedHours: true,
            },
          })
        : null,
    ]);
    const names = await this.resolveNames([
      { employee: q.responsibleEmployeeId },
      { user: q.createdById },
      { user: q.sentById },
      { user: q.acceptanceRecordedById },
      ...events.map((e) => ({ user: e.userId })),
    ]);
    const referralRefs = await this.referralReferences([q.referralId]);
    return {
      data: {
        ...this.quotationRow(q, names, referralRefs),
        createdByName: q.createdById
          ? (names.users.get(q.createdById) ?? null)
          : null,
        sentByName: q.sentById ? (names.users.get(q.sentById) ?? null) : null,
        acceptanceRecordedByName: q.acceptanceRecordedById
          ? (names.users.get(q.acceptanceRecordedById) ?? null)
          : null,
        visitPlan: visitPlan
          ? {
              id: visitPlan.id,
              status: visitPlan.status,
              effectiveFrom: visitPlan.effectiveFrom.toISOString(),
              weeklyContractedHours: visitPlan.weeklyContractedHours,
            }
          : null,
        revisions: revisions.map((r) => ({
          ...r,
          weeklyTotal: Number(r.weeklyTotal),
          createdAt: r.createdAt.toISOString(),
        })),
        events: events.map((e) => this.eventRow(e, names)),
        documents,
      },
    };
  }

  async createQuotation(
    actor: RequestUser,
    serviceUserId: string,
    dto: CreateQuotationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    await this.validateQuotationRefs(serviceUserId, dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const referenceNumber = await this.allocateReference(
        tx,
        'QUO',
        new Date().getUTCFullYear(),
      );
      const row = await tx.careQuotation.create({
        data: {
          ...this.quotationScalars(dto),
          ...this.quotationChildren(dto),
          referenceNumber,
          revision: 1,
          serviceUserId,
          createdById: actor.id,
        },
      });
      await tx.careQuotation.update({
        where: { id: row.id },
        data: { rootQuotationId: row.id },
      });
      await this.addEvent(tx, {
        serviceUserId,
        referralId: row.referralId,
        quotationId: row.id,
        action: 'QUOTE_CREATED',
        toStatus: 'DRAFT',
        userId: actor.id,
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.QUOTATION_CREATED,
        'CareQuotation',
        row.id,
        null,
        row,
        meta,
      );
      return row;
    });
    return this.getQuotation(actor, serviceUserId, created.id);
  }

  /** Only drafts can be edited; sent / accepted quotations are revised instead. */
  async updateQuotation(
    actor: RequestUser,
    serviceUserId: string,
    quotationId: string,
    dto: UpdateQuotationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const existing = await this.findQuotation(serviceUserId, quotationId);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only draft quotations can be edited — create a revision instead',
      );
    }
    await this.validateQuotationRefs(serviceUserId, dto);
    await this.prisma.$transaction(async (tx) => {
      const scalars = this.quotationScalars(dto, true);
      if (dto.lines !== undefined || dto.charges !== undefined) {
        const lines =
          dto.lines ??
          existing.lines.map((l) => ({
            description: l.description,
            daysOfWeek: l.daysOfWeek,
            visitsPerWeek: l.visitsPerWeek,
            durationMinutes: l.durationMinutes,
            numberOfCarers: l.numberOfCarers,
            hourlyRate: Number(l.hourlyRate),
          }));
        const charges =
          dto.charges ??
          existing.charges.map((c) => ({
            description: c.description,
            amount: Number(c.amount),
            frequency: c.frequency,
          }));
        await tx.careQuotationLine.deleteMany({ where: { quotationId } });
        await tx.careQuotationCharge.deleteMany({ where: { quotationId } });
        Object.assign(scalars, this.quotationChildren({ lines, charges }));
      }
      const row = await tx.careQuotation.update({
        where: { id: quotationId },
        data: { ...scalars, updatedById: actor.id },
      });
      const changes = await this.describeChanges(
        existing,
        row,
        QUOTATION_FIELD_LABELS,
        tx,
      );
      const servicesChanged =
        dto.lines !== undefined || dto.charges !== undefined;
      if (changes.length || servicesChanged) {
        await this.addEvent(tx, {
          serviceUserId,
          referralId: row.referralId,
          quotationId,
          action: 'QUOTE_UPDATED',
          changes:
            servicesChanged && !changes.some((c) => c.field === 'Weekly total')
              ? [
                  ...changes,
                  { field: 'Services / charges', from: null, to: 'updated' },
                ]
              : changes,
          userId: actor.id,
        });
        await this.logAudit(
          tx,
          actor,
          AuditAction.QUOTATION_UPDATED,
          'CareQuotation',
          quotationId,
          existing,
          row,
          meta,
        );
      }
    });
    return this.getQuotation(actor, serviceUserId, quotationId);
  }

  async changeQuotationStatus(
    actor: RequestUser,
    serviceUserId: string,
    quotationId: string,
    dto: QuotationStatusDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const existing = await this.findQuotation(serviceUserId, quotationId);
    const next = nextQuotationStatus(existing.status, dto.action);
    if (!next) {
      throw new BadRequestException(
        `This quotation is ${existing.status.toLowerCase()} and cannot be ${QUOTATION_ACTION_PAST[dto.action]}`,
      );
    }
    const at = dto.at ? new Date(dto.at) : new Date();
    const note = trimOrNull(dto.note);
    const data: Prisma.CareQuotationUncheckedUpdateInput = {
      status: next,
      updatedById: actor.id,
    };
    switch (dto.action) {
      case 'SEND':
        if (!existing.lines.length)
          throw new BadRequestException('Add at least one proposed service');
        data.sentAt = at;
        data.sentById = actor.id;
        break;
      case 'ACCEPT':
        if (!dto.acceptedByName?.trim())
          throw new BadRequestException('Enter who accepted the quotation');
        data.acceptedAt = at;
        data.acceptedByName = dto.acceptedByName.trim();
        data.acceptanceMethod = trimOrNull(dto.acceptanceMethod);
        data.acceptanceRecordedById = actor.id;
        break;
      case 'DECLINE':
        data.declinedAt = at;
        data.declineReason = note;
        break;
      case 'WITHDRAW':
        if (!note)
          throw new BadRequestException('Give a reason for withdrawing');
        break;
    }
    const rootId = existing.rootQuotationId ?? existing.id;
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.careQuotation.update({
        where: { id: quotationId },
        data,
      });
      if (dto.action === 'ACCEPT') {
        // Earlier revisions stay as they were (acceptance details kept) and are marked superseded.
        await tx.careQuotation.updateMany({
          where: {
            id: { not: quotationId },
            deletedAt: null,
            status: { in: ['SENT', 'ACCEPTED'] },
            OR: [{ id: rootId }, { rootQuotationId: rootId }],
          },
          data: { status: 'SUPERSEDED', supersededAt: at },
        });
      }
      await this.addEvent(tx, {
        serviceUserId,
        referralId: row.referralId,
        quotationId,
        action: `QUOTE_${next === 'SENT' ? 'SENT' : next}`,
        fromStatus: existing.status,
        toStatus: next,
        note:
          dto.action === 'ACCEPT'
            ? [
                `Accepted by ${row.acceptedByName}`,
                row.acceptanceMethod ? `(${row.acceptanceMethod})` : '',
                note ?? '',
              ]
                .filter(Boolean)
                .join(' ')
            : note,
        userId: actor.id,
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.QUOTATION_STATUS_CHANGED,
        'CareQuotation',
        quotationId,
        existing,
        row,
        meta,
      );
    });
    return this.getQuotation(actor, serviceUserId, quotationId);
  }

  /** New draft revision copied from this one; the original is left untouched. */
  async reviseQuotation(
    actor: RequestUser,
    serviceUserId: string,
    quotationId: string,
    note: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(actor, serviceUserId);
    const source = await this.findQuotation(serviceUserId, quotationId);
    if (source.status === 'DRAFT') {
      throw new BadRequestException('Edit the draft instead of revising it');
    }
    const rootId = source.rootQuotationId ?? source.id;
    const family = await this.prisma.careQuotation.findMany({
      where: {
        deletedAt: null,
        OR: [{ id: rootId }, { rootQuotationId: rootId }],
      },
      select: { revision: true, status: true },
    });
    if (family.some((f) => f.status === 'DRAFT')) {
      throw new BadRequestException(
        'A draft revision already exists for this quotation',
      );
    }
    const latestRevision = Math.max(...family.map((f) => f.revision));
    if (source.revision !== latestRevision) {
      throw new BadRequestException(
        `Revise the latest revision (${latestRevision}) instead`,
      );
    }
    const revision = latestRevision + 1;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.careQuotation.create({
        data: {
          referenceNumber: source.referenceNumber,
          revision,
          rootQuotationId: rootId,
          serviceUserId,
          referralId: source.referralId,
          visitPlanId: source.visitPlanId,
          responsibleEmployeeId: source.responsibleEmployeeId,
          payerType: source.payerType,
          payerName: source.payerName,
          payerRelationship: source.payerRelationship,
          payerEmail: source.payerEmail,
          payerPhone: source.payerPhone,
          payerAddress: source.payerAddress,
          validUntil: source.validUntil,
          startDate: source.startDate,
          currency: source.currency,
          notes: source.notes,
          terms: source.terms,
          ...this.quotationChildren({
            lines: source.lines.map((l) => ({
              description: l.description,
              daysOfWeek: l.daysOfWeek,
              visitsPerWeek: l.visitsPerWeek,
              durationMinutes: l.durationMinutes,
              numberOfCarers: l.numberOfCarers,
              hourlyRate: Number(l.hourlyRate),
            })),
            charges: source.charges.map((c) => ({
              description: c.description,
              amount: Number(c.amount),
              frequency: c.frequency,
            })),
          }),
          createdById: actor.id,
        },
      });
      await this.addEvent(tx, {
        serviceUserId,
        referralId: row.referralId,
        quotationId: row.id,
        action: 'QUOTE_REVISED',
        toStatus: 'DRAFT',
        note: [
          `Revision ${revision} created from revision ${source.revision}`,
          trimOrNull(note),
        ]
          .filter(Boolean)
          .join('. '),
        userId: actor.id,
      });
      await this.logAudit(
        tx,
        actor,
        AuditAction.QUOTATION_CREATED,
        'CareQuotation',
        row.id,
        null,
        row,
        meta,
      );
      return row;
    });
    return this.getQuotation(actor, serviceUserId, created.id);
  }

  // ===================================================================== helpers

  private async ensureServiceUser(actor: RequestUser, serviceUserId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true, locationId: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
    await this.orgScope.assertServiceUserInScope(
      this.orgScope.fromRequestUser(actor),
      serviceUserId,
    );
    return su;
  }

  private async findReferral(serviceUserId: string, referralId: string) {
    const r = await this.prisma.serviceUserReferral.findFirst({
      where: { id: referralId, serviceUserId, deletedAt: null },
    });
    if (!r) throw new NotFoundException('Referral not found');
    return r;
  }

  private async findQuotation(
    serviceUserId: string,
    quotationId: string,
  ): Promise<QuotationFull> {
    const q = await this.prisma.careQuotation.findFirst({
      where: { id: quotationId, serviceUserId, deletedAt: null },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        charges: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  private async validateReferralRefs(
    actor: RequestUser,
    dto: Partial<CreateReferralDto>,
  ) {
    const empIds = [dto.receivedByEmployeeId, dto.responsibleEmployeeId].filter(
      (x): x is string => Boolean(x),
    );
    if (empIds.length) {
      const found = await this.prisma.employee.count({
        where: { id: { in: [...new Set(empIds)] }, deletedAt: null },
      });
      if (found !== new Set(empIds).size)
        throw new BadRequestException('Employee not found');
    }
    if (dto.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: dto.locationId, deletedAt: null },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException('Branch not found');
      this.orgScope.assertLocationAccess(
        this.orgScope.fromRequestUser(actor),
        dto.locationId,
      );
    }
    if (dto.fundingTypeId) {
      const ft = await this.prisma.fundingType.findFirst({
        where: { id: dto.fundingTypeId, deletedAt: null },
        select: { id: true },
      });
      if (!ft) throw new BadRequestException('Funding arrangement not found');
    }
    if (dto.funderId) {
      const f = await this.prisma.funder.findFirst({
        where: { id: dto.funderId, deletedAt: null },
        select: { id: true },
      });
      if (!f) throw new BadRequestException('Funding organisation not found');
    }
    return {
      receivedByEmployeeId: dto.receivedByEmployeeId,
      responsibleEmployeeId: dto.responsibleEmployeeId,
      locationId: dto.locationId,
      fundingTypeId: dto.fundingTypeId,
      funderId: dto.funderId,
    };
  }

  private async validateQuotationRefs(
    serviceUserId: string,
    dto: Partial<CreateQuotationDto>,
  ) {
    if (dto.referralId) await this.findReferral(serviceUserId, dto.referralId);
    if (dto.visitPlanId) {
      const vp = await this.prisma.serviceUserVisitPlan.findFirst({
        where: { id: dto.visitPlanId, serviceUserId, deletedAt: null },
        select: { id: true },
      });
      if (!vp)
        throw new BadRequestException(
          'Care package not found for this service user',
        );
    }
    if (dto.responsibleEmployeeId) {
      const e = await this.prisma.employee.findFirst({
        where: { id: dto.responsibleEmployeeId, deletedAt: null },
        select: { id: true },
      });
      if (!e) throw new BadRequestException('Employee not found');
    }
  }

  private quotationScalars(dto: Partial<CreateQuotationDto>, partial = false) {
    const data: Prisma.CareQuotationUncheckedUpdateInput = {};
    const set = <K extends keyof CreateQuotationDto>(k: K, v: unknown) => {
      if (!partial || dto[k] !== undefined)
        (data as Record<string, unknown>)[k] = v;
    };
    set('referralId', dto.referralId ?? null);
    set('visitPlanId', dto.visitPlanId ?? null);
    set('responsibleEmployeeId', dto.responsibleEmployeeId ?? null);
    set('payerType', dto.payerType ?? 'SERVICE_USER');
    set('payerName', trimOrNull(dto.payerName));
    set('payerRelationship', trimOrNull(dto.payerRelationship));
    set('payerEmail', trimOrNull(dto.payerEmail));
    set('payerPhone', trimOrNull(dto.payerPhone));
    set('payerAddress', trimOrNull(dto.payerAddress));
    set('validUntil', civilDateOrNull(dto.validUntil));
    set('startDate', civilDateOrNull(dto.startDate));
    set('notes', trimOrNull(dto.notes));
    set('terms', trimOrNull(dto.terms));
    return data as Prisma.CareQuotationUncheckedCreateInput &
      Prisma.CareQuotationUncheckedUpdateInput;
  }

  /** Nested line / charge create + server-calculated totals. */
  private quotationChildren(
    dto: Pick<CreateQuotationDto, 'lines' | 'charges'>,
  ) {
    const lines = dto.lines ?? [];
    const charges = dto.charges ?? [];
    const totals = quotationTotals(lines, charges);
    return {
      ...totals,
      lines: {
        create: lines.map((l, i) => ({
          description: l.description.trim(),
          daysOfWeek: l.daysOfWeek ?? [],
          visitsPerWeek: l.visitsPerWeek,
          durationMinutes: l.durationMinutes,
          numberOfCarers: l.numberOfCarers,
          hourlyRate: l.hourlyRate,
          ...quotationLineTotals(l),
          sortOrder: i,
        })),
      },
      charges: {
        create: charges.map((c, i) => ({
          description: c.description.trim(),
          amount: c.amount,
          frequency: c.frequency,
          sortOrder: i,
        })),
      },
    };
  }

  private async allocateReference(tx: Tx, prefix: 'REF' | 'QUO', year: number) {
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "service_users"."ReferralNumberSequence" ("kind", "year", "lastValue", "updatedAt")
      VALUES (${prefix}, ${year}, 1, now())
      ON CONFLICT ("kind", "year")
      DO UPDATE SET "lastValue" = "ReferralNumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `);
    return formatReferenceNumber(prefix, year, rows[0]?.lastValue ?? 1);
  }

  private addEvent(
    tx: Tx | PrismaService,
    e: {
      serviceUserId: string;
      referralId?: string | null;
      quotationId?: string | null;
      action: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      note?: string | null;
      changes?: Array<{
        field: string;
        from: string | null;
        to: string | null;
      }>;
      userId: string;
    },
  ) {
    return tx.serviceUserReferralEvent.create({
      data: {
        serviceUserId: e.serviceUserId,
        referralId: e.referralId ?? null,
        quotationId: e.quotationId ?? null,
        action: e.action,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        note: e.note ?? null,
        changes: e.changes?.length
          ? (e.changes as Prisma.InputJsonValue)
          : Prisma.DbNull,
        userId: e.userId,
      },
    });
  }

  /** Readable before/after list; ids are turned into names. */
  private async describeChanges(
    before: object,
    after: object,
    labels: Record<string, string>,
    client: Tx | PrismaService = this.prisma,
  ) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const raw: Array<{ key: string; from: unknown; to: unknown }> = [];
    for (const key of Object.keys(labels)) {
      if (valueText(b[key]) !== valueText(a[key]))
        raw.push({ key, from: b[key], to: a[key] });
    }
    if (!raw.length) return [];
    const names = await this.resolveNames(
      raw.flatMap((r): NameRef[] => {
        const pick = (v: unknown) => (typeof v === 'string' ? v : null);
        if (r.key.endsWith('EmployeeId'))
          return [{ employee: pick(r.from) }, { employee: pick(r.to) }];
        if (r.key === 'locationId')
          return [{ location: pick(r.from) }, { location: pick(r.to) }];
        if (r.key === 'fundingTypeId')
          return [{ fundingType: pick(r.from) }, { fundingType: pick(r.to) }];
        if (r.key === 'funderId')
          return [{ funder: pick(r.from) }, { funder: pick(r.to) }];
        return [];
      }),
      client,
    );
    const show = (key: string, v: unknown): string | null => {
      const s = valueText(v);
      if (s == null || s === '') return null;
      if (key.endsWith('EmployeeId')) return names.employees.get(s) ?? s;
      if (key === 'locationId') return names.locations.get(s) ?? s;
      if (key === 'fundingTypeId') return names.fundingTypes.get(s)?.name ?? s;
      if (key === 'funderId') return names.funders.get(s) ?? s;
      return s.length > 300 ? `${s.slice(0, 300)}…` : s;
    };
    return raw.map((r) => ({
      field: labels[r.key],
      from: show(r.key, r.from),
      to: show(r.key, r.to),
    }));
  }

  private referralIds(rows: ServiceUserReferral[]) {
    return rows.flatMap((r) => [
      { employee: r.receivedByEmployeeId },
      { employee: r.responsibleEmployeeId },
      { user: r.recordedById },
      { user: r.updatedById },
      { user: r.decisionById },
      { location: r.locationId },
      { fundingType: r.fundingTypeId },
      { funder: r.funderId },
    ]);
  }

  private async resolveNames(
    refs: Array<{
      employee?: string | null;
      user?: string | null;
      location?: string | null;
      fundingType?: string | null;
      funder?: string | null;
    }>,
    client: Tx | PrismaService = this.prisma,
  ): Promise<Names> {
    const ids = (k: keyof (typeof refs)[number]) => [
      ...new Set(refs.map((r) => r[k]).filter((x): x is string => Boolean(x))),
    ];
    const [emps, users, locs, fts, funders] = await Promise.all([
      ids('employee').length
        ? client.employee.findMany({
            where: { id: { in: ids('employee') } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          })
        : [],
      ids('user').length
        ? client.user.findMany({
            where: { id: { in: ids('user') } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [],
      ids('location').length
        ? client.location.findMany({
            where: { id: { in: ids('location') } },
            select: { id: true, name: true },
          })
        : [],
      ids('fundingType').length
        ? client.fundingType.findMany({
            where: { id: { in: ids('fundingType') } },
            select: { id: true, name: true, code: true },
          })
        : [],
      ids('funder').length
        ? client.funder.findMany({
            where: { id: { in: ids('funder') } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const join = (...p: Array<string | null | undefined>) =>
      p
        .map((x) => x?.trim())
        .filter(Boolean)
        .join(' ');
    return {
      employees: new Map(
        emps.map((e) => [
          e.id,
          join(e.personalDetail?.firstName, e.personalDetail?.lastName) || '—',
        ]),
      ),
      users: new Map(
        users.map((u) => [u.id, join(u.firstName, u.lastName) || u.email]),
      ),
      locations: new Map(locs.map((l) => [l.id, l.name])),
      fundingTypes: new Map(
        fts.map((f) => [f.id, { name: f.name, code: f.code }]),
      ),
      funders: new Map(funders.map((f) => [f.id, f.name])),
    };
  }

  private async referralReferences(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.serviceUserReferral.findMany({
      where: { id: { in: unique } },
      select: { id: true, referenceNumber: true },
    });
    return new Map(rows.map((r) => [r.id, r.referenceNumber]));
  }

  private async linkedDocuments(
    serviceUserId: string,
    linkedRecordType: string,
    linkedRecordId: string,
  ) {
    const docs = await this.prisma.serviceUserDocumentRecord.findMany({
      where: {
        serviceUserId,
        linkedRecordType,
        linkedRecordId,
        deletedAt: null,
      },
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        title: true,
        fileName: true,
        documentDate: true,
        uploadedAt: true,
        status: true,
        documentType: { select: { name: true } },
      },
    });
    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      documentType: d.documentType.name,
      documentDate: d.documentDate.toISOString(),
      uploadedAt: d.uploadedAt.toISOString(),
      status: d.status,
    }));
  }

  private person(id: string | null, map: Map<string, string>) {
    return id ? { id, name: map.get(id) ?? '—' } : null;
  }

  private referralRow(r: ServiceUserReferral, names: Names) {
    const ft = r.fundingTypeId
      ? names.fundingTypes.get(r.fundingTypeId)
      : undefined;
    return {
      id: r.id,
      referenceNumber: r.referenceNumber,
      serviceUserId: r.serviceUserId,
      status: r.status,
      priority: r.priority,
      sourceType: r.sourceType,
      referringOrganisation: r.referringOrganisation,
      referrerName: r.referrerName,
      referrerRole: r.referrerRole,
      referrerPhone: r.referrerPhone,
      referrerEmail: r.referrerEmail,
      referralDate: r.referralDate?.toISOString() ?? null,
      receivedAt: r.receivedAt.toISOString(),
      receivedVia: r.receivedVia,
      receivedBy: this.person(r.receivedByEmployeeId, names.employees),
      location: r.locationId
        ? { id: r.locationId, name: names.locations.get(r.locationId) ?? '—' }
        : null,
      responsibleEmployee: this.person(
        r.responsibleEmployeeId,
        names.employees,
      ),
      careRequirements: r.careRequirements,
      expectedStartDate:
        r.expectedStartDate?.toISOString().slice(0, 10) ?? null,
      requestedHoursPerWeek: num(r.requestedHoursPerWeek),
      fundingType:
        r.fundingTypeId && ft
          ? { id: r.fundingTypeId, name: ft.name, code: ft.code }
          : null,
      funder: r.funderId
        ? { id: r.funderId, name: names.funders.get(r.funderId) ?? '—' }
        : null,
      fundingNotes: r.fundingNotes,
      nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
      followUpOverdue: Boolean(
        r.nextFollowUpAt && r.nextFollowUpAt < new Date(),
      ),
      decisionAt: r.decisionAt?.toISOString() ?? null,
      decisionByName: r.decisionById
        ? (names.users.get(r.decisionById) ?? null)
        : null,
      decisionReason: r.decisionReason,
      notes: r.notes,
      recordedByName: r.recordedById
        ? (names.users.get(r.recordedById) ?? null)
        : null,
      updatedByName: r.updatedById
        ? (names.users.get(r.updatedById) ?? null)
        : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private quotationRow(
    q: QuotationFull,
    names: Names,
    referralRefs: Map<string, string>,
  ) {
    return {
      id: q.id,
      referenceNumber: q.referenceNumber,
      revision: q.revision,
      rootQuotationId: q.rootQuotationId,
      serviceUserId: q.serviceUserId,
      referral: q.referralId
        ? {
            id: q.referralId,
            referenceNumber: referralRefs.get(q.referralId) ?? '—',
          }
        : null,
      visitPlanId: q.visitPlanId,
      status: q.status,
      expired: isQuotationExpired(
        q.status,
        q.validUntil,
        new Date().toISOString().slice(0, 10),
      ),
      responsibleEmployee: this.person(
        q.responsibleEmployeeId,
        names.employees,
      ),
      payerType: q.payerType,
      payerName: q.payerName,
      payerRelationship: q.payerRelationship,
      payerEmail: q.payerEmail,
      payerPhone: q.payerPhone,
      payerAddress: q.payerAddress,
      validUntil: q.validUntil?.toISOString().slice(0, 10) ?? null,
      startDate: q.startDate?.toISOString().slice(0, 10) ?? null,
      currency: q.currency,
      notes: q.notes,
      terms: q.terms,
      weeklyHours: Number(q.weeklyHours),
      weeklyCareCost: Number(q.weeklyCareCost),
      weeklyChargesCost: Number(q.weeklyChargesCost),
      monthlyChargesCost: Number(q.monthlyChargesCost),
      oneOffChargesCost: Number(q.oneOffChargesCost),
      weeklyTotal: Number(q.weeklyTotal),
      monthlyTotal: Number(q.monthlyTotal),
      lines: q.lines.map((l) => ({
        id: l.id,
        description: l.description,
        daysOfWeek: l.daysOfWeek,
        visitsPerWeek: l.visitsPerWeek,
        durationMinutes: l.durationMinutes,
        numberOfCarers: l.numberOfCarers,
        hourlyRate: Number(l.hourlyRate),
        weeklyHours: Number(l.weeklyHours),
        weeklyCost: Number(l.weeklyCost),
      })),
      charges: q.charges.map((c) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount),
        frequency: c.frequency,
      })),
      sentAt: q.sentAt?.toISOString() ?? null,
      acceptedAt: q.acceptedAt?.toISOString() ?? null,
      acceptedByName: q.acceptedByName,
      acceptanceMethod: q.acceptanceMethod,
      declinedAt: q.declinedAt?.toISOString() ?? null,
      declineReason: q.declineReason,
      supersededAt: q.supersededAt?.toISOString() ?? null,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    };
  }

  private eventRow(
    e: {
      id: string;
      action: string;
      fromStatus: string | null;
      toStatus: string | null;
      note: string | null;
      changes: Prisma.JsonValue;
      userId: string | null;
      createdAt: Date;
      referralId: string | null;
      quotationId: string | null;
    },
    names: Names,
  ) {
    return {
      id: e.id,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      note: e.note,
      changes: Array.isArray(e.changes) ? e.changes : [],
      userName: e.userId ? (names.users.get(e.userId) ?? null) : null,
      referralId: e.referralId,
      quotationId: e.quotationId,
      createdAt: e.createdAt.toISOString(),
    };
  }

  private logAudit(
    tx: Tx,
    actor: RequestUser,
    action: AuditAction,
    recordType: string,
    recordId: string,
    before: object | null,
    after: object,
    meta?: RequestAuditMeta,
  ) {
    return this.audit.logAudit({
      tx,
      userId: actor.id,
      module: AuditModule.SERVICE_USER,
      action,
      recordType,
      recordId,
      ...(before ? { oldValues: auditSnapshot(before) } : {}),
      newValues: auditSnapshot(after),
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }
}
