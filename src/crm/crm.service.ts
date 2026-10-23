import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEventType, EnquiryLostReason, EnquiryStage, Prisma } from '@prisma/client';
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
};

function mapEnquiry(row: AnyEnquiryRow, maps: NameMaps = {}) {
  const events = 'events' in row && Array.isArray(row.events) ? row.events : [];
  const user = (id: string | null) => (id ? (maps.users?.get(id) ?? null) : null);
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    stage: row.stage,
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
    recordedById: row.recordedById,
    recordedByName: user(row.recordedById),
    stageChangedAt: row.stageChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events: [...events].sort((a, b) => a.at.getTime() - b.at.getTime()).map(mapEvent),
  };
}

const digitsOnly = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
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

  private async getInScope(actor: RequestUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
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

  /** Map rows to API shape with user / funding / branch names resolved. */
  private async present<T extends AnyEnquiryRow>(rows: T[]) {
    const [users, funding, locations, carePlans] = await Promise.all([
      this.userNames(rows.flatMap(r => [r.recordedById, r.ownerId, r.assessorId])),
      this.fundingNames(rows.map(r => r.fundingTypeId)),
      this.locationNames(rows.map(r => r.locationId)),
      this.carePlanNames(rows.flatMap(r => r.carePlanFormIds)),
    ]);
    return rows.map(r => mapEnquiry(r, { users, funding, locations, carePlans }));
  }

  /* ─── reads ─────────────────────────────────────────────────────────── */

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
      ...(query.source ? { source: query.source } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    });
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

    return this.prisma.$transaction(async tx => {
      const year = new Date().getFullYear();
      const seq = await tx.enquiryNumberSequence.upsert({
        where: { year },
        create: { year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const referenceNumber = `ENQ-${year}-${String(seq.lastValue).padStart(4, '0')}`;

      const created = await tx.enquiry.create({
        data: {
          referenceNumber,
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
          events: { create: { action: 'Enquiry created', userId } },
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
        description: `Enquiry ${referenceNumber} created`,
        newValues: auditSnapshot({ referenceNumber, name: `${created.firstName} ${created.lastName}` }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      const [data] = await this.present([created]);
      return { message: 'Enquiry created', data };
    });
  }

  async update(actor: RequestUser, id: string, dto: UpdateEnquiryDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const dates = {
      dateOfBirth: this.parseDate(dto.dateOfBirth),
      sentAt: this.parseDate(dto.sentAt),
      receivedAt: this.parseDate(dto.receivedAt),
      requestedStartDate: this.parseDate(dto.requestedStartDate),
      nextFollowUpAt: this.parseDate(dto.nextFollowUpAt),
      assessmentAt: this.parseDate(dto.assessmentAt),
      quoteSentAt: this.parseDate(dto.quoteSentAt),
    };
    const locationId =
      dto.locationId === undefined ? undefined : this.resolveLocationId(actor, dto.locationId ?? null);

    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      const data: Record<string, unknown> = {};
      (['firstName', 'lastName', 'contactName', 'contactRelationship', 'contactPhone',
        'contactEmail', 'source', 'sourceDetail', 'enquiryType', 'urgency', 'needs', 'carePlanFormIds',
        'ownerId', 'receivedVia', 'addressLine', 'postcode', 'fundingType', 'fundingTypeId', 'funderName',
        'hoursPerWeek', 'visitsPerDay', 'nextAction', 'assessorId', 'assessmentLocation',
        'quoteWeeklyAmount', 'quoteHourlyRate', 'quoteNotes'] as const).forEach(k => {
        if (dto[k] !== undefined) data[k] = dto[k];
      });
      for (const [k, v] of Object.entries(dates)) if (v !== undefined) data[k] = v;
      if (locationId !== undefined) data.locationId = locationId;

      // Only record what actually changed.
      const norm = (x: unknown) =>
        x instanceof Date ? x.getTime() : Array.isArray(x) ? [...x].sort().join(',') : (x ?? null);
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
