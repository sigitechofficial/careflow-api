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
  // 24 Aug 2026: body-map tasks mark a site; wash/skin checks use SKIN_INTEGRITY.
  {
    match: /body\s*map|pressure\s*area|check\s*pressure|pressure\s*care/i,
    linkedTypeCode: 'skin_body_map',
    observationTypeCode: 'BODY_MAP',
  },
  {
    match: /emollient|barrier\s*cream/i,
    linkedTypeCode: 'skin_integrity',
    observationTypeCode: 'SKIN_INTEGRITY',
  },
  { match: /news2/i, linkedTypeCode: 'news2', observationTypeCode: 'NEWS2' },
  { match: /\bweight\b/i, linkedTypeCode: 'weight', observationTypeCode: 'WEIGHT' },
  { match: /spo2|oxygen\s*sat/i, linkedTypeCode: 'spo2', observationTypeCode: 'OXYGEN_SATURATION' },
  {
    match: /respiratory|\boxygen\b/i,
    linkedTypeCode: 'respiration',
    observationTypeCode: 'RESPIRATION',
  },
  { match: /\bpulse\b|heart\s*rate/i, linkedTypeCode: 'pulse', observationTypeCode: 'PULSE' },
  { match: /temperature|temp\b/i, linkedTypeCode: 'temp', observationTypeCode: 'TEMPERATURE' },
  { match: /reposition/i, linkedTypeCode: 'repositioning', observationTypeCode: 'REPOSITIONING' },
  {
    match: /toilet|commode|\bpad\b|catheter/i,
    linkedTypeCode: 'continence',
    observationTypeCode: 'CONTINENCE',
  },
  { match: /fluid|drink/i, linkedTypeCode: 'fluid_intake', observationTypeCode: 'FLUID_MONITOR' },
  { match: /\bsleep\b/i, linkedTypeCode: 'sleep', observationTypeCode: 'SLEEP' },
  { match: /mood|wellbeing/i, linkedTypeCode: 'mood_wellbeing', observationTypeCode: 'WELLBEING' },
  { match: /\bpain\b/i, linkedTypeCode: 'pain_score', observationTypeCode: 'PAIN' },
  { match: /falls?/i, linkedTypeCode: 'falls', observationTypeCode: 'FALLS' },
  {
    match: /peg|enteral/i,
    linkedTypeCode: 'peg_enteral',
    observationTypeCode: 'PEG_ENTERAL',
  },
  {
    match: /assist to eat|^feeding$|food\s*\/\s*nutrition|iddsi|texture-modified/i,
    linkedTypeCode: 'meals',
    observationTypeCode: 'MEALS',
  },
  {
    match: /seizure|epilepsy/i,
    linkedTypeCode: 'seizure',
    observationTypeCode: 'SEIZURE_CHART',
  },
  {
    match: /behaviour|behavior|pbs|bpsd/i,
    linkedTypeCode: 'abc_patterns',
    observationTypeCode: 'ABC_PATTERNS',
  },
];

/** feedsObservation flags from task catalogue → concrete obs type. */
const FEEDS_TO_OBS: Record<string, { linkedTypeCode: string; observationTypeCode: string }> = {
  diabetes: { linkedTypeCode: 'blood_glucose', observationTypeCode: 'BLOOD_SUGAR' },
  pain: { linkedTypeCode: 'pain_score', observationTypeCode: 'PAIN' },
  body_map: { linkedTypeCode: 'skin_body_map', observationTypeCode: 'BODY_MAP' },
  skin_integrity: { linkedTypeCode: 'skin_integrity', observationTypeCode: 'SKIN_INTEGRITY' },
  continence: { linkedTypeCode: 'continence', observationTypeCode: 'CONTINENCE' },
  bowel: { linkedTypeCode: 'bowel', observationTypeCode: 'BOWEL_MOVEMENT' },
  repositioning_chart: { linkedTypeCode: 'repositioning', observationTypeCode: 'REPOSITIONING' },
  food_intake: { linkedTypeCode: 'meals', observationTypeCode: 'MEALS' },
  epilepsy: { linkedTypeCode: 'seizure', observationTypeCode: 'SEIZURE_CHART' },
  pbs: { linkedTypeCode: 'abc_patterns', observationTypeCode: 'ABC_PATTERNS' },
};

function matchNameToObs(name: string): TaskObsLink | null {
  for (const row of NAME_TO_OBS) {
    if (row.match.test(name)) {
      return {
        linkTab: 'obs',
        linkedTypeCode: row.linkedTypeCode,
        observationTypeCode: row.observationTypeCode,
      };
    }
  }
  return null;
}

/** Catalogue `flagsJson.feedsObservation` includes `body_map`. */
export function catalogueFeedsBodyMap(flagsJson: unknown): boolean {
  const flags =
    flagsJson && typeof flagsJson === 'object' && !Array.isArray(flagsJson)
      ? (flagsJson as Record<string, unknown>)
      : null;
  const feeds = flags?.feedsObservation;
  if (!Array.isArray(feeds)) return false;
  return feeds.some((raw) => String(raw).toLowerCase() === 'body_map');
}

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
      // 24 Aug 2026: generic `vitals` is not BP — pick the vital from the task name.
      if (key === 'vitals') {
        const fromName = matchNameToObs(input.name);
        if (fromName) return fromName;
        continue;
      }
      // Dual-tag bowel+continence: Bristol sheet for bowel-named tasks.
      if (key === 'continence') {
        const alsoBowel = feeds.some((f) => String(f).toLowerCase() === 'bowel');
        if (alsoBowel && /bowel/i.test(input.name)) continue;
      }
      // Dual-tag reposition + skin: turning chart, not skin integrity.
      if (key === 'skin_integrity' && /reposition/i.test(input.name)) continue;
      // Generic wellbeing is Mood — Sleep uses the same catalogue tag.
      if (key === 'wellbeing') {
        if (/\bsleep\b/i.test(input.name)) {
          return {
            linkTab: 'obs',
            linkedTypeCode: 'sleep',
            observationTypeCode: 'SLEEP',
          };
        }
        const fromName = matchNameToObs(input.name);
        if (fromName) return fromName;
        return {
          linkTab: 'obs',
          linkedTypeCode: 'mood_wellbeing',
          observationTypeCode: 'WELLBEING',
        };
      }
      const mapped = FEEDS_TO_OBS[key];
      if (mapped) return { linkTab: 'obs', ...mapped };
    }
  }

  return matchNameToObs(input.name);
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
