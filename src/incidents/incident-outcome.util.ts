/** Outcome & close: who the outcome was shared with, and how learning reached the team. */

export const OUTCOME_SHARING_METHODS = ['IN_PERSON', 'PHONE', 'VIDEO', 'LETTER', 'EMAIL'] as const;

/** Why the outcome was not shared with someone. */
export const OUTCOME_NOT_SHARED_REASONS = [
  'PASSED_AWAY',
  'LACKS_CAPACITY',
  'NOT_NEEDED',
  'DECLINED',
  'COULD_NOT_CONTACT',
  'NOT_APPROPRIATE',
] as const;

export const OUTCOME_PERSON_KINDS = ['SERVICE_USER', 'REPRESENTATIVE', 'STAFF', 'OTHER'] as const;

export const LEARNING_SHARED_METHODS = [
  'TEAM_MEETING',
  'SUPERVISION',
  'MEMO',
  'EMAIL',
  'TRAINING_SESSION',
  'OTHER',
] as const;

export type OutcomeSharingEntry = {
  /** Stable row key, e.g. SU:<id>, REP:<serviceUserId>, STAFF:<employeeId>, OTHER. */
  key: string;
  personKind: (typeof OUTCOME_PERSON_KINDS)[number];
  name: string;
  shared: boolean;
  /** YYYY-MM-DD when shared. */
  sharedOn: string | null;
  method: string | null;
  notSharedReason: string | null;
  note: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Clean the "outcome shared with" rows and say what each still needs: a date and method when
 * shared, a reason when not (with a note when "not appropriate").
 */
export function sanitizeOutcomeSharing(
  raw: unknown,
  today: string,
): { entries: OutcomeSharingEntry[]; errors: string[] } {
  const entries: OutcomeSharingEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw.slice(0, 30) : []) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const key = str(o.key, 80);
    const personKind = OUTCOME_PERSON_KINDS.find((k) => k === o.personKind);
    if (!key || !personKind || seen.has(key)) continue;
    seen.add(key);
    const name = str(o.name, 200) ?? '';
    const shared = o.shared === true;
    const sharedOn = shared && typeof o.sharedOn === 'string' && DAY.test(o.sharedOn) ? o.sharedOn : null;
    const method = shared ? (OUTCOME_SHARING_METHODS.find((m) => m === o.method) ?? null) : null;
    const notSharedReason = shared
      ? null
      : (OUTCOME_NOT_SHARED_REASONS.find((m) => m === o.notSharedReason) ?? null);
    const note = str(o.note, 1000);
    const who = name || 'a person';
    if (shared) {
      if (!name) errors.push('the name of each person the outcome was shared with');
      if (!sharedOn) errors.push(`when the outcome was shared with ${who}`);
      else if (sharedOn > today) errors.push(`a date that is not in the future for ${who}`);
      if (!method) errors.push(`how the outcome was shared with ${who}`);
    } else if (!notSharedReason) {
      errors.push(`whether the outcome was shared with ${who}`);
    } else if (notSharedReason === 'NOT_APPROPRIATE' && !note) {
      errors.push(`why sharing with ${who} was not appropriate`);
    }
    entries.push({ key, personKind, name, shared, sharedOn, method, notSharedReason, note });
  }
  return { entries, errors: [...new Set(errors)] };
}
