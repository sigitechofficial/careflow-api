import type { Prisma } from '@prisma/client';

export type DomAllocationRuleBehavior =
  | 'DONT_ALLOW'
  | 'ALWAYS_ALLOW'
  | 'REQUEST_CONFIRMATION'
  | 'MANAGER_APPROVAL';

/**
 * Carer over their contracted weekly hours (Monday–Sunday) on the rota board, extra visits and
 * special visits. Visit plans always need a manager's approval. `minutes` is the grace allowed
 * over the limit.
 */
export const WEEKLY_HOURS_RULE_KEY = 'carer_over_weekly_hours';

export const WEEKLY_HOURS_REJECT_ACTIONS = [
  'REMOVE_EXTRA_VISITS',
  'REMOVE_FROM_PLAN',
] as const;
export type WeeklyHoursRejectAction =
  (typeof WEEKLY_HOURS_REJECT_ACTIONS)[number];

export type DomWeeklyHoursRuleOptions = {
  rejectAction: WeeklyHoursRejectAction;
  maxApprovableHours: number;
  /** Called-off visits (the carer went, the service user turned it down) count in the carer's week. */
  countCalledOff: boolean;
};

export type DomCareAllocationRule = {
  key: string;
  label: string;
  behavior: DomAllocationRuleBehavior;
  minutes: number | null;
  /** Only on the weekly-hours rule. */
  weeklyHours?: DomWeeklyHoursRuleOptions;
};

const BEHAVIORS: DomAllocationRuleBehavior[] = ['DONT_ALLOW', 'ALWAYS_ALLOW', 'REQUEST_CONFIRMATION'];

export const DEFAULT_WEEKLY_HOURS_RULE_OPTIONS: DomWeeklyHoursRuleOptions = {
  rejectAction: 'REMOVE_EXTRA_VISITS',
  maxApprovableHours: 60,
  countCalledOff: true,
};

export const DEFAULT_DOM_CARE_ALLOCATION_RULES: DomCareAllocationRule[] = [
  { key: 'visit_time_tolerance', label: 'Visit Time Tolerance', behavior: 'DONT_ALLOW', minutes: null },
  { key: 'carer_on_holiday', label: 'Carer on holiday', behavior: 'DONT_ALLOW', minutes: null },
  { key: 'carer_on_nca', label: 'Carer on NCA', behavior: 'DONT_ALLOW', minutes: null },
  {
    key: 'carer_blocked_su_on_run',
    label: 'Carer blocked with 1 SU on run or job allocated to',
    behavior: 'DONT_ALLOW',
    minutes: null,
  },
  { key: 'carer_allocated_another_run', label: 'Carer allocated to another run', behavior: 'DONT_ALLOW', minutes: null },
  {
    key: 'job_outside_working_pattern',
    label: 'Job or jobs outside working pattern',
    behavior: 'REQUEST_CONFIRMATION',
    minutes: null,
  },
  { key: 'allow_overlap', label: 'Allow overlap', behavior: 'REQUEST_CONFIRMATION', minutes: 0 },
  { key: 'time_between_jobs', label: 'Time between jobs', behavior: 'REQUEST_CONFIRMATION', minutes: 15 },
  { key: 'visit_change_across_zones', label: 'Visit change across zones', behavior: 'REQUEST_CONFIRMATION', minutes: null },
  {
    key: WEEKLY_HOURS_RULE_KEY,
    label: 'Carer over weekly hours',
    behavior: 'MANAGER_APPROVAL',
    minutes: 0,
    weeklyHours: { ...DEFAULT_WEEKLY_HOURS_RULE_OPTIONS },
  },
];

/** For the weekly-hours rule, `minutes` is the grace allowed over the limit. */
const RULES_WITH_MINUTES = new Set([
  'allow_overlap',
  'time_between_jobs',
  WEEKLY_HOURS_RULE_KEY,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBehavior(
  value: unknown,
  key: string,
): DomAllocationRuleBehavior | null {
  if (typeof value !== 'string') return null;
  // Manager approval exists only on the weekly-hours rule.
  if (value === 'MANAGER_APPROVAL')
    return key === WEEKLY_HOURS_RULE_KEY ? 'MANAGER_APPROVAL' : null;
  return BEHAVIORS.includes(value as DomAllocationRuleBehavior)
    ? (value as DomAllocationRuleBehavior)
    : null;
}

function parseWeeklyHoursOptions(value: unknown): DomWeeklyHoursRuleOptions {
  const raw = isRecord(value) ? value : {};
  const rejectAction = WEEKLY_HOURS_REJECT_ACTIONS.includes(
    raw.rejectAction as WeeklyHoursRejectAction,
  )
    ? (raw.rejectAction as WeeklyHoursRejectAction)
    : DEFAULT_WEEKLY_HOURS_RULE_OPTIONS.rejectAction;
  const n = Number(raw.maxApprovableHours);
  const maxApprovableHours = Number.isFinite(n)
    ? Math.max(1, Math.min(168, Math.round(n)))
    : DEFAULT_WEEKLY_HOURS_RULE_OPTIONS.maxApprovableHours;
  const countCalledOff =
    typeof raw.countCalledOff === 'boolean'
      ? raw.countCalledOff
      : DEFAULT_WEEKLY_HOURS_RULE_OPTIONS.countCalledOff;
  return { rejectAction, maxApprovableHours, countCalledOff };
}

function parseRule(raw: unknown): DomCareAllocationRule | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  const defaultRule = DEFAULT_DOM_CARE_ALLOCATION_RULES.find((r) => r.key === key);
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : (defaultRule?.label ?? key);
  const behavior =
    parseBehavior(raw.behavior, key) ?? defaultRule?.behavior ?? 'DONT_ALLOW';
  let minutes: number | null = null;
  if (RULES_WITH_MINUTES.has(key)) {
    const n = Number(raw.minutes);
    minutes = Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : (defaultRule?.minutes ?? 0);
  }
  if (key === WEEKLY_HOURS_RULE_KEY) {
    return {
      key,
      label,
      behavior,
      minutes,
      weeklyHours: parseWeeklyHoursOptions(raw.weeklyHours),
    };
  }
  return { key, label, behavior, minutes };
}

export function parseDomCareAllocationRules(
  value: Prisma.JsonValue | null | undefined,
): DomCareAllocationRule[] {
  const byKey = new Map<string, DomCareAllocationRule>();
  if (Array.isArray(value)) {
    for (const row of value) {
      const parsed = parseRule(row);
      if (parsed) byKey.set(parsed.key, parsed);
    }
  }
  return DEFAULT_DOM_CARE_ALLOCATION_RULES.map((def) => {
    const saved = byKey.get(def.key);
    return saved ? { ...def, ...saved, label: def.label } : { ...def };
  });
}

export function serializeDomCareAllocationRules(rules: DomCareAllocationRule[]): Prisma.InputJsonValue {
  return rules.map((r) => {
    const row = {
      key: r.key,
      label: r.label,
      behavior: parseBehavior(r.behavior, r.key) ?? 'DONT_ALLOW',
      minutes: RULES_WITH_MINUTES.has(r.key) ? (r.minutes ?? 0) : null,
    };
    return r.key === WEEKLY_HOURS_RULE_KEY
      ? { ...row, weeklyHours: parseWeeklyHoursOptions(r.weeklyHours) }
      : row;
  });
}

export function ruleSupportsMinutes(key: string): boolean {
  return RULES_WITH_MINUTES.has(key);
}

export type AllocationRuleWarningSeverity = 'blocking' | 'warning' | 'info';

/** Whether an allocation rule should emit a warning and at what severity. */
export function allocationRuleWarning(
  rules: DomCareAllocationRule[],
  ruleKey: string,
): { warn: boolean; severity: AllocationRuleWarningSeverity } {
  const rule = rules.find((r) => r.key === ruleKey);
  const behavior = rule?.behavior ?? 'DONT_ALLOW';
  if (behavior === 'ALWAYS_ALLOW') return { warn: false, severity: 'info' };
  if (behavior === 'REQUEST_CONFIRMATION') return { warn: true, severity: 'warning' };
  return { warn: true, severity: 'blocking' };
}
