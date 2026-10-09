/**
 * Bank holiday calendars. `UK` is the original region and holds England & Wales dates; scheduling
 * and charges keep reading it. Scotland and Northern Ireland have their own calendars.
 */
export const DEFAULT_BANK_HOLIDAY_REGION = 'UK';

export const BANK_HOLIDAY_REGIONS = ['UK', 'SCOTLAND', 'NORTHERN_IRELAND'] as const;
export type BankHolidayRegion = (typeof BANK_HOLIDAY_REGIONS)[number];

export const BANK_HOLIDAY_REGION_LABELS: Record<BankHolidayRegion, string> = {
  UK: 'England & Wales',
  SCOTLAND: 'Scotland',
  NORTHERN_IRELAND: 'Northern Ireland',
};

/** GOV.UK bank-holidays.json division → stored region. */
export const GOV_UK_DIVISION_REGION: Record<string, BankHolidayRegion> = {
  'england-and-wales': 'UK',
  scotland: 'SCOTLAND',
  'northern-ireland': 'NORTHERN_IRELAND',
};

export function isBankHolidayRegion(value: unknown): value is BankHolidayRegion {
  return typeof value === 'string' && (BANK_HOLIDAY_REGIONS as readonly string[]).includes(value);
}
