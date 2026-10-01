import type { PrismaService } from '../../prisma/prisma.service';
import {
  dayKeyInTimeZone,
  formatHmInTimeZone,
  getOperationalTimeZone,
} from './operational-day.util';
import {
  type DateDisplayFormat,
  formatOrganisationIsoDate,
  resolveDateDisplayFormat,
} from './organisation-display-format.util';

/** Org timezone + date display format used inside notification text. */
export type NotificationDisplay = {
  timeZone: string;
  dateFormat: DateDisplayFormat;
};

export async function loadNotificationDisplay(
  prisma: Pick<PrismaService, 'organisationGeneralSettings'>,
): Promise<NotificationDisplay> {
  const settings = await prisma.organisationGeneralSettings.findFirst({
    select: { timezone: true, dateDisplayFormat: true },
  });
  return {
    timeZone: getOperationalTimeZone(settings?.timezone),
    dateFormat: resolveDateDisplayFormat(settings?.dateDisplayFormat),
  };
}

/** Calendar day of an instant in the org timezone, in the org date format (e.g. 28/09/2026). */
export function formatNotificationDate(instant: Date, display: NotificationDisplay): string {
  return formatOrganisationIsoDate(dayKeyInTimeZone(instant, display.timeZone), display.dateFormat);
}

/** A stored calendar day (UTC midnight, e.g. all-day events) in the org date format. */
export function formatNotificationCalendarDay(day: Date, display: NotificationDisplay): string {
  return formatOrganisationIsoDate(day.toISOString().slice(0, 10), display.dateFormat);
}

/** HH:mm wall clock in the org timezone. */
export function formatNotificationTime(instant: Date, display: NotificationDisplay): string {
  return formatHmInTimeZone(instant, display.timeZone);
}

/** `28/09/2026 at 14:00` */
export function formatNotificationDateTime(instant: Date, display: NotificationDisplay): string {
  return `${formatNotificationDate(instant, display)} at ${formatNotificationTime(instant, display)}`;
}
