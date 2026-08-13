/** Allowed IANA timezones for OrganisationGeneralSettings.timezone */
export const ORGANISATION_TIMEZONES = [
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Warsaw',
  'Europe/Bucharest',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

export type OrganisationTimezone = (typeof ORGANISATION_TIMEZONES)[number];

export const DEFAULT_ORGANISATION_TIMEZONE: OrganisationTimezone = 'Europe/London';

export function isOrganisationTimezone(value: string): value is OrganisationTimezone {
  return (ORGANISATION_TIMEZONES as readonly string[]).includes(value);
}
