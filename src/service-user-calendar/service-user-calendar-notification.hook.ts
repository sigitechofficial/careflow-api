import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationModule, NotificationSeverity, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  formatNotificationCalendarDay,
  formatNotificationDateTime,
  loadNotificationDisplay,
} from '../common/utils/notification-display.util';

type CalendarEventRow = {
  id: string;
  title: string;
  startDateTime: Date;
  allDay?: boolean;
  eventType?: { code: string; name: string } | null;
};

type CalendarServiceUserName = {
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
};

/**
 * Optional notification fan-out for service user calendar reminders.
 * Does not schedule future jobs — immediate notify only when flags are set on create/update.
 */
@Injectable()
export class ServiceUserCalendarNotificationHook {
  private readonly logger = new Logger(ServiceUserCalendarNotificationHook.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async createReminderNotificationIfNeeded(params: {
    event: CalendarEventRow;
    serviceUser?: CalendarServiceUserName | null;
    recipientUserIds: string[];
    notifyKeyWorker: boolean;
    notifyNamedNurse: boolean;
    notifyManager: boolean;
    reminderBeforeMinutes?: number | null;
  }): Promise<void> {
    const { event, recipientUserIds } = params;
    const hasNotify =
      params.notifyKeyWorker ||
      params.notifyNamedNurse ||
      params.notifyManager ||
      (params.reminderBeforeMinutes != null && params.reminderBeforeMinutes > 0);

    if (!hasNotify || !recipientUserIds.length) {
      if (hasNotify && !this.notifications) {
        this.logger.debug(
          `[TODO] Calendar reminder for event ${event.id}: NotificationsService not configured`,
        );
      }
      return;
    }

    if (!this.notifications) {
      this.logger.debug(`[TODO] Calendar reminder for event ${event.id}: skip — no notification service`);
      return;
    }

    const typeCode = event.eventType?.code ?? 'OTHER';
    const notificationType = this.mapEventTypeToNotificationType(typeCode);
    const title = this.buildTitle(typeCode, event.title);
    const message = await this.buildMessage(event, params.serviceUser);

    try {
      await this.notifications.notifyUsers({
        recipientUserIds,
        type: notificationType,
        title,
        message,
        module: NotificationModule.SERVICE_CARE,
        severity: NotificationSeverity.INFO,
        metadata: {
          calendarEventId: event.id,
          eventTypeCode: typeCode,
          reminderBeforeMinutes: params.reminderBeforeMinutes ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Calendar notification failed: ${(err as Error).message}`);
    }
  }

  /** `Harry Max — GP appointment on 28/09/2026 at 11:00.` (org timezone + date format). */
  private async buildMessage(
    event: CalendarEventRow,
    serviceUser?: CalendarServiceUserName | null,
  ): Promise<string> {
    const suName =
      [serviceUser?.firstName, serviceUser?.lastName].filter(Boolean).join(' ').trim() ||
      serviceUser?.preferredName?.trim() ||
      null;
    const what = event.eventType?.name ?? 'Event';
    const display = await loadNotificationDisplay(this.prisma);
    const when = event.allDay
      ? `on ${formatNotificationCalendarDay(event.startDateTime, display)} (all day)`
      : `on ${formatNotificationDateTime(event.startDateTime, display)}`;
    return `${suName ? `${suName} — ` : ''}${what} ${when}.`;
  }

  private mapEventTypeToNotificationType(code: string): NotificationType {
    switch (code) {
      case 'BIRTHDAY':
        return NotificationType.BIRTHDAY_REMINDER;
      case 'GP_APPOINTMENT':
        return NotificationType.GP_APPOINTMENT_REMINDER;
      case 'HOSPITAL_APPOINTMENT':
        return NotificationType.HOSPITAL_APPOINTMENT_REMINDER;
      case 'CARE_REVIEW':
        return NotificationType.CARE_REVIEW_REMINDER;
      case 'MEDICATION_REVIEW':
        return NotificationType.MEDICATION_REVIEW_REMINDER;
      case 'ASSESSMENT':
        return NotificationType.ASSESSMENT_DUE_REMINDER;
      case 'CUSTOMER_EVENT':
      case 'APPOINTMENT':
      default:
        return NotificationType.APPOINTMENT_REMINDER;
    }
  }

  private buildTitle(typeCode: string, eventTitle: string): string {
    const labels: Record<string, string> = {
      CUSTOMER_EVENT: 'Customer event reminder',
      BIRTHDAY: 'Birthday reminder',
      APPOINTMENT: 'Appointment reminder',
      GP_APPOINTMENT: 'GP appointment reminder',
      HOSPITAL_APPOINTMENT: 'Hospital appointment reminder',
      CARE_REVIEW: 'Care review reminder',
      MEDICATION_REVIEW: 'Medication review reminder',
      ASSESSMENT: 'Assessment due reminder',
    };
    const prefix = labels[typeCode] ?? 'Calendar reminder';
    return `${prefix}: ${eventTitle}`;
  }
}
