import { Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStatus, Prisma, VisitReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { jobDurationMinutes, operationalScheduleMonthBounds } from '../scheduling/schedule-date-range.util';
import {
  ENTERPRISE_EMPLOYEE_VISA_TYPES,
  LEGACY_VISA_TYPE_ID_MAP,
} from '../organisation-general-settings/employee-visa-catalog.constants';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  addDaysToOperationalIso,
  dayKeyInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import type {
  EmployeeHourBand,
  EmployeeHourMetric,
  EmployeeHoursWeeklyQueryDto,
} from './dto/employee-hours-weekly-query.dto';
import type {
  EmployeeComplianceStatus,
  EmployeeHoursMonthlyQueryDto,
  UpsertEmployeeHoursMonthlyReviewDto,
} from './dto/employee-hours-monthly.dto';
import type { EmployeeHoursMonthlyDetailQueryDto } from './dto/employee-hours-monthly-detail.dto';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const OVERTIME_THRESHOLD_HOURS = 40;

/** Monday 00:00 UTC of the ISO week containing a civil YYYY-MM-DD label. */
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

function mondayIsoOfCivilDate(iso: string): string | null {
  const d = parseUtcDateOnly(iso.slice(0, 10));
  if (!d) return null;
  return mondayOfIsoWeekContaining(d).toISOString().slice(0, 10);
}

function weekdayIndexFromMonday(mondayIso: string, dayIso: string): number {
  const a = parseUtcDateOnly(mondayIso);
  const b = parseUtcDateOnly(dayIso);
  if (!a || !b) return 0;
  return Math.min(6, Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hoursInBand(hours: number, band: EmployeeHourBand): boolean {
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

function bandForHours(hours: number): EmployeeHourBand {
  if (hours < 10) return 'under_10';
  if (hours < 20) return '10_20';
  if (hours < 30) return '20_30';
  if (hours < 40) return '30_40';
  return 'over_40';
}

/** Canonical visa id (legacy ids remapped) → { label, capHours }. */
const VISA_BY_ID = new Map(
  ENTERPRISE_EMPLOYEE_VISA_TYPES.map((v) => [v.id, { label: v.label, capHours: v.maxWeeklyHours }]),
);

function resolveVisa(visaTypeId: string | null | undefined): {
  id: string;
  label: string;
  capHours: number;
} | null {
  if (!visaTypeId) return null;
  const canonical = VISA_BY_ID.has(visaTypeId)
    ? visaTypeId
    : LEGACY_VISA_TYPE_ID_MAP[visaTypeId] ?? null;
  if (!canonical) return null;
  const entry = VISA_BY_ID.get(canonical);
  return entry ? { id: canonical, label: entry.label, capHours: entry.capHours } : null;
}

/** Visa routes that carry UKVI sponsor (SMS) reporting duties. */
const SPONSORED_VISA_IDS = new Set(['skilled_worker', 'health_care_worker']);

/** Under-hours tolerance before SMS reporting is flagged (80% of CoS weekly hours). */
const SMS_UNDER_HOURS_RATIO = 0.8;

type FacetOption = { id: string; name: string; count: number };

function pushFacet(map: Map<string, FacetOption>, id: string | null | undefined, name: string | null | undefined) {
  if (!id || !name) return;
  const existing = map.get(id);
  if (existing) existing.count += 1;
  else map.set(id, { id, name, count: 1 });
}

function sortedFacet(map: Map<string, FacetOption>): FacetOption[] {
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Calendar month week blocks: W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–end.
 * Instant bounds use the organisation operational timezone. */
function calendarMonthWeekBlocks(
  year: number,
  month: number,
  timeZone: string,
): Array<{
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

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const y = String(year);

  return blocks
    .filter((b) => b.dayFrom <= daysInMonth && b.dayFrom <= b.dayTo)
    .map((b, index) => {
      const startIso = `${y}-${pad2(month)}-${pad2(b.dayFrom)}`;
      const endIso = `${y}-${pad2(month)}-${pad2(b.dayTo)}`;
      const weekStart = operationalDayBounds(startIso, timeZone).start;
      const weekEnd = operationalDayBounds(endIso, timeZone).end;
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
        weekStartIso: startIso,
        weekEndIso: endIso,
        dayLabels,
      };
    });
}

function reconciliationPayableMinutes(r: {
  payableMinutes: number | null;
  approvedPayStart: Date | null;
  approvedPayEnd: Date | null;
  actualStartDateTime: Date | null;
  actualEndDateTime: Date | null;
}): number {
  if (r.payableMinutes != null && r.payableMinutes > 0) return r.payableMinutes;
  if (r.approvedPayStart && r.approvedPayEnd) {
    return Math.max(
      0,
      Math.round((r.approvedPayEnd.getTime() - r.approvedPayStart.getTime()) / 60_000),
    );
  }
  if (r.actualStartDateTime && r.actualEndDateTime) {
    return Math.max(
      0,
      Math.round(
        (r.actualEndDateTime.getTime() - r.actualStartDateTime.getTime()) / 60_000,
      ),
    );
  }
  return 0;
}

@Injectable()
export class EmployeeHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async weeklySummary(query: EmployeeHoursWeeklyQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const mondayIso =
      (query.weekStart ? mondayIsoOfCivilDate(query.weekStart) : null) ??
      mondayIsoOfCivilDate(today) ??
      today;
    const sundayIso = addDaysToOperationalIso(mondayIso, 6);
    const weekStart = operationalDayBounds(mondayIso, timeZone).start;
    const weekEnd = operationalDayBounds(sundayIso, timeZone).end;
    const weekStartIso = mondayIso;
    const weekEndIso = sundayIso;

    const employmentWhere: Prisma.EmployeeEmploymentWhereInput = {};
    if (query.roleId) employmentWhere.roleId = query.roleId;
    if (query.jobTitleId) employmentWhere.jobTitleId = query.jobTitleId;
    if (query.contractTypeId) employmentWhere.contractTypeId = query.contractTypeId;
    if (query.locationId) {
      employmentWhere.OR = [
        { baseLocationId: query.locationId },
        { locationId: query.locationId },
      ];
    }
    if (query.staffKind === 'bank') employmentWhere.isBankStaff = true;
    if (query.staffKind === 'agency') employmentWhere.isAgencyStaff = true;
    if (query.staffKind === 'permanent') {
      employmentWhere.isBankStaff = false;
      employmentWhere.isAgencyStaff = false;
    }

    const empWhere: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(Object.keys(employmentWhere).length > 0 ? { employment: employmentWhere } : {}),
    };

    const employees = await this.prisma.employee.findMany({
      where: empWhere,
      select: {
        id: true,
        isActive: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        employment: {
          select: {
            employeeNumber: true,
            contractedWeeklyHours: true,
            maximumWeeklyHours: true,
            minimumWeeklyHours: true,
            guaranteedWeeklyHours: true,
            visaTypeId: true,
            weeklyHoursCapOverride: true,
            weeklyHoursCapOverrideExpiresAt: true,
            optedOutOf48Hours: true,
            isBankStaff: true,
            isAgencyStaff: true,
            startDate: true,
            role: { select: { id: true, name: true } },
            jobTitle: { select: { id: true, name: true } },
            contractType: { select: { id: true, name: true } },
            baseLocation: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ personalDetail: { lastName: 'asc' } }, { personalDetail: { firstName: 'asc' } }],
    });

    const employeeIds = employees.map((e) => e.id);
    const assignedMinutes = new Map<string, number>();
    const workedMinutes = new Map<string, number>();
    const assignedVisits = new Map<string, number>();
    const workedVisits = new Map<string, number>();
    /** Worked minutes per weekday, Monday = index 0. */
    const dayMinutes = new Map<string, number[]>();

    if (employeeIds.length > 0) {
      const [allocations, reconciliations] = await Promise.all([
        this.prisma.jobAllocation.findMany({
          where: {
            deletedAt: null,
            isActive: true,
            status: { in: ACTIVE_ALLOCATION },
            employeeId: { in: employeeIds },
            scheduledJob: {
              deletedAt: null,
              scheduledStartDateTime: { gte: weekStart, lte: weekEnd },
            },
          },
          select: {
            employeeId: true,
            scheduledJob: {
              select: {
                scheduledStartDateTime: true,
                scheduledEndDateTime: true,
                estimatedDurationMinutes: true,
              },
            },
          },
        }),
        this.prisma.visitReconciliation.findMany({
          where: {
            employeeId: { in: employeeIds },
            plannedStartDateTime: { gte: weekStart, lte: weekEnd },
            status: {
              notIn: [VisitReconciliationStatus.REJECTED_FOR_PAY],
            },
          },
          select: {
            employeeId: true,
            payableMinutes: true,
            plannedStartDateTime: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
            approvedPayStart: true,
            approvedPayEnd: true,
          },
        }),
      ]);

      for (const a of allocations) {
        if (!a.employeeId) continue;
        const mins = jobDurationMinutes(a.scheduledJob);
        assignedMinutes.set(a.employeeId, (assignedMinutes.get(a.employeeId) ?? 0) + mins);
        assignedVisits.set(a.employeeId, (assignedVisits.get(a.employeeId) ?? 0) + 1);
      }

      for (const r of reconciliations) {
        if (!r.employeeId) continue;
        let mins = 0;
        if (r.payableMinutes != null && r.payableMinutes > 0) {
          mins = r.payableMinutes;
        } else if (r.approvedPayStart && r.approvedPayEnd) {
          mins = Math.max(
            0,
            Math.round((r.approvedPayEnd.getTime() - r.approvedPayStart.getTime()) / 60_000),
          );
        } else if (r.actualStartDateTime && r.actualEndDateTime) {
          mins = Math.max(
            0,
            Math.round(
              (r.actualEndDateTime.getTime() - r.actualStartDateTime.getTime()) / 60_000,
            ),
          );
        }
        if (mins > 0) {
          workedMinutes.set(r.employeeId, (workedMinutes.get(r.employeeId) ?? 0) + mins);
          workedVisits.set(r.employeeId, (workedVisits.get(r.employeeId) ?? 0) + 1);
          const dayKey = dayKeyInTimeZone(r.plannedStartDateTime, timeZone);
          const dayIdx = weekdayIndexFromMonday(weekStartIso, dayKey);
          const days = dayMinutes.get(r.employeeId) ?? [0, 0, 0, 0, 0, 0, 0];
          days[dayIdx] += mins;
          dayMinutes.set(r.employeeId, days);
        }
      }
    }

    const bandMetric: EmployeeHourMetric = query.bandMetric ?? 'worked';
    const search = query.search?.trim().toLowerCase() ?? '';

    const roleFacets = new Map<string, FacetOption>();
    const jobTitleFacets = new Map<string, FacetOption>();
    const contractTypeFacets = new Map<string, FacetOption>();
    const locationFacets = new Map<string, FacetOption>();
    const visaFacets = new Map<string, FacetOption>();

    const allRows = employees.map((emp) => {
      const employment = emp.employment;
      const name =
        [emp.personalDetail?.firstName, emp.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Unknown';
      const weeklyHours =
        employment?.contractedWeeklyHours != null
          ? round2(Number(employment.contractedWeeklyHours))
          : null;
      const maximumHours =
        employment?.maximumWeeklyHours != null
          ? round2(Number(employment.maximumWeeklyHours))
          : null;
      const minimumHours =
        employment?.minimumWeeklyHours != null
          ? round2(Number(employment.minimumWeeklyHours))
          : null;
      const guaranteedHours =
        employment?.guaranteedWeeklyHours != null
          ? round2(Number(employment.guaranteedWeeklyHours))
          : null;

      const assignedHours = round2((assignedMinutes.get(emp.id) ?? 0) / 60);
      const hoursWorked = round2((workedMinutes.get(emp.id) ?? 0) / 60);
      const hoursOver40 = round2(Math.max(0, hoursWorked - OVERTIME_THRESHOLD_HOURS));

      const visa = resolveVisa(employment?.visaTypeId);
      const overrideActive =
        employment?.weeklyHoursCapOverride != null &&
        (employment.weeklyHoursCapOverrideExpiresAt == null ||
          employment.weeklyHoursCapOverrideExpiresAt.getTime() >= weekStart.getTime());
      const capCandidates = [
        maximumHours,
        visa?.capHours ?? null,
      ].filter((v): v is number => v != null);
      const effectiveCapHours = overrideActive
        ? round2(Number(employment!.weeklyHoursCapOverride))
        : capCandidates.length > 0
          ? Math.min(...capCandidates)
          : null;
      const hoursOverCap =
        effectiveCapHours != null ? round2(Math.max(0, hoursWorked - effectiveCapHours)) : 0;

      const utilisationPct =
        weeklyHours != null && weeklyHours > 0
          ? round2((hoursWorked / weeklyHours) * 100)
          : null;
      const remainingContractHours =
        weeklyHours != null ? round2(weeklyHours - hoursWorked) : null;
      const remainingCapHours =
        effectiveCapHours != null ? round2(effectiveCapHours - assignedHours) : null;

      const branch = employment?.baseLocation ?? employment?.location ?? null;

      pushFacet(roleFacets, employment?.role?.id, employment?.role?.name);
      pushFacet(jobTitleFacets, employment?.jobTitle?.id, employment?.jobTitle?.name);
      pushFacet(contractTypeFacets, employment?.contractType?.id, employment?.contractType?.name);
      pushFacet(locationFacets, branch?.id, branch?.name);
      pushFacet(visaFacets, visa?.id, visa?.label);

      return {
        employeeId: emp.id,
        employeeName: name,
        employeeNumber: employment?.employeeNumber ?? null,
        isActive: emp.isActive,
        roleName: employment?.role?.name ?? null,
        jobTitleName: employment?.jobTitle?.name ?? null,
        contractTypeName: employment?.contractType?.name ?? null,
        branchName: branch?.name ?? null,
        startDate: employment?.startDate ? employment.startDate.toISOString().slice(0, 10) : null,
        isBankStaff: employment?.isBankStaff ?? false,
        isAgencyStaff: employment?.isAgencyStaff ?? false,
        optedOutOf48Hours: employment?.optedOutOf48Hours ?? false,
        immigration: visa,
        capOverrideActive: overrideActive,
        effectiveCapHours,
        weeklyHours,
        maximumHours,
        minimumHours,
        guaranteedHours,
        assignedHours,
        hoursWorked,
        hoursOver40,
        hoursOverCap,
        utilisationPct,
        remainingContractHours,
        remainingCapHours,
        assignedVisits: assignedVisits.get(emp.id) ?? 0,
        workedVisits: workedVisits.get(emp.id) ?? 0,
        dayHours: (dayMinutes.get(emp.id) ?? [0, 0, 0, 0, 0, 0, 0]).map((m) => round2(m / 60)),
        hourBand: bandForHours(hoursWorked),
        visaTypeId: visa?.id ?? null,
      };
    });

    // Non-band filters first, so the band counts reflect the currently filtered population.
    let filtered = allRows;
    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(search) ||
          (r.employeeNumber?.toLowerCase().includes(search) ?? false),
      );
    }
    if (query.visaTypeId) {
      const wanted = resolveVisa(query.visaTypeId)?.id ?? query.visaTypeId;
      filtered = filtered.filter((r) => r.visaTypeId === wanted);
    }
    if (query.overContractOnly) {
      filtered = filtered.filter(
        (r) => r.weeklyHours != null && r.hoursWorked > r.weeklyHours,
      );
    }
    if (query.overCapOnly) {
      filtered = filtered.filter((r) => r.hoursOverCap > 0);
    }
    if (query.over40Only) {
      filtered = filtered.filter((r) => r.hoursOver40 > 0);
    }

    const metricValueOf = (r: (typeof allRows)[number]) =>
      bandMetric === 'assigned'
        ? r.assignedHours
        : bandMetric === 'weekly'
          ? (r.weeklyHours ?? 0)
          : r.hoursWorked;

    const bandCounts: Record<EmployeeHourBand, number> = {
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
        acc.hoursOver40 += r.hoursOver40;
        acc.hoursOverCap += r.hoursOverCap;
        acc.assignedVisits += r.assignedVisits;
        acc.workedVisits += r.workedVisits;
        if (r.weeklyHours != null) {
          acc.weeklyHoursSum += r.weeklyHours;
          acc.weeklyHoursCount += 1;
        }
        if (r.utilisationPct != null) {
          acc.utilisationSum += r.utilisationPct;
          acc.utilisationCount += 1;
        }
        if (r.weeklyHours != null && r.hoursWorked > r.weeklyHours) acc.overContractCount += 1;
        if (r.hoursOverCap > 0) acc.overCapCount += 1;
        if (r.hoursOver40 > 0) acc.over40Count += 1;
        return acc;
      },
      {
        assignedHours: 0,
        hoursWorked: 0,
        hoursOver40: 0,
        hoursOverCap: 0,
        assignedVisits: 0,
        workedVisits: 0,
        weeklyHoursSum: 0,
        weeklyHoursCount: 0,
        utilisationSum: 0,
        utilisationCount: 0,
        overContractCount: 0,
        overCapCount: 0,
        over40Count: 0,
      },
    );

    return {
      data: {
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
        organisationTimezone: timeZone,
        overtimeThresholdHours: OVERTIME_THRESHOLD_HOURS,
        bandMetric,
        hourBand: query.hourBand ?? null,
        bandCounts,
        employeeCount: rows.length,
        totals: {
          contractedHours: round2(totals.weeklyHoursSum),
          assignedHours: round2(totals.assignedHours),
          hoursWorked: round2(totals.hoursWorked),
          hoursOver40: round2(totals.hoursOver40),
          hoursOverCap: round2(totals.hoursOverCap),
          assignedVisits: totals.assignedVisits,
          workedVisits: totals.workedVisits,
          averageWeeklyHours:
            totals.weeklyHoursCount > 0
              ? round2(totals.weeklyHoursSum / totals.weeklyHoursCount)
              : null,
          averageUtilisationPct:
            totals.utilisationCount > 0
              ? round2(totals.utilisationSum / totals.utilisationCount)
              : null,
          overContractCount: totals.overContractCount,
          overCapCount: totals.overCapCount,
          over40Count: totals.over40Count,
        },
        facets: {
          roles: sortedFacet(roleFacets),
          jobTitles: sortedFacet(jobTitleFacets),
          contractTypes: sortedFacet(contractTypeFacets),
          locations: sortedFacet(locationFacets),
          visaTypes: sortedFacet(visaFacets),
        },
        rows: rows.map(({ visaTypeId: _omit, ...rest }) => rest),
      },
    };
  }

  /**
   * Monthly sponsor-compliance report (CoS hours tracker).
   * Weeks are day-of-month blocks: W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–28, W5 = 29–end.
   */
  async monthlySummary(query: EmployeeHoursMonthlyQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const m = query.month ? /^(\d{4})-(\d{2})$/.exec(query.month) : /^(\d{4})-(\d{2})/.exec(today);
    const year = m ? Number(m[1]) : Number(today.slice(0, 4));
    const month = m ? Number(m[2]) : Number(today.slice(5, 7));
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const { monthStart, monthEnd } = operationalScheduleMonthBounds(monthKey, timeZone);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthName = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 1)));

    const empWhere: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.locationId
        ? {
            employment: {
              OR: [
                { baseLocationId: query.locationId },
                { locationId: query.locationId },
              ],
            },
          }
        : {}),
    };

    const employees = await this.prisma.employee.findMany({
      where: empWhere,
      select: {
        id: true,
        isActive: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        employment: {
          select: {
            employeeNumber: true,
            payrollNumber: true,
            contractedWeeklyHours: true,
            guaranteedWeeklyHours: true,
            maximumWeeklyHours: true,
            visaTypeId: true,
            weeklyHoursCapOverride: true,
            weeklyHoursCapOverrideExpiresAt: true,
            baseLocation: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ personalDetail: { lastName: 'asc' } }, { personalDetail: { firstName: 'asc' } }],
    });

    const employeeIds = employees.map((e) => e.id);
    /** employeeId -> worked minutes per week-of-month block (5 buckets). */
    const weekMinutes = new Map<string, number[]>();
    const assignedMinutes = new Map<string, number>();

    if (employeeIds.length > 0) {
      const [reconciliations, allocations] = await Promise.all([
        this.prisma.visitReconciliation.findMany({
          where: {
            employeeId: { in: employeeIds },
            plannedStartDateTime: { gte: monthStart, lte: monthEnd },
            status: { notIn: [VisitReconciliationStatus.REJECTED_FOR_PAY] },
          },
          select: {
            employeeId: true,
            payableMinutes: true,
            plannedStartDateTime: true,
            actualStartDateTime: true,
            actualEndDateTime: true,
            approvedPayStart: true,
            approvedPayEnd: true,
          },
        }),
        this.prisma.jobAllocation.findMany({
          where: {
            deletedAt: null,
            isActive: true,
            employeeId: { in: employeeIds },
            status: { in: ACTIVE_ALLOCATION },
            scheduledJob: {
              deletedAt: null,
              scheduledStartDateTime: { gte: monthStart, lte: monthEnd },
            },
          },
          select: {
            employeeId: true,
            scheduledJob: {
              select: {
                scheduledStartDateTime: true,
                scheduledEndDateTime: true,
                estimatedDurationMinutes: true,
              },
            },
          },
        }),
      ]);

      for (const a of allocations) {
        if (!a.employeeId) continue;
        const mins = jobDurationMinutes(a.scheduledJob);
        assignedMinutes.set(a.employeeId, (assignedMinutes.get(a.employeeId) ?? 0) + mins);
      }

      for (const r of reconciliations) {
        if (!r.employeeId) continue;
        let mins = 0;
        if (r.payableMinutes != null && r.payableMinutes > 0) {
          mins = r.payableMinutes;
        } else if (r.approvedPayStart && r.approvedPayEnd) {
          mins = Math.max(
            0,
            Math.round((r.approvedPayEnd.getTime() - r.approvedPayStart.getTime()) / 60_000),
          );
        } else if (r.actualStartDateTime && r.actualEndDateTime) {
          mins = Math.max(
            0,
            Math.round(
              (r.actualEndDateTime.getTime() - r.actualStartDateTime.getTime()) / 60_000,
            ),
          );
        }
        if (mins <= 0) continue;
        const dayOfMonth = Number(dayKeyInTimeZone(r.plannedStartDateTime, timeZone).slice(8, 10));
        const weekIdx = Math.min(4, Math.floor((dayOfMonth - 1) / 7));
        const weeks = weekMinutes.get(r.employeeId) ?? [0, 0, 0, 0, 0];
        weeks[weekIdx] += mins;
        weekMinutes.set(r.employeeId, weeks);
      }
    }

    const reviews = employeeIds.length
      ? await this.prisma.employeeHoursMonthlyReview.findMany({
          where: { employeeId: { in: employeeIds }, year, month },
        })
      : [];
    const reviewByEmployee = new Map(reviews.map((r) => [r.employeeId, r]));

    const search = query.search?.trim().toLowerCase() ?? '';
    const locationFacets = new Map<string, FacetOption>();

    const allRows = employees.map((emp) => {
      const employment = emp.employment;
      const firstName = emp.personalDetail?.firstName ?? '';
      const surname = emp.personalDetail?.lastName ?? '';
      const fullName = [firstName, surname].filter(Boolean).join(' ').trim() || 'Unknown';
      const workerId =
        employment?.employeeNumber ?? employment?.payrollNumber ?? emp.id.slice(0, 8);

      const cosWeeklyHours =
        employment?.contractedWeeklyHours != null
          ? round2(Number(employment.contractedWeeklyHours))
          : employment?.guaranteedWeeklyHours != null
            ? round2(Number(employment.guaranteedWeeklyHours))
            : null;

      const visa = resolveVisa(employment?.visaTypeId);
      const sponsored = visa != null && SPONSORED_VISA_IDS.has(visa.id);
      const overrideActive =
        employment?.weeklyHoursCapOverride != null &&
        (employment.weeklyHoursCapOverrideExpiresAt == null ||
          employment.weeklyHoursCapOverrideExpiresAt.getTime() >= monthStart.getTime());
      const capCandidates = [
        employment?.maximumWeeklyHours != null ? Number(employment.maximumWeeklyHours) : null,
        visa?.capHours ?? null,
      ].filter((v): v is number => v != null);
      const effectiveCapHours = overrideActive
        ? round2(Number(employment!.weeklyHoursCapOverride))
        : capCandidates.length > 0
          ? Math.min(...capCandidates)
          : null;

      const weeks = (weekMinutes.get(emp.id) ?? [0, 0, 0, 0, 0]).map((mins) =>
        round2(mins / 60),
      );
      const totalMonthlyHours = round2(weeks.reduce((a, b) => a + b, 0));
      const assignedHours = round2((assignedMinutes.get(emp.id) ?? 0) / 60);
      const monthWeeks = daysInMonth / 7;
      const expectedContractHours =
        cosWeeklyHours != null ? round2(cosWeeklyHours * monthWeeks) : null;
      const expectedCapHours =
        effectiveCapHours != null ? round2(effectiveCapHours * monthWeeks) : null;
      const overAssignedVsContract =
        expectedContractHours != null
          ? round2(Math.max(0, assignedHours - expectedContractHours))
          : 0;
      const overAssignedVsCap =
        expectedCapHours != null ? round2(Math.max(0, assignedHours - expectedCapHours)) : 0;
      const overAssignedHours = Math.max(overAssignedVsContract, overAssignedVsCap);

      const anyWeekOverCap =
        effectiveCapHours != null && weeks.some((h) => h > effectiveCapHours);
      // Under-hours check: only fully elapsed 7-day blocks (W1–W4); W5 is a partial block.
      const nowMs = Date.now();
      const anyElapsedWeekUnderCos =
        cosWeeklyHours != null &&
        weeks.slice(0, 4).some((h, i) => {
          const blockEnd = Date.UTC(year, month - 1, (i + 1) * 7, 23, 59, 59);
          return blockEnd < nowMs && h < cosWeeklyHours * SMS_UNDER_HOURS_RATIO;
        });

      const review = reviewByEmployee.get(emp.id) ?? null;
      const derivedSms = sponsored && (anyWeekOverCap || anyElapsedWeekUnderCos);
      const smsReportingRequired = review?.smsReportingRequired ?? derivedSms;

      const derivedStatus: EmployeeComplianceStatus = anyWeekOverCap
        ? 'breach'
        : smsReportingRequired
          ? 'action_required'
          : 'compliant';
      const complianceStatus =
        (review?.complianceStatusOverride as EmployeeComplianceStatus | null) ?? derivedStatus;

      // baseLocation is the employee's primary branch; location is the legacy fallback.
      const branch = employment?.baseLocation ?? employment?.location ?? null;
      pushFacet(locationFacets, branch?.id, branch?.name);

      return {
        recordId: `EH-${year}${String(month).padStart(2, '0')}-${String(workerId).toUpperCase()}`,
        month: monthName,
        monthKey,
        year,
        employeeId: emp.id,
        workerId,
        firstName,
        surname,
        fullName,
        isActive: emp.isActive,
        sponsored,
        immigration: visa,
        cosWeeklyHours,
        effectiveCapHours,
        weekHours: weeks,
        totalMonthlyHours,
        assignedHours,
        overAssignedHours,
        smsReportingRequired,
        smsOverridden: review?.smsReportingRequired != null,
        reviewCompleted: review?.reviewCompleted ?? false,
        complianceStatus,
        complianceOverridden: review?.complianceStatusOverride != null,
        comments: review?.comments ?? null,
        branchName: branch?.name ?? null,
      };
    });

    let rows = allRows;
    if (search) {
      rows = rows.filter(
        (r) =>
          r.fullName.toLowerCase().includes(search) ||
          String(r.workerId).toLowerCase().includes(search) ||
          r.recordId.toLowerCase().includes(search),
      );
    }
    if (query.sponsoredOnly) rows = rows.filter((r) => r.sponsored);
    if (query.smsOnly) rows = rows.filter((r) => r.smsReportingRequired);
    if (query.complianceStatus) {
      rows = rows.filter((r) => r.complianceStatus === query.complianceStatus);
    }
    if (query.reviewFilter === 'completed') rows = rows.filter((r) => r.reviewCompleted);
    if (query.reviewFilter === 'pending') rows = rows.filter((r) => !r.reviewCompleted);

    const totals = rows.reduce(
      (acc, r) => {
        acc.totalMonthlyHours += r.totalMonthlyHours;
        acc.assignedHours += r.assignedHours;
        acc.overAssignedHours += r.overAssignedHours;
        if (r.overAssignedHours > 0) acc.overAssignedCount += 1;
        if (r.smsReportingRequired) acc.smsRequiredCount += 1;
        if (r.reviewCompleted) acc.reviewsCompletedCount += 1;
        if (r.sponsored) acc.sponsoredCount += 1;
        acc.statusCounts[r.complianceStatus] += 1;
        return acc;
      },
      {
        totalMonthlyHours: 0,
        assignedHours: 0,
        overAssignedHours: 0,
        overAssignedCount: 0,
        smsRequiredCount: 0,
        reviewsCompletedCount: 0,
        sponsoredCount: 0,
        statusCounts: { compliant: 0, action_required: 0, breach: 0 } as Record<
          EmployeeComplianceStatus,
          number
        >,
      },
    );

    return {
      data: {
        month: monthKey,
        monthName,
        year,
        daysInMonth,
        organisationTimezone: timeZone,
        smsUnderHoursRatio: SMS_UNDER_HOURS_RATIO,
        employeeCount: rows.length,
        totals: {
          totalMonthlyHours: round2(totals.totalMonthlyHours),
          assignedHours: round2(totals.assignedHours),
          overAssignedHours: round2(totals.overAssignedHours),
          overAssignedCount: totals.overAssignedCount,
          smsRequiredCount: totals.smsRequiredCount,
          reviewsCompletedCount: totals.reviewsCompletedCount,
          reviewsPendingCount: rows.length - totals.reviewsCompletedCount,
          sponsoredCount: totals.sponsoredCount,
          statusCounts: totals.statusCounts,
        },
        facets: { locations: sortedFacet(locationFacets) },
        rows,
      },
    };
  }

  /**
   * Monthly detail for one employee — calendar week blocks within the month
   * (1–7, 8–14, 15–21, 22–28, 29–end), with contracted / assigned / worked hours.
   */
  async monthlyDetail(query: EmployeeHoursMonthlyDetailQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const m = query.month ? /^(\d{4})-(\d{2})$/.exec(query.month) : /^(\d{4})-(\d{2})/.exec(today);
    const year = m ? Number(m[1]) : Number(today.slice(0, 4));
    const month = m ? Number(m[2]) : Number(today.slice(5, 7));
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const { monthStart, monthEnd } = operationalScheduleMonthBounds(monthKey, timeZone);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthName = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 1)));

    const emp = await this.prisma.employee.findFirst({
      where: { id: query.employeeId, deletedAt: null },
      select: {
        id: true,
        isActive: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        employment: {
          select: {
            employeeNumber: true,
            contractedWeeklyHours: true,
            maximumWeeklyHours: true,
            visaTypeId: true,
            weeklyHoursCapOverride: true,
            weeklyHoursCapOverrideExpiresAt: true,
            role: { select: { id: true, name: true } },
            jobTitle: { select: { id: true, name: true } },
            baseLocation: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!emp) {
      throw new NotFoundException('Employee not found');
    }

    const employment = emp.employment;
    const displayName =
      [emp.personalDetail?.firstName, emp.personalDetail?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Unknown';
    const weeklyHours =
      employment?.contractedWeeklyHours != null
        ? round2(Number(employment.contractedWeeklyHours))
        : null;
    const visa = resolveVisa(employment?.visaTypeId);
    const overrideActive =
      employment?.weeklyHoursCapOverride != null &&
      (employment.weeklyHoursCapOverrideExpiresAt == null ||
        employment.weeklyHoursCapOverrideExpiresAt.getTime() >= monthStart.getTime());
    const effectiveCapHours = overrideActive
      ? round2(Number(employment!.weeklyHoursCapOverride))
      : (visa?.capHours ?? null);
    const branch = employment?.baseLocation ?? employment?.location ?? null;
    const weeksMeta = calendarMonthWeekBlocks(year, month, timeZone);

    const [allocations, reconciliations] = await Promise.all([
      this.prisma.jobAllocation.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          employeeId: emp.id,
          scheduledJob: {
            deletedAt: null,
            scheduledStartDateTime: { gte: monthStart, lte: monthEnd },
          },
        },
        select: {
          scheduledJob: {
            select: {
              scheduledStartDateTime: true,
              scheduledEndDateTime: true,
              estimatedDurationMinutes: true,
            },
          },
        },
      }),
      this.prisma.visitReconciliation.findMany({
        where: {
          employeeId: emp.id,
          plannedStartDateTime: { gte: monthStart, lte: monthEnd },
          status: { notIn: [VisitReconciliationStatus.REJECTED_FOR_PAY] },
        },
        select: {
          payableMinutes: true,
          plannedStartDateTime: true,
          actualStartDateTime: true,
          actualEndDateTime: true,
          approvedPayStart: true,
          approvedPayEnd: true,
        },
      }),
    ]);

    const weeks = weeksMeta.map((week) => {
      let assignedMins = 0;
      let assignedVisits = 0;
      for (const a of allocations) {
        const t = a.scheduledJob.scheduledStartDateTime.getTime();
        if (t >= week.weekStart.getTime() && t <= week.weekEnd.getTime()) {
          assignedMins += jobDurationMinutes(a.scheduledJob);
          assignedVisits += 1;
        }
      }

      const dayMins = week.dayLabels.map(() => 0);
      let workedMins = 0;
      let workedVisits = 0;
      for (const r of reconciliations) {
        const t = r.plannedStartDateTime.getTime();
        if (t < week.weekStart.getTime() || t > week.weekEnd.getTime()) continue;
        const mins = reconciliationPayableMinutes(r);
        if (mins <= 0) continue;
        workedMins += mins;
        workedVisits += 1;
        const dayOfMonth = Number(dayKeyInTimeZone(r.plannedStartDateTime, timeZone).slice(8, 10));
        const dayIdx = dayOfMonth - week.dayFrom;
        if (dayIdx >= 0 && dayIdx < dayMins.length) {
          dayMins[dayIdx] += mins;
        }
      }

      const assignedHours = round2(assignedMins / 60);
      const hoursWorked = round2(workedMins / 60);
      const hoursOverContract =
        weeklyHours != null ? round2(Math.max(0, hoursWorked - weeklyHours)) : 0;
      const hoursOverCap =
        effectiveCapHours != null ? round2(Math.max(0, hoursWorked - effectiveCapHours)) : 0;
      const hoursOverAssigned =
        weeklyHours != null ? round2(Math.max(0, assignedHours - weeklyHours)) : 0;
      const utilisationPct =
        weeklyHours != null && weeklyHours > 0
          ? round2((hoursWorked / weeklyHours) * 100)
          : null;
      const assignedUtilisationPct =
        weeklyHours != null && weeklyHours > 0
          ? round2((assignedHours / weeklyHours) * 100)
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
        partialMonth: false,
        weeklyHours,
        effectiveCapHours,
        assignedHours,
        hoursWorked,
        hoursOverContract,
        hoursOverCap,
        hoursOverAssigned,
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
        acc.hoursOverContract += w.hoursOverContract;
        acc.hoursOverCap += w.hoursOverCap;
        acc.hoursOverAssigned += w.hoursOverAssigned;
        acc.assignedVisits += w.assignedVisits;
        acc.workedVisits += w.workedVisits;
        if (w.hoursOverContract > 0) acc.overContractWeekCount += 1;
        if (w.hoursOverCap > 0) acc.overCapWeekCount += 1;
        if (w.hoursOverAssigned > 0) acc.overAssignedWeekCount += 1;
        return acc;
      },
      {
        assignedHours: 0,
        hoursWorked: 0,
        hoursOverContract: 0,
        hoursOverCap: 0,
        hoursOverAssigned: 0,
        assignedVisits: 0,
        workedVisits: 0,
        overContractWeekCount: 0,
        overCapWeekCount: 0,
        overAssignedWeekCount: 0,
      },
    );

    const expectedContractHours =
      weeklyHours != null ? round2(weeklyHours * (daysInMonth / 7)) : null;

    return {
      data: {
        month: monthKey,
        monthName,
        year,
        daysInMonth,
        organisationTimezone: timeZone,
        weekScheme: '1–7 · 8–14 · 15–21 · 22–28 · 29+',
        employee: {
          employeeId: emp.id,
          employeeName: displayName,
          employeeNumber: employment?.employeeNumber ?? null,
          isActive: emp.isActive,
          branchName: branch?.name ?? null,
          roleName: employment?.role?.name ?? null,
          jobTitleName: employment?.jobTitle?.name ?? null,
        },
        weeklyHours,
        effectiveCapHours,
        immigration: visa,
        expectedContractHours,
        totals: {
          assignedHours: round2(monthTotals.assignedHours),
          hoursWorked: round2(monthTotals.hoursWorked),
          hoursOverContract: round2(monthTotals.hoursOverContract),
          hoursOverCap: round2(monthTotals.hoursOverCap),
          hoursOverAssigned: round2(monthTotals.hoursOverAssigned),
          assignedVisits: monthTotals.assignedVisits,
          workedVisits: monthTotals.workedVisits,
          overContractWeekCount: monthTotals.overContractWeekCount,
          overCapWeekCount: monthTotals.overCapWeekCount,
          overAssignedWeekCount: monthTotals.overAssignedWeekCount,
          weekCount: weeks.length,
        },
        weeks,
      },
    };
  }

  async upsertMonthlyReview(userId: string, dto: UpsertEmployeeHoursMonthlyReviewDto) {
    const [y, m] = dto.month.split('-').map(Number);
    const data: Prisma.EmployeeHoursMonthlyReviewUncheckedUpdateInput = {
      updatedById: userId,
    };
    if (dto.reviewCompleted !== undefined) data.reviewCompleted = dto.reviewCompleted;
    if (dto.smsReportingRequired !== undefined) {
      data.smsReportingRequired = dto.smsReportingRequired;
    }
    if (dto.complianceStatusOverride !== undefined) {
      data.complianceStatusOverride = dto.complianceStatusOverride;
    }
    if (dto.comments !== undefined) data.comments = dto.comments?.trim() || null;

    const review = await this.prisma.employeeHoursMonthlyReview.upsert({
      where: {
        employeeId_year_month: { employeeId: dto.employeeId, year: y!, month: m! },
      },
      create: {
        employeeId: dto.employeeId,
        year: y!,
        month: m!,
        reviewCompleted: dto.reviewCompleted ?? false,
        smsReportingRequired: dto.smsReportingRequired ?? null,
        complianceStatusOverride: dto.complianceStatusOverride ?? null,
        comments: dto.comments?.trim() || null,
        updatedById: userId,
      },
      update: data,
    });
    return { data: review };
  }
}
