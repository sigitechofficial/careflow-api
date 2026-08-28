/** Wave-2 clinical observation payloads: NEWS2, wellbeing, ABC, seizure, urinalysis, infection. */

const EMPLOYEE_STRUCTURED_PAYLOAD_TYPES = new Set([
  'SLEEP',
  'CONTINENCE',
  'PEG_ENTERAL',
  'SKIN_INTEGRITY',
  'BODY_MAP',
  'BOWEL_MOVEMENT',
  'FALLS',
  'REPOSITIONING',
  'MEALS',
  'NEWS2',
  'WELLBEING',
  'ABC_PATTERNS',
  'SEIZURE_CHART',
  'URINALYSIS',
  'INFECTION',
]);

export function shouldValidateEmployeeObservationPayload(typeCode: string): boolean {
  return EMPLOYEE_STRUCTURED_PAYLOAD_TYPES.has(typeCode.toUpperCase());
}

export type WellbeingScoreInput = { dimensionCode: string; level: number };

const URINE_LABELS: Record<string, string> = {
  CLEAR_PALE: 'Clear / pale',
  CLEAR_YELLOW: 'Clear / yellow',
  CLOUDY: 'Cloudy',
  DARK: 'Dark',
  BLOOD_STAINED: 'Blood stained',
  FOUL_SMELL: 'Foul smell',
  INCONTINENCE: 'Incontinent sample',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};

const INFECTION_LABELS: Record<string, string> = {
  COVID_19: 'COVID-19',
  C_DIFF: 'C.diff',
  E_COLI: 'E.coli',
  MRSA: 'MRSA',
  NOROVIRUS: 'Norovirus',
  UTI: 'UTI',
};

export function extractWellbeingScoresFromPayload(payload: unknown): WellbeingScoreInput[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const raw = (payload as Record<string, unknown>).wellbeingScores;
  if (!Array.isArray(raw)) return [];
  const out: WellbeingScoreInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const dimensionCode = String(rec.dimensionCode ?? '')
      .trim()
      .toUpperCase();
    const level = typeof rec.level === 'number' ? rec.level : Number(rec.level);
    if (!dimensionCode || !Number.isInteger(level) || level < 1 || level > 5) continue;
    out.push({ dimensionCode, level });
  }
  return out;
}

export function calculateNews2Score(payload: Record<string, unknown>): number | null {
  const rr = toNum(payload.respirationRate);
  const spo2 = toNum(payload.oxygenSaturation);
  const sys = toNum(payload.systolic);
  const pulse = toNum(payload.pulse);
  const temp = toNum(payload.temperature);
  const air = typeof payload.airOrOxygen === 'string' ? payload.airOrOxygen.trim() : '';
  const con = typeof payload.consciousness === 'string' ? payload.consciousness.trim() : '';
  if (rr == null || spo2 == null || sys == null || pulse == null || temp == null || !air || !con) {
    return null;
  }

  const scoreRr = rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3;
  const scoreSpo2 = spo2 <= 91 ? 3 : spo2 <= 93 ? 2 : spo2 <= 95 ? 1 : 0;
  const scoreO2 = air === 'OXYGEN' ? 2 : 0;
  const scoreSys = sys <= 90 ? 3 : sys <= 100 ? 2 : sys <= 110 ? 1 : sys <= 219 ? 0 : 3;
  const scorePulse =
    pulse <= 40 ? 3 : pulse <= 50 ? 1 : pulse <= 90 ? 0 : pulse <= 110 ? 1 : pulse <= 130 ? 2 : 3;
  const scoreCon = con === 'A' ? 0 : 3;
  const scoreTemp = temp <= 35.0 ? 3 : temp <= 36.0 ? 1 : temp <= 38.0 ? 0 : temp <= 39.0 ? 1 : 2;
  return scoreRr + scoreSpo2 + scoreO2 + scoreSys + scorePulse + scoreCon + scoreTemp;
}

export function formatClinicalObservationValue(
  typeCode: string | undefined,
  payload: Record<string, unknown>,
  numericValue?: number | null,
): string | null {
  const code = (typeCode ?? '').toUpperCase();
  switch (code) {
    case 'NEWS2': {
      const score = numericValue ?? calculateNews2Score(payload);
      return score != null ? `Score ${score}` : null;
    }
    case 'WELLBEING': {
      const scores = extractWellbeingScoresFromPayload(payload);
      if (!scores.length) return null;
      return scores.map((s) => `${s.dimensionCode} ${s.level}`).join(' · ');
    }
    case 'ABC_PATTERNS': {
      const parts: string[] = [];
      const a = asTrim(payload.antecedent);
      const b = asTrim(payload.behaviour) || asTrim(payload.behavior);
      const c = asTrim(payload.consequences) || asTrim(payload.consequence);
      if (a) parts.push(`A: ${truncate(a, 40)}`);
      if (b) parts.push(`B: ${truncate(b, 40)}`);
      if (c) parts.push(`C: ${truncate(c, 40)}`);
      const abcAction = asTrim(payload.actionTaken);
      if (abcAction) parts.push(`Action: ${truncate(abcAction, 40)}`);
      const risk = asTrim(payload.riskLevel);
      if (risk) parts.push(`Risk: ${risk.replace(/_/g, ' ')}`);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'SEIZURE_CHART': {
      const parts: string[] = [];
      const description = asTrim(payload.description);
      const length = asTrim(payload.lengthOfSeizure);
      if (description) parts.push(truncate(description, 40));
      if (length) parts.push(`${length} min`);
      const type = asTrim(payload.type);
      if (type) parts.push(type.replace(/_/g, ' '));
      const recovery = asTrim(payload.recovery);
      if (recovery) parts.push(recovery.replace(/_/g, ' '));
      const rescue = asTrim(payload.rescueMed);
      if (rescue) parts.push(`Rescue: ${rescue}`);
      const seizureInjury = asTrim(payload.injury);
      if (seizureInjury) parts.push(`Injury: ${seizureInjury}`);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'URINALYSIS': {
      const parts: string[] = [];
      const obs = asTrim(payload.observationOfUrine);
      if (obs) {
        parts.push(
          obs === 'OTHER'
            ? asTrim(payload.observationOfUrineOther) || 'Other'
            : URINE_LABELS[obs] ?? obs.replace(/_/g, ' '),
        );
      }
      const dip = asTrim(payload.dipstick);
      if (dip && dip !== 'NOT_TAKEN') parts.push(`Dipstick: ${dip.replace(/_/g, ' ')}`);
      const urineAction = asTrim(payload.actionTaken);
      if (urineAction) parts.push(`Action: ${urineAction}`);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'INFECTION': {
      const parts: string[] = [];
      const type = asTrim(payload.infectionType);
      if (type) parts.push(INFECTION_LABELS[type] ?? type.replace(/_/g, ' '));
      if (payload.infectionCleared === true) parts.push('Cleared');
      if (payload.hospitalisation === true) parts.push('Hospitalised');
      if (payload.isolationRequired === true) parts.push('Isolation');
      return parts.length ? parts.join(' · ') : null;
    }
    default:
      return null;
  }
}

function toNum(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function asTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
