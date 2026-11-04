import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnCallCallStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type {
  CloseOnCallCallDto,
  CreateOnCallCallDto,
  CreateOnCallShiftDto,
  ListOnCallCallsQueryDto,
  ListOnCallShiftsQueryDto,
  UpdateOnCallCallDto,
  UpdateOnCallShiftDto,
} from './dto/on-call.dto';

type AuditMeta = ReturnType<
  typeof import('../common/utils/request-audit-meta.util').getRequestAuditMeta
>;

/** Longest single on-call shift (a long bank-holiday weekend fits). */
export const ON_CALL_SHIFT_MAX_HOURS = 96;
/** A call can be logged a little "in the future" to allow for clock differences. */
const CALL_FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Start must be before end, and the shift no longer than ON_CALL_SHIFT_MAX_HOURS. */
export function validateShiftWindow(startsAt: Date, endsAt: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new BadRequestException('Enter a valid start and end');
  }
  if (endsAt <= startsAt)
    throw new BadRequestException('The shift must end after it starts');
  if (
    endsAt.getTime() - startsAt.getTime() >
    ON_CALL_SHIFT_MAX_HOURS * 3_600_000
  ) {
    throw new BadRequestException(
      `An on-call shift can be at most ${ON_CALL_SHIFT_MAX_HOURS} hours`,
    );
  }
}

/** Branch filter for a user limited to some branches: their branches, plus rows that cover every branch. */
export function locationScopeWhere(
  locationIds: string[] | null,
): { OR: object[] } | undefined {
  if (!locationIds) return undefined;
  return { OR: [{ locationId: null }, { locationId: { in: locationIds } }] };
}

const fullName = (
  p: { firstName?: string | null; lastName?: string | null } | null | undefined,
) => (p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null);

@Injectable()
export class OnCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  /** Branches the user is limited to, or null when they see every branch. */
  private scopedLocationIds(user: RequestUser): string[] | null {
    const scope = this.orgScope.fromRequestUser(user);
    if (scope.companyWide || !scope.locationIds?.length) return null;
    return scope.locationIds;
  }

  private assertLocationAllowed(
    user: RequestUser,
    locationId: string | null | undefined,
  ): void {
    const allowed = this.scopedLocationIds(user);
    if (!allowed) return;
    if (!locationId)
      throw new ForbiddenException('Choose one of your branches');
    if (!allowed.includes(locationId))
      throw new ForbiddenException('That branch is outside your access');
  }

  private async assertLocationExists(locationId: string | null | undefined) {
    if (!locationId) return;
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, deletedAt: null },
      select: { id: true },
    });
    if (!loc) throw new BadRequestException('Branch not found');
  }

  // ---------- Names for display (ids only are stored) ----------

  private async names(ids: {
    employees?: string[];
    serviceUsers?: string[];
    locations?: string[];
    users?: string[];
  }) {
    const uniq = (xs?: (string | null | undefined)[]) => [
      ...new Set((xs ?? []).filter((x): x is string => !!x)),
    ];
    const [employees, serviceUsers, locations, users] = await Promise.all([
      uniq(ids.employees).length
        ? this.prisma.employee.findMany({
            where: { id: { in: uniq(ids.employees) } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          })
        : [],
      uniq(ids.serviceUsers).length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: uniq(ids.serviceUsers) } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
      uniq(ids.locations).length
        ? this.prisma.location.findMany({
            where: { id: { in: uniq(ids.locations) } },
            select: { id: true, name: true },
          })
        : [],
      uniq(ids.users).length
        ? this.prisma.user.findMany({
            where: { id: { in: uniq(ids.users) } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [],
    ]);
    return {
      employee: new Map(
        employees.map((e) => [e.id, fullName(e.personalDetail)]),
      ),
      serviceUser: new Map(serviceUsers.map((s) => [s.id, fullName(s)])),
      location: new Map(locations.map((l) => [l.id, l.name])),
      user: new Map(users.map((u) => [u.id, fullName(u) ?? u.email])),
    };
  }

  // ---------- Rota ----------

  private async shiftRows(where: Prisma.OnCallShiftWhereInput) {
    const rows = await this.prisma.onCallShift.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { tier: 'asc' }],
      take: 500,
    });
    const n = await this.names({
      employees: rows.map((r) => r.employeeId),
      locations: rows.map((r) => r.locationId ?? ''),
    });
    return rows.map((r) => ({
      ...r,
      employeeName: n.employee.get(r.employeeId) ?? null,
      locationName: r.locationId
        ? (n.location.get(r.locationId) ?? null)
        : null,
    }));
  }

  async listShifts(user: RequestUser, q: ListOnCallShiftsQueryDto) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to > from))
      throw new BadRequestException('"to" must be after "from"');
    const where: Prisma.OnCallShiftWhereInput = {
      deletedAt: null,
      startsAt: { lt: to },
      endsAt: { gt: from },
    };
    if (q.locationId)
      where.OR = [{ locationId: null }, { locationId: q.locationId }];
    const scope = locationScopeWhere(this.scopedLocationIds(user));
    if (scope) where.AND = [scope];
    return this.shiftRows(where);
  }

  /** Who is on call right now (first and second line). */
  async now(user: RequestUser) {
    const at = new Date();
    const where: Prisma.OnCallShiftWhereInput = {
      deletedAt: null,
      startsAt: { lte: at },
      endsAt: { gt: at },
    };
    const scope = locationScopeWhere(this.scopedLocationIds(user));
    if (scope) where.AND = [scope];
    return this.shiftRows(where);
  }

  private async assertEmployeeAvailable(
    employeeId: string,
    startsAt: Date,
    endsAt: Date,
    ignoreShiftId?: string,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!employee)
      throw new BadRequestException('Staff member not found or not active');
    const clash = await this.prisma.onCallShift.findFirst({
      where: {
        deletedAt: null,
        employeeId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(ignoreShiftId ? { id: { not: ignoreShiftId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new BadRequestException(
        'This person already has an on-call shift that overlaps these times',
      );
  }

  async createShift(
    user: RequestUser,
    dto: CreateOnCallShiftDto,
    meta: AuditMeta,
  ) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    validateShiftWindow(startsAt, endsAt);
    this.assertLocationAllowed(user, dto.locationId);
    await this.assertLocationExists(dto.locationId);
    await this.assertEmployeeAvailable(dto.employeeId, startsAt, endsAt);
    const row = await this.prisma.onCallShift.create({
      data: {
        employeeId: dto.employeeId,
        locationId: dto.locationId ?? null,
        tier: dto.tier,
        startsAt,
        endsAt,
        notes: dto.notes ?? null,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCHEDULING,
      action: AuditAction.ON_CALL_SHIFT_CREATED,
      recordType: 'OnCallShift',
      recordId: row.id,
      newValues: {
        employeeId: row.employeeId,
        locationId: row.locationId,
        tier: row.tier,
        startsAt,
        endsAt,
      },
      ...meta,
    });
    return (await this.shiftRows({ id: row.id }))[0];
  }

  private async findShift(user: RequestUser, id: string) {
    const row = await this.prisma.onCallShift.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('On-call shift not found');
    const allowed = this.scopedLocationIds(user);
    if (allowed && row.locationId && !allowed.includes(row.locationId))
      throw new NotFoundException('On-call shift not found');
    return row;
  }

  async updateShift(
    user: RequestUser,
    id: string,
    dto: UpdateOnCallShiftDto,
    meta: AuditMeta,
  ) {
    const old = await this.findShift(user, id);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : old.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : old.endsAt;
    const employeeId = dto.employeeId ?? old.employeeId;
    const locationId =
      dto.locationId !== undefined ? dto.locationId : old.locationId;
    validateShiftWindow(startsAt, endsAt);
    if (dto.locationId !== undefined) {
      this.assertLocationAllowed(user, locationId);
      await this.assertLocationExists(locationId);
    }
    await this.assertEmployeeAvailable(employeeId, startsAt, endsAt, id);
    await this.prisma.onCallShift.update({
      where: { id },
      data: {
        employeeId,
        locationId: locationId ?? null,
        tier: dto.tier ?? old.tier,
        startsAt,
        endsAt,
        notes: dto.notes !== undefined ? (dto.notes ?? null) : old.notes,
        updatedById: user.id,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCHEDULING,
      action: AuditAction.ON_CALL_SHIFT_UPDATED,
      recordType: 'OnCallShift',
      recordId: id,
      oldValues: {
        employeeId: old.employeeId,
        locationId: old.locationId,
        tier: old.tier,
        startsAt: old.startsAt,
        endsAt: old.endsAt,
      },
      newValues: {
        employeeId,
        locationId,
        tier: dto.tier ?? old.tier,
        startsAt,
        endsAt,
      },
      ...meta,
    });
    return (await this.shiftRows({ id }))[0];
  }

  async deleteShift(user: RequestUser, id: string, meta: AuditMeta) {
    const old = await this.findShift(user, id);
    await this.prisma.onCallShift.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCHEDULING,
      action: AuditAction.ON_CALL_SHIFT_DELETED,
      recordType: 'OnCallShift',
      recordId: id,
      oldValues: {
        employeeId: old.employeeId,
        tier: old.tier,
        startsAt: old.startsAt,
        endsAt: old.endsAt,
      },
      ...meta,
    });
    return { id };
  }

  // ---------- Out-of-hours calls ----------

  private async callRows(where: Prisma.OnCallCallWhereInput, take = 300) {
    const rows = await this.prisma.onCallCall.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take,
    });
    const n = await this.names({
      employees: rows.map((r) => r.callerEmployeeId ?? ''),
      serviceUsers: rows.map((r) => r.serviceUserId ?? ''),
      locations: rows.map((r) => r.locationId ?? ''),
      users: rows.flatMap((r) => [
        r.takenByUserId ?? '',
        r.closedByUserId ?? '',
      ]),
    });
    return rows.map((r) => ({
      ...r,
      callerEmployeeName: r.callerEmployeeId
        ? (n.employee.get(r.callerEmployeeId) ?? null)
        : null,
      serviceUserName: r.serviceUserId
        ? (n.serviceUser.get(r.serviceUserId) ?? null)
        : null,
      locationName: r.locationId
        ? (n.location.get(r.locationId) ?? null)
        : null,
      takenByName: r.takenByUserId
        ? (n.user.get(r.takenByUserId) ?? null)
        : null,
      closedByName: r.closedByUserId
        ? (n.user.get(r.closedByUserId) ?? null)
        : null,
    }));
  }

  async listCalls(user: RequestUser, q: ListOnCallCallsQueryDto) {
    const where: Prisma.OnCallCallWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.serviceUserId) where.serviceUserId = q.serviceUserId;
    if (q.from || q.to) {
      where.receivedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lt: new Date(q.to) } : {}),
      };
    }
    const scope = locationScopeWhere(this.scopedLocationIds(user));
    if (scope) where.AND = [scope];
    return this.callRows(where);
  }

  private async assertCallLinks(
    dto: Pick<
      CreateOnCallCallDto,
      'callerEmployeeId' | 'serviceUserId' | 'locationId'
    >,
  ) {
    if (dto.callerEmployeeId) {
      const e = await this.prisma.employee.findFirst({
        where: { id: dto.callerEmployeeId, deletedAt: null },
        select: { id: true },
      });
      if (!e) throw new BadRequestException('Carer not found');
    }
    if (dto.serviceUserId) {
      const s = await this.prisma.serviceUser.findFirst({
        where: { id: dto.serviceUserId, deletedAt: null },
        select: { id: true },
      });
      if (!s) throw new BadRequestException('Service user not found');
    }
    await this.assertLocationExists(dto.locationId);
  }

  private assertReceivedAt(receivedAt: Date) {
    if (Number.isNaN(receivedAt.getTime()))
      throw new BadRequestException('Enter when the call came in');
    if (receivedAt.getTime() > Date.now() + CALL_FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('The call time cannot be in the future');
    }
  }

  async createCall(
    user: RequestUser,
    dto: CreateOnCallCallDto,
    meta: AuditMeta,
  ) {
    const receivedAt = new Date(dto.receivedAt);
    this.assertReceivedAt(receivedAt);
    if (dto.locationId) this.assertLocationAllowed(user, dto.locationId);
    await this.assertCallLinks(dto);
    const row = await this.prisma.onCallCall.create({
      data: {
        receivedAt,
        takenByUserId: user.id,
        callerType: dto.callerType,
        callerName: dto.callerName,
        callerPhone: dto.callerPhone ?? null,
        callerEmployeeId: dto.callerEmployeeId ?? null,
        serviceUserId: dto.serviceUserId ?? null,
        locationId: dto.locationId ?? null,
        category: dto.category,
        summary: dto.summary,
        actionTaken: dto.actionTaken ?? null,
        followUpRequired: dto.followUpRequired ?? false,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCHEDULING,
      action: AuditAction.ON_CALL_CALL_LOGGED,
      recordType: 'OnCallCall',
      recordId: row.id,
      newValues: {
        callerType: row.callerType,
        category: row.category,
        serviceUserId: row.serviceUserId,
      },
      ...meta,
    });
    return (await this.callRows({ id: row.id }, 1))[0];
  }

  private async findCall(user: RequestUser, id: string) {
    const row = await this.prisma.onCallCall.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Call not found');
    const allowed = this.scopedLocationIds(user);
    if (allowed && row.locationId && !allowed.includes(row.locationId))
      throw new NotFoundException('Call not found');
    return row;
  }

  async updateCall(
    user: RequestUser,
    id: string,
    dto: UpdateOnCallCallDto,
    meta: AuditMeta,
  ) {
    const old = await this.findCall(user, id);
    if (old.status === OnCallCallStatus.CLOSED)
      throw new BadRequestException('A closed call cannot be changed');
    if (dto.receivedAt) this.assertReceivedAt(new Date(dto.receivedAt));
    if (dto.locationId) this.assertLocationAllowed(user, dto.locationId);
    await this.assertCallLinks(dto);
    const data: Prisma.OnCallCallUpdateInput = {
      ...(dto.receivedAt ? { receivedAt: new Date(dto.receivedAt) } : {}),
      ...(dto.callerType ? { callerType: dto.callerType } : {}),
      ...(dto.callerName ? { callerName: dto.callerName } : {}),
      ...(dto.callerPhone !== undefined
        ? { callerPhone: dto.callerPhone ?? null }
        : {}),
      ...(dto.callerEmployeeId !== undefined
        ? { callerEmployeeId: dto.callerEmployeeId ?? null }
        : {}),
      ...(dto.serviceUserId !== undefined
        ? { serviceUserId: dto.serviceUserId ?? null }
        : {}),
      ...(dto.locationId !== undefined
        ? { locationId: dto.locationId ?? null }
        : {}),
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.summary ? { summary: dto.summary } : {}),
      ...(dto.actionTaken !== undefined
        ? { actionTaken: dto.actionTaken ?? null }
        : {}),
      ...(dto.followUpRequired !== undefined
        ? { followUpRequired: dto.followUpRequired }
        : {}),
    };
    await this.prisma.onCallCall.update({ where: { id }, data });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCHEDULING,
      action: AuditAction.ON_CALL_CALL_UPDATED,
      recordType: 'OnCallCall',
      recordId: id,
      oldValues: {
        category: old.category,
        followUpRequired: old.followUpRequired,
      },
      newValues: { ...dto },
      ...meta,
    });
    return (await this.callRows({ id }, 1))[0];
  }

  async closeCall(
    user: RequestUser,
    id: string,
    dto: CloseOnCallCallDto,
    meta: AuditMeta,
  ) {
    const old = await this.findCall(user, id);
    if (old.status === OnCallCallStatus.CLOSED)
      throw new BadRequestException('This call is already closed');
    await this.prisma.onCallCall.update({
      where: { id },
      data: {
        status: OnCallCallStatus.CLOSED,
        closedAt: new Date(),
        closedByUserId: user.id,
        closingNote: dto.closingNote,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCHEDULING,
      action: AuditAction.ON_CALL_CALL_CLOSED,
      recordType: 'OnCallCall',
      recordId: id,
      newValues: { closingNote: dto.closingNote },
      ...meta,
    });
    return (await this.callRows({ id }, 1))[0];
  }
}
