import {
  INCIDENT_CONTRIBUTING_FACTORS,
  INCIDENT_OUTCOME_CHANGE_CODES,
} from './incident-review.constants';

export type ContributingFactorDetail = {
  /** Records the factor relates to (staff, care plan, medication…), name kept as at save time. */
  items?: { id: string; label: string }[];
  note?: string;
};

export type ContributingFactorDetails = Record<string, ContributingFactorDetail>;

const MAX_ITEMS = 50;
const MAX_LABEL = 200;
const MAX_NOTE = 2000;

/** Contributing factors: details for ticked factors only. */
export function sanitizeContributingFactorDetails(raw: unknown, tickedFactors: string[]) {
  return sanitizeCodeDetails(raw, tickedFactors, INCIDENT_CONTRIBUTING_FACTORS);
}

/** Outcome "changes made": details for ticked changes only. */
export function sanitizeChangesMadeDetails(raw: unknown, tickedChanges: string[]) {
  return sanitizeCodeDetails(raw, tickedChanges, INCIDENT_OUTCOME_CHANGE_CODES);
}

/**
 * Keep details only for ticked, known codes, with bounded, well-formed items and notes.
 * Returns null when nothing is left.
 */
function sanitizeCodeDetails(
  raw: unknown,
  tickedFactors: string[],
  allowedCodes: readonly string[],
): ContributingFactorDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const allowed = new Set<string>(allowedCodes);
  const out: ContributingFactorDetails = {};
  for (const code of tickedFactors) {
    if (!allowed.has(code)) continue;
    const entry = (raw as Record<string, unknown>)[code];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { items, note } = entry as { items?: unknown; note?: unknown };
    const seen = new Set<string>();
    const cleanItems = (Array.isArray(items) ? items : [])
      .map((i) =>
        i && typeof i === 'object'
          ? {
              id: String((i as { id?: unknown }).id ?? '').trim().slice(0, 64),
              label: String((i as { label?: unknown }).label ?? '').trim().slice(0, MAX_LABEL),
            }
          : null,
      )
      .filter((i): i is { id: string; label: string } => {
        if (!i || !i.id || !i.label || seen.has(i.id)) return false;
        seen.add(i.id);
        return true;
      })
      .slice(0, MAX_ITEMS);
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : '';
    if (cleanItems.length || cleanNote) {
      out[code] = {
        ...(cleanItems.length ? { items: cleanItems } : {}),
        ...(cleanNote ? { note: cleanNote } : {}),
      };
    }
  }
  return Object.keys(out).length ? out : null;
}
