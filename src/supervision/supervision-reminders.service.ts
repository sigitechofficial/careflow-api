import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule, NotificationSeverity, NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { resolveManagerUserIds } from '../notifications/resolve-manager-recipients';
import { MailService } from '../mail/mail.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { SupervisionSettings } from '../organisation-general-settings/supervision-settings.util';
import { isoDateInTimeZone } from '../jobs/job-catalogue';
import { collectReviewDues, currentStaffWhere, type ReviewDue } from '../employee-reviews/review-dues';
import { daysUntil, dueText, reminderAudience, remindersDue, type DueReminder } from './supervision-reminder.util';

export type SupervisionReminderSummary = {
  timeZone: string;
  today: string;
  reviewsChecked: number;
  sent: number;
  alreadySent: number;
  skippedBooked: number;
  noRecipients: number;
  failed: number;
};

type Candidate = ReviewDue;

type CarerInfo = {
  label: string;
  locationId: string | null;
  supervisor: { id: string; email: string } | null;
};

/** Sessions still to happen (or to finish) count as "booked". */
const OPEN_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'AWAITING_SIGN_OFF'] as const;

/**
 * Daily supervision-due reminders (job `supervision-reminders`, Settings → Supervision → Reminders).
 * Works from each review type's schedule (collectReviewDues): supervision, spot checks, appraisals,
 * probation and induction milestones from the start date, and follow-ups of event types. New
 * starters are covered before anything has been recorded for them.
 */
@Injectable()
export class SupervisionRemindersService {
  private readonly logger = new Logger(SupervisionRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    @Optional() private readonly push?: FcmPushService,
    @Optional() private readonly mail?: MailService,
  ) {}

  async sendDueReminders(now = new Date()): Promise<SupervisionReminderSummary> {
    const [settings, timeZone] = await Promise.all([
      this.orgSettings.getSupervisionSettings(),
      this.orgSettings.getOperationalTimezone(),
    ]);
    const today = isoDateInTimeZone(now, timeZone);
    const summary: SupervisionReminderSummary = {
      timeZone,
      today,
      reviewsChecked: 0,
      sent: 0,
      alreadySent: 0,
      skippedBooked: 0,
      noRecipients: 0,
      failed: 0,
    };

    const { dues: candidates } = await collectReviewDues(this.prisma, currentStaffWhere(now));
    summary.reviewsChecked = candidates.length;
    if (!candidates.length) return summary;

    const employeeIds = [...new Set(candidates.map((c) => c.employeeId))];
    const [carers, booked] = await Promise.all([this.carers(employeeIds), this.bookings(employeeIds)]);
    const managersByLocation = new Map<string, string[]>();
    const managersFor = async (locationId: string | null) => {
      const key = locationId ?? '';
      if (!managersByLocation.has(key)) {
        managersByLocation.set(key, await resolveManagerUserIds(this.prisma as unknown as PrismaClient, { locationId }));
      }
      return managersByLocation.get(key)!;
    };

    for (const c of candidates) {
      const carer = carers.get(c.employeeId);
      if (!carer) continue;
      const dueIso = c.nextDue.toISOString().slice(0, 10);
      const bookedAt = booked.get(`${c.employeeId}:${c.reviewTypeId}`) ?? null;
      for (const reminder of remindersDue(daysUntil(dueIso, today), settings)) {
        if (reminder.beforeDue && bookedAt && bookedAt.toISOString().slice(0, 10) <= dueIso) {
          summary.skippedBooked += 1;
          continue;
        }
        const audience = reminderAudience(reminder, settings, Boolean(carer.supervisor));
        const staff = new Set<string>();
        if (audience.supervisor && carer.supervisor) staff.add(carer.supervisor.id);
        if (audience.managers) for (const id of await managersFor(carer.locationId)) staff.add(id);
        if (!staff.size && !audience.carer) {
          summary.noRecipients += 1;
          continue;
        }
        const outcome = await this.deliver(c, carer, reminder, [...staff], audience.carer, bookedAt, settings, timeZone);
        summary[outcome] += 1;
      }
    }
    this.logger.log(
      `Supervision reminders (${today} ${timeZone}): checked=${summary.reviewsChecked} sent=${summary.sent} ` +
        `already=${summary.alreadySent} booked=${summary.skippedBooked} none=${summary.noRecipients} failed=${summary.failed}`,
    );
    return summary;
  }

  private async carers(employeeIds: string[]): Promise<Map<string, CarerInfo>> {
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true, username: true } },
        employment: {
          select: {
            employeeNumber: true,
            locationId: true,
            baseLocationId: true,
            supervisor: { select: { id: true, email: true, isActive: true, deletedAt: true } },
          },
        },
      },
    });
    const map = new Map<string, CarerInfo>();
    for (const e of rows) {
      const name = [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ') || 'Carer';
      const number = e.employment?.employeeNumber?.trim();
      const username = e.personalDetail?.username?.trim();
      const ref = number ? `#${number}` : username ? `@${username}` : `ID ${e.id.slice(0, 8)}`;
      const sup = e.employment?.supervisor;
      map.set(e.id, {
        label: `${name} (${ref})`,
        locationId: e.employment?.locationId ?? e.employment?.baseLocationId ?? null,
        supervisor: sup && sup.isActive && !sup.deletedAt ? { id: sup.id, email: sup.email } : null,
      });
    }
    return map;
  }

  /** Earliest open session per carer and review type. */
  private async bookings(employeeIds: string[]): Promise<Map<string, Date>> {
    const rows = await this.prisma.supervisionSession.findMany({
      where: {
        deletedAt: null,
        status: { in: [...OPEN_STATUSES] },
        attendees: { some: { employeeId: { in: employeeIds } } },
      },
      select: { reviewTypeId: true, scheduledAt: true, attendees: { select: { employeeId: true } } },
    });
    const map = new Map<string, Date>();
    for (const s of rows) {
      for (const a of s.attendees) {
        const key = `${a.employeeId}:${s.reviewTypeId}`;
        const current = map.get(key);
        if (!current || s.scheduledAt < current) map.set(key, s.scheduledAt);
      }
    }
    return map;
  }

  /**
   * Claims the reminder first (unique per review, due date and kind) so it is never sent twice,
   * then sends. If nothing could be delivered the claim is released for the next run.
   */
  private async deliver(
    c: Candidate,
    carer: CarerInfo,
    reminder: DueReminder,
    staffUserIds: string[],
    pushCarer: boolean,
    bookedAt: Date | null,
    settings: SupervisionSettings,
    timeZone: string,
  ): Promise<'sent' | 'alreadySent' | 'failed'> {
    let logId: string;
    try {
      const log = await this.prisma.supervisionReminderLog.create({
        data: {
          employeeReviewId: c.trackerId,
          employeeId: c.employeeId,
          reviewTypeId: c.reviewTypeId,
          dueDate: c.nextDue,
          kind: reminder.kind,
        },
        select: { id: true },
      });
      logId = log.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'alreadySent';
      throw err;
    }

    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    const when = dueText(reminder.days);
    const title = reminder.escalation
      ? `Escalation: ${c.typeName} ${when} — ${carer.label}`
      : `${c.typeName} ${when} — ${carer.label}`;
    const message =
      `${c.typeName} for ${carer.label} is ${when} (due ${fmt(c.nextDue)}). ` +
      (bookedAt ? `A session is booked for ${fmt(bookedAt)}.` : 'No session is booked yet.') +
      (reminder.escalation ? ' Sent to branch managers because it is overdue.' : '');
    const href = `/employee/${c.employeeId}/edit?tab=staff-reviews`;

    // People who turned "Supervision due" off in their preferences get neither the notification nor the email.
    const optedOut = await this.optedOut(staffUserIds);
    const staff = staffUserIds.filter((id) => !optedOut.has(id));
    let notified: string[] = [];
    if (staff.length) {
      try {
        await this.notifications.notifyUsers({
          recipientUserIds: staff,
          type: NotificationType.SUPERVISION_DUE,
          title,
          message,
          module: NotificationModule.EMPLOYEE,
          severity: reminder.days < 0 ? NotificationSeverity.WARNING : NotificationSeverity.INFO,
          recordType: c.trackerId ? 'EmployeeReview' : 'Employee',
          recordId: c.trackerId ?? c.employeeId,
          metadata: { href, employeeId: c.employeeId, reviewTypeId: c.reviewTypeId, reminderKind: reminder.kind, dueDate: c.nextDue },
        });
        notified = staff;
      } catch (err) {
        this.logger.warn(`Supervision reminder ${c.employeeId}/${c.reviewTypeId} ${reminder.kind}: in-app failed: ${(err as Error).message}`);
      }
    }

    let carerPushed = false;
    if (pushCarer && this.push) {
      try {
        const report = await this.push.sendToEmployees([c.employeeId], {
          title: `${c.typeName} ${when}`,
          body: bookedAt
            ? `Your ${c.typeName.toLowerCase()} is booked for ${fmt(bookedAt)}.`
            : `Your ${c.typeName.toLowerCase()} is due ${fmt(c.nextDue)}. Your supervisor will arrange a time.`,
          data: { type: 'SUPERVISION_DUE', employeeId: c.employeeId, reviewTypeId: c.reviewTypeId },
        }, 'supervision-reminders');
        carerPushed = report.sent > 0;
      } catch (err) {
        this.logger.warn(`Supervision reminder ${c.employeeId}/${c.reviewTypeId}: push failed: ${(err as Error).message}`);
      }
    }

    const emailed = settings.emailReminders && staff.length ? await this.email(staff, title, message, href) : false;

    if (!notified.length && !carerPushed && !emailed) {
      await this.prisma.supervisionReminderLog.delete({ where: { id: logId } }).catch(() => undefined);
      return 'failed';
    }
    await this.prisma.supervisionReminderLog.update({
      where: { id: logId },
      data: { recipientUserIds: notified, carerPushed, emailed },
    });
    return 'sent';
  }

  private async optedOut(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type: NotificationType.SUPERVISION_DUE, inAppEnabled: false },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private async email(userIds: string[], subject: string, text: string, href: string): Promise<boolean> {
    if (!this.mail) return false;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null, isActive: true },
      select: { email: true },
    });
    const to = users.map((u) => u.email).filter(Boolean);
    if (!to.length) return false;
    const base = this.config.get<string>('app.adminAppUrl', '');
    const link = base ? `${base}${href}` : null;
    try {
      // One message per person so staff never see each other's addresses.
      for (const address of to) {
        await this.mail.send({ kind: 'supervision-reminders', to: address, subject, text: link ? `${text}\n\nOpen the staff record: ${link}` : text });
      }
      return true;
    } catch (err) {
      this.logger.warn(`Supervision reminder email failed: ${(err as Error).message}`);
      return false;
    }
  }
}
