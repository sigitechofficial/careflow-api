/** Inputs for the office notification body of an ECM exception alert. */
export type EcmAlertMessageInput = {
  kind: string;
  /** Exception title — used as the lead-in for kinds without a dedicated sentence. */
  title: string;
  /** e.g. "Morning — Harry" (already carries the preferred name). */
  jobName: string;
  /** e.g. "Harry Max". */
  serviceUserFullName: string;
  carerName?: string | null;
  startVarianceMinutes?: number | null;
  actualDurationMinutes?: number | null;
  plannedDurationMinutes?: number | null;
  /** Unable-to-start reason label. */
  reasonLabel?: string | null;
  /** Free text from the carer (SOS message / outside-area note). */
  carerNote?: string | null;
};

/**
 * Plain-sentence notification body, e.g.
 * "Ali Khan arrived 25 min late for Morning — Harry (Harry Max)."
 */
export function buildEcmAlertMessage(input: EcmAlertMessageInput): string {
  const visit = `${input.jobName} (${input.serviceUserFullName})`;
  const carer = input.carerName?.trim() || null;
  const who = carer ?? 'Carer';
  const note = input.carerNote?.trim() || null;
  const start = input.startVarianceMinutes;
  const actual = input.actualDurationMinutes;
  const planned = input.plannedDurationMinutes;

  switch (input.kind) {
    case 'LATE_ARRIVAL':
    case 'VERY_LATE_ARRIVAL':
      return start != null && start > 0
        ? `${who} arrived ${start} min late for ${visit}.`
        : `${who} arrived late for ${visit}.`;
    case 'EARLY_ARRIVAL':
      return start != null && start < 0
        ? `${who} arrived ${Math.abs(start)} min early for ${visit}.`
        : `${who} arrived early for ${visit}.`;
    case 'SHORT_VISIT':
    case 'LONG_VISIT':
    case 'EXCESSIVE_OVERRUN':
      if (actual != null && planned != null) {
        return `${who} stayed ${actual} min of a planned ${planned} min at ${visit}.`;
      }
      break;
    case 'LEFT_VISIT_AREA':
      return `${who} left the visit area during ${visit}. Visit operations are locked until the office allows them to continue.`;
    case 'OUTSIDE_AREA_CHECK_IN_REQUEST':
      return `${who} is outside the visit area for ${visit} and asked the office to allow Manual check-in.${note ? ` Note: "${note}"` : ''}`;
    case 'CARER_SOS':
      return `${who} raised an SOS during ${visit}.${note ? ` Message: "${note}"` : ''}`;
    case 'UNABLE_TO_START': {
      const reason = input.reasonLabel?.trim();
      return `${who} could not start ${visit}${reason ? `: ${reason}` : ''}.`;
    }
  }

  return carer
    ? `${input.title}: ${visit}. Carer: ${carer}.`
    : `${input.title}: ${visit}.`;
}
