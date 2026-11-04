import { Injectable } from '@nestjs/common';
import { EmployeeHoursApprovalType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  dayKeyInTimeZone,
  formatHmInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import type { HoursHistoryKind, HoursHistoryQueryDto } from './dto/hours-history-query.dto';

/** Hours requests that belong to a carer; the rest belong to a service user. */
const CARER_REQUEST_TYPES: EmployeeHoursApprovalType[] = [
  EmployeeHoursApprovalType.VISIT_PLAN_OVER_HOURS,
  EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
  EmployeeHoursApprovalType.CONTRACTED_HOURS_CHANGE,
];
const SERVICE_USER_REQUEST_TYPES: EmployeeHoursApprovalType[] = [
  EmployeeHoursApprovalType.SERVICE_USER_WEEKLY_HOURS_CHANGE,
  EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS,
  EmployeeHoursApprovalType.DRAFT_PLAN_OVER_HOURS,
];

export type HoursHistoryEvent = {
  id: string;
  kind: HoursHistoryKind;
  /** Hours requests only. */
  requestType: EmployeeHoursApprovalType | null;
  /** ACTIVE / CANCELLED (extra hours), CREATED (visits), or the request status. */
  status: string;
  /** When it was given, created or asked for. */
  at: string;
  byName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  /** Extra hours: the days they cover. */
  periodType: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** The visit (extra visit, special visit, rota request): day and times in the organisation timezone. */
  visitDate: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Extra hours given, or the visit's length. */
  hours: number | null;
  /** Requests: the week's hours and its limit when it was asked for. */
  weekHours: number | null;
  limitHours: number | null;
  /** Contracted / weekly hours changes. */
  previousHours: number | null;
  requestedHours: number | null;
  /** Carer events: the service user; service user events: the carers who got the visit. */
  serviceUserName: string | null;
  carerNames: string[];
  title: string | null;
  reason: string | null;
};

type Group = { personId: string; personName: string; events: HoursHistoryEvent[] };

const round1 = (n: number) => Math.round(n * 10) / 10;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const uniq = (ids: Array<string | null | undefined>) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/**
 * One place for who gave or asked for extra hours and visits, and who approved them —
 * grouped by carer or by service user. Read-only: everything comes from the records the
 * features already keep (extra weekly hours, hours requests, extra visits, special visits).
 */
@Injectable()
export class HoursHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async list(query: HoursHistoryQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const from = query.from ?? `${today.slice(0, 7)}-01`;
    const to = query.to ?? today;
    const range = {
      gte: operationalDayBounds(from, timeZone).start,
      lte: operationalDayBounds(to, timeZone).end,
    };
    const wants = (kind: HoursHistoryKind) => !query.kind || query.kind === kind;

    const groups =
      query.group === 'service_user'
        ? await this.serviceUserGroups(range, wants, timeZone)
        : await this.carerGroups(range, wants, timeZone);

    const search = query.search?.trim().toLowerCase() ?? '';
    const data = groups
      .filter((g) => !search || g.personName.toLowerCase().includes(search))
      .map((g) => ({
        ...g,
        events: g.events.sort((a, b) => b.at.localeCompare(a.at)),
      }))
      .sort((a, b) => a.personName.localeCompare(b.personName));

    return { message: 'Hours and visits history', data, meta: { from, to } };
  }

  private async carerGroups(
    range: Prisma.DateTimeFilter,
    wants: (kind: HoursHistoryKind) => boolean,
    timeZone: string,
  ): Promise<Group[]> {
    const [extras, requests, specials] = await Promise.all([
      wants('EXTRA_HOURS')
        ? this.prisma.employeeExtraWeeklyHours.findMany({ where: { grantedAt: range } })
        : [],
      wants('HOURS_REQUEST')
        ? this.prisma.employeeHoursApproval.findMany({
            where: {
              requestedAt: range,
              requestType: { in: CARER_REQUEST_TYPES },
              employeeId: { not: null },
            },
          })
        : [],
      wants('SPECIAL_VISIT')
        ? this.prisma.specialVisit.findMany({ where: { createdAt: range, deletedAt: null } })
        : [],
    ]);

    const [userName, carerName, suName] = await Promise.all([
      this.userNames([
        ...extras.flatMap((r) => [r.grantedById, r.cancelledById]),
        ...requests.flatMap((r) => [r.requestedById, r.decidedById]),
        ...specials.map((r) => r.createdById),
      ]),
      this.carerNames([
        ...extras.map((r) => r.employeeId),
        ...requests.map((r) => r.employeeId),
        ...specials.map((r) => r.employeeId),
      ]),
      this.serviceUserNames(requests.map((r) => r.serviceUserId)),
    ]);

    const groups = new Map<string, Group>();
    const add = (employeeId: string, event: HoursHistoryEvent) => {
      const g = groups.get(employeeId) ?? {
        personId: employeeId,
        personName: carerName.get(employeeId) ?? employeeId,
        events: [],
      };
      g.events.push(event);
      groups.set(employeeId, g);
    };

    for (const r of extras) {
      add(r.employeeId, {
        ...blankEvent(r.id, 'EXTRA_HOURS'),
        status: r.cancelledAt ? 'CANCELLED' : 'ACTIVE',
        at: r.grantedAt.toISOString(),
        byName: r.grantedById ? (userName.get(r.grantedById) ?? null) : null,
        decidedByName: r.cancelledById ? (userName.get(r.cancelledById) ?? null) : null,
        decidedAt: r.cancelledAt?.toISOString() ?? null,
        decisionNotes: r.cancelReason,
        periodType: r.periodType,
        periodStart: isoDay(r.startDate),
        periodEnd: isoDay(r.endDate),
        hours: r.extraHours,
        reason: r.reason,
      });
    }

    for (const r of requests) {
      add(r.employeeId!, {
        ...this.requestEvent(r, userName, timeZone),
        serviceUserName: r.serviceUserId ? (suName.get(r.serviceUserId) ?? null) : null,
      });
    }

    for (const r of specials) {
      add(r.employeeId, {
        ...blankEvent(r.id, 'SPECIAL_VISIT'),
        status: 'CREATED',
        at: r.createdAt.toISOString(),
        byName: r.createdById ? (userName.get(r.createdById) ?? null) : null,
        visitDate: isoDay(r.visitDate),
        hours: round1(r.durationMinutes / 60),
        title: r.title,
        reason: r.notes,
      });
    }

    return [...groups.values()];
  }

  private async serviceUserGroups(
    range: Prisma.DateTimeFilter,
    wants: (kind: HoursHistoryKind) => boolean,
    timeZone: string,
  ): Promise<Group[]> {
    const [requests, extraVisits] = await Promise.all([
      wants('HOURS_REQUEST')
        ? this.prisma.employeeHoursApproval.findMany({
            where: {
              requestedAt: range,
              requestType: { in: SERVICE_USER_REQUEST_TYPES },
              serviceUserId: { not: null },
            },
          })
        : [],
      wants('EXTRA_VISIT')
        ? this.prisma.visitPlanSlotException.findMany({
            where: { createdAt: range, exceptionType: 'EXTRA' },
            include: {
              visitPlanSlot: {
                select: {
                  plannedStartTime: true,
                  plannedEndTime: true,
                  durationMinutes: true,
                  assignedEmployeeIds: true,
                  visitPlan: { select: { serviceUserId: true } },
                },
              },
            },
          })
        : [],
    ]);

    // An extra visit with no carers chosen goes to the slot's usual carers.
    const extraCarers = (r: (typeof extraVisits)[number]) =>
      r.assignedEmployeeIds.length ? r.assignedEmployeeIds : r.visitPlanSlot.assignedEmployeeIds;
    const requestCarers = (r: (typeof requests)[number]) => {
      const ids = (r.requestPayload as { employeeIds?: unknown } | null)?.employeeIds;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    };

    const [userName, carerName, suName] = await Promise.all([
      this.userNames([
        ...requests.flatMap((r) => [r.requestedById, r.decidedById]),
        ...extraVisits.map((r) => r.createdById),
      ]),
      this.carerNames([...extraVisits.flatMap(extraCarers), ...requests.flatMap(requestCarers)]),
      this.serviceUserNames([
        ...requests.map((r) => r.serviceUserId),
        ...extraVisits.map((r) => r.visitPlanSlot.visitPlan.serviceUserId),
      ]),
    ]);
    const namesOf = (ids: string[]) => ids.map((id) => carerName.get(id) ?? id);

    const groups = new Map<string, Group>();
    const add = (serviceUserId: string, event: HoursHistoryEvent) => {
      const g = groups.get(serviceUserId) ?? {
        personId: serviceUserId,
        personName: suName.get(serviceUserId) ?? serviceUserId,
        events: [],
      };
      g.events.push(event);
      groups.set(serviceUserId, g);
    };

    for (const r of requests) {
      add(r.serviceUserId!, {
        ...this.requestEvent(r, userName, timeZone),
        carerNames: namesOf(requestCarers(r)),
      });
    }

    for (const r of extraVisits) {
      const slot = r.visitPlanSlot;
      const minutes = r.durationMinutes ?? slot.durationMinutes;
      add(slot.visitPlan.serviceUserId, {
        ...blankEvent(r.id, 'EXTRA_VISIT'),
        status: 'CREATED',
        at: r.createdAt.toISOString(),
        byName: r.createdById ? (userName.get(r.createdById) ?? null) : null,
        visitDate: dayKeyInTimeZone(r.exceptionDate, timeZone),
        startTime: r.plannedStartTime ?? slot.plannedStartTime,
        endTime: r.plannedEndTime ?? slot.plannedEndTime,
        hours: minutes != null ? round1(minutes / 60) : null,
        carerNames: namesOf(extraCarers(r)),
        reason: r.notes || null,
      });
    }

    return [...groups.values()];
  }

  private requestEvent(
    r: Prisma.EmployeeHoursApprovalGetPayload<object>,
    userName: Map<string, string>,
    timeZone: string,
  ): HoursHistoryEvent {
    const payload = (r.requestPayload ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    let visitDate: string | null = null;
    let startTime: string | null = null;
    let endTime: string | null = null;
    if (r.requestType === EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS) {
      const start = str(payload.start);
      const end = str(payload.end);
      if (start) {
        visitDate = dayKeyInTimeZone(new Date(start), timeZone);
        startTime = formatHmInTimeZone(new Date(start), timeZone);
      }
      if (end) endTime = formatHmInTimeZone(new Date(end), timeZone);
    } else if (r.requestType === EmployeeHoursApprovalType.EXTRA_VISIT_OVER_HOURS) {
      visitDate = str(payload.date);
      startTime = str(payload.startTime);
      endTime = str(payload.endTime);
    }
    return {
      ...blankEvent(r.id, 'HOURS_REQUEST'),
      requestType: r.requestType,
      status: r.status,
      at: r.requestedAt.toISOString(),
      byName: r.requestedById ? (userName.get(r.requestedById) ?? null) : null,
      decidedByName: r.decidedById ? (userName.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNotes: r.decisionNotes,
      visitDate,
      startTime,
      endTime,
      weekHours: r.projectedWeeklyHours,
      limitHours: r.contractedWeeklyHours,
      previousHours: r.previousContractedWeeklyHours,
      requestedHours: r.requestedContractedWeeklyHours,
      reason: r.reason,
    };
  }

  private async userNames(ids: Array<string | null | undefined>) {
    const list = uniq(ids);
    const users = list.length
      ? await this.prisma.user.findMany({
          where: { id: { in: list } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    return new Map(
      users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.id]),
    );
  }

  private async carerNames(ids: Array<string | null | undefined>) {
    const list = uniq(ids);
    const employees = list.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: list } },
          select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
        })
      : [];
    return new Map(
      employees.map((e) => [
        e.id,
        `${e.personalDetail?.firstName ?? ''} ${e.personalDetail?.lastName ?? ''}`.trim() || e.id,
      ]),
    );
  }

  private async serviceUserNames(ids: Array<string | null | undefined>) {
    const list = uniq(ids);
    const serviceUsers = list.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: list } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    return new Map(
      serviceUsers.map((s) => [s.id, `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.id]),
    );
  }
}

function blankEvent(id: string, kind: HoursHistoryKind): HoursHistoryEvent {
  return {
    id,
    kind,
    requestType: null,
    status: '',
    at: '',
    byName: null,
    decidedByName: null,
    decidedAt: null,
    decisionNotes: null,
    periodType: null,
    periodStart: null,
    periodEnd: null,
    visitDate: null,
    startTime: null,
    endTime: null,
    hours: null,
    weekHours: null,
    limitHours: null,
    previousHours: null,
    requestedHours: null,
    serviceUserName: null,
    carerNames: [],
    title: null,
    reason: null,
  };
}
