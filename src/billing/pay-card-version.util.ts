import { PayCardRule, Prisma } from '@prisma/client';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';

type Db = Prisma.TransactionClient;

export type PayCardVersionWindow = { version: number; effectiveFrom: Date };

/** YYYY-MM-DD of a `@db.Date` value (stored as UTC midnight). */
function dateOnlyKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Version in force on a calendar day: the latest `effectiveFrom` on or before the day
 * (same-day ties go to the higher version). Days before the first version use the earliest.
 */
export function pickPayCardVersionForDay(
  versions: PayCardVersionWindow[],
  dayKey: string,
): number | null {
  if (!versions.length) return null;
  const sorted = [...versions].sort(
    (a, b) =>
      dateOnlyKey(a.effectiveFrom).localeCompare(dateOnlyKey(b.effectiveFrom)) ||
      a.version - b.version,
  );
  let picked = sorted[0].version;
  for (const v of sorted) {
    if (dateOnlyKey(v.effectiveFrom) <= dayKey) picked = v.version;
  }
  return picked;
}

/** Same rule fields the editor sends; used to decide whether a save changes the rates. */
const RULE_COMPARE_FIELDS = [
  'label',
  'serviceType',
  'dayType',
  'startTime',
  'endTime',
  'rateType',
  'amount',
  'multiplier',
  'additionalAmount',
  'percentageUplift',
  'enhancementMethod',
  'minimumMinutes',
  'roundingRule',
  'priority',
  'sortOrder',
  'appliesToVisit',
  'appliesToTravel',
  'appliesToWaiting',
  'appliesToTraining',
] as const;

const SORT_ORDER_INDEX = RULE_COMPARE_FIELDS.indexOf('sortOrder');

function normaliseRuleValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && 'toString' in (value as object)) {
    // Prisma.Decimal
    const n = Number((value as { toString(): string }).toString());
    return Number.isFinite(n) ? String(n) : String(value);
  }
  if (typeof value === 'number') return String(value);
  return String(value);
}

export function payRulesSignature(rules: Array<Record<string, unknown>>): string {
  return JSON.stringify(
    [...rules]
      .map((rule) => RULE_COMPARE_FIELDS.map((f) => normaliseRuleValue(rule[f])))
      .sort((a, b) => Number(a[SORT_ORDER_INDEX] || 0) - Number(b[SORT_ORDER_INDEX] || 0)),
  );
}

/**
 * Rules of the pay card version in force on the visit's calendar day (org timezone).
 * Falls back to the current rules when the card has no version history.
 */
export async function loadPayCardRulesForDate(
  db: Db,
  payCardId: string,
  at: Date,
  timeZone?: string,
): Promise<{ version: number | null; rules: PayCardRule[] }> {
  const versions = await db.payCardVersion.findMany({
    where: { payCardId },
    select: { version: true, effectiveFrom: true },
  });
  const version = pickPayCardVersionForDay(versions, dayKeyInTimeZone(at, timeZone));
  if (version == null) {
    const rules = await db.payCardRule.findMany({ where: { payCardId, supersededAt: null } });
    return { version: null, rules };
  }
  const rules = await db.payCardRule.findMany({ where: { payCardId, version } });
  return { version, rules };
}

/** Rules of a specific stored version (falls back to current rules when unknown). */
export async function loadPayCardRulesForVersion(
  db: Db,
  payCardId: string,
  version: number | null | undefined,
): Promise<PayCardRule[]> {
  if (version != null) {
    const rules = await db.payCardRule.findMany({ where: { payCardId, version } });
    if (rules.length) return rules;
  }
  return db.payCardRule.findMany({ where: { payCardId, supersededAt: null } });
}
