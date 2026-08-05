/**
 * Maps visit tasks that feed clinical observations (Obs tab).
 * Mobile uses linkedTypeCode / linkTab — backend must keep task + observation in sync.
 *
 * Rule: never expose Obs badge/linkTab without both linkedTypeCode + observationTypeCode.
 */

export type TaskObsLink = {
  linkTab: 'obs';
  linkedTypeCode: string;
  observationTypeCode: string;
};

/**
 * Order matters: more specific patterns before broader ones
 * (e.g. pressure areas before blood pressure).
 */
const NAME_TO_OBS: Array<{ match: RegExp; linkedTypeCode: string; observationTypeCode: string }> = [
  {
    match: /blood\s*glucose|glucose|blood\s*sugar/i,
    linkedTypeCode: 'blood_glucose',
    observationTypeCode: 'BLOOD_SUGAR',
  },
  {
    match: /blood\s*pressure|\bbp\b/i,
    linkedTypeCode: 'bp',
    observationTypeCode: 'BLOOD_PRESSURE',
  },
  // Skin / pressure-area checks (NOT blood pressure)
  {
    match: /pressure\s*area|check\s*pressure|pressure\s*care|skin|body\s*map|emollient|barrier\s*cream/i,
    linkedTypeCode: 'skin_body_map',
    observationTypeCode: 'INFECTION',
  },
  { match: /spo2|oxygen\s*sat/i, linkedTypeCode: 'spo2', observationTypeCode: 'OXYGEN_SATURATION' },
  { match: /\bpulse\b|heart\s*rate/i, linkedTypeCode: 'pulse', observationTypeCode: 'PULSE' },
  { match: /temperature|temp\b/i, linkedTypeCode: 'temp', observationTypeCode: 'TEMPERATURE' },
  { match: /reposition/i, linkedTypeCode: 'repositioning', observationTypeCode: 'REPOSITIONING' },
  { match: /fluid|drink/i, linkedTypeCode: 'fluid_intake', observationTypeCode: 'FLUID_MONITOR' },
  { match: /mood|wellbeing/i, linkedTypeCode: 'mood_wellbeing', observationTypeCode: 'WELLBEING' },
  { match: /\bpain\b/i, linkedTypeCode: 'pain_score', observationTypeCode: 'PAIN' },
  { match: /falls?/i, linkedTypeCode: 'falls', observationTypeCode: 'FALLS' },
];

/** feedsObservation flags from task catalogue → concrete obs type. */
const FEEDS_TO_OBS: Record<string, { linkedTypeCode: string; observationTypeCode: string }> = {
  diabetes: { linkedTypeCode: 'blood_glucose', observationTypeCode: 'BLOOD_SUGAR' },
  pain: { linkedTypeCode: 'pain_score', observationTypeCode: 'PAIN' },
  body_map: { linkedTypeCode: 'skin_body_map', observationTypeCode: 'INFECTION' },
  skin_integrity: { linkedTypeCode: 'skin_body_map', observationTypeCode: 'INFECTION' },
  vitals: { linkedTypeCode: 'bp', observationTypeCode: 'BLOOD_PRESSURE' },
  continence: { linkedTypeCode: 'bowel', observationTypeCode: 'BOWEL_MOVEMENT' },
  bowel: { linkedTypeCode: 'bowel', observationTypeCode: 'BOWEL_MOVEMENT' },
};

export function resolveTaskObsLink(input: {
  name: string;
  groupCode?: string | null;
  flagsJson?: unknown;
}): TaskObsLink | null {
  const flags =
    input.flagsJson && typeof input.flagsJson === 'object' && !Array.isArray(input.flagsJson)
      ? (input.flagsJson as Record<string, unknown>)
      : null;
  const feeds = flags?.feedsObservation;
  if (Array.isArray(feeds)) {
    for (const raw of feeds) {
      const key = String(raw).toLowerCase();
      const mapped = FEEDS_TO_OBS[key];
      if (mapped) return { linkTab: 'obs', ...mapped };
    }
  }

  for (const row of NAME_TO_OBS) {
    if (row.match.test(input.name)) {
      return {
        linkTab: 'obs',
        linkedTypeCode: row.linkedTypeCode,
        observationTypeCode: row.observationTypeCode,
      };
    }
  }
  return null;
}

/** Parse "5", "5.2", "5 mmol/L", "5.2mmol/L" → number. */
export function parseObservationNumeric(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!Number.isNaN(Number(trimmed))) return Number(trimmed);
  const match = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
