/**
 * Maps visit tasks that feed clinical observations (Obs tab).
 * Mobile uses linkedTypeCode / linkTab — backend must keep task + observation in sync.
 */

export type TaskObsLink = {
  linkTab: 'obs';
  linkedTypeCode: string;
  observationTypeCode: string;
};

const NAME_TO_OBS: Array<{ match: RegExp; linkedTypeCode: string; observationTypeCode: string }> = [
  { match: /blood\s*glucose|glucose|blood\s*sugar/i, linkedTypeCode: 'blood_glucose', observationTypeCode: 'BLOOD_SUGAR' },
  { match: /blood\s*pressure|\bbp\b/i, linkedTypeCode: 'bp', observationTypeCode: 'BLOOD_PRESSURE' },
  { match: /spo2|oxygen\s*sat/i, linkedTypeCode: 'spo2', observationTypeCode: 'OXYGEN_SATURATION' },
  { match: /\bpulse\b|heart\s*rate/i, linkedTypeCode: 'pulse', observationTypeCode: 'PULSE' },
  { match: /temperature|temp\b/i, linkedTypeCode: 'temp', observationTypeCode: 'TEMPERATURE' },
  { match: /reposition/i, linkedTypeCode: 'repositioning', observationTypeCode: 'REPOSITIONING' },
  { match: /fluid|drink/i, linkedTypeCode: 'fluid_intake', observationTypeCode: 'FLUID_MONITOR' },
  { match: /mood|wellbeing/i, linkedTypeCode: 'mood_wellbeing', observationTypeCode: 'WELLBEING' },
  { match: /skin|body\s*map/i, linkedTypeCode: 'skin_body_map', observationTypeCode: 'INFECTION' },
  { match: /falls?/i, linkedTypeCode: 'falls', observationTypeCode: 'FALLS' },
];

const FEEDS_TO_OBS: Record<string, { linkedTypeCode: string; observationTypeCode: string }> = {
  diabetes: { linkedTypeCode: 'blood_glucose', observationTypeCode: 'BLOOD_SUGAR' },
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

  const group = String(input.groupCode ?? '').toLowerCase();
  if (/observations_monitoring|observation/.test(group)) {
    for (const row of NAME_TO_OBS) {
      if (row.match.test(input.name)) {
        return {
          linkTab: 'obs',
          linkedTypeCode: row.linkedTypeCode,
          observationTypeCode: row.observationTypeCode,
        };
      }
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
