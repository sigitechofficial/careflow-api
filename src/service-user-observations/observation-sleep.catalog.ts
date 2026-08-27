export const SLEEP_QUALITY_CODES = [
  'SETTLED',
  'RESTLESS',
  'DISTURBED',
  'DID_NOT_SLEEP',
] as const;

export const SLEEP_REASON_CODES = ['PAIN', 'TOILET', 'NOISE', 'ANXIETY', 'UNKNOWN'] as const;

export const SLEEP_QUALITY_OPTIONS = [
  { value: 'SETTLED', label: 'Settled' },
  { value: 'RESTLESS', label: 'Restless' },
  { value: 'DISTURBED', label: 'Disturbed' },
  { value: 'DID_NOT_SLEEP', label: 'Did not sleep' },
] as const;

export const SLEEP_REASON_OPTIONS = [
  { value: 'PAIN', label: 'Pain' },
  { value: 'TOILET', label: 'Toilet' },
  { value: 'NOISE', label: 'Noise' },
  { value: 'ANXIETY', label: 'Anxiety' },
  { value: 'UNKNOWN', label: 'Unknown' },
] as const;

const QUALITY_SET = new Set<string>(SLEEP_QUALITY_CODES);
const REASON_SET = new Set<string>(SLEEP_REASON_CODES);

export function isSleepQualityCode(value: string): boolean {
  return QUALITY_SET.has(value);
}

export function isSleepReasonCode(value: string): boolean {
  return REASON_SET.has(value);
}

export function sleepQualityNeedsReasons(quality: string): boolean {
  return quality === 'RESTLESS' || quality === 'DISTURBED' || quality === 'DID_NOT_SLEEP';
}

export function sleepQualityLabel(code: string): string {
  return SLEEP_QUALITY_OPTIONS.find((o) => o.value === code)?.label ?? code.replace(/_/g, ' ');
}

export function sleepReasonLabel(code: string): string {
  return SLEEP_REASON_OPTIONS.find((o) => o.value === code)?.label ?? code.replace(/_/g, ' ');
}

/** Accept `reasons: string[]` or legacy `reason: string`. */
export function normalizeSleepReasons(payload: Record<string, unknown>): string[] {
  const fromArray = payload.reasons;
  if (Array.isArray(fromArray)) {
    return fromArray
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }
  const fromString =
    typeof payload.reasons === 'string'
      ? payload.reasons
      : typeof payload.reason === 'string'
        ? payload.reason
        : '';
  if (!fromString.trim()) return [];
  return fromString
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatSleepObservationValue(payload: Record<string, unknown>): string | null {
  const quality = typeof payload.quality === 'string' ? payload.quality.trim() : '';
  if (!quality) return null;
  const qualityLabel = sleepQualityLabel(quality);
  if (!sleepQualityNeedsReasons(quality)) return qualityLabel;
  const reasons = normalizeSleepReasons(payload)
    .filter(isSleepReasonCode)
    .map(sleepReasonLabel);
  return reasons.length ? `${qualityLabel} · ${reasons.join(', ')}` : qualityLabel;
}
