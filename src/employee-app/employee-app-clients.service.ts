import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AllocationStatus,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  ScheduledJobStatus,
  VisitPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatScheduleDate } from '../schedules/schedules-date.util';
import { utcDayBounds } from '../scheduling/schedule-date-range.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.DRAFT,
];

type TagTone = 'danger' | 'warning' | 'primary' | 'success' | 'neutral';
type ClientTag = { id: string; label: string; tone: TagTone };

@Injectable()
export class EmployeeAppClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async getClients(employeeId: string, opts: { search?: string } = {}) {
    const serviceUserIds = await this.resolveRoundClientIds(employeeId);
    const search = opts.search?.trim() ?? '';

    if (serviceUserIds.length === 0) {
      return {
        data: {
          totalCount: 0,
          totalCountLabel: '0 people on your round',
          search: search || null,
          clients: [],
        },
      };
    }

    const users = await this.prisma.serviceUser.findMany({
      where: {
        id: { in: serviceUserIds },
        deletedAt: null,
        isActive: true,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
                { preferredName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        careType: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const ids = users.map((u) => u.id);

    const [allergies, openRisks, visitPlans, eolAssessments] = await Promise.all([
      this.prisma.serviceUserAllergy.findMany({
        where: { serviceUserId: { in: ids }, deletedAt: null, isActive: true },
        select: { serviceUserId: true, allergyName: true },
        orderBy: { allergyName: 'asc' },
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: {
          serviceUserId: { in: ids },
          status: InitialAssessmentRiskStatus.OPEN,
          riskType: {
            in: [
              InitialAssessmentRiskType.FALLS,
              InitialAssessmentRiskType.SKIN_INTEGRITY,
              InitialAssessmentRiskType.HYDRATION,
              InitialAssessmentRiskType.MOVING_HANDLING,
            ],
          },
        },
        select: { serviceUserId: true, riskType: true, riskLevel: true },
      }),
      this.prisma.serviceUserVisitPlan.findMany({
        where: {
          serviceUserId: { in: ids },
          status: VisitPlanStatus.ACTIVE,
          deletedAt: null,
          isActive: true,
        },
        select: {
          serviceUserId: true,
          slots: {
            where: { isEnabled: true },
            select: {
              daysOfWeek: true,
              scheduleFrequency: true,
              isEnabled: true,
            },
          },
        },
      }),
      this.prisma.serviceUserAssessment.findMany({
        where: {
          serviceUserId: { in: ids },
          assessmentKey: 'end-of-life-assessment',
        },
        select: { serviceUserId: true, id: true },
      }),
    ]);

    const allergiesBySu = groupAllergyNames(allergies);
    const risksBySu = groupRisks(openRisks);
    const visitsPerDayBySu = new Map<string, number>();
    for (const plan of visitPlans) {
      const current = visitsPerDayBySu.get(plan.serviceUserId) ?? 0;
      visitsPerDayBySu.set(plan.serviceUserId, Math.max(current, estimateVisitsPerDay(plan.slots)));
    }
    const eolSet = new Set(eolAssessments.map((a) => a.serviceUserId));

    const clients = users.map((su) => {
      const fullName = [su.firstName, su.lastName].filter(Boolean).join(' ').trim() || 'Service user';
      const initials = initialsFromName(su.firstName, su.lastName);
      const age = ageFromDob(su.dateOfBirth);
      const careTypeName = su.careType?.name?.trim() || 'Care';
      const visitsPerDay = visitsPerDayBySu.get(su.id) ?? 0;
      const allergyNames = allergiesBySu.get(su.id) ?? [];
      const riskTypes = risksBySu.get(su.id) ?? new Set<InitialAssessmentRiskType>();
      const isPalliative = /palliative/i.test(careTypeName) || /palliative/i.test(su.careType?.code ?? '');
      const tags = buildClientTags({
        allergyNames,
        riskTypes,
        endOfLife: eolSet.has(su.id) || isPalliative,
      });

      const summaryParts = [
        age != null ? `${age} yrs` : null,
        careTypeName,
      ].filter(Boolean);
      const summaryBase = summaryParts.join(' · ');
      const summary =
        visitsPerDay > 0
          ? `${summaryBase} — ${visitsPerDay} visit${visitsPerDay === 1 ? '' : 's'}/day`
          : summaryBase;

      return {
        clientId: su.id,
        firstName: su.firstName,
        lastName: su.lastName,
        preferredName: su.preferredName,
        fullName,
        initials,
        age,
        careType: {
          id: su.careType?.id ?? null,
          name: careTypeName,
          code: su.careType?.code ?? null,
        },
        visitsPerDay,
        summary,
        tags,
      };
    });

    const totalCount = clients.length;
    return {
      data: {
        totalCount,
        totalCountLabel:
          totalCount === 1 ? '1 person on your round' : `${totalCount} people on your round`,
        search: search || null,
        clients,
      },
    };
  }

  /** Standing visit-plan roster + clients scheduled in the next 14 days. */
  async resolveRoundClientIds(employeeId: string): Promise<string[]> {
    const today = formatScheduleDate(new Date());
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 14);
    const horizonStr = formatScheduleDate(horizon);
    const { start } = utcDayBounds(today);
    const { end } = utcDayBounds(horizonStr);

    const [assignments, legacySlots, allocations] = await Promise.all([
      this.prisma.visitPlanSlotCarerAssignment.findMany({
        where: { employeeId },
        select: {
          visitPlanSlot: {
            select: {
              isEnabled: true,
              visitPlan: {
                select: {
                  serviceUserId: true,
                  status: true,
                  deletedAt: true,
                  isActive: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.visitPlanSlot.findMany({
        where: {
          isEnabled: true,
          assignedEmployeeIds: { has: employeeId },
          visitPlan: {
            status: VisitPlanStatus.ACTIVE,
            deletedAt: null,
            isActive: true,
          },
        },
        select: { visitPlan: { select: { serviceUserId: true } } },
      }),
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: start, lte: end },
            status: { notIn: EXCLUDED_JOB_STATUSES },
          },
        },
        select: { scheduledJob: { select: { serviceUserId: true } } },
      }),
    ]);

    const ids = new Set<string>();
    for (const row of assignments) {
      const plan = row.visitPlanSlot.visitPlan;
      if (
        plan.deletedAt ||
        !plan.isActive ||
        plan.status !== VisitPlanStatus.ACTIVE ||
        !row.visitPlanSlot.isEnabled
      ) {
        continue;
      }
      ids.add(plan.serviceUserId);
    }
    for (const slot of legacySlots) ids.add(slot.visitPlan.serviceUserId);
    for (const a of allocations) ids.add(a.scheduledJob.serviceUserId);
    return [...ids];
  }

  async assertClientOnRound(employeeId: string, clientId: string): Promise<void> {
    const ids = await this.resolveRoundClientIds(employeeId);
    if (!ids.includes(clientId)) {
      throw new ForbiddenException('Client is not on your round');
    }
  }
}

function groupAllergyNames(
  rows: Array<{ serviceUserId: string; allergyName: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const name = row.allergyName.trim();
    if (!name) continue;
    const list = map.get(row.serviceUserId) ?? [];
    if (!list.includes(name)) list.push(name);
    map.set(row.serviceUserId, list);
  }
  return map;
}

function groupRisks(
  rows: Array<{ serviceUserId: string; riskType: InitialAssessmentRiskType }>,
): Map<string, Set<InitialAssessmentRiskType>> {
  const map = new Map<string, Set<InitialAssessmentRiskType>>();
  for (const row of rows) {
    const set = map.get(row.serviceUserId) ?? new Set();
    set.add(row.riskType);
    map.set(row.serviceUserId, set);
  }
  return map;
}

function buildClientTags(input: {
  allergyNames: string[];
  riskTypes: Set<InitialAssessmentRiskType>;
  endOfLife: boolean;
}): ClientTag[] {
  const tags: ClientTag[] = [];

  if (input.allergyNames.length > 0) {
    tags.push({
      id: 'allergies',
      label: input.allergyNames.join(', '),
      tone: 'danger',
    });
  }

  if (input.riskTypes.has(InitialAssessmentRiskType.HYDRATION)) {
    tags.push({ id: 'dehydration_risk', label: 'Dehydration risk', tone: 'warning' });
  }
  if (input.riskTypes.has(InitialAssessmentRiskType.FALLS)) {
    tags.push({ id: 'falls_risk', label: 'Falls risk', tone: 'warning' });
  }
  if (input.riskTypes.has(InitialAssessmentRiskType.MOVING_HANDLING)) {
    tags.push({
      id: 'moving_handling',
      label: 'Moving & handling — high risk',
      tone: 'warning',
    });
  }
  if (input.riskTypes.has(InitialAssessmentRiskType.SKIN_INTEGRITY)) {
    tags.push({ id: 'pressure_ulcer_risk', label: 'Pressure ulcer risk', tone: 'warning' });
  }
  if (input.endOfLife) {
    tags.push({ id: 'end_of_life', label: 'End of life', tone: 'warning' });
  }

  return tags;
}

function estimateVisitsPerDay(
  slots: Array<{ daysOfWeek: number[]; scheduleFrequency: string; isEnabled: boolean }>,
): number {
  const enabled = slots.filter((s) => s.isEnabled);
  if (enabled.length === 0) return 0;

  let max = 0;
  for (let dow = 0; dow <= 6; dow++) {
    const count = enabled.filter((s) => {
      if (s.scheduleFrequency === 'DAILY' && (!s.daysOfWeek || s.daysOfWeek.length === 0)) {
        return true;
      }
      return (s.daysOfWeek ?? []).includes(dow);
    }).length;
    max = Math.max(max, count);
  }
  return max;
}

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function initialsFromName(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '?';
}
