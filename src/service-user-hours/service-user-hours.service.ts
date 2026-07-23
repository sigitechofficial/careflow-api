import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ScheduledJobStatus,
  VisitPlanStatus,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { jobDurationMinutes } from '../scheduling/schedule-date-range.util';
import type { ServiceUserHoursMonthlyDetailQueryDto } from './dto/service-user-hours-monthly-detail.dto';
import type {
  ServiceUserHourBand,
  ServiceUserHourMetric,
  ServiceUserHoursWeeklyQueryDto,
} from './dto/service-user-hours-weekly-query.dto';

/** Jobs that still represent scheduled package load for the week. */
const ASSIGNED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.DRAFT,
  ScheduledJobStatus.UNALLOCATED,
  ScheduledJobStatus.ALLOCATED,
  ScheduledJobStatus.IN_PROGRESS,
  ScheduledJobStatus.COMPLETED,
  ScheduledJobStatus.PARTIALLY_COMPLETED,
  ScheduledJobStatus.MISSED,
  ScheduledJobStatus.NEEDS_ATTENTION,
];

type ContractedSource = 'visit_plan' | 'dom_care' | 'funding' | null;

type FacetOption = { id: string; name: string; count: number };

/** Monday 00:00 UTC of the ISO week containing `date` (UTC calendar date). */
function mondayOfIsoWeekContaining(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseUtcDateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseHoursValue(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

function hoursInBand(hours: number, band: ServiceUserHourBand): boolean {
  switch (band) {
    case 'under_10':
      return hours < 10;
    case '10_20':
      return hours >= 10 && hours < 20;
    case '20_30':
      return hours >= 20 && hours < 30;
    case '30_40':
      return hours >= 30 && hours < 40;
    case 'over_40':
      return hours >= 40;
    default:
      return true;
  }
}

function bandForHours(hours: number): ServiceUserHourBand {
  if (hours < 10) return 'under_10';
  if (hours < 20) return '10_20';
  if (hours < 30) return '20_30';
  if (hours < 40) return '30_40';
  return 'over_40';
}

function pushFacet(
  map: Map<string, FacetOption>,
  id: string | null | undefined,
  name: string | null | undefined,
) {
  if (!id || !name) return;
  const existing = map.get(id);
  if (existing) existing.count += 1;
  else map.set(id, { id, name, count: 1 });
}

function sortedFacet(map: Map<string, FacetOption>): FacetOption[] {
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function reconciliationBillableMinutes(r: {
  billableMinutes: number | null;
  approvedBillStart: Date | null;
  approvedBillEnd: Date | null;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
}): number {
  if (r.billableMinutes != null && r.billableMinutes > 0) return r.billableMinutes;
  if (r.approvedBillStart && r.approvedBillEnd) {
    return Math.max(
      0,
      Math.round((r.approvedBillEnd.getTime() - r.approvedBillStart.getTime()) / 60_000),
    );
  }
  if (r.actualStartDateTime && r.actualEndDateTime) {
    return Math.max(
      0,
      Math.round((r.actualEndDateTime.getTime() - r.actualStartDateTime.getTime()) / 60_000),
    );
  }
  return 0;
}

function resolvePackageHours(su: {
  domCare: { weeklyContractedHours: string | null } | null;
  currentFunding: { authorisedWeeklyHours: number | null } | null;
  visitPlans: { weeklyContractedHours: string | null }[];
}): {
  weeklyPackageHours: number | null;
  contractedSource: ContractedSource;
  authorisedWeeklyHours: number | null;
} {
  const visitPlanHours = parseHoursValue(su.visitPlans[0]?.weeklyContractedHours);
  const domCareHours = parseHoursValue(su.domCare?.weeklyContractedHours);
  const fundingHours = parseHoursValue(su.currentFunding?.authorisedWeeklyHours);

  if (visitPlanHours != null) {
    return {
      weeklyPackageHours: visitPlanHours,
      contractedSource: 'visit_plan',
      authorisedWeeklyHours: fundingHours,
    };
  }
  if (domCareHours != null) {
    return {
      weeklyPackageHours: domCareHours,
      contractedSource: 'dom_care',
      authorisedWeeklyHours: fundingHours,
    };
  }
  if (fundingHours != null) {
    return {
      weeklyPackageHours: fundingHours,
      contractedSource: 'funding',
      authorisedWeeklyHours: fundingHours,
    };
  }
  return {
    weeklyPackageHours: null,
    contractedSource: null,
    authorisedWeeklyHours: fundingHours,
  };
}

/** Calendar month week blocks: W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–end (28/29/30/31). */
function calendarMonthWeekBlocks(year: number, month: number): Array<{
  weekNumber: number;
  dayFrom: number;
  dayTo: number;
  weekStart: Date;
  weekEnd: Date;
  weekStartIso: string;
  weekEndIso: string;
  dayLabels: string[];
}> {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const blocks: Array<{ dayFrom: number; dayTo: number }> = [
    { dayFrom: 1, dayTo: Math.min(7, daysInMonth) },
    { dayFrom: 8, dayTo: Math.min(14, daysInMonth) },
    { dayFrom: 15, dayTo: Math.min(21, daysInMonth) },
    { dayFrom: 22, dayTo: Math.min(28, daysInMonth) },
  ];
  if (daysInMonth >= 29) {
    blocks.push({ dayFrom: 29, dayTo: daysInMonth });
  }

  return blocks
    .filter((b) => b.dayFrom <= daysInMonth && b.dayFrom <= b.dayTo)
    .map((b, index) => {
      const weekStart = new Date(Date.UTC(year, month - 1, b.dayFrom, 0, 0, 0, 0));
      const weekEnd = endOfUtcDay(new Date(Date.UTC(year, month - 1, b.dayTo)));
      const dayLabels: string[] = [];
      for (let d = b.dayFrom; d <= b.dayTo; d += 1) {
        dayLabels.push(String(d));
      }
      return {
        weekNumber: index + 1,
        dayFrom: b.dayFrom,
        dayTo: b.dayTo,
        weekStart,
        weekEnd,
        weekStartIso: weekStart.toISOString().slice(0, 10),
        weekEndIso: weekEnd.toISOString().slice(0, 10),
        dayLabels,
      };
    });
}

@Injectable()
export class ServiceUserHoursService {
  constructor(private readonly prisma: PrismaService) {}

  async weeklySummary(query: ServiceUserHoursWeeklyQueryDto) {
    const anchor = query.weekStart
      ? (parseUtcDateOnly(query.weekStart) ?? new Date())
      : new Date();
    const weekStart = mondayOfIsoWeekContaining(anchor);
    const weekEnd = endOfUtcDay(
      new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 6)),
    );
    const weekStartIso = weekStart.toISOString().slice(0, 10);
    const weekEndIso = weekEnd.toISOString().slice(0, 10);

    const suWhere: Prisma.ServiceUserWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.careTypeId ? { careTypeId: query.careTypeId } : {}),
      ...(query.fundingTypeId ? { fundingTypeId: query.fundingTypeId } : {}),
      ...(query.statusId ? { statusId: query.statusId } : {}),
    };

    const serviceUsers = await this.prisma.serviceUser.findMany({
      where: suWhere,
      select: {
        id: true,
        isActive: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        serviceStartDate: true,
        location: { select: { id: true, name: true } },
        careType: { select: { id: true, name: true } },
        fundingType: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        riskLevel: { select: { id: true, name: true } },
        domCare: { select: { weeklyContractedHours: true } },
        currentFunding: { select: { authorisedWeeklyHours: true } },
        visitPlans: {
          where: {
            deletedAt: null,
            isActive: true,
            status: VisitPlanStatus.ACTIVE,
          },
          select: {
            id: true,
            weeklyContractedHours: true,
            effectiveFrom: true,
            updatedAt: true,
          },
          orderBy: [{ effectiveFrom: 'desc' }, { updatedAt: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const serviceUserIds = serviceUsers.map((su) => su.id);
    const assignedMinutes = new Map<string, number>();
    const assignedVisits = new Map<string, number>();
    const workedMinutes = new Map<string, number>();
    const workedVisits = new Map<string, number>();
    /** Worked minutes per weekday, Monday = index 0. */
    const dayMinutes = new Map<string, number[]>();

    if (serviceUserIds.length > 0) {
      const [jobs, reconciliations] = await Promise.all([
        this.prisma.scheduledJob.findMany({
          where: {
            deletedAt: null,
            isActive: true,
            serviceUserId: { in: serviceUserIds },
            status: { in: ASSIGNED_JOB_STATUSES },
            scheduledStartDateTime: { gte: weekStart, lte: weekEnd },
          },
          select: {
            serviceUserId: true,
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            estimatedDurationMinutes: true,
          },
        }),
        this.prisma.visitReconciliation.findMany({
          where: {
            serviceUserId: { in: serviceUserIds },
            plannedStartDateTime: { gte: weekStart, lte: weekEnd },
            status: { notIn: [VisitReconciliationStatus.REJECTED_FOR_INVOICE] },
          },
          select: {
            serviceUserId: true,
            scheduledVisitId: true,
            billableMinutes: true,
            plannedStartDateTime: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
            approvedBillStart: true,
            approvedBillEnd: true,
          },
        }),
      ]);

      for (const job of jobs) {
        const mins = jobDurationMinutes(job);
        assignedMinutes.set(
          job.serviceUserId,
          (assignedMinutes.get(job.serviceUserId) ?? 0) + mins,
        );
        assignedVisits.set(
          job.serviceUserId,
          (assignedVisits.get(job.serviceUserId) ?? 0) + 1,
        );
      }

      // Multi-carer visits share a scheduledVisitId — keep the max billable minutes per visit.
      const visitBest = new Map<
        string,
        {
          serviceUserId: string;
          minutes: number;
          plannedStartDateTime: Date;
        }
      >();
      for (const r of reconciliations) {
        const mins = reconciliationBillableMinutes(r);
        if (mins <= 0) continue;
        const existing = visitBest.get(r.scheduledVisitId);
        if (!existing || mins > existing.minutes) {
          visitBest.set(r.scheduledVisitId, {
            serviceUserId: r.serviceUserId,
            minutes: mins,
            plannedStartDateTime: r.plannedStartDateTime,
          });
        }
      }

      for (const visit of visitBest.values()) {
        workedMinutes.set(
          visit.serviceUserId,
          (workedMinutes.get(visit.serviceUserId) ?? 0) + visit.minutes,
        );
        workedVisits.set(
          visit.serviceUserId,
          (workedVisits.get(visit.serviceUserId) ?? 0) + 1,
        );
        const dayIdx = Math.min(
          6,
          Math.max(
            0,
            Math.floor((visit.plannedStartDateTime.getTime() - weekStart.getTime()) / 86_400_000),
          ),
        );
        const days = dayMinutes.get(visit.serviceUserId) ?? [0, 0, 0, 0, 0, 0, 0];
        days[dayIdx] += visit.minutes;
        dayMinutes.set(visit.serviceUserId, days);
      }
    }

    const bandMetric: ServiceUserHourMetric = query.bandMetric ?? 'assigned';
    const search = query.search?.trim().toLowerCase() ?? '';

    const locationFacets = new Map<string, FacetOption>();
    const careTypeFacets = new Map<string, FacetOption>();
    const fundingTypeFacets = new Map<string, FacetOption>();
    const statusFacets = new Map<string, FacetOption>();

    const allRows = serviceUsers.map((su) => {
      const displayName =
        [su.preferredName || su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
        'Unknown';

      const visitPlan = su.visitPlans[0] ?? null;
      const visitPlanHours = parseHoursValue(visitPlan?.weeklyContractedHours);
      const domCareHours = parseHoursValue(su.domCare?.weeklyContractedHours);
      const fundingHours = parseHoursValue(su.currentFunding?.authorisedWeeklyHours);

      let weeklyPackageHours: number | null = null;
      let contractedSource: ContractedSource = null;
      if (visitPlanHours != null) {
        weeklyPackageHours = visitPlanHours;
        contractedSource = 'visit_plan';
      } else if (domCareHours != null) {
        weeklyPackageHours = domCareHours;
        contractedSource = 'dom_care';
      } else if (fundingHours != null) {
        weeklyPackageHours = fundingHours;
        contractedSource = 'funding';
      }

      const assignedHours = round2((assignedMinutes.get(su.id) ?? 0) / 60);
      const hoursWorked = round2((workedMinutes.get(su.id) ?? 0) / 60);
      const hoursOverPackage =
        weeklyPackageHours != null
          ? round2(Math.max(0, assignedHours - weeklyPackageHours))
          : 0;
      const hoursOverWorked =
        weeklyPackageHours != null
          ? round2(Math.max(0, hoursWorked - weeklyPackageHours))
          : 0;
      const utilisationPct =
        weeklyPackageHours != null && weeklyPackageHours > 0
          ? round2((hoursWorked / weeklyPackageHours) * 100)
          : null;
      const assignedUtilisationPct =
        weeklyPackageHours != null && weeklyPackageHours > 0
          ? round2((assignedHours / weeklyPackageHours) * 100)
          : null;
      const remainingPackageHours =
        weeklyPackageHours != null ? round2(weeklyPackageHours - assignedHours) : null;

      pushFacet(locationFacets, su.location?.id, su.location?.name);
      pushFacet(careTypeFacets, su.careType?.id, su.careType?.name);
      pushFacet(fundingTypeFacets, su.fundingType?.id, su.fundingType?.name);
      pushFacet(statusFacets, su.status?.id, su.status?.name);

      return {
        serviceUserId: su.id,
        serviceUserName: displayName,
        serviceUserNumber: su.serviceUserNumber ?? null,
        isActive: su.isActive,
        branchName: su.location?.name ?? null,
        careTypeName: su.careType?.name ?? null,
        fundingTypeName: su.fundingType?.name ?? null,
        statusName: su.status?.name ?? null,
        riskLevelName: su.riskLevel?.name ?? null,
        serviceStartDate: su.serviceStartDate
          ? su.serviceStartDate.toISOString().slice(0, 10)
          : null,
        weeklyPackageHours,
        contractedSource,
        authorisedWeeklyHours: fundingHours,
        assignedHours,
        hoursWorked,
        hoursOverPackage,
        hoursOverWorked,
        utilisationPct,
        assignedUtilisationPct,
        remainingPackageHours,
        assignedVisits: assignedVisits.get(su.id) ?? 0,
        workedVisits: workedVisits.get(su.id) ?? 0,
        dayHours: (dayMinutes.get(su.id) ?? [0, 0, 0, 0, 0, 0, 0]).map((m) => round2(m / 60)),
        hourBand: bandForHours(assignedHours),
      };
    });

    let filtered = allRows;
    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.serviceUserName.toLowerCase().includes(search) ||
          (r.serviceUserNumber?.toLowerCase().includes(search) ?? false),
      );
    }
    if (query.overPackageOnly) {
      filtered = filtered.filter((r) => r.hoursOverPackage > 0);
    }
    if (query.overWorkedOnly) {
      filtered = filtered.filter((r) => r.hoursOverWorked > 0);
    }

    const metricValueOf = (r: (typeof allRows)[number]) =>
      bandMetric === 'worked'
        ? r.hoursWorked
        : bandMetric === 'package'
          ? (r.weeklyPackageHours ?? 0)
          : r.assignedHours;

    const bandCounts: Record<ServiceUserHourBand, number> = {
      under_10: 0,
      '10_20': 0,
      '20_30': 0,
      '30_40': 0,
      over_40: 0,
    };
    for (const row of filtered) {
      bandCounts[bandForHours(metricValueOf(row))] += 1;
    }

    let rows = filtered;
    if (query.hourBand) {
      rows = rows.filter((r) => hoursInBand(metricValueOf(r), query.hourBand!));
    }

    const totals = rows.reduce(
      (acc, r) => {
        acc.assignedHours += r.assignedHours;
        acc.hoursWorked += r.hoursWorked;
        acc.hoursOverPackage += r.hoursOverPackage;
        acc.assignedVisits += r.assignedVisits;
        acc.workedVisits += r.workedVisits;
        if (r.weeklyPackageHours != null) {
          acc.packageHoursSum += r.weeklyPackageHours;
          acc.packageHoursCount += 1;
        }
        if (r.utilisationPct != null) {
          acc.utilisationSum += r.utilisationPct;
          acc.utilisationCount += 1;
        }
        if (r.assignedUtilisationPct != null) {
          acc.assignedUtilisationSum += r.assignedUtilisationPct;
          acc.assignedUtilisationCount += 1;
        }
        if (r.hoursOverPackage > 0) acc.overPackageCount += 1;
        if (r.hoursOverWorked > 0) acc.overWorkedCount += 1;
        if (r.weeklyPackageHours == null) acc.missingPackageCount += 1;
        return acc;
      },
      {
        assignedHours: 0,
        hoursWorked: 0,
        hoursOverPackage: 0,
        assignedVisits: 0,
        workedVisits: 0,
        packageHoursSum: 0,
        packageHoursCount: 0,
        utilisationSum: 0,
        utilisationCount: 0,
        assignedUtilisationSum: 0,
        assignedUtilisationCount: 0,
        overPackageCount: 0,
        overWorkedCount: 0,
        missingPackageCount: 0,
      },
    );

    return {
      data: {
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
        bandMetric,
        hourBand: query.hourBand ?? null,
        bandCounts,
        serviceUserCount: rows.length,
        totals: {
          packageHours: round2(totals.packageHoursSum),
          assignedHours: round2(totals.assignedHours),
          hoursWorked: round2(totals.hoursWorked),
          hoursOverPackage: round2(totals.hoursOverPackage),
          assignedVisits: totals.assignedVisits,
          workedVisits: totals.workedVisits,
          averagePackageHours:
            totals.packageHoursCount > 0
              ? round2(totals.packageHoursSum / totals.packageHoursCount)
              : null,
          averageUtilisationPct:
            totals.utilisationCount > 0
              ? round2(totals.utilisationSum / totals.utilisationCount)
              : null,
          averageAssignedUtilisationPct:
            totals.assignedUtilisationCount > 0
              ? round2(totals.assignedUtilisationSum / totals.assignedUtilisationCount)
              : null,
          overPackageCount: totals.overPackageCount,
          overWorkedCount: totals.overWorkedCount,
          missingPackageCount: totals.missingPackageCount,
        },
        facets: {
          locations: sortedFacet(locationFacets),
          careTypes: sortedFacet(careTypeFacets),
          fundingTypes: sortedFacet(fundingTypeFacets),
          statuses: sortedFacet(statusFacets),
        },
        rows,
      },
    };
  }

  /**
   * Monthly detail for one service user — calendar week blocks within the month
   * (1–7, 8–14, 15–21, 22–28, 29–end), with package / assigned / worked hours.
   */
  async monthlyDetail(query: ServiceUserHoursMonthlyDetailQueryDto) {
    const now = new Date();
    const m = query.month ? /^(\d{4})-(\d{2})$/.exec(query.month) : null;
    const year = m ? Number(m[1]) : now.getUTCFullYear();
    const month = m ? Number(m[2]) : now.getUTCMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthName = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    }).format(monthStart);

    const su = await this.prisma.serviceUser.findFirst({
      where: { id: query.serviceUserId, deletedAt: null },
      select: {
        id: true,
        isActive: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        location: { select: { id: true, name: true } },
        careType: { select: { id: true, name: true } },
        status: { select: { id: true, name: true } },
        domCare: { select: { weeklyContractedHours: true } },
        currentFunding: { select: { authorisedWeeklyHours: true } },
        visitPlans: {
          where: {
            deletedAt: null,
            isActive: true,
            status: VisitPlanStatus.ACTIVE,
          },
          select: {
            weeklyContractedHours: true,
            effectiveFrom: true,
            updatedAt: true,
          },
          orderBy: [{ effectiveFrom: 'desc' }, { updatedAt: 'desc' }],
          take: 1,
        },
      },
    });

    if (!su) {
      throw new NotFoundException('Service user not found');
    }

    const displayName =
      [su.preferredName || su.firstName, su.lastName].filter(Boolean).join(' ').trim() ||
      'Unknown';
    const packageInfo = resolvePackageHours(su);
    const weeksMeta = calendarMonthWeekBlocks(year, month);

    const [jobs, reconciliations] = await Promise.all([
      this.prisma.scheduledJob.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          serviceUserId: su.id,
          status: { in: ASSIGNED_JOB_STATUSES },
          scheduledStartDateTime: { gte: monthStart, lte: monthEnd },
        },
        select: {
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          estimatedDurationMinutes: true,
        },
      }),
      this.prisma.visitReconciliation.findMany({
        where: {
          serviceUserId: su.id,
          plannedStartDateTime: { gte: monthStart, lte: monthEnd },
          status: { notIn: [VisitReconciliationStatus.REJECTED_FOR_INVOICE] },
        },
        select: {
          scheduledVisitId: true,
          billableMinutes: true,
          plannedStartDateTime: true,
          actualStartDateTime: true,
          actualEndDateTime: true,
          approvedBillStart: true,
          approvedBillEnd: true,
        },
      }),
    ]);

    const visitBest = new Map<
      string,
      { minutes: number; plannedStartDateTime: Date }
    >();
    for (const r of reconciliations) {
      const mins = reconciliationBillableMinutes(r);
      if (mins <= 0) continue;
      const existing = visitBest.get(r.scheduledVisitId);
      if (!existing || mins > existing.minutes) {
        visitBest.set(r.scheduledVisitId, {
          minutes: mins,
          plannedStartDateTime: r.plannedStartDateTime,
        });
      }
    }

    const weeks = weeksMeta.map((week) => {
      let assignedMins = 0;
      let assignedVisits = 0;
      for (const job of jobs) {
        const t = job.scheduledStartDateTime.getTime();
        if (t >= week.weekStart.getTime() && t <= week.weekEnd.getTime()) {
          assignedMins += jobDurationMinutes(job);
          assignedVisits += 1;
        }
      }

      const dayMins = week.dayLabels.map(() => 0);
      let workedMins = 0;
      let workedVisits = 0;
      for (const visit of visitBest.values()) {
        const t = visit.plannedStartDateTime.getTime();
        if (t < week.weekStart.getTime() || t > week.weekEnd.getTime()) continue;
        workedMins += visit.minutes;
        workedVisits += 1;
        const dayOfMonth = visit.plannedStartDateTime.getUTCDate();
        const dayIdx = dayOfMonth - week.dayFrom;
        if (dayIdx >= 0 && dayIdx < dayMins.length) {
          dayMins[dayIdx] += visit.minutes;
        }
      }

      const assignedHours = round2(assignedMins / 60);
      const hoursWorked = round2(workedMins / 60);
      const packageHours = packageInfo.weeklyPackageHours;
      const hoursOverPackage =
        packageHours != null ? round2(Math.max(0, assignedHours - packageHours)) : 0;
      const hoursOverWorked =
        packageHours != null ? round2(Math.max(0, hoursWorked - packageHours)) : 0;
      const assignedUtilisationPct =
        packageHours != null && packageHours > 0
          ? round2((assignedHours / packageHours) * 100)
          : null;
      const utilisationPct =
        packageHours != null && packageHours > 0
          ? round2((hoursWorked / packageHours) * 100)
          : null;

      const dayRangeLabel =
        week.dayFrom === week.dayTo
          ? `${week.dayFrom}`
          : `${week.dayFrom}–${week.dayTo}`;

      return {
        weekNumber: week.weekNumber,
        weekStart: week.weekStartIso,
        weekEnd: week.weekEndIso,
        dayFrom: week.dayFrom,
        dayTo: week.dayTo,
        label: `Week ${week.weekNumber}`,
        dayRangeLabel,
        /** Always false for calendar blocks — weeks stay inside the month. */
        partialMonth: false,
        packageHours,
        assignedHours,
        hoursWorked,
        hoursOverPackage,
        hoursOverWorked,
        assignedUtilisationPct,
        utilisationPct,
        assignedVisits,
        workedVisits,
        dayLabels: week.dayLabels,
        dayHours: dayMins.map((mins) => round2(mins / 60)),
      };
    });

    const monthTotals = weeks.reduce(
      (acc, w) => {
        acc.assignedHours += w.assignedHours;
        acc.hoursWorked += w.hoursWorked;
        acc.hoursOverPackage += w.hoursOverPackage;
        acc.assignedVisits += w.assignedVisits;
        acc.workedVisits += w.workedVisits;
        if (w.hoursOverPackage > 0) acc.overPackageWeekCount += 1;
        if (w.hoursOverWorked > 0) acc.overWorkedWeekCount += 1;
        return acc;
      },
      {
        assignedHours: 0,
        hoursWorked: 0,
        hoursOverPackage: 0,
        assignedVisits: 0,
        workedVisits: 0,
        overPackageWeekCount: 0,
        overWorkedWeekCount: 0,
      },
    );

    const expectedPackageHours =
      packageInfo.weeklyPackageHours != null
        ? round2(packageInfo.weeklyPackageHours * (daysInMonth / 7))
        : null;

    return {
      data: {
        month: monthKey,
        monthName,
        year,
        daysInMonth,
        weekScheme: '1–7 · 8–14 · 15–21 · 22–28 · 29+',
        serviceUser: {
          serviceUserId: su.id,
          serviceUserName: displayName,
          serviceUserNumber: su.serviceUserNumber ?? null,
          isActive: su.isActive,
          branchName: su.location?.name ?? null,
          careTypeName: su.careType?.name ?? null,
          statusName: su.status?.name ?? null,
        },
        weeklyPackageHours: packageInfo.weeklyPackageHours,
        contractedSource: packageInfo.contractedSource,
        authorisedWeeklyHours: packageInfo.authorisedWeeklyHours,
        expectedPackageHours,
        totals: {
          assignedHours: round2(monthTotals.assignedHours),
          hoursWorked: round2(monthTotals.hoursWorked),
          hoursOverPackage: round2(monthTotals.hoursOverPackage),
          assignedVisits: monthTotals.assignedVisits,
          workedVisits: monthTotals.workedVisits,
          overPackageWeekCount: monthTotals.overPackageWeekCount,
          overWorkedWeekCount: monthTotals.overWorkedWeekCount,
          weekCount: weeks.length,
        },
        weeks,
      },
    };
  }
}
