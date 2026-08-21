import type { Prisma } from '@prisma/client';
import { slotLabel } from '../service-user-visit-plans/visit-plan-slot-defaults';

export const PORTAL_VISIT_PLAN_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function formatPortalVisitPlanWeekdays(daysOfWeek: number[]): string {
  if (!daysOfWeek.length) return '—';
  return daysOfWeek.map(d => PORTAL_VISIT_PLAN_DAY_LABELS[d] ?? String(d)).join(', ');
}

export function formatPortalVisitPlanTimeRange(start: string, end: string): string {
  return `${start} – ${end}`;
}

export const portalVisitPlanInclude = {
  slots: {
    where: { isEnabled: true },
    orderBy: { sortOrder: 'asc' as const },
    include: {
      carerAssignments: { orderBy: [{ sortOrder: 'asc' as const }, { role: 'asc' as const }] },
    },
  },
  pauseReasonCatalog: { select: { id: true, name: true, code: true } },
} satisfies Prisma.ServiceUserVisitPlanInclude;

export type PortalVisitPlanRow = Prisma.ServiceUserVisitPlanGetPayload<{
  include: typeof portalVisitPlanInclude;
}>;

export type PortalVisitPlanSlot = {
  id: string;
  label: string;
  daysOfWeek: number[];
  daysLabel: string;
  plannedStartTime: string;
  plannedEndTime: string;
  durationMinutes: number | null;
  requiredCarers: number;
  scheduleFrequency: string;
  slotKind: string;
  nightDuty: string;
  notes: string;
  carers: Array<{
    displayName: string;
    role: string;
    dayLabel: string | null;
  }>;
};

export type PortalVisitPlan = {
  id: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  weeklyContractedHours: string | null;
  numberOfCarers: number;
  notes: string;
  reviewDueAt: string | null;
  suspendedAt: string | null;
  pauseReason: { id: string; name: string } | null;
  expectedResumeAt: string | null;
  slots: PortalVisitPlanSlot[];
};

export function mapPortalVisitPlan(
  row: PortalVisitPlanRow,
  roundNameByCode: Map<string, string>,
  employeeNameById: Map<string, string>,
): PortalVisitPlan {
  return {
    id: row.id,
    status: row.status,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    weeklyContractedHours: row.weeklyContractedHours,
    numberOfCarers: row.numberOfCarers,
    notes: row.notes ?? '',
    reviewDueAt: row.reviewDueAt?.toISOString() ?? null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    pauseReason: row.pauseReasonCatalog
      ? { id: row.pauseReasonCatalog.id, name: row.pauseReasonCatalog.name }
      : null,
    expectedResumeAt: row.expectedResumeAt?.toISOString() ?? null,
    slots: (row.slots ?? []).map(slot => {
      const assignmentCarers = (slot.carerAssignments ?? []).map(a => ({
        displayName: employeeNameById.get(a.employeeId) ?? 'Carer',
        role: a.role,
        dayLabel: a.dayOfWeek == null ? null : PORTAL_VISIT_PLAN_DAY_LABELS[a.dayOfWeek] ?? null,
      }));
      const fallbackCarers = (slot.assignedEmployeeIds ?? [])
        .filter(id => !slot.carerAssignments?.some(a => a.employeeId === id))
        .map(id => ({
          displayName: employeeNameById.get(id) ?? 'Carer',
          role: 'ASSIGNED',
          dayLabel: null as string | null,
        }));

      return {
        id: slot.id,
        label: slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode),
        daysOfWeek: slot.daysOfWeek,
        daysLabel: formatPortalVisitPlanWeekdays(slot.daysOfWeek),
        plannedStartTime: slot.plannedStartTime,
        plannedEndTime: slot.plannedEndTime,
        durationMinutes: slot.durationMinutes,
        requiredCarers: slot.requiredCarers,
        scheduleFrequency: slot.scheduleFrequency,
        slotKind: slot.slotKind,
        nightDuty: slot.nightDuty,
        notes: slot.notes ?? '',
        carers: [...assignmentCarers, ...fallbackCarers],
      };
    }),
  };
}

export function collectVisitPlanEmployeeIds(rows: PortalVisitPlanRow[]): string[] {
  const ids = new Set<string>();
  for (const plan of rows) {
    for (const slot of plan.slots ?? []) {
      for (const id of slot.assignedEmployeeIds ?? []) ids.add(id);
      for (const a of slot.carerAssignments ?? []) ids.add(a.employeeId);
    }
  }
  return [...ids];
}
