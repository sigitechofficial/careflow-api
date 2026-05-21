/** UTC calendar day at 00:00:00.000 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Inclusive end of a calendar display day (23:59:59.999 UTC). */
export function endOfUtcDisplayDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Parse `YYYY-MM-DD` to UTC end-of-day for storage and expiry checks. */
export function parseDisplayUntilInput(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error('displayUntil must be YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error('displayUntil is not a valid calendar date');
  }
  return endOfUtcDisplayDay(probe);
}

export function isDisplayUntilOnOrAfterToday(displayUntil: Date, now = new Date()): boolean {
  return startOfUtcDay(displayUntil).getTime() >= startOfUtcDay(now).getTime();
}

/** Message is expired after the inclusive display-until day has ended. */
export function isDisplayUntilExpired(displayUntil: Date, now = new Date()): boolean {
  return now.getTime() > endOfUtcDisplayDay(displayUntil).getTime();
}
