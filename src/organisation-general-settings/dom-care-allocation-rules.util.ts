import type { Prisma } from '@prisma/client';

export type DomAllocationRuleBehavior = 'DONT_ALLOW' | 'ALWAYS_ALLOW' | 'REQUEST_CONFIRMATION';

export type DomCareAllocationRule = {
  key: string;
  label: string;
  behavior: DomAllocationRuleBehavior;
  minutes: number | null;
};

const BEHAVIORS: DomAllocationRuleBehavior[] = ['DONT_ALLOW', 'ALWAYS_ALLOW', 'REQUEST_CONFIRMATION'];

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
];

const RULES_WITH_MINUTES = new Set(['allow_overlap', 'time_between_jobs']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBehavior(value: unknown): DomAllocationRuleBehavior | null {
  if (typeof value !== 'string') return null;
  return BEHAVIORS.includes(value as DomAllocationRuleBehavior)
    ? (value as DomAllocationRuleBehavior)
    : null;
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
  const behavior = parseBehavior(raw.behavior) ?? defaultRule?.behavior ?? 'DONT_ALLOW';
  let minutes: number | null = null;
  if (RULES_WITH_MINUTES.has(key)) {
    const n = Number(raw.minutes);
    minutes = Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : (defaultRule?.minutes ?? 0);
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
  return rules.map((r) => ({
    key: r.key,
    label: r.label,
    behavior: r.behavior,
    minutes: RULES_WITH_MINUTES.has(r.key) ? (r.minutes ?? 0) : null,
  }));
}

export function ruleSupportsMinutes(key: string): boolean {
  return RULES_WITH_MINUTES.has(key);
}
