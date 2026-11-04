import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  EnquiryKind,
  EnquiryLostReason,
  EnquiryQuotePayerType,
  EnquiryStage,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService, andWhereFragment } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import { MoveEnquiryDto } from './dto/move-enquiry.dto';
import { EnquiryNoteDto } from './dto/note-enquiry.dto';
import { ListEnquiriesQueryDto } from './dto/list-enquiries-query.dto';
import { EnquiryDuplicatesQueryDto } from './dto/duplicates-query.dto';
import { LinkServiceUserDto } from './dto/link-service-user.dto';
import { InitialAssessmentsService } from '../initial-assessments/initial-assessments.service';
import { canMove } from './crm-workflow.util';

type EventRow = Prisma.EnquiryEventGetPayload<object>;
type EnquiryRow = Prisma.EnquiryGetPayload<{ include: { events: true } }>;
type AnyEnquiryRow = EnquiryRow | Prisma.EnquiryGetPayload<object>;

export const LOST_REASON_LABELS: Record<EnquiryLostReason, string> = {
  PRICE: 'Price / cost',
  CHOSE_ANOTHER_PROVIDER: 'Chose another provider',
  NO_CAPACITY: 'We had no capacity',
  OUT_OF_AREA: 'Outside our area',
  NEEDS_NOT_MET: 'We could not meet the care needs',
  MOVED_TO_CARE_HOME: 'Moved to a care home',
  NO_LONGER_NEEDED: 'Care no longer needed',
  DECEASED: 'Person passed away',
  NO_RESPONSE: 'No response from enquirer',
  FUNDING_DECLINED: 'Funding declined',
  OTHER: 'Other',
};

const LONDON_DATE_TIME: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
};

function mapEvent(row: EventRow) {
  return {
    id: row.id,
    action: row.action,
    note: row.note,
    userId: row.userId,
    at: row.at.toISOString(),
  };
}

type NameMaps = {
  users?: Map<string, string | null>;
  funding?: Map<string, string>;
  locations?: Map<string, string>;
  carePlans?: Map<string, string>;
  /** Latest initial assessment of the linked service user, by service user id. */
  assessments?: Map<string, { id: string; status: string; updatedAt: string }>;
};

function mapEnquiry(row: AnyEnquiryRow, maps: NameMaps = {}) {
  const events = 'events' in row && Array.isArray(row.events) ? row.events : [];
  const user = (id: string | null) => (id ? (maps.users?.get(id) ?? null) : null);
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    stage: row.stage,
    kind: row.kind,
    referringOrganisation: row.referringOrganisation,
    referrerRole: row.referrerRole,
    referralReference: row.referralReference,
    referralDate: row.referralDate?.toISOString() ?? null,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth?.toISOString() ?? null,
    contactName: row.contactName,
    contactRelationship: row.contactRelationship,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    source: row.source,
    sourceDetail: row.sourceDetail,
    enquiryType: row.enquiryType,
    urgency: row.urgency,
    needs: row.needs,
    carePlanFormIds: row.carePlanFormIds,
    // A care plan removed since keeps its id but has no name; it is left out of the list.
    carePlans: row.carePlanFormIds
      .filter(id => maps.carePlans?.has(id))
      .map(id => ({ id, name: maps.carePlans!.get(id)! })),
    ownerId: row.ownerId,
    ownerName: user(row.ownerId),
    locationId: row.locationId,
    locationName: row.locationId ? (maps.locations?.get(row.locationId) ?? null) : null,
    receivedVia: row.receivedVia,
    sentAt: row.sentAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    addressLine: row.addressLine,
    postcode: row.postcode,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    fundingType: row.fundingType,
    fundingTypeId: row.fundingTypeId,
    fundingTypeName: row.fundingTypeId ? (maps.funding?.get(row.fundingTypeId) ?? null) : null,
    funderName: row.funderName,
    hoursPerWeek: row.hoursPerWeek,
    visitsPerDay: row.visitsPerDay,
    requestedStartDate: row.requestedStartDate?.toISOString() ?? null,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    nextAction: row.nextAction,
    assessmentAt: row.assessmentAt?.toISOString() ?? null,
    assessorId: row.assessorId,
    assessorName: user(row.assessorId),
    assessmentLocation: row.assessmentLocation,
    quoteWeeklyAmount: row.quoteWeeklyAmount,
    quoteHourlyRate: row.quoteHourlyRate,
    quoteSentAt: row.quoteSentAt?.toISOString() ?? null,
    quoteNotes: row.quoteNotes,
    lostReasonCode: row.lostReasonCode,
    lostReason: row.lostReason,
    convertedServiceUserId: row.convertedServiceUserId,
    initialAssessment: row.convertedServiceUserId
      ? (maps.assessments?.get(row.convertedServiceUserId) ?? null)
      : null,
    recordedById: row.recordedById,
    recordedByName: user(row.recordedById),
    stageChangedAt: row.stageChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events: [...events].sort((a, b) => a.at.getTime() - b.at.getTime()).map(mapEvent),
  };
}

/** Quote payer type for a funder's funding type: council, NHS, the person themselves, or other. */
export function payerTypeForFundingType(code: string | null | undefined): EnquiryQuotePayerType {
  switch (code) {
    case 'LOCAL_AUTHORITY':
      return EnquiryQuotePayerType.LOCAL_AUTHORITY;
    case 'NHS':
      return EnquiryQuotePayerType.NHS;
    case 'PRIVATE':
    case 'SELF_FUNDED':
      return EnquiryQuotePayerType.PRIVATE_CLIENT;
    default:
      return EnquiryQuotePayerType.OTHER;
  }
}

const digitsOnly = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly initialAssessments: InitialAssessmentsService,
  ) {}

  private parseDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  /* ─── scoping ───────────────────────────────────────────────────────── */

  /**
   * Rows the actor may see. Branch-restricted users see their branches' enquiries plus the ones
   * they recorded; company-wide users see all (optionally narrowed to the header branch).
   */
  private scopeWhere(actor: RequestUser, requestedLocationId?: string): Prisma.EnquiryWhereInput {
    const scope = this.orgScope.fromRequestUser(actor);
    const ids = this.orgScope.resolveListLocationIds(scope, requestedLocationId);
    const where: Prisma.EnquiryWhereInput = { deletedAt: null };
    if (!ids) return where;
    if (scope.locationIds === null) {
      // Unrestricted user filtering by the header branch.
      andWhereFragment(where, { locationId: { in: ids } });
      return where;
    }
    andWhereFragment(where, {
      OR: [...(ids.length ? [{ locationId: { in: ids } }] : []), { recordedById: actor.id }],
    });
    return where;
  }

  /** The enquiry if the actor may see it (used by quotations too). */
  async getInScope(actor: RequestUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    const row = await tx.enquiry.findFirst({ where: { ...this.scopeWhere(actor), id } });
    if (!row) throw new NotFoundException('Enquiry not found');
    return row;
  }

  /** Validate a requested branch; default to the actor's only branch when none is given. */
  private resolveLocationId(actor: RequestUser, requested: string | null | undefined): string | null | undefined {
    const scope = this.orgScope.fromRequestUser(actor);
    if (requested) {
      this.orgScope.assertLocationAccess(scope, requested);
      return requested;
    }
    if (requested === undefined && scope.locationIds?.length === 1) return scope.locationIds[0];
    return requested;
  }

  /* ─── name resolution ───────────────────────────────────────────────── */

  private async userNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map<string, string | null>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null]),
    );
  }

  private async fundingNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await this.prisma.serviceUserFundingType.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map(r => [r.id, r.name]));
  }

  private async carePlanNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await this.prisma.carePathwayForm.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map(r => [r.id, r.name]));
  }

  private async locationNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await this.prisma.location.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map(r => [r.id, r.name]));
  }

  private async latestAssessments(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map<string, { id: string; status: string; updatedAt: string }>();
    const rows = await this.prisma.initialAssessmentSubmission.findMany({
      where: {
        serviceUserId: { in: unique },
        deletedAt: null,
        status: { notIn: ['ARCHIVED', 'CANCELLED'] },
      },
      orderBy: { updatedAt: 'desc' },
      distinct: ['serviceUserId'],
      select: { id: true, serviceUserId: true, status: true, updatedAt: true },
    });
    return new Map(
      rows.map(r => [r.serviceUserId, { id: r.id, status: r.status, updatedAt: r.updatedAt.toISOString() }]),
    );
  }

  /** Map rows to API shape with user / funding / branch names resolved. */
  private async present<T extends AnyEnquiryRow>(rows: T[]) {
    const [users, funding, locations, carePlans, assessments] = await Promise.all([
      this.userNames(rows.flatMap(r => [r.recordedById, r.ownerId, r.assessorId])),
      this.fundingNames(rows.map(r => r.fundingTypeId)),
      this.locationNames(rows.map(r => r.locationId)),
      this.carePlanNames(rows.flatMap(r => r.carePlanFormIds)),
      this.latestAssessments(rows.map(r => r.convertedServiceUserId)),
    ]);
    return rows.map(r => mapEnquiry(r, { users, funding, locations, carePlans, assessments }));
  }

  /* ─── reads ─────────────────────────────────────────────────────────── */

  /** Active funders (Settings → Funders) for a quote's "who pays", with the quote payer type of each. */
  async funders() {
    const rows = await this.prisma.funder.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, fundingType: { select: { code: true, name: true } } },
    });
    return {
      data: rows.map(r => ({
        id: r.id,
        name: r.name,
        fundingTypeName: r.fundingType?.name ?? null,
        payerType: payerTypeForFundingType(r.fundingType?.code),
      })),
    };
  }

  async fundingTypes() {
    const rows = await this.prisma.serviceUserFundingType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true },
    });
    return { data: rows };
  }

  /** Published, active care plan forms (Settings → Care pathway), for the care needs list. */
  async carePlans() {
    const rows = await this.prisma.carePathwayForm.findMany({
      where: { formType: 'CARE_PLAN', status: 'PUBLISHED', isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { data: rows };
  }

  /** Active office users that an enquiry can be assigned to. */
  async owners() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, userRoles: { some: {} } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return {
      data: users.map(u => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
      })),
    };
  }

  async list(actor: RequestUser, query: ListEnquiriesQueryDto) {
    const where = this.scopeWhere(actor, query.locationId);
    andWhereFragment(where, {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    });
    const search = query.search?.trim();
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      andWhereFragment(where, {
        OR: [
          { referenceNumber: contains },
          { firstName: contains },
          { lastName: contains },
          { contactName: contains },
          { contactEmail: contains },
          { contactPhone: contains },
          { postcode: contains },
          { referringOrganisation: contains },
          { referralReference: contains },
        ],
      });
    }
    const rows = await this.prisma.enquiry.findMany({ where, orderBy: { createdAt: 'desc' } });
    return { data: await this.present(rows) };
  }

  async summary(actor: RequestUser, locationId?: string) {
    const rows = await this.prisma.enquiry.findMany({
      where: this.scopeWhere(actor, locationId),
      select: { stage: true, nextFollowUpAt: true, lostReasonCode: true },
    });
    const now = Date.now();
    const byStage: Record<string, number> = {};
    const lostByReason: Record<string, number> = {};
    let followUpsDue = 0;
    for (const r of rows) {
      byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
      const open = r.stage !== EnquiryStage.WON && r.stage !== EnquiryStage.LOST;
      if (open && r.nextFollowUpAt && r.nextFollowUpAt.getTime() <= now) followUpsDue++;
      if (r.stage === EnquiryStage.LOST) {
        const key = r.lostReasonCode ?? 'UNSPECIFIED';
        lostByReason[key] = (lostByReason[key] ?? 0) + 1;
      }
    }
    const won = byStage[EnquiryStage.WON] ?? 0;
    const lost = byStage[EnquiryStage.LOST] ?? 0;
    const decided = won + lost;
    return {
      data: {
        total: rows.length,
        open: rows.length - decided,
        won,
        lost,
        winRate: decided ? Math.round((won / decided) * 100) : 0,
        followUpsDue,
        byStage,
        lostByReason,
      },
    };
  }

  async getById(actor: RequestUser, id: string) {
    const row = await this.prisma.enquiry.findFirst({
      where: { ...this.scopeWhere(actor), id },
      include: { events: true },
    });
    if (!row) throw new NotFoundException('Enquiry not found');
    const [data] = await this.present([row]);
    return { data };
  }

  /**
   * Possible duplicates of a person: same first + last name (case-insensitive) with a matching or
   * missing date of birth, or the same phone number. Searches enquiries and service users in scope.
   */
  async duplicates(actor: RequestUser, q: EnquiryDuplicatesQueryDto) {
    const first = q.firstName?.trim();
    const last = q.lastName?.trim();
    const phone = digitsOnly(q.phone);
    const dob = this.parseDate(q.dateOfBirth) ?? null;
    const hasName = Boolean(first && last);
    const hasPhone = phone.length >= 7;
    if (!hasName && !hasPhone) return { data: { enquiries: [], serviceUsers: [] } };

    const sameDay = (a: Date | null, b: Date | null) =>
      !a || !b || a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    const nameFilter = hasName
      ? {
          firstName: { equals: first!, mode: Prisma.QueryMode.insensitive },
          lastName: { equals: last!, mode: Prisma.QueryMode.insensitive },
        }
      : undefined;
    const phoneTail = phone.slice(-7);

    // Enquiries
    const enquiryWhere = this.scopeWhere(actor);
    if (q.excludeId) andWhereFragment(enquiryWhere, { id: { not: q.excludeId } });
    andWhereFragment(enquiryWhere, {
      OR: [
        ...(nameFilter ? [nameFilter] : []),
        ...(hasPhone ? [{ contactPhone: { contains: phoneTail } }] : []),
      ],
    });
    const enquiryRows = await this.prisma.enquiry.findMany({
      where: enquiryWhere,
      select: { id: true, referenceNumber: true, firstName: true, lastName: true, stage: true, dateOfBirth: true, contactPhone: true },
      take: 20,
    });
    const enquiries = enquiryRows
      .filter(r => {
        const byName = hasName && r.firstName.toLowerCase() === first!.toLowerCase()
          && r.lastName.toLowerCase() === last!.toLowerCase() && sameDay(r.dateOfBirth, dob);
        const byPhone = hasPhone && digitsOnly(r.contactPhone).endsWith(phoneTail);
        return byName || byPhone;
      })
      .slice(0, 5)
      .map(r => ({ id: r.id, referenceNumber: r.referenceNumber, name: `${r.firstName} ${r.lastName}`, stage: r.stage }));

    // Service users
    const scope = this.orgScope.fromRequestUser(actor);
    const suWhere: Prisma.ServiceUserWhereInput = { deletedAt: null };
    andWhereFragment(suWhere, this.orgScope.serviceUserScopeWhere(scope));
    andWhereFragment(suWhere, {
      OR: [
        ...(nameFilter ? [nameFilter] : []),
        ...(hasPhone ? [{ phone: { contains: phoneTail } }, { mobile: { contains: phoneTail } }] : []),
      ],
    });
    const suRows = await this.prisma.serviceUser.findMany({
      where: suWhere,
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true, mobile: true },
      take: 20,
    });
    const serviceUsers = suRows
      .filter(r => {
        const byName = hasName && r.firstName.toLowerCase() === first!.toLowerCase()
          && r.lastName.toLowerCase() === last!.toLowerCase() && sameDay(r.dateOfBirth, dob);
        const byPhone = hasPhone
          && (digitsOnly(r.phone).endsWith(phoneTail) || digitsOnly(r.mobile).endsWith(phoneTail));
        return byName || byPhone;
      })
      .slice(0, 5)
      .map(r => ({ id: r.id, name: `${r.firstName} ${r.lastName}`, dateOfBirth: r.dateOfBirth?.toISOString() ?? null }));

    return { data: { enquiries, serviceUsers } };
  }

  /* ─── writes ────────────────────────────────────────────────────────── */

  async create(actor: RequestUser, dto: CreateEnquiryDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const locationId = this.resolveLocationId(actor, dto.locationId) ?? null;
    // Every enquiry belongs to the branch that received it (drives who sees and manages it).
    if (!locationId) throw new BadRequestException('Choose the branch that received this enquiry');

    return this.prisma.$transaction(async tx => {
      const year = new Date().getFullYear();
      const seq = await tx.enquiryNumberSequence.upsert({
        where: { year },
        create: { year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const referenceNumber = `ENQ-${year}-${String(seq.lastValue).padStart(4, '0')}`;

      const isReferral = dto.kind === EnquiryKind.REFERRAL;
      const created = await tx.enquiry.create({
        data: {
          referenceNumber,
          kind: dto.kind ?? EnquiryKind.ENQUIRY,
          referringOrganisation: isReferral ? (dto.referringOrganisation ?? null) : null,
          referrerRole: isReferral ? (dto.referrerRole ?? null) : null,
          referralReference: isReferral ? (dto.referralReference ?? null) : null,
          referralDate: isReferral ? (this.parseDate(dto.referralDate) ?? null) : null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth: this.parseDate(dto.dateOfBirth) ?? null,
          contactName: dto.contactName ?? null,
          contactRelationship: dto.contactRelationship ?? null,
          contactPhone: dto.contactPhone ?? null,
          contactEmail: dto.contactEmail ?? null,
          source: dto.source ?? 'OTHER',
          sourceDetail: dto.sourceDetail ?? null,
          enquiryType: dto.enquiryType ?? null,
          urgency: dto.urgency ?? 'ROUTINE',
          needs: dto.needs ?? null,
          carePlanFormIds: dto.carePlanFormIds ?? [],
          ownerId: dto.ownerId ?? null,
          locationId,
          receivedVia: dto.receivedVia ?? null,
          sentAt: this.parseDate(dto.sentAt) ?? null,
          receivedAt: this.parseDate(dto.receivedAt) ?? null,
          addressLine: dto.addressLine ?? null,
          postcode: dto.postcode ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          fundingType: dto.fundingType ?? null,
          fundingTypeId: dto.fundingTypeId ?? null,
          funderName: dto.funderName ?? null,
          hoursPerWeek: dto.hoursPerWeek ?? null,
          visitsPerDay: dto.visitsPerDay ?? null,
          requestedStartDate: this.parseDate(dto.requestedStartDate) ?? null,
          nextFollowUpAt: this.parseDate(dto.nextFollowUpAt) ?? null,
          nextAction: dto.nextAction ?? null,
          assessmentAt: this.parseDate(dto.assessmentAt) ?? null,
          assessorId: dto.assessorId ?? null,
          assessmentLocation: dto.assessmentLocation ?? null,
          quoteWeeklyAmount: dto.quoteWeeklyAmount ?? null,
          quoteHourlyRate: dto.quoteHourlyRate ?? null,
          quoteSentAt: this.parseDate(dto.quoteSentAt) ?? null,
          quoteNotes: dto.quoteNotes ?? null,
          recordedById: userId,
          events: { create: { action: isReferral ? 'Referral created' : 'Enquiry created', userId } },
        },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_CREATED,
        eventType: AuditEventType.CREATE,
        recordType: 'Enquiry',
        recordId: created.id,
        description: `${isReferral ? 'Referral' : 'Enquiry'} ${referenceNumber} created`,
        newValues: auditSnapshot({ referenceNumber, name: `${created.firstName} ${created.lastName}` }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const [data] = await this.present([created]);
      return { message: isReferral ? 'Referral created' : 'Enquiry created', data };
    });
  }

  async update(actor: RequestUser, id: string, dto: UpdateEnquiryDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const dates = {
      dateOfBirth: this.parseDate(dto.dateOfBirth),
      sentAt: this.parseDate(dto.sentAt),
      receivedAt: this.parseDate(dto.receivedAt),
      requestedStartDate: this.parseDate(dto.requestedStartDate),
      referralDate: this.parseDate(dto.referralDate),
      nextFollowUpAt: this.parseDate(dto.nextFollowUpAt),
      assessmentAt: this.parseDate(dto.assessmentAt),
      quoteSentAt: this.parseDate(dto.quoteSentAt),
    };
    if (dto.locationId === null || dto.locationId === '') {
      throw new BadRequestException('An enquiry must keep the branch that received it');
    }
    const locationId =
      dto.locationId === undefined ? undefined : this.resolveLocationId(actor, dto.locationId);

    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      const data: Record<string, unknown> = {};
      (['firstName', 'lastName', 'contactName', 'contactRelationship', 'contactPhone',
        'contactEmail', 'source', 'sourceDetail', 'enquiryType', 'urgency', 'needs', 'carePlanFormIds',
        'ownerId', 'receivedVia', 'addressLine', 'postcode', 'latitude', 'longitude', 'fundingType', 'fundingTypeId', 'funderName',
        'hoursPerWeek', 'visitsPerDay', 'nextAction', 'assessorId', 'assessmentLocation',
        'quoteWeeklyAmount', 'quoteHourlyRate', 'quoteNotes', 'kind', 'referringOrganisation', 'referrerRole',
        'referralReference'] as const).forEach(k => {
        if (dto[k] !== undefined) data[k] = dto[k];
      });
      for (const [k, v] of Object.entries(dates)) if (v !== undefined) data[k] = v;
      // An enquiry keeps no referral details (they are cleared when a referral is changed back).
      if ((data.kind ?? before.kind) === EnquiryKind.ENQUIRY) {
        for (const k of ['referringOrganisation', 'referrerRole', 'referralReference', 'referralDate']) data[k] = null;
      }
      if (locationId !== undefined) data.locationId = locationId;

      // Only record what actually changed.
      const norm = (x: unknown) =>
        x instanceof Date
          ? x.getTime()
          : x instanceof Prisma.Decimal
            ? x.toNumber()
            : Array.isArray(x)
              ? [...x].sort().join(',')
              : (x ?? null);
      const prev = before as Record<string, unknown>;
      const changedKeys = Object.keys(data).filter(k => norm(prev[k]) !== norm(data[k]));
      const has = (...keys: string[]) => keys.some(k => changedKeys.includes(k));
      const special = new Set([
        'ownerId', 'nextFollowUpAt', 'nextAction',
        'assessmentAt', 'assessorId', 'assessmentLocation',
        'quoteWeeklyAmount', 'quoteHourlyRate', 'quoteSentAt', 'quoteNotes',
      ]);
      const pick = <T>(k: string) => (k in data ? data[k] : prev[k]) as T;

      const events: Prisma.EnquiryEventCreateWithoutEnquiryInput[] = [];
      if (changedKeys.some(k => !special.has(k))) events.push({ action: 'Details updated', userId });

      if (has('ownerId')) {
        const newOwner = pick<string | null>('ownerId');
        const ownerName = newOwner ? (await this.userNames([newOwner])).get(newOwner) : null;
        events.push({ action: newOwner ? `Assigned to ${ownerName ?? 'a user'}` : 'Unassigned', userId });
      }

      if (has('nextFollowUpAt', 'nextAction')) {
        const due = pick<Date | null>('nextFollowUpAt');
        const action = pick<string | null>('nextAction');
        events.push(
          due
            ? {
                action: 'Follow-up scheduled',
                note: [action, `due ${due.toLocaleString('en-GB', LONDON_DATE_TIME)}`].filter(Boolean).join(' · '),
                userId,
              }
            : { action: 'Follow-up cleared', userId },
        );
      }

      if (has('assessmentAt', 'assessorId', 'assessmentLocation')) {
        const at = pick<Date | null>('assessmentAt');
        const assessorId = pick<string | null>('assessorId');
        const assessor = assessorId ? (await this.userNames([assessorId])).get(assessorId) : null;
        const where = pick<string | null>('assessmentLocation');
        events.push(
          at
            ? {
                action: 'Assessment booked',
                note: [
                  at.toLocaleString('en-GB', LONDON_DATE_TIME),
                  assessor ? `with ${assessor}` : null,
                  where ? `at ${where}` : null,
                ].filter(Boolean).join(' · '),
                userId,
              }
            : { action: 'Assessment details updated', userId },
        );
      }

      if (has('quoteWeeklyAmount', 'quoteHourlyRate', 'quoteSentAt', 'quoteNotes')) {
        const weekly = pick<number | null>('quoteWeeklyAmount');
        const hourly = pick<number | null>('quoteHourlyRate');
        events.push({
          action: 'Quote recorded',
          note: [
            weekly != null ? `£${weekly.toFixed(2)}/week` : null,
            hourly != null ? `£${hourly.toFixed(2)}/hour` : null,
          ].filter(Boolean).join(' · ') || null,
          userId,
        });
      }

      const updated = await tx.enquiry.update({
        where: { id },
        data: {
          ...(data as Prisma.EnquiryUpdateInput),
          ...(events.length ? { events: { create: events } } : {}),
        },
        include: { events: true },
      });
      await this.syncPreAdmissionServiceUser(tx, updated, changedKeys, userId);

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Enquiry ${updated.referenceNumber} updated`,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const [mapped] = await this.present([updated]);
      return { message: 'Enquiry updated', data: mapped };
    });
  }

  async move(actor: RequestUser, id: string, dto: MoveEnquiryDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      if (!canMove(before.stage, dto.stage)) {
        throw new BadRequestException(`Cannot move from ${before.stage} to ${dto.stage}`);
      }

      const losing = dto.stage === EnquiryStage.LOST;
      const detail = dto.lostReason?.trim() || null;
      if (losing) {
        if (!dto.lostReasonCode) {
          throw new BadRequestException('Choose a reason to mark an enquiry as lost');
        }
        if (dto.lostReasonCode === EnquiryLostReason.OTHER && !detail) {
          throw new BadRequestException('Describe the reason when choosing "Other"');
        }
      }

      const note = losing
        ? [LOST_REASON_LABELS[dto.lostReasonCode!], detail].filter(Boolean).join(' — ')
        : (dto.note ?? null);

      const updated = await tx.enquiry.update({
        where: { id },
        data: {
          stage: dto.stage,
          stageChangedAt: new Date(),
          ...(losing ? { lostReasonCode: dto.lostReasonCode, lostReason: detail } : {}),
          events: { create: { action: `Moved to ${dto.stage}`, note, userId } },
        },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_STAGE_CHANGED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Enquiry ${updated.referenceNumber} moved to ${dto.stage}`,
        oldValues: auditSnapshot({ stage: before.stage }),
        newValues: auditSnapshot({ stage: updated.stage }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const [data] = await this.present([updated]);
      return { message: `Enquiry moved to ${dto.stage}`, data };
    });
  }

  /** Link the service user created from this enquiry and mark the enquiry Won. */
  async linkServiceUser(actor: RequestUser, id: string, dto: LinkServiceUserDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const scope = this.orgScope.fromRequestUser(actor);
    await this.orgScope.assertServiceUserInScope(scope, dto.serviceUserId);

    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);
      if (before.convertedServiceUserId && before.convertedServiceUserId !== dto.serviceUserId) {
        throw new BadRequestException('This enquiry is already linked to another service user');
      }
      const su = await tx.serviceUser.findFirst({
        where: { id: dto.serviceUserId, deletedAt: null },
        select: { firstName: true, lastName: true },
      });
      if (!su) throw new NotFoundException('Service user not found');

      const becomesWon = before.stage !== EnquiryStage.WON;
      const updated = await tx.enquiry.update({
        where: { id },
        data: {
          convertedServiceUserId: dto.serviceUserId,
          ...(becomesWon ? { stage: EnquiryStage.WON, stageChangedAt: new Date() } : {}),
          events: {
            create: {
              action: 'Converted to service user',
              note: `${su.firstName} ${su.lastName}`,
              userId,
            },
          },
        },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_CONVERTED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Enquiry ${updated.referenceNumber} linked to service user`,
        newValues: auditSnapshot({ convertedServiceUserId: dto.serviceUserId, stage: updated.stage }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const [data] = await this.present([updated]);
      return { message: 'Enquiry linked to service user', data };
    });
  }

  /** A service user made from the enquiry's details (name, date of birth, branch, funding type, address). */
  private async createServiceUserFromEnquiry(
    tx: Prisma.TransactionClient,
    actor: RequestUser,
    enquiry: Prisma.EnquiryGetPayload<object>,
    statusCode: 'PRE_ADMISSION' | 'ACTIVE',
    serviceStartDate: Date | null,
  ) {
    const locationId = enquiry.locationId ?? this.resolveLocationId(actor, undefined) ?? null;
    const status = await tx.serviceUserStatus.findFirst({
      where: { code: statusCode, isActive: true },
      select: { id: true },
    });
    const su = await tx.serviceUser.create({
      data: {
        firstName: enquiry.firstName,
        lastName: enquiry.lastName,
        dateOfBirth: enquiry.dateOfBirth,
        statusId: status?.id ?? null,
        locationId,
        fundingTypeId: enquiry.fundingTypeId,
        serviceStartDate,
        createdById: actor.id,
      },
    });
    if (locationId) {
      await tx.serviceUserAssignment.create({
        data: { serviceUserId: su.id, locationId, createdById: actor.id },
      });
    }
    if (enquiry.addressLine || enquiry.postcode) {
      await tx.serviceUserAddress.create({
        data: {
          serviceUserId: su.id,
          addressLine1: enquiry.addressLine,
          postcode: enquiry.postcode,
          latitude: enquiry.latitude,
          longitude: enquiry.longitude,
        },
      });
    }
    await this.copyEnquiryContact(tx, actor, enquiry, su.id);
    return su;
  }

  /**
   * The enquiry's contact becomes one of the service user's contacts (once, matched by name). Its
   * relationship is matched to the relationship list by name; a referral's contact with no matching
   * relationship is kept as "Other" (a professional, such as the referring team). The first contact
   * is the primary one.
   */
  private async copyEnquiryContact(
    tx: Prisma.TransactionClient,
    actor: RequestUser,
    enquiry: Prisma.EnquiryGetPayload<object>,
    serviceUserId: string,
  ) {
    const name = enquiry.contactName?.trim();
    if (!name) return;
    const existing = await tx.serviceUserContact.findMany({
      where: { serviceUserId, deletedAt: null },
      select: { firstName: true, lastName: true },
    });
    const fullName = (c: { firstName: string; lastName: string | null }) =>
      [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
    if (existing.some(c => fullName(c) === name.toLowerCase())) return;

    const relationship = enquiry.contactRelationship?.trim() ?? '';
    const code = relationship.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const matched = code
      ? await tx.relationshipType.findFirst({
          where: { isActive: true, OR: [{ code }, { name: { equals: relationship, mode: 'insensitive' } }] },
          select: { id: true, code: true },
        })
      : null;
    const type =
      matched ??
      (enquiry.kind === EnquiryKind.REFERRAL
        ? await tx.relationshipType.findFirst({ where: { code: 'OTHER', isActive: true }, select: { id: true, code: true } })
        : null);
    // A person's name is split into first and last; a professional contact (a team or practice) is kept whole.
    const professional = ['GP', 'SOCIAL_WORKER', 'OTHER'].includes(type?.code ?? '');
    const space = name.indexOf(' ');
    const [firstName, lastName] =
      professional || space < 0 ? [name, null] : [name.slice(0, space), name.slice(space + 1).trim()];

    await tx.serviceUserContact.create({
      data: {
        serviceUserId,
        firstName,
        lastName,
        relationshipTypeId: type?.id ?? null,
        phone: enquiry.contactPhone,
        email: enquiry.contactEmail,
        isPrimary: existing.length === 0,
        notes:
          relationship && !matched
            ? `From enquiry ${enquiry.referenceNumber} (relationship: ${relationship})`
            : `From enquiry ${enquiry.referenceNumber}`,
        createdById: actor.id,
      },
    });
  }

  /**
   * After the client accepts: the enquiry's person becomes an active service user. The Pre-admission
   * service user made for the initial assessment is made active (its missing details filled from the
   * enquiry); otherwise one is created. The enquiry is linked and marked Won. Safe to repeat.
   */
  async activateServiceUser(
    actor: RequestUser,
    id: string,
    opts: { serviceStartDate: Date | null },
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);
      if (!before.locationId) throw new BadRequestException('Set the branch on the enquiry first');
      const active = await tx.serviceUserStatus.findFirst({
        where: { code: 'ACTIVE', isActive: true },
        select: { id: true },
      });
      let serviceUserId = before.convertedServiceUserId;
      let created = false;
      if (serviceUserId) {
        const su = await tx.serviceUser.findFirst({
          where: { id: serviceUserId, deletedAt: null },
          select: { statusId: true, dateOfBirth: true, locationId: true, fundingTypeId: true, serviceStartDate: true },
        });
        if (!su) throw new NotFoundException('The linked service user no longer exists');
        await tx.serviceUser.update({
          where: { id: serviceUserId },
          data: {
            statusId: active?.id ?? su.statusId,
            dateOfBirth: su.dateOfBirth ?? before.dateOfBirth,
            locationId: su.locationId ?? before.locationId,
            fundingTypeId: su.fundingTypeId ?? before.fundingTypeId,
            serviceStartDate: su.serviceStartDate ?? opts.serviceStartDate,
            updatedById: userId,
          },
        });
        const address = await tx.serviceUserAddress.findUnique({
          where: { serviceUserId },
          select: { id: true, latitude: true },
        });
        if (!address && (before.addressLine || before.postcode)) {
          await tx.serviceUserAddress.create({
            data: {
              serviceUserId,
              addressLine1: before.addressLine,
              postcode: before.postcode,
              latitude: before.latitude,
              longitude: before.longitude,
            },
          });
        } else if (address && address.latitude == null && before.latitude != null) {
          // An address kept without a map position gets the enquiry's.
          await tx.serviceUserAddress.update({
            where: { id: address.id },
            data: { latitude: before.latitude, longitude: before.longitude },
          });
        }
        await this.copyEnquiryContact(tx, actor, before, serviceUserId);
        if (su.statusId !== active?.id) {
          await this.audit.logAudit({
            tx,
            userId,
            module: AuditModule.SERVICE_USER,
            action: AuditAction.SERVICE_USER_STATUS_CHANGED,
            recordType: 'ServiceUser',
            recordId: serviceUserId,
            description: `Service user made active from accepted quote on enquiry ${before.referenceNumber}`,
            oldValues: auditSnapshot({ statusId: su.statusId }),
            newValues: auditSnapshot({ statusId: active?.id ?? null }),
            ipAddress: meta?.ipAddress ?? undefined,
            userAgent: meta?.userAgent ?? undefined,
          });
        }
      } else {
        const su = await this.createServiceUserFromEnquiry(tx, actor, before, 'ACTIVE', opts.serviceStartDate);
        serviceUserId = su.id;
        created = true;
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.SERVICE_USER_CREATED,
          recordType: 'ServiceUser',
          recordId: su.id,
          description: `Active service user created from enquiry ${before.referenceNumber}`,
          newValues: auditSnapshot({ id: su.id, firstName: su.firstName, lastName: su.lastName, statusId: su.statusId, locationId: su.locationId }),
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
      }

      const becomesWon = before.stage !== EnquiryStage.WON;
      await tx.enquiry.update({
        where: { id },
        data: {
          convertedServiceUserId: serviceUserId,
          ...(becomesWon ? { stage: EnquiryStage.WON, stageChangedAt: new Date() } : {}),
          events: {
            create: {
              action: 'Converted to service user',
              note: `${before.firstName} ${before.lastName} — ${created ? 'created as active' : 'made active'}`,
              userId,
            },
          },
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_CONVERTED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Enquiry ${before.referenceNumber} converted to an active service user`,
        newValues: auditSnapshot({ convertedServiceUserId: serviceUserId, stage: EnquiryStage.WON }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { serviceUserId: serviceUserId!, created };
    });
  }

  /**
   * The full initial assessment is kept on a service user. An enquiry without one gets a
   * Pre-admission service user made from its details and linked to it; the enquiry keeps its
   * stage (it is not marked Won), and the new service user gets a draft assessment to fill in.
   * Returns the existing link when there is one.
   */
  async startInitialAssessment(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const linked = await this.linkPreAdmissionServiceUser(
      actor,
      id,
      'Initial assessment started',
      'for the initial assessment',
      meta,
    );

    if (!linked.created) {
      return { message: 'Enquiry already has a service user', data: { serviceUserId: linked.serviceUserId } };
    }
    try {
      await this.initialAssessments.createSubmission(userId, linked.serviceUserId, {}, meta);
    } catch {
      // The link is made; the assessment page offers "Start new assessment" if the draft failed.
    }
    return { message: 'Pre-admission service user created', data: { serviceUserId: linked.serviceUserId } };
  }

  /**
   * A Pre-admission service user made from the enquiry (no assessment), so details only the
   * service user holds (title, GP, NHS number…) can be added before it is made active.
   * Returns the existing link when there is one.
   */
  async createPreAdmissionServiceUser(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const linked = await this.linkPreAdmissionServiceUser(
      actor,
      id,
      'Pre-admission service user created',
      'to add their details',
      meta,
    );
    return {
      message: linked.created ? 'Pre-admission service user created' : 'Enquiry already has a service user',
      data: { serviceUserId: linked.serviceUserId },
    };
  }

  /** Makes and links a Pre-admission service user from the enquiry, unless one is linked already. */
  private async linkPreAdmissionServiceUser(
    actor: RequestUser,
    id: string,
    eventAction: string,
    purpose: string,
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);
      if (before.convertedServiceUserId) return { serviceUserId: before.convertedServiceUserId, created: false };
      const su = await this.createServiceUserFromEnquiry(tx, actor, before, 'PRE_ADMISSION', null);
      await tx.enquiry.update({
        where: { id },
        data: {
          convertedServiceUserId: su.id,
          events: {
            create: {
              action: eventAction,
              note: `Pre-admission service user created for ${su.firstName} ${su.lastName}`,
              userId,
            },
          },
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_CREATED,
        recordType: 'ServiceUser',
        recordId: su.id,
        description: `Pre-admission service user created from enquiry ${before.referenceNumber}`,
        newValues: auditSnapshot({
          id: su.id,
          firstName: su.firstName,
          lastName: su.lastName,
          statusId: su.statusId,
          locationId: su.locationId,
        }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_CONVERTED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Enquiry ${before.referenceNumber} linked to a pre-admission service user ${purpose}`,
        newValues: auditSnapshot({ convertedServiceUserId: su.id, stage: before.stage }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { serviceUserId: su.id, created: true };
    });
  }

  /**
   * While the linked service user is still Pre-admission (made from this enquiry for the initial
   * assessment), the person's details changed on the enquiry are copied to it. Only changed fields
   * are copied, so a correction made on the service user is not undone by an unrelated edit.
   */
  private async syncPreAdmissionServiceUser(
    tx: Prisma.TransactionClient,
    enquiry: Prisma.EnquiryGetPayload<object>,
    changedKeys: string[],
    userId: string,
  ) {
    if (!enquiry.convertedServiceUserId) return;
    const changed = (k: string) => changedKeys.includes(k);
    const personKeys = [
      'firstName', 'lastName', 'dateOfBirth', 'locationId', 'fundingTypeId', 'addressLine', 'postcode', 'latitude', 'longitude',
    ];
    if (!personKeys.some(changed)) return;
    const su = await tx.serviceUser.findFirst({
      where: { id: enquiry.convertedServiceUserId, deletedAt: null, status: { code: 'PRE_ADMISSION' } },
      select: { id: true },
    });
    if (!su) return;

    await tx.serviceUser.update({
      where: { id: su.id },
      data: {
        ...(changed('firstName') ? { firstName: enquiry.firstName } : {}),
        ...(changed('lastName') ? { lastName: enquiry.lastName } : {}),
        ...(changed('dateOfBirth') ? { dateOfBirth: enquiry.dateOfBirth } : {}),
        ...(changed('locationId') ? { locationId: enquiry.locationId } : {}),
        ...(changed('fundingTypeId') ? { fundingTypeId: enquiry.fundingTypeId } : {}),
        updatedById: userId,
      },
    });
    if (changed('locationId')) {
      await tx.serviceUserAssignment.updateMany({
        where: { serviceUserId: su.id, deletedAt: null },
        data: { locationId: enquiry.locationId },
      });
    }
    if (changed('addressLine') || changed('postcode') || changed('latitude') || changed('longitude')) {
      const coords = changed('latitude') || changed('longitude');
      await tx.serviceUserAddress.upsert({
        where: { serviceUserId: su.id },
        update: {
          ...(changed('addressLine') ? { addressLine1: enquiry.addressLine } : {}),
          ...(changed('postcode') ? { postcode: enquiry.postcode } : {}),
          ...(coords ? { latitude: enquiry.latitude, longitude: enquiry.longitude } : {}),
        },
        create: {
          serviceUserId: su.id,
          addressLine1: enquiry.addressLine,
          postcode: enquiry.postcode,
          latitude: enquiry.latitude,
          longitude: enquiry.longitude,
        },
      });
    }
  }

  async addNote(actor: RequestUser, id: string, dto: EnquiryNoteDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const existing = await this.getInScope(actor, id, tx);

      await tx.enquiryEvent.create({ data: { enquiryId: id, action: 'Note', note: dto.note, userId } });
      const updated = await tx.enquiry.findFirstOrThrow({ where: { id }, include: { events: true } });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_NOTE_ADDED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Note added to enquiry ${existing.referenceNumber}`,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const [data] = await this.present([updated]);
      return { message: 'Note added', data };
    });
  }

  async remove(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      await tx.enquiry.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_DELETED,
        eventType: AuditEventType.DELETE,
        recordType: 'Enquiry',
        recordId: id,
        description: `Enquiry ${before.referenceNumber} deleted`,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Enquiry deleted', data: { id } };
    });
  }
}
