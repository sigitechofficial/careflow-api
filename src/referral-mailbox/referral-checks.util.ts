/**
 * Referral checks and the decision rules. Everything here is plain code over CareFlow's own data, so the
 * same referral always gets the same answer and the reason for each result is visible.
 */

export type CheckResult = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
export type ReferralCheck = { key: string; label: string; result: CheckResult; detail: string };
export type ReferralDecision = 'YES' | 'POSSIBLY' | 'NEED_INFO' | 'NO';

export const DECISION_LABEL: Record<ReferralDecision, string> = {
  YES: 'Yes, subject to our assessment',
  POSSIBLY: 'Possibly',
  NEED_INFO: 'Need more information',
  NO: 'Sorry, we can’t take this one',
};

export type CouncilLookup =
  /** Full postcode found: its council. */
  | { kind: 'exact'; council: string }
  /** Only the district (e.g. "CR5") is known, or the full postcode was not found: the councils it spans. */
  | { kind: 'district'; district: string; councils: string[] }
  | { kind: 'unknown'; reason: string };

/** UK postcode → local authority, via postcodes.io (free; only the postcode is sent). */
export async function lookupCouncil(postcode: string): Promise<CouncilLookup> {
  const pc = postcode.replace(/\s+/g, '').toUpperCase();
  const full = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(pc);
  const district = full ? full[1] : /^[A-Z]{1,2}\d[A-Z\d]?$/.test(pc) ? pc : null;
  if (!district) return { kind: 'unknown', reason: `"${postcode}" does not look like a UK postcode.` };
  const get = async (url: string) => {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`postcode lookup ${res.status}`);
    return (await res.json()) as { result?: { admin_district?: string | string[] | null } };
  };
  try {
    if (full) {
      const body = await get(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const council = body?.result?.admin_district;
      if (typeof council === 'string' && council) return { kind: 'exact', council };
    }
    const body = await get(`https://api.postcodes.io/outcodes/${encodeURIComponent(district)}`);
    const councils = body?.result?.admin_district;
    if (Array.isArray(councils) && councils.length) return { kind: 'district', district, councils };
    return { kind: 'unknown', reason: `The postcode ${postcode} could not be found.` };
  } catch {
    return { kind: 'unknown', reason: `The postcode ${postcode} could not be looked up just now.` };
  }
}

/** The branch whose coverage lists this council (names compared without case or "&"/"and" differences). */
export function branchForCouncil<T extends { locationId: string; localAuthorities: string[] }>(
  council: string,
  coverage: T[],
): T | null {
  const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
  const c = norm(council);
  return coverage.find((b) => b.localAuthorities.some((la) => norm(la) === c)) ?? null;
}

/** Whole days from today (UTC date) to an ISO date; null when not a date. */
export function daysUntil(isoDate: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86_400_000);
}

const DAY_INDEX: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
/** Day numbers for the visit's days. No days, or none we recognise, means every day (never an empty list). */
export const dayIndexes = (days: string[]): number[] => {
  const known = [...new Set(days.map((d) => DAY_INDEX[String(d).trim().slice(0, 3).toUpperCase()]).filter((n): n is number => n !== undefined))];
  return (known.length ? known : [...new Set(Object.values(DAY_INDEX))]).sort((a, b) => a - b);
};

/** "08:00" + 45 → "08:45" (clamped to 23:59). */
export function addMinutes(hhmm: string, minutes: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || minutes <= 0) return null;
  const total = Math.min(Number(m[1]) * 60 + Number(m[2]) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "08:00" shifted by ±minutes, kept within the same day ("00:00"–"23:59"). */
export function shiftTime(hhmm: string, minutes: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const total = Math.max(0, Math.min(Number(m[1]) * 60 + Number(m[2]) + minutes, 23 * 60 + 59));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Care a domiciliary branch may not provide: flagged for a manager, never decided automatically. */
export function careWeMayNotProvide(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/\blive[- ]in\b/.test(t)) out.push('Live-in care');
  if (/24[- ]?hour|round the clock|waking night/.test(t)) out.push('24-hour or night care');
  if (/\bnurs(e|ing)\b.*\b(task|care|clinical)|peg feed|tracheostomy|suction|injection/.test(t)) out.push('Clinical or nursing tasks');
  // A child: "a child", "aged 9", "14 years old", "under 18". Not "her children", not "82 years old".
  if (/\b(a|the|this|our) child\b|\bminor\b|\bunder[- ]18\b|\bpa?ediatric|\baged (1[0-7]|[1-9])\b|\b(1[0-7]|[1-9])[- ]?(years?|yrs?)[- ]old\b/.test(t)) {
    out.push('Care for a child');
  }
  return out;
}

/** "female" / "male" when the referral asks for one; null for no preference ("male or female is fine", "either"). */
export function carerGenderPreference(text: string | null | undefined): 'female' | 'male' | null {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/\b(no|any) (gender )?preference|\beither\b|\bany\b|male or female|female or male|men or women|women or men|doesn.?t mind|does not mind|not (important|essential|fussed)/.test(t)) return null;
  if (/female|\bwom[ae]n\b|\blad(y|ies)\b/.test(t)) return 'female';
  if (/\bmale\b|\bm[ae]n\b|\bgentlem[ae]n\b/.test(t)) return 'male';
  return null;
}

const FUNDER_NOISE = /\b(the|london|royal|metropolitan|city|county|borough|district|council|of|adult|adults|social|care|services?|department|team|ltd|limited|nhs)\b/g;
const funderKey = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]/g, ' ').replace(FUNDER_NOISE, ' ').replace(/\s+/g, ' ').trim();

/**
 * The funder a referral names, matched on the distinctive part of the name ("London Borough of Croydon" = "Croydon Council").
 * Exact match first, then the longest name that contains, or is contained in, the other (at least 4 letters).
 */
export function matchFunder<T extends { name: string }>(given: string, funders: T[]): T | null {
  const g = funderKey(given);
  if (g.length < 3) return null;
  const exact = funders.find((f) => funderKey(f.name) === g);
  if (exact) return exact;
  const partial = funders
    .map((f) => ({ f, k: funderKey(f.name) }))
    .filter(({ k }) => k.length >= 4 && (k.includes(g) || g.includes(k)))
    .sort((a, b) => b.k.length - a.k.length);
  return partial[0]?.f ?? null;
}

/** Hourly rates on a charge card in words, e.g. "£24.50 an hour on weekdays, £27.00 at weekends". */
export function rateSummary(rules: Array<{ rateType: string; dayType: string; amount: number; label: string | null }>): string | null {
  const hourly = rules.filter((r) => r.rateType === 'HOURLY' && r.amount > 0);
  if (!hourly.length) return null;
  const DAY: Record<string, string> = {
    ANY: 'any day',
    WEEKDAY: 'weekdays',
    WEEKEND: 'weekends',
    SATURDAY: 'Saturdays',
    SUNDAY: 'Sundays',
    BANK_HOLIDAY: 'bank holidays',
  };
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of hourly) {
    const when = DAY[r.dayType] ?? r.label ?? r.dayType.toLowerCase();
    if (seen.has(when)) continue;
    seen.add(when);
    parts.push(`£${r.amount.toFixed(2)} an hour${when === 'any day' ? '' : ` on ${when}`}`);
  }
  return parts.join(', ');
}

/**
 * The decision from the checks:
 * - NO: outside every branch's area, care our rules decline, or no carer free for any visit.
 * - NEED_INFO: no usable address or no visit pattern, so area or carers can't be checked.
 * - POSSIBLY: some visits can be covered but not all, a short-notice start, or a rule says a manager decides.
 * - YES: everything passes (always "subject to our assessment" in the reply).
 */
export function decideReferral(checks: ReferralCheck[]): { decision: ReferralDecision; reasons: string[] } {
  const by = (key: string) => checks.find((c) => c.key === key);
  const area = by('area');
  const carers = checks.filter((c) => c.key.startsWith('carers:'));
  const reasons: string[] = [];

  if (area?.result === 'FAIL') return { decision: 'NO', reasons: [area.detail] };
  // Care our rules say we don't take.
  const declined = checks.filter((c) => c.key.startsWith('rule:') && c.result === 'FAIL');
  if (declined.length) return { decision: 'NO', reasons: declined.map((c) => `${c.label}: ${c.detail}`) };
  if (carers.length && carers.every((c) => c.result === 'FAIL')) {
    return { decision: 'NO', reasons: ['No carer is free for any of the visits asked for.'] };
  }
  if (area?.result === 'UNKNOWN') reasons.push(area.detail);
  if (!carers.length || carers.every((c) => c.result === 'UNKNOWN')) reasons.push('No visit times were given, so carer availability could not be checked.');
  if (reasons.length) return { decision: 'NEED_INFO', reasons };

  for (const c of checks) {
    // Duplicates, funding, price and quotation notes are for staff; they never change the decision.
    // Notes from the rules ("note:…") and the kind of email are for staff too.
    const informational = ['duplicate', 'funding', 'price', 'quote', 'kind'].includes(c.key) || c.key.startsWith('note:');
    if (c.result === 'FAIL' || (c.result === 'WARN' && !informational)) reasons.push(`${c.label}: ${c.detail}`);
  }
  return reasons.length ? { decision: 'POSSIBLY', reasons } : { decision: 'YES', reasons: [] };
}
