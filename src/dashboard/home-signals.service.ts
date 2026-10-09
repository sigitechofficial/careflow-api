import { Injectable } from '@nestjs/common';
import { FundingStatus, MedicationAdministrationStatus, PolicyStatus, Prisma, VisitPlanStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { operationalDayBounds, operationalTodayIso } from '../common/utils/operational-day.util';
import type {
  MedicationExceptionsQueryDto,
  StaffOffQueryDto,
  UpcomingWindowQueryDto,
} from './dto/home-signals-query.dto';

/** Doses that were due but not given as planned. */
const EXCEPTION_STATUSES = [
  MedicationAdministrationStatus.MISSED,
  MedicationAdministrationStatus.REFUSED,
  MedicationAdministrationStatus.NOT_GIVEN,
  MedicationAdministrationStatus.HELD,
] as const;

/** Funding still in force (so its end date / PO / review date matters). */
const LIVE_FUNDING = [FundingStatus.ACTIVE, FundingStatus.APPROVED];

const ITEM_LIMIT = 20;
const DAY_MS = 86_400_000;

export type UpcomingItem = {
  id: string;
  serviceUserId: string;
  serviceUserName: string;
  label: string;
  dueDate: string;
  overdue: boolean;
};

export type UpcomingCategory = { count: number; overdue: number; items: UpcomingItem[] };

function personName(p: { firstName?: string | null; lastName?: string | null; preferredName?: string | null } | null | undefined): string {
  if (!p) return 'Unknown';
  const first = p.preferredName?.trim() || p.firstName?.trim() || '';
  return [first, p.lastName?.trim() ?? ''].filter(Boolean).join(' ') || 'Unknown';
}

function addDaysIso(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00.000Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Home dashboard signals that had no list/count endpoint before:
 * medication exceptions, service-user expiries, staff off today, policy reviews.
 * Every query is narrowed to the caller's branches (and an optional branch filter).
 */
@Injectable()
export class HomeSignalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /** Location ids to filter by, `undefined` for unrestricted, or `null` when nothing is in scope. */
  private locationIds(user: RequestUser, locationId?: string): string[] | undefined | null {
    const scope = this.orgScope.fromRequestUser(user);
    const ids = this.orgScope.resolveListLocationIds(scope, locationId);
    if (ids && ids.length === 0) return null;
    return ids;
  }

  private serviceUserWhere(ids: string[] | undefined): Prisma.ServiceUserWhereInput {
    const base: Prisma.ServiceUserWhereInput = { deletedAt: null, isActive: true };
    if (!ids) return base;
    return {
      ...base,
      OR: [
        { locationId: { in: ids } },
        { assignments: { some: { deletedAt: null, locationId: { in: ids } } } },
      ],
    };
  }

  private employeeWhere(ids: string[] | undefined): Prisma.EmployeeWhereInput {
    const base: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };
    if (!ids) return base;
    return {
      ...base,
      employment: {
        is: {
          OR: [
            { locationId: { in: ids } },
            { baseLocationId: { in: ids } },
            { floorLocations: { some: { locationId: { in: ids } } } },
          ],
        },
      },
    };
  }

  /* ── Medication: missed / refused / not given / held doses ─────────────── */

  async medicationExceptions(user: RequestUser, q: MedicationExceptionsQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const dateFrom = q.dateFrom ?? operationalTodayIso(new Date(), timeZone);
    const dateTo = q.dateTo ?? dateFrom;
    const start = operationalDayBounds(dateFrom, timeZone).start;
    const end = operationalDayBounds(dateTo, timeZone).end;

    const byStatus: Record<(typeof EXCEPTION_STATUSES)[number], number> = {
      MISSED: 0,
      REFUSED: 0,
      NOT_GIVEN: 0,
      HELD: 0,
    };
    const empty = { dateFrom, dateTo, total: 0, awaitingReview: 0, byStatus, items: [] as unknown[] };

    const ids = this.locationIds(user, q.locationId);
    if (ids === null) return { data: empty };

    const where: Prisma.MedicationAdministrationEventWhereInput = {
      deletedAt: null,
      isActive: true,
      status: { in: [...EXCEPTION_STATUSES] },
      serviceUser: this.serviceUserWhere(ids),
      OR: [
        { scheduledDateTime: { gte: start, lte: end } },
        { scheduledDateTime: null, actualDateTime: { gte: start, lte: end } },
      ],
    };

    const [groups, awaitingReview, rows] = await this.prisma.$transaction([
      this.prisma.medicationAdministrationEvent.groupBy({
        by: ['status'],
        where,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.medicationAdministrationEvent.count({ where: { ...where, managerReviewedAt: null } }),
      this.prisma.medicationAdministrationEvent.findMany({
        where,
        orderBy: [{ scheduledDateTime: 'desc' }, { createdAt: 'desc' }],
        take: ITEM_LIMIT,
        select: {
          id: true,
          status: true,
          scheduledDateTime: true,
          actualDateTime: true,
          reason: true,
          outcomeLabel: true,
          medicationNameSnapshot: true,
          managerReviewedAt: true,
          medication: { select: { medicationName: true } },
          serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
        },
      }),
    ]);

    let total = 0;
    for (const g of groups) {
      const n = typeof g._count === 'object' && g._count ? (g._count._all ?? 0) : 0;
      byStatus[g.status as keyof typeof byStatus] = n;
      total += n;
    }

    return {
      data: {
        dateFrom,
        dateTo,
        total,
        awaitingReview,
        byStatus,
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          serviceUserId: r.serviceUser.id,
          serviceUserName: personName(r.serviceUser),
          medicationName: r.medicationNameSnapshot ?? r.medication.medicationName,
          dueAt: (r.scheduledDateTime ?? r.actualDateTime)?.toISOString() ?? null,
          reason: r.reason ?? r.outcomeLabel ?? null,
          reviewed: Boolean(r.managerReviewedAt),
        })),
      },
    };
  }

  /* ── Service users: expiries and reviews due ───────────────────────────── */

  async serviceUserUpcoming(user: RequestUser, q: UpcomingWindowQueryDto) {
    const days = q.days ?? 30;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const todayStart = operationalDayBounds(today, timeZone).start;
    const horizon = operationalDayBounds(addDaysIso(today, days), timeZone).end;

    const blank = (): UpcomingCategory => ({ count: 0, overdue: 0, items: [] });
    const result = {
      days,
      from: today,
      to: addDaysIso(today, days),
      dols: blank(),
      legalAuthorities: blank(),
      documents: blank(),
      fundingEnding: blank(),
      purchaseOrders: blank(),
      fundingReviews: blank(),
      visitPlanReviews: blank(),
    };

    const ids = this.locationIds(user, q.locationId);
    if (ids === null) return { data: result };
    const su = this.serviceUserWhere(ids);
    const suSelect = { id: true, firstName: true, lastName: true, preferredName: true } as const;
    const dueSoon = { not: null, lte: horizon } as const;

    const category = <T extends { id: string; serviceUser: { id: string; firstName: string | null; lastName: string | null; preferredName: string | null } }>(
      rows: T[],
      due: (r: T) => Date | null,
      label: (r: T) => string,
      count: number,
      overdue: number,
    ): UpcomingCategory => ({
      count,
      overdue,
      items: rows.map((r) => {
        const d = due(r)!;
        return {
          id: r.id,
          serviceUserId: r.serviceUser.id,
          serviceUserName: personName(r.serviceUser),
          label: label(r),
          dueDate: d.toISOString(),
          overdue: d < todayStart,
        };
      }),
    });

    // DoLS: current authorisations needing renewal.
    const dolsWhere: Prisma.ServiceUserDolsRecordWhereInput = {
      deletedAt: null,
      isActive: true,
      isCurrent: true,
      renewalDate: dueSoon,
      serviceUser: su,
    };
    // Lasting powers of attorney, deputyships, court orders, appointees.
    const legalWhere: Prisma.ServiceUserLegalAuthorityWhereInput = {
      deletedAt: null,
      isActive: true,
      expiresOn: dueSoon,
      serviceUser: su,
    };
    const docWhere: Prisma.ServiceUserDocumentRecordWhereInput = {
      deletedAt: null,
      isActive: true,
      status: 'ACTIVE',
      expiryDate: dueSoon,
      serviceUser: su,
    };
    const fundingBase: Prisma.ServiceUserFundingWhereInput = {
      deletedAt: null,
      isActive: true,
      status: { in: LIVE_FUNDING },
      serviceUser: su,
    };
    const planWhere: Prisma.ServiceUserVisitPlanWhereInput = {
      deletedAt: null,
      isActive: true,
      status: VisitPlanStatus.ACTIVE,
      reviewDueAt: dueSoon,
      serviceUser: su,
    };

    const [
      dols, dolsN, dolsOver,
      legal, legalN, legalOver,
      docs, docsN, docsOver,
      fundEnd, fundEndN, fundEndOver,
      po, poN, poOver,
      fundRev, fundRevN, fundRevOver,
      plans, plansN, plansOver,
    ] = await this.prisma.$transaction([
      this.prisma.serviceUserDolsRecord.findMany({ where: dolsWhere, orderBy: { renewalDate: 'asc' }, take: ITEM_LIMIT, select: { id: true, renewalDate: true, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserDolsRecord.count({ where: dolsWhere }),
      this.prisma.serviceUserDolsRecord.count({ where: { ...dolsWhere, renewalDate: { lt: todayStart } } }),

      this.prisma.serviceUserLegalAuthority.findMany({ where: legalWhere, orderBy: { expiresOn: 'asc' }, take: ITEM_LIMIT, select: { id: true, expiresOn: true, category: true, holderName: true, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserLegalAuthority.count({ where: legalWhere }),
      this.prisma.serviceUserLegalAuthority.count({ where: { ...legalWhere, expiresOn: { lt: todayStart } } }),

      this.prisma.serviceUserDocumentRecord.findMany({ where: docWhere, orderBy: { expiryDate: 'asc' }, take: ITEM_LIMIT, select: { id: true, expiryDate: true, title: true, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserDocumentRecord.count({ where: docWhere }),
      this.prisma.serviceUserDocumentRecord.count({ where: { ...docWhere, expiryDate: { lt: todayStart } } }),

      this.prisma.serviceUserFunding.findMany({ where: { ...fundingBase, endDate: dueSoon }, orderBy: { endDate: 'asc' }, take: ITEM_LIMIT, select: { id: true, endDate: true, packageName: true, funder: { select: { name: true } }, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserFunding.count({ where: { ...fundingBase, endDate: dueSoon } }),
      this.prisma.serviceUserFunding.count({ where: { ...fundingBase, endDate: { lt: todayStart } } }),

      this.prisma.serviceUserFunding.findMany({ where: { ...fundingBase, purchaseOrderExpiresAt: dueSoon }, orderBy: { purchaseOrderExpiresAt: 'asc' }, take: ITEM_LIMIT, select: { id: true, purchaseOrderExpiresAt: true, purchaseOrderNumber: true, funder: { select: { name: true } }, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserFunding.count({ where: { ...fundingBase, purchaseOrderExpiresAt: dueSoon } }),
      this.prisma.serviceUserFunding.count({ where: { ...fundingBase, purchaseOrderExpiresAt: { lt: todayStart } } }),

      this.prisma.serviceUserFunding.findMany({ where: { ...fundingBase, reviewDate: dueSoon }, orderBy: { reviewDate: 'asc' }, take: ITEM_LIMIT, select: { id: true, reviewDate: true, packageName: true, funder: { select: { name: true } }, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserFunding.count({ where: { ...fundingBase, reviewDate: dueSoon } }),
      this.prisma.serviceUserFunding.count({ where: { ...fundingBase, reviewDate: { lt: todayStart } } }),

      this.prisma.serviceUserVisitPlan.findMany({ where: planWhere, orderBy: { reviewDueAt: 'asc' }, take: ITEM_LIMIT, select: { id: true, reviewDueAt: true, serviceUser: { select: suSelect } } }),
      this.prisma.serviceUserVisitPlan.count({ where: planWhere }),
      this.prisma.serviceUserVisitPlan.count({ where: { ...planWhere, reviewDueAt: { lt: todayStart } } }),
    ]);

    const funderLabel = (r: { packageName: string | null; funder: { name: string } | null }, fallback: string) =>
      [r.funder?.name, r.packageName].filter(Boolean).join(' · ') || fallback;

    return {
      data: {
        ...result,
        dols: category(dols, (r) => r.renewalDate, () => 'DoLS authorisation renewal', dolsN, dolsOver),
        legalAuthorities: category(
          legal,
          (r) => r.expiresOn,
          (r) => `${r.category.replace(/_/g, ' ').toLowerCase()} · ${r.holderName || 'holder not recorded'}`,
          legalN,
          legalOver,
        ),
        documents: category(docs, (r) => r.expiryDate, (r) => r.title, docsN, docsOver),
        fundingEnding: category(fundEnd, (r) => r.endDate, (r) => funderLabel(r, 'Funding'), fundEndN, fundEndOver),
        purchaseOrders: category(
          po,
          (r) => r.purchaseOrderExpiresAt,
          (r) => `PO ${r.purchaseOrderNumber || '(no number)'}${r.funder?.name ? ` · ${r.funder.name}` : ''}`,
          poN,
          poOver,
        ),
        fundingReviews: category(fundRev, (r) => r.reviewDate, (r) => funderLabel(r, 'Funding review'), fundRevN, fundRevOver),
        visitPlanReviews: category(plans, (r) => r.reviewDueAt, () => 'Visit plan review', plansN, plansOver),
      },
    };
  }

  /* ── Staff off on a given day (absence records + booked holidays) ──────── */

  async staffOff(user: RequestUser, q: StaffOffQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const date = q.date ?? operationalTodayIso(new Date(), timeZone);
    const { start, end } = operationalDayBounds(date, timeZone);
    const empty = { date, total: 0, sickness: 0, holiday: 0, unauthorised: 0, items: [] as unknown[] };

    const ids = this.locationIds(user, q.locationId);
    if (ids === null) return { data: empty };
    const employee = this.employeeWhere(ids);
    const nameSelect = { personalDetail: { select: { firstName: true, lastName: true } } } as const;

    const [absences, holidays] = await this.prisma.$transaction([
      this.prisma.employeeAbsenceRecord.findMany({
        where: { deletedAt: null, isActive: true, fromDateTime: { lte: end }, toDateTime: { gte: start }, employee },
        orderBy: { fromDateTime: 'asc' },
        select: {
          id: true,
          employeeId: true,
          absenceType: true,
          sicknessFlag: true,
          permissionStatus: true,
          holidayId: true,
          fromDateTime: true,
          toDateTime: true,
          employee: { select: nameSelect },
        },
      }),
      this.prisma.employeeHoliday.findMany({
        // Holidays already mirrored as an absence record are counted once, via the absence.
        where: { deletedAt: null, isActive: true, startDate: { lte: end }, endDate: { gte: start }, absenceRecord: { is: null }, employee },
        orderBy: { startDate: 'asc' },
        select: { id: true, employeeId: true, startDate: true, endDate: true, employee: { select: nameSelect } },
      }),
    ]);

    const byEmployee = new Map<
      string,
      { employeeId: string; name: string; reason: string; sickness: boolean; holiday: boolean; unauthorised: boolean; from: string; to: string }
    >();
    for (const a of absences) {
      if (byEmployee.has(a.employeeId)) continue;
      const isHoliday = Boolean(a.holidayId) || /holiday|annual/i.test(a.absenceType);
      byEmployee.set(a.employeeId, {
        employeeId: a.employeeId,
        name: personName(a.employee.personalDetail),
        reason: a.absenceType,
        sickness: a.sicknessFlag,
        holiday: isHoliday,
        unauthorised: /^unauthori[sz]ed$/i.test(a.permissionStatus),
        from: a.fromDateTime.toISOString(),
        to: a.toDateTime.toISOString(),
      });
    }
    for (const h of holidays) {
      if (byEmployee.has(h.employeeId)) continue;
      byEmployee.set(h.employeeId, {
        employeeId: h.employeeId,
        name: personName(h.employee.personalDetail),
        reason: 'Holiday',
        sickness: false,
        holiday: true,
        unauthorised: false,
        from: h.startDate.toISOString(),
        to: h.endDate.toISOString(),
      });
    }
    const items = [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name));

    return {
      data: {
        date,
        total: items.length,
        sickness: items.filter((i) => i.sickness).length,
        holiday: items.filter((i) => i.holiday).length,
        unauthorised: items.filter((i) => i.unauthorised).length,
        items,
      },
    };
  }

  /* ── Policies: published policies whose review date is due ─────────────── */

  async policyReviews(q: UpcomingWindowQueryDto) {
    const days = q.days ?? 30;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const todayStart = operationalDayBounds(today, timeZone).start;
    const horizon = operationalDayBounds(addDaysIso(today, days), timeZone).end;

    const versions = await this.prisma.policyVersion.findMany({
      where: {
        status: PolicyStatus.PUBLISHED,
        reviewDate: { not: null, lte: horizon },
        document: { deletedAt: null, isActive: true, status: PolicyStatus.PUBLISHED },
      },
      orderBy: { reviewDate: 'asc' },
      select: {
        id: true,
        reviewDate: true,
        titleSnapshot: true,
        document: { select: { id: true, reference: true, title: true, currentVersionId: true } },
      },
    });
    // Only the version currently in force counts; superseded drafts do not.
    const current = versions.filter((v) => !v.document.currentVersionId || v.document.currentVersionId === v.id);

    return {
      data: {
        days,
        count: current.length,
        overdue: current.filter((v) => v.reviewDate! < todayStart).length,
        items: current.slice(0, ITEM_LIMIT).map((v) => ({
          id: v.document.id,
          reference: v.document.reference,
          title: v.document.title || v.titleSnapshot,
          reviewDate: v.reviewDate!.toISOString(),
          overdue: v.reviewDate! < todayStart,
        })),
      },
    };
  }
}
