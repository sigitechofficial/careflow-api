import { AllocationStatus, Prisma } from '@prisma/client';
import {
  PARENTAL_LEAVE_TYPES,
  ROTA_BLOCKING_LEAVE_TYPES,
} from '../employee-absences/dto/employee-absence.dto';
import {
  allocationRuleBehavior,
  type DomCareAllocationRule,
} from '../organisation-general-settings/dom-care-allocation-rules.util';
import { matchEmployeeSkills, requiredSkillKeywords } from '../service-user-visit-plans/visit-plan-carer-suggest.util';
import { CARER_ROTA_CONFLICT_MESSAGE } from '../service-user-visit-plans/visit-carer-rota-conflict.util';
import { resolveAllocationWindow } from './allocation-window.util';

/**
 * Settings-driven allocation rules (Settings → Allocation rules) evaluated for a
 * batch of carers against one visit window. ALWAYS_ALLOW rules are not checked.
 * `block` = DONT_ALLOW: the carer must not be assigned (hidden from pickers,
 * hard-blocked on allocate, left off generated visits).
 */
export type AllocationRuleKey =
  | 'carer_on_holiday'
  | 'carer_on_nca'
  | 'carer_on_leave'
  | 'allow_overlap'
  | 'time_between_jobs'
  | 'medication_not_trained'
  | 'missing_client_skills'
  /** Evaluated by callers from their own working-pattern logic. */
  | 'job_outside_working_pattern';

export type AllocationRuleHit = { key: AllocationRuleKey; message: string; block: boolean };

const ACTIVE_ALLOCATION_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const MEDICATION_SKILL_KEYWORDS = ['medication', 'medicine'];

type RuleDb = Pick<
  Prisma.TransactionClient,
  | 'employeeHoliday'
  | 'employeeNonCoreActivity'
  | 'employeeAbsenceRecord'
  | 'jobAllocation'
  | 'employeeSkill'
>;

export type AllocationRuleHitsParams = {
  employeeIds: string[];
  jobStart: Date;
  jobEnd: Date;
  rules: DomCareAllocationRule[];
  /** Ignore allocations on this job (the visit being staffed). */
  excludeScheduledJobId?: string;
  medicationRequired?: boolean;
  /** Skill keywords the client's care plan needs (see requiredSkillKeywords). */
  skillKeywords?: string[];
};

export async function evaluateAllocationRuleHits(
  db: RuleDb,
  params: AllocationRuleHitsParams,
): Promise<Map<string, AllocationRuleHit[]>> {
  const hits = new Map<string, AllocationRuleHit[]>();
  const ids = [...new Set(params.employeeIds.filter((id) => id?.trim()))];
  if (!ids.length) return hits;

  const { rules, jobStart, jobEnd } = params;
  const active = (key: AllocationRuleKey) => allocationRuleBehavior(rules, key) !== 'ALWAYS_ALLOW';
  const blocks = (key: AllocationRuleKey) => allocationRuleBehavior(rules, key) === 'DONT_ALLOW';
  const add = (employeeId: string, key: AllocationRuleKey, message: string, block = blocks(key)) => {
    const list = hits.get(employeeId) ?? [];
    if (!list.some((h) => h.key === key)) list.push({ key, message, block });
    hits.set(employeeId, list);
  };

  if (active('carer_on_holiday')) {
    const jobDay = new Date(
      Date.UTC(jobStart.getUTCFullYear(), jobStart.getUTCMonth(), jobStart.getUTCDate(), 12, 0, 0, 0),
    );
    const rows = await db.employeeHoliday.findMany({
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        isActive: true,
        startDate: { lte: jobDay },
        endDate: { gte: jobDay },
      },
      select: { employeeId: true },
    });
    for (const r of rows) add(r.employeeId, 'carer_on_holiday', 'Employee is on holiday for this visit date');
  }

  if (active('carer_on_nca')) {
    const rows = await db.employeeNonCoreActivity.findMany({
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        isActive: true,
        dateFrom: { lte: jobEnd },
        dateTo: { gte: jobStart },
      },
      select: { employeeId: true },
    });
    for (const r of rows) add(r.employeeId, 'carer_on_nca', 'Employee has non-core activity during this visit');
  }

  if (active('carer_on_leave')) {
    const rows = await db.employeeAbsenceRecord.findMany({
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        fromDateTime: { lte: jobEnd },
        toDateTime: { gte: jobStart },
        OR: [
          { absenceType: { in: [...ROTA_BLOCKING_LEAVE_TYPES] } },
          { absenceType: { in: [...PARENTAL_LEAVE_TYPES] }, permissionStatus: 'Authorised' },
        ],
      },
      select: { employeeId: true, absenceType: true },
    });
    for (const r of rows) {
      const message =
        r.absenceType === 'Sickness'
          ? 'Employee is off sick for this visit date'
          : r.absenceType === 'Casual leave'
            ? 'Employee is on casual leave for this visit date'
            : `Employee is on ${r.absenceType.toLowerCase()} leave for this visit date`;
      add(r.employeeId, 'carer_on_leave', message);
    }
  }

  // Overlap: always checked. Overlap within the "Allow overlap" minutes follows that
  // rule; anything longer is a hard block (as before these rules were configurable).
  const overlapRule = rules.find((r) => r.key === 'allow_overlap');
  const overlapToleranceMs =
    overlapRule && overlapRule.behavior !== 'DONT_ALLOW' ? (overlapRule.minutes ?? 0) * 60_000 : 0;
  const travelRule = rules.find((r) => r.key === 'time_between_jobs');
  const travelMs =
    travelRule && travelRule.behavior !== 'ALWAYS_ALLOW' ? (travelRule.minutes ?? 0) * 60_000 : 0;
  const others = await db.jobAllocation.findMany({
    where: {
      employeeId: { in: ids },
      deletedAt: null,
      isActive: true,
      status: { in: ACTIVE_ALLOCATION_STATUSES },
      ...(params.excludeScheduledJobId ? { scheduledJobId: { not: params.excludeScheduledJobId } } : {}),
      scheduledJob: {
        deletedAt: null,
        isActive: true,
        // Job window widened by the travel gap; exact per-carer timing is resolved below.
        AND: [
          { scheduledStartDateTime: { lt: new Date(jobEnd.getTime() + travelMs) } },
          {
            OR: [
              { scheduledEndDateTime: { gt: new Date(jobStart.getTime() - travelMs) } },
              { scheduledEndDateTime: null },
            ],
          },
        ],
      },
    },
    select: {
      employeeId: true,
      scheduledStartDateTime: true,
      scheduledEndDateTime: true,
      durationMinutes: true,
      scheduledJob: {
        select: { scheduledStartDateTime: true, scheduledEndDateTime: true, estimatedDurationMinutes: true },
      },
    },
    take: 2000,
  });
  for (const row of others) {
    const other = resolveAllocationWindow(row, row.scheduledJob);
    const overlapMs =
      Math.min(jobEnd.getTime(), other.end.getTime()) - Math.max(jobStart.getTime(), other.start.getTime());
    if (overlapMs > 0) {
      if (overlapMs > overlapToleranceMs) {
        add(row.employeeId, 'allow_overlap', CARER_ROTA_CONFLICT_MESSAGE, true);
      } else if (active('allow_overlap')) {
        add(row.employeeId, 'allow_overlap', `Overlaps another visit by ${Math.round(overlapMs / 60_000)} min`);
      }
      continue;
    }
    if (travelMs > 0 && -overlapMs < travelMs) {
      add(
        row.employeeId,
        'time_between_jobs',
        `Less than ${travelRule?.minutes} min between this and another visit`,
      );
    }
  }

  const skillKeywords = params.skillKeywords ?? [];
  const checkMeds = params.medicationRequired === true && active('medication_not_trained');
  const checkSkills = skillKeywords.length > 0 && active('missing_client_skills');
  if (checkMeds || checkSkills) {
    const skillRows = await db.employeeSkill.findMany({
      where: { employeeId: { in: ids }, deletedAt: null, isActive: true },
      select: { employeeId: true, skillTypeId: true, expiryDate: true, skillType: { select: { name: true } } },
    });
    const byEmployee = new Map<string, { skillTypeId: string | null; skillName: string | null; expiryDate: Date | null }[]>();
    for (const s of skillRows) {
      const list = byEmployee.get(s.employeeId) ?? [];
      list.push({ skillTypeId: s.skillTypeId, skillName: s.skillType?.name ?? null, expiryDate: s.expiryDate });
      byEmployee.set(s.employeeId, list);
    }
    for (const id of ids) {
      const skills = byEmployee.get(id) ?? [];
      if (checkMeds && !matchEmployeeSkills(skills, MEDICATION_SKILL_KEYWORDS, jobStart).matched.length) {
        add(id, 'medication_not_trained', 'Visit includes medication and carer has no current medication skill');
      }
      if (checkSkills) {
        const { missing } = matchEmployeeSkills(skills, skillKeywords, jobStart);
        if (missing.length) add(id, 'missing_client_skills', `Missing skills: ${missing.join(', ')}`);
      }
    }
  }

  return hits;
}

/** Skill keywords for a visit plan slot's linked care plan forms (empty when none). */
export async function skillKeywordsForVisitPlanSlot(
  db: Pick<Prisma.TransactionClient, 'visitPlanSlot' | 'carePathwayForm'>,
  visitPlanSlotId: string | null | undefined,
): Promise<string[]> {
  if (!visitPlanSlotId) return [];
  const slot = await db.visitPlanSlot.findFirst({
    where: { id: visitPlanSlotId },
    select: { linkedCarePlanFormIds: true },
  });
  const formIds = slot?.linkedCarePlanFormIds ?? [];
  if (!formIds.length) return [];
  const forms = await db.carePathwayForm.findMany({
    where: { id: { in: formIds }, deletedAt: null },
    select: { name: true },
  });
  return requiredSkillKeywords([], forms.map((f) => f.name));
}

export function blockingRuleHits(hits: AllocationRuleHit[] | undefined): AllocationRuleHit[] {
  return (hits ?? []).filter((h) => h.block);
}
