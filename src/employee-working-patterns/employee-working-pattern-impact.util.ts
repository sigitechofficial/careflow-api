import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  employmentToCycleConfig,
  parseIsoDateOnly,
  type WorkingPatternCycleConfig,
} from './working-pattern-cycle.util';
import type { BulkReplaceWorkingPatternsDto } from './dto/bulk-replace-working-patterns.dto';
import {
  collectCarerPatternConflicts,
  type EmployeePatternContext,
  type SlotCarerPatternInput,
} from '../service-user-visit-plans/visit-plan-carer-job-fit.util';

export type EmployeeWorkingPatternVisitSlotImpact = {
  serviceUserId: string;
  serviceUserName: string;
  slotCode: string;
  slotLabel: string;
  unavailableDayLabels: string[];
  timeOutsidePattern: boolean;
  timeMismatchMessages: string[];
  summary: string;
};

type SlotMeta = {
  serviceUserId: string;
  serviceUserName: string;
  slotCode: string;
  slotLabel: string;
};

function serviceUserDisplayName(user?: {
  firstName?: string | null;
  lastName?: string | null;
} | null): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return name || 'Service user';
}

export function patternContextFromBulkDto(
  employee: {
    id: string;
    createdAt: Date;
    personalDetail?: { firstName?: string | null; lastName?: string | null } | null;
    employment?: {
      workingPatternCycleWeeks?: number | null;
      workingPatternCycleAnchorDate?: Date | null;
      startDate?: Date | null;
    } | null;
  },
  dto: BulkReplaceWorkingPatternsDto,
): EmployeePatternContext {
  const cycleWeeks = dto.cycleWeeks === 2 ? 2 : 1;
  const anchorFromDto = dto.cycleAnchorDate ? parseIsoDateOnly(dto.cycleAnchorDate) : null;
  const baseConfig = employmentToCycleConfig(employee.employment, employee.createdAt);
  const cycleConfig: WorkingPatternCycleConfig = {
    ...baseConfig,
    workingPatternCycleWeeks: cycleWeeks,
    workingPatternCycleAnchorDate: anchorFromDto ?? baseConfig.workingPatternCycleAnchorDate,
  };

  return {
    employeeId: employee.id,
    employeeName: serviceUserDisplayName(employee.personalDetail),
    patterns: dto.weeks.map((row) => ({
      weekInCycle: row.weekInCycle,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
      isAvailable: row.isAvailable !== false,
      notes: row.notes ?? null,
    })),
    cycleConfig,
  };
}

function buildSlotInputsFromAssignments(
  assignments: Array<{
    employeeId: string;
    dayOfWeek: number | null;
    plannedStartTime: string | null;
    plannedEndTime: string | null;
    visitPlanSlot: {
      id: string;
      slotCode: string;
      daysOfWeek: number[];
      plannedStartTime: string;
      plannedEndTime: string;
      isEnabled: boolean;
      medicationRoundCode: string | null;
      visitPlan: {
        serviceUser: {
          id: string;
          firstName: string;
          lastName: string;
        };
      };
    };
  }>,
  employeeId: string,
): { inputs: SlotCarerPatternInput[]; metaBySlotId: Map<string, SlotMeta> } {
  const bySlotId = new Map<
    string,
    {
      slot: (typeof assignments)[number]['visitPlanSlot'];
      carerAssignments: SlotCarerPatternInput['carerAssignments'];
    }
  >();

  for (const assignment of assignments) {
    const slot = assignment.visitPlanSlot;
    let entry = bySlotId.get(slot.id);
    if (!entry) {
      entry = { slot, carerAssignments: [] };
      bySlotId.set(slot.id, entry);
    }
    entry.carerAssignments!.push({
      employeeId: assignment.employeeId,
      dayOfWeek: assignment.dayOfWeek,
      plannedStartTime: assignment.plannedStartTime,
      plannedEndTime: assignment.plannedEndTime,
    });
  }

  const metaBySlotId = new Map<string, SlotMeta>();
  const inputs: SlotCarerPatternInput[] = [];

  for (const { slot, carerAssignments } of bySlotId.values()) {
    const slotLabel = slot.medicationRoundCode ?? slot.slotCode;
    metaBySlotId.set(slot.id, {
      serviceUserId: slot.visitPlan.serviceUser.id,
      serviceUserName: serviceUserDisplayName(slot.visitPlan.serviceUser),
      slotCode: slot.slotCode,
      slotLabel,
    });
    inputs.push({
      slotCode: slot.id,
      slotLabel,
      daysOfWeek: slot.daysOfWeek,
      plannedStartTime: slot.plannedStartTime,
      plannedEndTime: slot.plannedEndTime,
      isEnabled: slot.isEnabled,
      assignedEmployeeIds: [],
      carerAssignments: carerAssignments?.filter((row) => row.employeeId === employeeId),
    });
  }

  return { inputs, metaBySlotId };
}

export async function previewEmployeeWorkingPatternVisitSlotImpacts(
  prisma: PrismaService,
  employeeId: string,
  dto: BulkReplaceWorkingPatternsDto,
): Promise<EmployeeWorkingPatternVisitSlotImpact[]> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: {
      personalDetail: true,
      employment: true,
    },
  });
  if (!employee) throw new NotFoundException('Employee not found');

  const assignments = await prisma.visitPlanSlotCarerAssignment.findMany({
    where: {
      employeeId,
      visitPlanSlot: {
        isEnabled: true,
        visitPlan: {
          status: 'ACTIVE',
          serviceUser: { deletedAt: null },
        },
      },
    },
    include: {
      visitPlanSlot: {
        include: {
          visitPlan: {
            include: {
              serviceUser: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!assignments.length) return [];

  const { inputs, metaBySlotId } = buildSlotInputsFromAssignments(assignments, employeeId);
  const proposedContext = patternContextFromBulkDto(employee, dto);
  const conflicts = collectCarerPatternConflicts(inputs, [proposedContext]);

  return conflicts.map((conflict) => {
    const meta = metaBySlotId.get(conflict.slotCode);
    return {
      serviceUserId: meta?.serviceUserId ?? '',
      serviceUserName: meta?.serviceUserName ?? 'Service user',
      slotCode: meta?.slotCode ?? conflict.slotCode,
      slotLabel: meta?.slotLabel ?? conflict.slotLabel,
      unavailableDayLabels: conflict.unavailableDayLabels,
      timeOutsidePattern: conflict.timeOutsidePattern,
      timeMismatchMessages: conflict.timeMismatchMessages,
      summary: conflict.summary,
    };
  });
}
