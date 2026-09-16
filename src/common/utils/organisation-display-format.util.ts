/**
 * Organisation date / time display formats (Settings → General).
 * Calendar days are YYYY-MM-DD labels; instants must already be converted via ops TZ.
 */

export const DATE_DISPLAY_FORMATS = [
  'DD_MM_YYYY',
  'MM_DD_YYYY',
  'YYYY_MM_DD',
] as const;

export const TIME_DISPLAY_FORMATS = ['HH_MM', 'HH_XX'] as const;

export type DateDisplayFormat = (typeof DATE_DISPLAY_FORMATS)[number];
export type TimeDisplayFormat = (typeof TIME_DISPLAY_FORMATS)[number];

export const DEFAULT_DATE_DISPLAY_FORMAT: DateDisplayFormat = 'DD_MM_YYYY';
export const DEFAULT_TIME_DISPLAY_FORMAT: TimeDisplayFormat = 'HH_MM';

export function resolveDateDisplayFormat(
  value?: string | null,
): DateDisplayFormat {
  if (
    value === 'MM_DD_YYYY' ||
    value === 'YYYY_MM_DD' ||
    value === 'DD_MM_YYYY'
  ) {
    return value;
  }
  return DEFAULT_DATE_DISPLAY_FORMAT;
}

export function resolveTimeDisplayFormat(
  value?: string | null,
): TimeDisplayFormat {
  if (value === 'HH_XX' || value === 'HH_MM') return value;
  return DEFAULT_TIME_DISPLAY_FORMAT;
}

/** Format a YYYY-MM-DD calendar day with the organisation date display format. */
export function formatOrganisationIsoDate(
  isoDate: string,
  format: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate?.trim() ?? '');
  if (!match) return isoDate ?? '';
  const [, year, month, day] = match;
  switch (format) {
    case 'MM_DD_YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY_MM_DD':
      return `${year}-${month}-${day}`;
    case 'DD_MM_YYYY':
    default:
      return `${day}/${month}/${year}`;
  }
}

/** Format HH:mm (ops TZ wall clock) with the organisation time display format. */
export function formatOrganisationHm(
  hm: string,
  format: TimeDisplayFormat = DEFAULT_TIME_DISPLAY_FORMAT,
): string {
  const trimmed = hm?.trim() ?? '';
  if (!trimmed) return '';
  if (format === 'HH_XX') {
    const hour = trimmed.split(':')[0];
    return hour ?? trimmed;
  }
  return trimmed;
}
